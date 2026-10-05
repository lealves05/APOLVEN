/**
 * Parâmetros editáveis pelo MASTER da central (contrato v1.1 — "settings" no manifesto).
 * Sistema: valem para todas as empresas (tabela system_settings). Empresa: companies.settings de cada empresa.
 * Campo: { key, label, type: boolean|number|text|textarea|select, group, help?, options?, min?, max?, step?, unit? }
 */
import { q, one } from './db.js';
import { HttpError, withDefaults } from './util.js';

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife',
  'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((v) => ({ value: v, label: v.replace('America/', '').replace('_', ' ') }));

export const SYSTEM_FIELDS = [
  { key: 'signup_enabled', label: 'Novos cadastros abertos', type: 'boolean', group: 'Cadastro e demonstração', default: true,
    help: 'Desligado, a tela de cadastro e a ativação de demonstrações ficam fechadas (corretoras existentes seguem normalmente).' },
  { key: 'demo_enabled', label: 'Botão "Experimentar demonstração"', type: 'boolean', group: 'Cadastro e demonstração', default: true },
  { key: 'demo_days', label: 'Dias até apagar demonstrações não ativadas', type: 'number', group: 'Cadastro e demonstração', min: 1, max: 30, step: 1, unit: 'dias', default: 7 },
  { key: 'notice_text', label: 'Aviso para todos os usuários', type: 'textarea', group: 'Comunicação', max: 300, default: '',
    help: 'Exibido no topo do APOLVEN para todas as corretoras. Deixe vazio para não mostrar.' },
  { key: 'notice_level', label: 'Tipo do aviso', type: 'select', group: 'Comunicação', default: 'info',
    options: [{ value: 'info', label: 'Informativo' }, { value: 'warn', label: 'Atenção' }] },
];

export const TENANT_FIELDS = [
  { key: 'trade_name', label: 'Nome fantasia', type: 'text', group: 'Corretora', max: 160 },
  { key: 'timezone', label: 'Fuso horário', type: 'select', group: 'Corretora', options: TIMEZONES },
  { key: 'installments_upcomingDays', label: 'Parcela "próxima do vencimento"', type: 'number', group: 'Parcelas e renovações', min: 1, max: 30, step: 1, unit: 'dias' },
  { key: 'installments_reminderDays', label: 'Lembrete antes do vencimento', type: 'number', group: 'Parcelas e renovações', min: 0, max: 30, step: 1, unit: 'dias' },
  { key: 'quotes_expiringDays', label: 'Aviso de cotação perto de vencer', type: 'number', group: 'Cotações', min: 1, max: 30, step: 1, unit: 'dias' },
  { key: 'quotes_comparisonLinkDays', label: 'Validade do link do comparativo', type: 'number', group: 'Cotações', min: 1, max: 30, step: 1, unit: 'dias' },
  { key: 'approvals_internalProposalApproval', label: 'Exigir aprovação interna das propostas', type: 'boolean', group: 'Alçadas' },
  { key: 'approvals_comparisonApproval', label: 'Exigir aprovação antes de enviar comparativo', type: 'boolean', group: 'Alçadas' },
];

const strip = ({ default: _d, ...f }) => f;
export const settingsManifest = () => ({ system: SYSTEM_FIELDS.map(strip), tenant: TENANT_FIELDS });
const bad = (m) => new HttpError(400, m);

function coerce(field, v) {
  if (v === null || v === undefined) return undefined;
  if (field.type === 'boolean') { if (typeof v !== 'boolean') throw bad(`${field.label}: valor inválido`); return v; }
  if (field.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) throw bad(`${field.label}: use um valor entre ${field.min} e ${field.max}`);
    return n;
  }
  if (field.type === 'select') { if (!field.options.some((o) => o.value === v)) throw bad(`${field.label}: opção inválida`); return v; }
  const s = String(v).trim();
  if (field.max && s.length > field.max) throw bad(`${field.label}: máximo de ${field.max} caracteres`);
  return s;
}
function pick(fields, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad('Envie os parâmetros em "values".');
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw bad(`Parâmetro desconhecido: ${k}`);
    const c = coerce(f, v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

let sysCache = { at: 0, v: null };
export async function getSystemParams() {
  if (sysCache.v && Date.now() - sysCache.at < 30000) return sysCache.v;
  const base = Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, f.default]));
  try {
    const { rows } = await q('select key, value from system_settings');
    for (const r of rows) if (r.key in base) base[r.key] = r.value;
  } catch { /* tabela ainda não criada */ }
  sysCache = { at: Date.now(), v: base };
  return base;
}
export async function setSystemParams(values) {
  const clean = pick(SYSTEM_FIELDS, values);
  for (const [k, v] of Object.entries(clean)) {
    await q(`insert into system_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, JSON.stringify(v)]);
  }
  sysCache.at = 0;
  return getSystemParams();
}

/** Aviso geral exibido a todas as empresas (ou null). */
export async function systemNotice() {
  const p = await getSystemParams();
  return p.notice_text ? { text: p.notice_text, level: p.notice_level === 'warn' ? 'warn' : 'info' } : null;
}

/** Configuração inicial de uma empresa nova conforme os padrões do sistema. */
export async function newCompanySettings(base) {
  return { ...base };
}

// caminho dentro de companies.settings para cada campo da empresa
const PATHS = Object.fromEntries(TENANT_FIELDS.filter((f) => !['trade_name'].includes(f.key)).map((f) => [f.key, f.key.split('_')]));

export async function getTenantParams(companyId) {
  const c = await one('select name, trade_name, settings from companies where id = $1', [companyId]);
  if (!c) return null;
  const s = withDefaults(c.settings);
  const out = { trade_name: c.trade_name || c.name };
  for (const [k, path] of Object.entries(PATHS)) out[k] = path.reduce((o, p) => (o == null ? o : o[p]), s) ?? null;
  return out;
}
export async function setTenantParams(db, companyId, values) {
  const clean = pick(TENANT_FIELDS, values);
  if (clean.trade_name != null && clean.trade_name.length < 2) throw bad('Nome fantasia muito curto.');
  const { rows: [c] } = await db.query('select settings from companies where id = $1 for update', [companyId]);
  const s = c?.settings && typeof c.settings === 'object' ? JSON.parse(JSON.stringify(c.settings)) : {};
  for (const [k, path] of Object.entries(PATHS)) {
    if (!(k in clean)) continue;
    if (path.length === 1) s[path[0]] = clean[k];
    else { s[path[0]] = { ...(s[path[0]] || {}), [path[1]]: clean[k] }; }
  }
  await db.query('update companies set settings = $2, trade_name = coalesce($3, trade_name) where id = $1', [companyId, s, clean.trade_name ?? null]);
  return clean;
}
