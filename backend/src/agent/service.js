// Agente do WhatsApp: conversas, registro das mensagens, envio e autoatendimento das mensagens recebidas.
// Regras: o agente nunca promete cobertura, aceite ou valor; dados de apólice/parcela só depois de conferir a
// identidade (3 primeiros dígitos do CPF/CNPJ ou data de nascimento); "SAIR" interrompe os avisos automáticos;
// em atendimento humano o agente fica em silêncio; conversa simulada nunca envia nada.
import { q, one, tx } from '../db.js';
import { withDefaults, today, BRANCHES, onlyDigits, randomToken, sha256 } from '../util.js';
import { nextNumber, docNumber } from '../lib/common.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';
import { agentSettings, render } from './config.js';
import { send, toWaId, phoneVariants, credentials } from './whatsapp.js';

const money = (c) => (c == null ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const br = (d) => String(d || '').slice(0, 10).split('-').reverse().join('/');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const PUBLIC_URL_DEFAULT = 'https://apolven.lorler.com.br';

/** Agente da corretora (linha + configuração completa + dados da empresa). Cria a linha na primeira vez. */
export async function loadAgent(companyId) {
  let row = await one('select * from wa_agents where company_id = $1', [companyId]);
  if (!row) {
    row = await one(`insert into wa_agents (company_id, verify_token) values ($1, $2) on conflict (company_id) do update set company_id = excluded.company_id returning *`,
      [companyId, randomToken(16)]);
  }
  const company = await one('select id, name, trade_name, phone, settings, is_demo from companies where id = $1', [companyId]);
  company.settings = withDefaults(company.settings);
  return { row, company, cfg: agentSettings(row.settings), name: row.name || 'Assistente', brand: company.trade_name || company.name };
}

/** Pode enviar mensagens reais? */
export const canSend = (agent) => !!(agent?.row?.enabled && credentials(agent.row).ready);

export async function getConversation(companyId, phone, { simulated = false, name = null } = {}) {
  const c = await one(`insert into wa_conversations (company_id, phone, simulated, contact_name) values ($1,$2,$3,$4)
     on conflict (company_id, phone, simulated) do update set contact_name = coalesce(wa_conversations.contact_name, excluded.contact_name)
     returning *`, [companyId, phone, simulated, name]);
  c.context ||= {};
  return c;
}

export async function saveConversation(conv) {
  await q(`update wa_conversations set client_id = $3, user_id = $4, status = $5, context = $6, handoff_reason = $7, handoff_at = $8,
      verified_until = $9, opted_out_at = $10, assigned_user_id = $11, contact_name = $12, updated_at = now() where id = $1 and company_id = $2`,
  [conv.id, conv.company_id, conv.client_id || null, conv.user_id || null, conv.status || 'agente', JSON.stringify(conv.context || {}), conv.handoff_reason || null,
    conv.handoff_at || null, conv.verified_until || null, conv.opted_out_at || null, conv.assigned_user_id || null, conv.contact_name || null]);
}

export async function logMessage(conv, m) {
  return one(`insert into wa_messages (company_id, conversation_id, direction, kind, body, template_name, wa_message_id, status, error, routine, entity, entity_id, sent_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing returning id`,
  [conv.company_id, conv.id, m.direction, m.kind || 'text', m.body ?? null, m.template_name || null, m.wa_message_id || null,
    m.status || (m.direction === 'in' ? 'recebida' : 'enviada'), m.error || null, m.routine || null, m.entity || null, m.entity_id || null, m.sent_by || null]);
}

/** Janela de 24 h aberta pelo destinatário (texto livre permitido). */
export const windowOpen = (conv) => !!(conv.last_inbound_at && Date.now() - new Date(conv.last_inbound_at).getTime() < 24 * 3600 * 1000);

/**
 * Envia (ou simula) e registra. msg: { text } | { template: { name, lang, params } }; `text` acompanha o modelo
 * só para o histórico ficar legível.
 */
export async function deliver(agent, conv, msg, extra = {}) {
  let status = 'simulada'; let error = null; let waId = null;
  // demonstração nunca envia: registra como simulada
  if (!conv.simulated && !agent.company.is_demo) {
    if (!canSend(agent)) { status = 'falhou'; error = 'Agente desligado ou WhatsApp não configurado.'; }
    else {
      const r = await send(agent.row, conv.phone, msg.template ? { template: msg.template } : { text: msg.text });
      status = r.ok ? 'enviada' : 'falhou'; error = r.ok ? null : r.error; waId = r.id || null;
      if (!r.ok) await q('update wa_agents set last_error = $2, updated_at = now() where company_id = $1', [conv.company_id, String(r.error).slice(0, 300)]);
    }
  }
  const body = msg.text ?? `[modelo ${msg.template?.name}] ${(msg.template?.params || []).join(' | ')}`;
  const saved = await logMessage(conv, { direction: 'out', kind: msg.template ? 'template' : 'text', body, template_name: msg.template?.name, wa_message_id: waId, status, error, ...extra });
  if (status !== 'falhou') await q('update wa_conversations set last_outbound_at = now(), updated_at = now() where id = $1', [conv.id]);
  return { ok: status !== 'falhou', status, error, message_id: saved?.id || null };
}

/** Cliente (ou usuário da equipe) pelo número. */
export async function whoIs(companyId, waId) {
  const vars = phoneVariants(waId);
  const client = await one(`select id, name, document, birth_date, owner_user_id, phone from clients
     where company_id = $1 and merged_into is null and active and phone is not null
       and (regexp_replace(phone, '\\D', '', 'g') = any($2) or '55' || regexp_replace(phone, '\\D', '', 'g') = any($2))
     order by updated_at desc limit 1`, [companyId, vars]);
  const user = client ? null : await one(`select id, name from users where company_id = $1 and active and phone is not null
       and (regexp_replace(phone, '\\D', '', 'g') = any($2) or '55' || regexp_replace(phone, '\\D', '', 'g') = any($2)) limit 1`, [companyId, vars]);
  return { client, user };
}

/** Link temporário (portal) — o token só existe aqui; no banco fica o hash. */
export async function portalLink(agent, { purpose, entity, entityId, clientId, days }) {
  const token = randomToken(24);
  await q(`insert into public_links (company_id, purpose, entity, entity_id, client_id, token_hash, expires_at) values ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7))`,
    [agent.company.id, purpose, entity, entityId, clientId, sha256(token), days]);
  const base = String(agent.cfg.publicUrl || PUBLIC_URL_DEFAULT).replace(/\/$/, '');
  return `${base}/p/${purpose === 'comparativo' ? 'comparativo' : 'parcelas'}/${token}`;
}

async function openTask(agent, conv, { title, kind = 'whatsapp', priority = 'alta', key }) {
  const owner = conv.client_id ? (await one('select owner_user_id from clients where id = $1', [conv.client_id]))?.owner_user_id : null;
  await q(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, auto_key)
     values ($1,$2,$3,$4, now(), $5, $6, 'wa_conversation', $7, $8) on conflict do nothing`,
  [agent.company.id, title, kind, priority, owner, conv.client_id || null, conv.id, key || null]);
  return owner;
}

async function activity(agent, conv, summary) {
  if (!conv.client_id || conv.simulated) return;
  await q(`insert into activities (company_id, client_id, entity, entity_id, kind, summary, created_by_name) values ($1,$2,'wa_conversation',$3,'whatsapp',$4,$5)`,
    [agent.company.id, conv.client_id, conv.id, summary, agent.name]);
}

async function handoff(agent, conv, reason, vars) {
  conv.status = 'humano'; conv.handoff_reason = reason; conv.handoff_at = new Date().toISOString();
  conv.context = { ...conv.context, awaiting: null };
  if (!conv.simulated) {
    conv.assigned_user_id = await openTask(agent, conv, { title: `WhatsApp: ${conv.contact_name || conv.phone} precisa de um corretor — ${reason}`, key: `wa-handoff:${conv.id}:${today(agent.company.settings.timezone)}` });
    await activity(agent, conv, `WhatsApp: atendimento transferido para a equipe (${reason})`);
  }
  return render(agent.cfg.texts.handoff, vars);
}

// ---------------- respostas do autoatendimento ----------------
const OPTOUT = /^(sair|parar|pare|stop|cancelar avisos|descadastrar|nao quero receber)\b/;
const HUMAN = /\b(atendente|humano|corretor|corretora|pessoa|falar com)\b/;
const MENU = /^(menu|oi|ola|bom dia|boa tarde|boa noite|inicio|opcoes|ajuda|0)\b/;
const OPTIONS = [
  { n: '1', re: /\b(apolice|apolices|seguro|seguros|vigencia)\b/ },
  { n: '2', re: /\b(parcela|parcelas|boleto|pagamento|comprovante|segunda via|2a via)\b/ },
  { n: '3', re: /\b(sinistro|acidente|batida|roubo|furto|guincho|assistencia|pane)\b/ },
  { n: '4', re: /\b(renovar|renovacao|cotacao|cotar|orcamento|novo seguro)\b/ },
];

function option(text) {
  const t = norm(text);
  const m = t.match(/^\s*([1-5])\b/);
  if (m) return m[1];
  if (HUMAN.test(t)) return '5';
  return OPTIONS.find((o) => o.re.test(t))?.n || null;
}

async function policiesOf(agent, clientId) {
  const { rows } = await q(`select p.id, p.policy_number, p.branch, p.end_date, i.name as institution, i.assistance_phone from policies p join institutions i on i.id = p.institution_id
     where p.company_id = $1 and (p.client_id = $2 or p.insured_client_id = $2) and p.contract_state = 'vigente' order by p.end_date limit 6`, [agent.company.id, clientId]);
  return rows;
}

async function policiesText(agent, conv) {
  const list = await policiesOf(agent, conv.client_id);
  if (!list.length) return 'Não encontrei apólice vigente no seu cadastro. Se quiser, responda 5 para falar com um corretor.';
  const lines = list.map((p) => `• ${BRANCHES[p.branch] || p.branch} — ${p.institution}${p.policy_number ? ` — apólice ${p.policy_number}` : ''} — vigente até ${br(p.end_date)}`);
  return `Suas apólices vigentes:\n${lines.join('\n')}\n\nPara parcelas responda 2; para sinistro ou assistência, 3.`;
}

async function installmentsText(agent, conv) {
  const ref = today(agent.company.settings.timezone);
  const { rows } = await q(`select i.*, ${INSTALLMENT_AGG}, p.policy_number, p.id as pid, ins.name as institution from premium_installments i
       join policies p on p.id = i.policy_id join institutions ins on ins.id = p.institution_id
     where i.company_id = $1 and (p.client_id = $2 or p.payer_client_id = $2) and p.contract_state = 'vigente' and i.status_override is null
     order by i.due_date limit 40`, [agent.company.id, conv.client_id]);
  const open = rows.map((x) => installmentState(x, ref, agent.company.settings.installments.upcomingDays))
    .filter((x) => ['vencida', 'proxima_vencimento', 'aberta', 'parcial', 'pagamento_informado'].includes(x.status)).slice(0, 5);
  if (!open.length) return 'Não há parcelas em aberto no seu cadastro. Se recebeu alguma cobrança, responda 5 para falar com um corretor.';
  const label = { vencida: 'vencida', proxima_vencimento: 'vence em breve', aberta: 'em aberto', parcial: 'pagamento parcial', pagamento_informado: 'pagamento informado — em conferência' };
  const lines = open.map((x) => `• ${x.institution} — parcela ${x.number}/${x.total_count} — vence ${br(x.due_date)} — ${money(x.balance_cents)} (${label[x.status]})`);
  const pids = [...new Set(open.map((x) => x.pid))].slice(0, 2);
  const links = [];
  for (const pid of pids) {
    const url = conv.simulated ? `${agent.cfg.publicUrl || PUBLIC_URL_DEFAULT}/p/parcelas/(link gerado no envio real)`
      : await portalLink(agent, { purpose: 'parcelas', entity: 'policy', entityId: pid, clientId: conv.client_id, days: 15 });
    links.push(url);
  }
  return `Parcelas do seu seguro:\n${lines.join('\n')}\n\nPara ver as parcelas e enviar o comprovante (link válido por 15 dias):\n${links.join('\n')}\n\nO pagamento é feito diretamente à seguradora.`;
}

async function assistanceText(agent, conv) {
  const list = conv.client_id ? await policiesOf(agent, conv.client_id) : [];
  const phones = [...new Map(list.filter((p) => p.assistance_phone).map((p) => [p.institution, `• ${p.institution}: ${p.assistance_phone}`])).values()];
  const head = phones.length ? `Assistência 24h da sua seguradora:\n${phones.join('\n')}\n\n` : 'Em caso de emergência, ligue para a assistência 24h que consta na sua apólice.\n\n';
  return `${head}Para registrar um aviso de sinistro ou pedido de assistência, descreva em uma mensagem o que aconteceu, quando e onde. Eu registro e aviso seu corretor. A análise e a decisão sobre a cobertura são sempre da seguradora.`;
}

/** Confere a identidade antes de mostrar dados da apólice/parcelas (por 24 h). */
function identityQuestion(client) {
  if (client.document) return { kind: 'doc', text: `Para sua segurança, informe os 3 primeiros dígitos do seu ${client.document.length > 11 ? 'CNPJ' : 'CPF'}.` };
  if (client.birth_date) return { kind: 'birth', text: 'Para sua segurança, informe sua data de nascimento (dd/mm/aaaa).' };
  return null;
}
function identityMatches(client, kind, text) {
  const d = onlyDigits(text);
  if (kind === 'doc') return d.length >= 3 && String(client.document).startsWith(d);
  if (kind === 'birth') return d.length === 8 && `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}` === String(client.birth_date).slice(0, 10);
  return false;
}

async function answerOption(agent, conv, client, opt, vars) {
  if (opt === '5') return handoff(agent, conv, 'cliente pediu para falar com um corretor', vars);
  if (opt === '4') {
    conv.context = { ...conv.context, awaiting: 'cotacao' };
    return 'Ótimo! Conte em uma mensagem qual seguro você quer renovar ou cotar (por exemplo: carro, casa, vida, empresa) e algum detalhe importante. Eu repasso ao seu corretor.';
  }
  if (opt === '3') { conv.context = { ...conv.context, awaiting: 'sinistro' }; return assistanceText(agent, conv); }
  // 1 e 2 mostram dados do contrato: exigem cadastro e identidade conferida
  if (!client) return handoff(agent, conv, 'número sem cadastro pediu dados de apólice/parcelas', vars);
  if (!(conv.verified_until && new Date(conv.verified_until) > new Date())) {
    const qn = identityQuestion(client);
    if (!qn) return handoff(agent, conv, 'cadastro sem documento para conferir a identidade', vars);
    conv.context = { ...conv.context, awaiting: 'identidade', pending: opt, idKind: qn.kind, tries: 0 };
    return qn.text;
  }
  return opt === '1' ? policiesText(agent, conv) : installmentsText(agent, conv);
}

/**
 * Processa uma mensagem recebida (WhatsApp real ou simulador). Devolve as respostas enviadas.
 */
export async function processInbound(agent, { phone, name = null, text, type = 'text', waMessageId = null, simulated = false }) {
  const waId = toWaId(phone) || onlyDigits(phone);
  const conv = await getConversation(agent.company.id, waId, { simulated, name });
  const saved = await logMessage(conv, { direction: 'in', kind: type, body: text ?? `[${type}]`, wa_message_id: waMessageId });
  if (waMessageId && !saved) return { replies: [], conversation: conv, skipped: 'duplicada' }; // reentrega do webhook
  await q('update wa_conversations set last_inbound_at = now(), unread = unread + 1, updated_at = now() where id = $1', [conv.id]);
  conv.last_inbound_at = new Date().toISOString();

  const { client, user } = await whoIs(agent.company.id, waId);
  if (client && !conv.client_id) conv.client_id = client.id;
  if (user && !conv.user_id) conv.user_id = user.id;
  const vars = { nome_virgula: client || user || name ? `, ${firstName(client?.name || user?.name || name)}` : '', agente: agent.name, corretora: agent.brand };

  const t = norm(text);
  let reply = null;
  // SAIR vale sempre, mesmo em atendimento humano
  if (type === 'text' && OPTOUT.test(t)) {
    conv.opted_out_at = new Date().toISOString();
    if (client && !simulated) {
      await tx(async (db) => {
        await db.query(`update consents set revoked_at = now(), revoked_reason = 'Pedido pelo WhatsApp (SAIR)' where company_id = $1 and client_id = $2 and purpose in ('whatsapp', 'marketing') and revoked_at is null`, [agent.company.id, client.id]);
        await db.query('update clients set marketing_opt_out = true, updated_at = now() where id = $1 and company_id = $2', [client.id, agent.company.id]);
      });
      await activity(agent, conv, 'WhatsApp: cliente pediu para não receber avisos automáticos (SAIR)');
    }
    reply = render(agent.cfg.texts.optout, vars);
  } else if (!simulated && !agent.row.enabled) {
    await saveConversation(conv);
    return { replies: [], conversation: conv, skipped: 'agente desligado' };
  } else if (conv.status === 'humano') {
    await saveConversation(conv);
    return { replies: [], conversation: conv, skipped: 'em atendimento humano' };
  } else if (!agent.cfg.autoReply && !simulated) {
    await saveConversation(conv);
    return { replies: [], conversation: conv, skipped: 'respostas automáticas desligadas' };
  } else {
    if (conv.status === 'encerrada') conv.status = 'agente';
    const awaiting = conv.context?.awaiting;
    if (user && !client) {
      const { rows: [c] } = await q(`select count(*)::int as n from tasks where company_id = $1 and assignee_user_id = $2 and status = 'aberta' and due_at < current_date + 1`, [agent.company.id, user.id]);
      reply = `Olá, ${firstName(user.name)}! Este é o número de atendimento da ${agent.brand}. Você tem ${c.n} tarefa(s) para hoje na Agenda do APOLVEN.`;
    } else if (type !== 'text' || text == null || !String(text).trim()) {
      reply = await handoff(agent, conv, `cliente enviou ${type === 'image' ? 'uma imagem' : type === 'document' ? 'um documento' : type === 'audio' ? 'um áudio' : 'um arquivo'}`, vars);
    } else if (awaiting === 'identidade') {
      const qn = conv.context.idKind;
      if (client && identityMatches(client, qn, text)) {
        conv.verified_until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const pending = conv.context.pending;
        conv.context = { ...conv.context, awaiting: null, pending: null, tries: 0 };
        reply = pending === '1' ? await policiesText(agent, conv) : await installmentsText(agent, conv);
      } else {
        const tries = (conv.context.tries || 0) + 1;
        conv.context = { ...conv.context, tries };
        reply = tries >= 3 ? await handoff(agent, conv, 'identidade não confirmada após 3 tentativas', vars) : 'Não confere. Tente de novo ou responda 5 para falar com um corretor.';
      }
    } else if (awaiting === 'sinistro' && !option(text)) {
      const n = simulated ? 0 : await tx(async (db) => {
        const num = await nextNumber(db, agent.company.id, 'request');
        if (conv.client_id) {
          const owner = (await db.query('select owner_user_id from clients where id = $1', [conv.client_id])).rows[0]?.owner_user_id || null;
          await db.query(`insert into service_requests (company_id, number, client_id, kind, description, priority, channel, assignee_user_id, due_at)
             values ($1,$2,$3,'assistencia',$4,'alta','whatsapp',$5, now() + interval '4 hours')`, [agent.company.id, num, conv.client_id, `Aviso pelo WhatsApp: ${String(text).slice(0, 3800)}`, owner]);
        }
        return num;
      });
      conv.context = { ...conv.context, awaiting: null };
      if (!simulated) await openTask(agent, conv, { title: `WhatsApp: aviso de sinistro/assistência de ${conv.contact_name || client?.name || conv.phone}`, key: `wa-sinistro:${conv.id}:${Date.now()}` });
      const proto = n ? ` Protocolo ${docNumber(agent.company.settings, 'request', n)}.` : '';
      reply = `Registrei seu aviso e avisei seu corretor.${proto} Se for uma emergência, ligue agora para a assistência 24h da seguradora. A decisão sobre a cobertura é sempre da seguradora.`;
    } else if (awaiting === 'cotacao' && !option(text)) {
      conv.context = { ...conv.context, awaiting: null };
      if (!simulated) {
        await openTask(agent, conv, { title: `WhatsApp: ${conv.contact_name || client?.name || conv.phone} pediu renovação/cotação — "${String(text).slice(0, 140)}"`, kind: 'cotacao', key: `wa-cotacao:${conv.id}:${Date.now()}` });
        await activity(agent, conv, `WhatsApp: pedido de renovação/cotação — ${String(text).slice(0, 300)}`);
      }
      reply = 'Anotado! Seu corretor vai preparar as opções e falar com você por aqui. Valores só são confirmados com a cotação da seguradora.';
    } else {
      const opt = option(text);
      if (opt) reply = await answerOption(agent, conv, client, opt, vars);
      else {
        conv.context = { ...conv.context, awaiting: null };
        reply = `${conv.context.greeted && !MENU.test(t) ? 'Não entendi. ' : ''}${render(agent.cfg.texts.menu, vars)}`;
        conv.context.greeted = true;
      }
    }
  }
  await saveConversation(conv);
  const replies = reply ? [reply] : [];
  if (reply) await deliver(agent, conv, { text: reply }, { routine: 'autoatendimento' });
  return { replies, conversation: conv };
}
