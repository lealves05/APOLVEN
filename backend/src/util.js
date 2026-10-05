import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Registro não encontrado') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);
export const forbidden = (msg = 'Seu perfil de acesso não permite esta ação.', extra) => new HttpError(403, msg, extra);

/** Valida dados com um schema zod e devolve os dados limpos. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first.path.join('.');
    throw bad(field ? `${field}: ${first.message}` : first.message, { issues: r.error.issues.slice(0, 10) });
  }
  return r.data;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
/** Identificador da rota: formato inválido vira 404 (não revela nada). */
export function idParam(v) { if (!isUuid(v)) throw notFound(); return v; }

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'corretora';
}

export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/** JSON estável (chaves ordenadas) — usado nos hashes de snapshots e de comandos idempotentes. */
export function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
}
export const hashOf = (v) => sha256(stableJson(v));

// ---------------- Dinheiro em centavos (16.4) ----------------
// Valores monetários são inteiros em centavos. Percentuais têm até 4 casas e são aplicados com aritmética inteira.

/** Inteiro de centavos válido (rejeita fração e não-número). */
export function cents(v, { allowNegative = false, allowNull = false } = {}) {
  if (v === null || v === undefined || v === '') { if (allowNull) return null; throw bad('valor monetário obrigatório'); }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw bad('valor monetário deve ser um número inteiro de centavos');
  if (!allowNegative && n < 0) throw bad('valor monetário não pode ser negativo');
  return n;
}

/** Arredonda divisão inteira (BigInt) pela regra "meio para cima" (afastando do zero). */
function divRound(num, den) {
  const neg = (num < 0n) !== (den < 0n);
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (2n * b);
  return neg ? -q : q;
}

/** cents × taxa% → centavos, arredondamento meio para cima. Ex.: applyRate(300000, 20) = 60000. */
export function applyRate(amountCents, rate) {
  const r = Math.round(Number(rate) * 10000); // 4 casas decimais exatas
  if (!Number.isFinite(r)) throw bad('percentual inválido');
  return Number(divRound(BigInt(amountCents) * BigInt(r), 1000000n));
}

/**
 * Divide um total em n partes iguais, com o resíduo distribuído de forma determinística às primeiras partes.
 * Ex.: splitEven(10000, 3) = [3334, 3333, 3333] — a soma fecha exatamente (16.4 / A20).
 */
export function splitEven(total, n) {
  if (!Number.isInteger(n) || n < 1) throw bad('quantidade de partes inválida');
  const base = Math.trunc(total / n);
  let rest = total - base * n;
  return Array.from({ length: n }, () => { if (rest > 0) { rest -= 1; return base + 1; } return base; });
}

/** Distribui um total proporcionalmente a pesos (maior resto), com soma exata. */
export function splitWeighted(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (rest <= 0) break; out[i] += 1; rest -= 1; }
  return out;
}

export const brl = (c) => (c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// ---------------- Datas ----------------
export const today = (tz = 'America/Sao_Paulo') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0, 12)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
export const periodOf = (ymd) => String(ymd).slice(0, 7);

