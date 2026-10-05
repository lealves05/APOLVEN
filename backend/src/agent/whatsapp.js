// WhatsApp Business — API oficial Cloud (Meta Graph API).
// Credenciais (token de acesso e segredo do app) ficam cifradas no cofre (secretbox, finalidade própria por corretora);
// nunca vão para log nem voltam ao navegador.
import crypto from 'node:crypto';
import { seal, unseal } from '../secretbox.js';

const GRAPH = () => (process.env.WA_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
const purpose = (companyId) => `wa:${companyId}`;

export const sealSecrets = (companyId, obj) => seal(obj, purpose(companyId));
export function readSecrets(row) {
  if (!row?.secrets) return {};
  try { return unseal(row.secrets, purpose(row.company_id)); } catch { return {}; }
}

/** Pronto para enviar? (número, token e segredo do app cadastrados). */
export function credentials(row) {
  const s = readSecrets(row);
  return { token: s.access_token || null, appSecret: s.app_secret || null, phoneNumberId: row?.phone_number_id || null,
    ready: !!(s.access_token && s.app_secret && row?.phone_number_id) };
}

/** Confere X-Hub-Signature-256 = sha256=HMAC(app_secret, corpo bruto) em tempo constante. */
export function validSignature(raw, header, appSecret) {
  if (!raw || !header || !appSecret || !String(header).startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const got = String(header).slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Telefone → wa_id (só dígitos, DDI 55 quando faltar). */
export function toWaId(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

/** Mesmo número com e sem o nono dígito (o WhatsApp devolve celulares brasileiros antigos sem ele). */
export function phoneVariants(waId) {
  const d = String(waId || '').replace(/\D/g, '');
  const out = new Set([d]);
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith('55') && d.length === 12) out.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...out];
}

async function graph(path, token, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${GRAPH()}${path}`, {
      method: body ? 'POST' : 'GET', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, code: data?.error?.code, error: String(data?.error?.message || `HTTP ${res.status}`).slice(0, 300) };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'Tempo esgotado ao contatar o WhatsApp.' : 'Não foi possível contatar o WhatsApp.' };
  } finally { clearTimeout(timer); }
}

/** Testa a conexão lendo os dados do número. */
export async function testConnection(row) {
  const c = credentials(row);
  if (!c.ready) return { ok: false, error: 'Preencha o ID do número, o token de acesso e o segredo do app.' };
  const r = await graph(`/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, c.token);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, display_phone_number: r.data.display_phone_number, verified_name: r.data.verified_name, quality_rating: r.data.quality_rating };
}

/**
 * Envia texto (só dentro da janela de 24 h aberta pelo destinatário) ou modelo aprovado.
 * msg: { text } | { template: { name, lang, params[] } }
 */
export async function send(row, to, msg) {
  const c = credentials(row);
  if (!c.ready) return { ok: false, error: 'Integração com o WhatsApp não configurada.' };
  const waTo = toWaId(to) || String(to).replace(/\D/g, '');
  // a Meta não aceita quebra de linha, tabulação nem 4+ espaços seguidos nas variáveis do modelo
  const clean = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000) || '-';
  const body = msg.template
    ? { messaging_product: 'whatsapp', to: waTo, type: 'template', template: {
      name: msg.template.name, language: { code: msg.template.lang || 'pt_BR' },
      ...(msg.template.params?.length ? { components: [{ type: 'body', parameters: msg.template.params.map((t) => ({ type: 'text', text: clean(t) })) }] } : {}) } }
    : { messaging_product: 'whatsapp', to: waTo, type: 'text', text: { body: String(msg.text || '').slice(0, 4096), preview_url: false } };
  const r = await graph(`/${encodeURIComponent(c.phoneNumberId)}/messages`, c.token, body);
  return r.ok ? { ok: true, id: r.data?.messages?.[0]?.id || null } : { ok: false, error: r.error, code: r.code };
}

/** Mensagens recebidas e status de entrega de um POST do webhook. */
export function parseWebhook(payload) {
  const messages = [];
  const statuses = [];
  for (const e of payload?.entry || []) {
    for (const ch of e?.changes || []) {
      const v = ch?.value || {};
      const pnid = v?.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : null;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));
      for (const m of v.messages || []) {
        let text = null;
        if (m.type === 'text') text = m.text?.body || '';
        else if (m.type === 'button') text = m.button?.text || m.button?.payload || '';
        else if (m.type === 'interactive') text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
        messages.push({ phoneNumberId: pnid, from: String(m.from), id: String(m.id), name: names[m.from] || null, type: m.type, text });
      }
      for (const s of v.statuses || []) statuses.push({ phoneNumberId: pnid, id: String(s.id), status: String(s.status), error: s.errors?.[0]?.title || null });
    }
  }
  return { messages, statuses };
}
