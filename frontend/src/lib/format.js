import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------- Dinheiro: a API trabalha em CENTAVOS (inteiros) ----------------
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** centavos → "R$ 1.234,56"; null/undefined → "não informado" (nunca zero). */
export const money = (cents, empty = '—') => (cents === null || cents === undefined || cents === '' ? empty : brl.format(Number(cents) / 100));
export const moneyOrNA = (cents) => money(cents, 'não informado');
/** reais (número) → centavos inteiros. */
export const toCents = (reais) => (reais === '' || reais === null || reais === undefined || Number.isNaN(Number(reais)) ? null : Math.round(Number(reais) * 100));
export const fromCents = (cents) => (cents === null || cents === undefined ? '' : Number(cents) / 100);
export const pct = (v, d = 2) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d })}%`);
export const num = (v, d = 0) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }).format(Number(v) || 0);

const toDate = (d) => (d instanceof Date ? d : typeof d === 'string' && d.length === 10 ? parseISO(d) : new Date(d));
export const fmt = (d, pattern = 'dd/MM/yyyy') => (d ? format(toDate(d), pattern, { locale: ptBR }) : '—');
export const fmtDateTime = (d) => fmt(d, "dd/MM/yyyy 'às' HH:mm");
export const ymd = (d = new Date()) => format(d, 'yyyy-MM-dd');
export const addDaysYmd = (n, from = new Date()) => { const x = new Date(from); x.setDate(x.getDate() + n); return ymd(x); };
export const ago = (d) => {
  if (!d) return '—';
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  if (h < 1) return 'há menos de 1 h';
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
};

// ---------------- Estados (cada domínio separado) ----------------
const tone = {
  gray: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300', blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', red: 'bg-red-500/10 text-red-700 dark:text-red-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
};
const S = (label, t) => ({ label, cls: tone[t] });

export const STAGES = {
  novo_contato: S('Novo contato', 'blue'), qualificacao: S('Qualificação', 'violet'), coleta_dados: S('Coleta de dados', 'indigo'), cotacao: S('Cotação', 'amber'),
  comparativo: S('Comparativo', 'amber'), negociacao: S('Negociação', 'orange'), autorizacao_cliente: S('Autorização do cliente', 'teal'), transmissao: S('Transmissão', 'teal'),
  acompanhamento: S('Acompanhamento', 'indigo'), ganho: S('Ganho', 'green'), perdido: S('Perdido', 'red'),
};
export const TASK_STATUS = {
  aguardando: S('Aguardando', 'gray'), executando: S('Executando', 'blue'), cotacao_valida: S('Cotação válida', 'green'), valor_indicativo: S('Valor indicativo', 'teal'),
  dados_insuficientes: S('Dados insuficientes', 'orange'), analise_subscricao: S('Análise de subscrição', 'violet'), recusa_informada: S('Recusa informada', 'red'),
  fonte_indisponivel: S('Fonte indisponível', 'orange'), tempo_excedido: S('Tempo excedido', 'orange'), autorizacao_expirada: S('Autorização expirada', 'red'),
  indeterminado: S('Resultado indeterminado', 'amber'), incompativel: S('Incompatível', 'red'), cancelada: S('Cancelada', 'gray'), pendente_assistida: S('Consulta assistida pendente', 'amber'),
};
export const QUOTE_REQUEST_STATUS = { rascunho: S('Rascunho', 'gray'), em_andamento: S('Em andamento', 'blue'), parcial: S('Resultado parcial', 'amber'), concluida: S('Concluída', 'green'), cancelada: S('Cancelada', 'gray') };
export const COMPARISON_STATUS = { rascunho: S('Rascunho', 'gray'), aprovado: S('Pronto para enviar', 'indigo'), enviado: S('Link enviado ao cliente', 'blue'), escolhido: S('Cliente escolheu', 'green'), expirado: S('Expirado', 'orange'), cancelado: S('Cancelado', 'gray') };
export const CLASSIFICATION = { equivalente: S('Atende ao mínimo', 'green'), parcial: S('Parcialmente equivalente', 'amber'), incompativel: S('Não atende ao mínimo', 'red') };
export const PROPOSAL_STATUS = {
  rascunho: S('Rascunho', 'gray'), aprovada_internamente: S('Aprovada internamente', 'indigo'), autorizada_cliente: S('Autorizada pelo cliente', 'teal'), transmitida: S('Transmitida', 'blue'),
  recepcionada: S('Recepcionada', 'blue'), em_analise: S('Em análise', 'violet'), aceita: S('Aceita', 'green'), recusada: S('Recusada', 'red'), retirada: S('Retirada', 'gray'),
  documento_recebido: S('Documento recebido', 'amber'), conferida: S('Conferida', 'green'),
};
export const CONTRACT_STATE = { vigente: S('Vigente', 'green'), cancelamento_solicitado: S('Cancelamento solicitado', 'orange'), cancelada: S('Cancelada', 'red'), vencida: S('Vencida', 'gray'), renovada: S('Renovada', 'indigo'), suspensa: S('Suspensa', 'amber') };
export const DOC_STATE = { aguardando_documento: S('Aguardando documento', 'amber'), recebido: S('Recebido — conferir', 'blue'), divergente: S('Divergente', 'red'), conferido: S('Conferido', 'green') };
export const INSTALLMENT_STATUS = {
  prevista: S('Prevista', 'gray'), aberta: S('Aberta', 'blue'), proxima_vencimento: S('Próxima do vencimento', 'amber'), vencida: S('Vencida', 'red'),
  pagamento_informado: S('Pagamento informado', 'violet'), pagamento_confirmado: S('Pagamento confirmado', 'green'), parcial: S('Parcial', 'teal'),
  em_divergencia: S('Em divergência', 'orange'), renegociada: S('Renegociada', 'indigo'), cancelada: S('Cancelada', 'gray'), restituida: S('Restituída', 'gray'),
};
export const COMMISSION_STATUS = {
  estimativa: S('Estimativa', 'gray'), prevista: S('Prevista', 'gray'), confirmada: S('Confirmada', 'blue'), a_vencer: S('A vencer', 'blue'), vencida: S('Vencida', 'red'),
  recebida_parcial: S('Recebida parcialmente', 'teal'), liquidada: S('Liquidada', 'green'), divergente: S('Divergente', 'orange'), contestada: S('Contestada', 'violet'),
  ajustada: S('Ajustada', 'indigo'), estornada: S('Estornada', 'red'),
};
export const ACCRUAL_STATUS = { liberada: S('Liberada', 'blue'), em_lote: S('Em lote', 'amber'), paga: S('Paga', 'green'), compensada: S('Compensada', 'gray'), contestada: S('Contestada', 'violet') };
export const ACCRUAL_KIND = { liberacao: 'Liberação', antecipacao: 'Antecipação', reducao: 'Redução (não pago)', recuperacao: 'Recuperável (já pago)' };
export const BATCH_STATUS = { rascunho: S('Rascunho', 'gray'), aprovado: S('Aprovado', 'indigo'), pago: S('Pago', 'green'), cancelado: S('Cancelado', 'gray') };
export const CLAIM_STATUS = { aberto: S('Aberto', 'blue'), documentacao: S('Documentação', 'amber'), aguardando_seguradora: S('Aguardando seguradora', 'violet'), em_regulacao: S('Em regulação', 'indigo'), indenizado: S('Indenizado (informado)', 'green'), negado: S('Negado (informado)', 'red'), encerrado: S('Encerrado', 'gray') };
export const REQUEST_STATUS = { aberta: S('Aberta', 'blue'), em_andamento: S('Em andamento', 'indigo'), aguardando_cliente: S('Aguardando cliente', 'amber'), aguardando_seguradora: S('Aguardando seguradora', 'violet'), concluida: S('Concluída', 'green'), cancelada: S('Cancelada', 'gray') };
export const LINE_STATUS = { pendente: S('Pendente', 'blue'), conciliada: S('Conciliada', 'green'), divergente: S('Divergente', 'orange'), ignorada: S('Ignorada', 'gray') };
export const CAPABILITY_STATE = { bloqueada: S('Bloqueada', 'red'), pendente: S('Pendente', 'amber'), validada: S('Validada', 'blue'), ativa: S('Ativa', 'green'), pausada: S('Pausada', 'gray'), indisponivel: S('Indisponível', 'gray') };
export const TECH_STATE = { sem_conector: S('Sem conector', 'gray'), nao_configurado: S('Não configurado', 'amber'), aguardando_credencial: S('Aguardando credencial', 'amber'), autenticacao_valida: S('Autenticação válida', 'blue'), erro: S('Erro', 'red'), em_homologacao: S('Em homologação', 'violet'), homologado: S('Homologado', 'green') };
export const COMMERCIAL_STATE = { nao_solicitado: S('Não solicitado', 'gray'), em_analise: S('Em análise', 'amber'), aprovado: S('Aprovado', 'green'), recusado: S('Recusado', 'red'), suspenso: S('Suspenso', 'orange'), vencido: S('Vencido', 'orange') };
export const REQ_STATUS = { nao_iniciado: S('Não iniciado', 'gray'), preenchido: S('Preenchido', 'blue'), enviado: S('Enviado', 'indigo'), aguardando_analise: S('Aguardando análise', 'amber'), confirmado: S('Confirmado', 'green'), recusado: S('Recusado', 'red'), vencido: S('Vencido', 'orange') };
export const ENV_LABEL = { testes: 'Testes (sandbox)', producao: 'Produção' };

export const ROLES = {
  owner: 'Proprietário', admin: 'Administrador da corretora', manager: 'Gestor comercial', broker: 'Corretor / produtor',
  operations: 'Operação / emissão', finance: 'Financeiro', claims: 'Sinistros / pós-venda', auditor: 'Auditor / leitura',
};
export const BRANCHES = {
  auto: 'Auto, moto e caminhão', frota: 'Frotas', residencial: 'Residencial', condominio: 'Condomínio', empresarial: 'Empresarial / patrimonial',
  vida: 'Vida individual / AP', vida_grupo: 'Vida em grupo', saude: 'Saúde', odonto: 'Odontológico', viagem: 'Viagem', rc: 'Responsabilidade civil',
  do_cyber: 'D&O e cyber', equipamentos: 'Equipamentos / bicicleta', rural: 'Rural', transportes: 'Transportes', garantia: 'Garantia', fianca: 'Fiança locatícia', previdencia: 'Previdência',
};
export const PRIORITY = { baixa: { label: 'Baixa', cls: 'text-ink-faint' }, normal: { label: 'Normal', cls: 'text-ink-soft' }, alta: { label: 'Alta', cls: 'text-amber-600' }, urgente: { label: 'Urgente', cls: 'text-red-600 font-semibold' } };

/** Número com prefixo: COT-00012. */
export function docNumber(settings, kind, n) {
  if (n == null) return '—';
  const cfg = { quote: 'COT', proposal: 'PRP', comparison: 'CMP', claim: 'SIN', request: 'SOL', endorsement: 'END', settlement: 'LIQ', batch: 'REP', opportunity: 'OPO', digits: 5, ...(settings?.numbering || {}) };
  return `${cfg[kind] || kind.toUpperCase()}-${String(n).padStart(Number(cfg.digits) || 5, '0')}`;
}

export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
export function maskPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export function maskDoc(v) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
export const maskCep = (v) => onlyDigits(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
export async function lookupCep(cep) {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (j.erro) return null;
    return { street: j.logradouro, district: j.bairro, city: j.localidade, uf: j.uf };
  } catch { return null; }
}
export const waLink = (phone, text) => {
  let d = onlyDigits(phone);
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};
export const fillTemplate = (t, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v ?? ''), t || '');

/** CSV local (dados já carregados), com proteção contra fórmula. */
export function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const safe = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
  const esc = (v) => `"${safe(v).replaceAll('"', '""')}"`;
  const csv = [cols.map(esc).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Valores da central de assinaturas (em reais, não centavos). */
export const moneyReais = (v) => brl.format(Number(v) || 0);