/** Valida CNPJ/CPF pelos dígitos verificadores. */
export function validDocument(v) {
  const d = onlyDigits(v);
  if (/^(\d)\1+$/.test(d)) return false;
  const calc = (base, weights) => {
    const sum = base.split('').reduce((a, n, i) => a + Number(n) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    return calc(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[9] && calc(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[10];
  }
  if (d.length === 14) {
    return calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[12] && calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[13];
  }
  return false;
}

// CPF/CNPJ parcialmente mascarado (4.1): ***.456.789-** e 12.***.***/0001-**
export function maskDocument(v) {
  const d = onlyDigits(v);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-**`;
  return d ? '***' : null;
}

/** URL de cobrança/documento: só https e sem credenciais embutidas (26.3). */
export function safeHttpsUrl(v) {
  if (!v) return null;
  try {
    const u = new URL(String(v));
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error();
    return u.toString();
  } catch { throw bad('link inválido: use um endereço https oficial'); }
}

/** Neutraliza fórmulas em exportação CSV/XLSX (22.4). */
export const csvSafe = (v) => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
export function toCsv(rows, cols) {
  const keys = cols || (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v) => `"${csvSafe(v).replaceAll('"', '""')}"`;
  return '﻿' + [keys.map(esc).join(';'), ...rows.map((r) => keys.map((k) => esc(r[k])).join(';'))].join('\n');
}

// ---------------- Ramos ----------------
export const BRANCHES = {
  auto: 'Auto, moto e caminhão',
  frota: 'Frotas',
  residencial: 'Residencial',
  condominio: 'Condomínio',
  empresarial: 'Empresarial / patrimonial',
  vida: 'Vida individual / acidentes pessoais',
  vida_grupo: 'Vida em grupo',
  saude: 'Saúde',
  odonto: 'Odontológico',
  viagem: 'Viagem',
  rc: 'Responsabilidade civil / profissional',
  do_cyber: 'D&O e riscos cibernéticos',
  equipamentos: 'Equipamentos / bicicleta',
  rural: 'Rural',
  transportes: 'Transportes',
  garantia: 'Garantia',
  fianca: 'Fiança locatícia',
  previdencia: 'Previdência aberta',
};
export const BRANCH_KEYS = Object.keys(BRANCHES);

// ---------------- Perfis de acesso (3.2) ----------------
export const PERMISSIONS = [
  { group: 'CRM e clientes', key: 'clients_view', label: 'Ver clientes e carteira', type: 'scope' },
  { group: 'CRM e clientes', key: 'clients_edit', label: 'Cadastrar e editar clientes, vínculos e consentimentos' },
  { group: 'CRM e clientes', key: 'clients_sensitive', label: 'Ver CPF/CNPJ completo e dados restritos' },
  { group: 'CRM e clientes', key: 'clients_export', label: 'Exportar clientes' },
  { group: 'CRM e clientes', key: 'opportunities', label: 'Oportunidades e funil', type: 'scope' },
  { group: 'CRM e clientes', key: 'tasks', label: 'Agenda e tarefas da equipe' },
  { group: 'Cotações e propostas', key: 'quotes_view', label: 'Ver cotações', type: 'scope' },
  { group: 'Cotações e propostas', key: 'quotes_manage', label: 'Criar rodadas e registrar ofertas' },
  { group: 'Cotações e propostas', key: 'comparisons_send', label: 'Aprovar e enviar comparativos ao cliente' },
  { group: 'Cotações e propostas', key: 'proposals_manage', label: 'Criar propostas e registrar andamento' },
  { group: 'Cotações e propostas', key: 'proposals_approve', label: 'Aprovação interna de propostas' },
  { group: 'Cotações e propostas', key: 'proposals_submit', label: 'Transmitir propostas autorizadas' },
  { group: 'Apólices', key: 'policies_view', label: 'Ver apólices e certificados', type: 'scope' },
  { group: 'Apólices', key: 'policies_manage', label: 'Cadastrar apólices, itens e documentos' },
  { group: 'Apólices', key: 'policies_verify', label: 'Conferir documento emitido' },
  { group: 'Apólices', key: 'endorsements', label: 'Endossos e cancelamentos' },
  { group: 'Apólices', key: 'renewals', label: 'Renovações' },
  { group: 'Parcelas do seguro', key: 'installments', label: 'Parcelas do seguro (consultar e registrar)' },
  { group: 'Parcelas do seguro', key: 'installments_confirm', label: 'Confirmar pagamento pela fonte oficial' },
  { group: 'Comissões e repasses', key: 'commissions_view', label: 'Ver comissões', type: 'scope' },
  { group: 'Comissões e repasses', key: 'commissions_rules', label: 'Acordos e regras de comissão' },
  { group: 'Comissões e repasses', key: 'commissions_settle', label: 'Baixar liquidações e conciliar extratos' },
  { group: 'Comissões e repasses', key: 'commissions_adjust', label: 'Ajustes, estornos e contestações' },
  { group: 'Comissões e repasses', key: 'splits_view', label: 'Ver repasses', type: 'scope' },
  { group: 'Comissões e repasses', key: 'splits_manage', label: 'Parceiros, regras de repasse e lotes' },
  { group: 'Comissões e repasses', key: 'splits_approve', label: 'Aprovar lotes de repasse' },
  { group: 'Comissões e repasses', key: 'splits_pay', label: 'Registrar pagamento de lotes' },
  { group: 'Financeiro', key: 'finance', label: 'Contas bancárias, contas a pagar/receber e conciliação' },
  { group: 'Financeiro', key: 'finance_close', label: 'Fechar e reabrir período' },
  { group: 'Pós-venda', key: 'claims', label: 'Sinistros' },
  { group: 'Pós-venda', key: 'service_requests', label: 'Solicitações e assistências' },
  { group: 'Cadastros', key: 'products', label: 'Produtos, planos e coberturas' },
  { group: 'Seguradoras e integrações', key: 'integrations_view', label: 'Ver seguradoras e integrações' },
  { group: 'Seguradoras e integrações', key: 'integrations_manage', label: 'Configurar empresas e conexões' },
  { group: 'Seguradoras e integrações', key: 'credentials_manage', label: 'Cadastrar/rotacionar credenciais (exige MFA)' },
  { group: 'Documentos', key: 'documents_restricted', label: 'Documentos restritos (saúde, questionários)' },
  { group: 'Documentos', key: 'imports', label: 'Importações' },
  { group: 'Relatórios', key: 'reports', label: 'Relatórios e indicadores' },
  { group: 'Relatórios', key: 'data_export', label: 'Exportar dados' },
  { group: 'Administração', key: 'settings', label: 'Configurações da corretora' },
  { group: 'Administração', key: 'units_manage', label: 'Unidades e equipes' },
  { group: 'Administração', key: 'users', label: 'Usuários e perfis de acesso' },
  { group: 'Administração', key: 'audit_view', label: 'Auditoria' },
  { group: 'Administração', key: 'privacy', label: 'Solicitações de titulares (LGPD)' },
];

export const ROLES = {
  owner: 'Proprietário', admin: 'Administrador da corretora', manager: 'Gestor comercial', broker: 'Corretor / produtor',
  operations: 'Operação / emissão', finance: 'Financeiro', claims: 'Sinistros / pós-venda', auditor: 'Auditor / leitura',
};
/** Perfis em que MFA é obrigatório (26.1). */
export const MFA_ROLES = ['owner', 'admin', 'finance'];

const ALL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.type === 'scope' ? 'all' : true]));
const NONE = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.type === 'scope' ? 'none' : false]));
const pick = (keys, base = NONE) => ({ ...base, ...Object.fromEntries(keys.map((k) => {
  const [key, sc] = k.split(':');
  const p = PERMISSIONS.find((x) => x.key === key);
  return [key, p?.type === 'scope' ? (sc || 'all') : true];
})) });

export const DEFAULT_PERMISSIONS = {
  admin: { ...ALL },
  manager: pick(['clients_view', 'clients_edit', 'clients_sensitive', 'clients_export', 'opportunities', 'tasks', 'quotes_view', 'quotes_manage',
    'comparisons_send', 'proposals_manage', 'proposals_approve', 'proposals_submit', 'policies_view', 'policies_manage', 'renewals', 'endorsements',
    'installments', 'commissions_view', 'splits_view', 'claims', 'service_requests', 'products', 'integrations_view', 'reports', 'data_export', 'imports']),
  broker: pick(['clients_view:own', 'clients_edit', 'opportunities:own', 'tasks', 'quotes_view:own', 'quotes_manage', 'comparisons_send',
    'proposals_manage', 'policies_view:own', 'renewals', 'installments', 'commissions_view:own', 'splits_view:own', 'service_requests', 'integrations_view']),
  operations: pick(['clients_view', 'clients_edit', 'tasks', 'quotes_view', 'quotes_manage', 'proposals_manage', 'proposals_submit', 'policies_view',
    'policies_manage', 'policies_verify', 'endorsements', 'renewals', 'installments', 'installments_confirm', 'service_requests', 'products', 'integrations_view', 'imports']),
  finance: pick(['clients_view', 'tasks', 'policies_view', 'installments', 'installments_confirm', 'commissions_view', 'commissions_rules',
    'commissions_settle', 'commissions_adjust', 'splits_view', 'splits_manage', 'splits_approve', 'splits_pay', 'finance', 'finance_close',
    'reports', 'data_export', 'imports', 'integrations_view']),
  claims: pick(['clients_view', 'tasks', 'policies_view', 'claims', 'service_requests', 'endorsements', 'installments']),
  auditor: pick(['clients_view', 'quotes_view', 'policies_view', 'commissions_view', 'splits_view', 'reports', 'audit_view', 'integrations_view']),
};

export function permissionsFor(role, settings) {
  if (role === 'owner') return { ...ALL };
  const base = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.auditor;
  return { ...base, ...(settings?.permissions?.[role] || {}) };
}

// ---------------- Configurações padrão da corretora ----------------
export const DEFAULT_SETTINGS = {
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  primaryColor: '#1d4ed8',
  theme: 'system',
  radius: 'lg',
  layout: 'side',
  numbering: { quote: 'COT', proposal: 'PRP', comparison: 'CMP', claim: 'SIN', request: 'SOL', endorsement: 'END', settlement: 'LIQ', batch: 'REP', opportunity: 'OPO', digits: 5 },
  renewals: { alertDays: [90, 60, 45, 30, 15, 7] },
  installments: { upcomingDays: 7, reminderDays: 3, agingBands: [15, 30, 60] },
  quotes: { expiringDays: 3, comparisonLinkDays: 7 },
  // pontuação (8.7): só depois dos requisitos mínimos; comissão NUNCA entra
  scoring: { coverage: 45, cost: 30, deductible: 15, assistance: 10 },
  approvals: { internalProposalApproval: false, comparisonApproval: false },
  lossReasons: ['Preço', 'Atendimento', 'Cobertura', 'Concorrente', 'Bem vendido', 'Cliente sem retorno', 'Outro'],
  expenseCategories: ['Salários e encargos', 'Aluguel', 'Sistemas e software', 'Marketing', 'Impostos e taxas', 'Tarifas bancárias', 'Repasses', 'Serviços de terceiros', 'Outras despesas'],
  incomeCategories: ['Comissões', 'Bonificações', 'Outras receitas'],
  whatsapp: {
    comparison: 'Olá {cliente}! Preparei o comparativo do seu seguro ({ramo}). Você pode conferir e escolher a opção por aqui: {link}',
    installment: 'Olá {cliente}! A parcela {parcela} do seu seguro ({seguradora}) vence em {vencimento}. Valor: {valor}. Se já pagou, desconsidere.',
    renewal: 'Olá {cliente}! Seu seguro {ramo} vence em {vencimento}. Vamos revisar as coberturas e cotar a renovação?',
  },
  dateFormat: 'dd/MM/yyyy',
};

export function withDefaults(settings = {}) {
  const out = { ...DEFAULT_SETTINGS, ...settings };
  for (const k of ['numbering', 'renewals', 'installments', 'quotes', 'scoring', 'approvals', 'whatsapp']) {
    out[k] = { ...DEFAULT_SETTINGS[k], ...(settings?.[k] || {}) };
  }
  out.permissions = Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((r) =>
    [r, { ...DEFAULT_PERMISSIONS[r], ...(settings?.permissions?.[r] || {}) }]));
  return out;
}

// ---------------- Política de senha ----------------
const COMMON_PASSWORDS = ['1234567890', '12345678', 'password', 'senha123', 'senha1234', 'qwerty', 'abc12345', 'apolven', '123456789', 'mudar123', 'admin123'];
export function passwordProblem(p) {
  const s = String(p ?? '');
  if (s.length < 10) return 'a senha deve ter ao menos 10 caracteres';
  if (Buffer.byteLength(s, 'utf8') > 72) return 'a senha deve ter no máximo 72 bytes (cerca de 72 letras sem acento)';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'use letras e números na senha';
  const low = s.toLowerCase();
  if (new Set(s).size < 5 || COMMON_PASSWORDS.some((c) => low.includes(c))) return 'esta senha é muito fraca ou comum; escolha outra';
  return null;
}
export const PASSWORD_HINT = 'Mínimo de 10 caracteres, com letras e números';
