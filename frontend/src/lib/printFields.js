// Campos de mesclagem do modelo de impressão da apólice e montagem dos dados (sem dependências: usado também nos testes).
// Valores sempre viram texto; ausentes viram "—" (nunca "undefined"/"null").

export const EMPTY = '—';
export const LOGO_SRC = 'logo:corretora';

export const FIELD_GROUPS = [
  { group: 'Corretora', fields: [
    ['corretora.nome', 'Nome da corretora'], ['corretora.cnpj', 'CNPJ'], ['corretora.susep', 'Código SUSEP'],
    ['corretora.endereco', 'Endereço'], ['corretora.telefone', 'Telefone'], ['corretora.email', 'E-mail'],
  ] },
  { group: 'Cliente', fields: [
    ['cliente.nome', 'Nome do cliente'], ['cliente.documento', 'CPF/CNPJ'], ['cliente.endereco', 'Endereço'],
    ['cliente.telefone', 'Telefone'], ['cliente.email', 'E-mail'], ['segurado.nome', 'Segurado'], ['pagador.nome', 'Pagador'],
  ] },
  { group: 'Apólice', fields: [
    ['apolice.numero', 'Nº da apólice'], ['apolice.certificado', 'Nº do certificado'], ['apolice.seguradora', 'Seguradora'],
    ['apolice.ramo', 'Ramo'], ['apolice.produto', 'Produto'], ['apolice.inicio', 'Início de vigência'], ['apolice.fim', 'Fim de vigência'],
    ['apolice.vigencia', 'Vigência (início a fim)'], ['apolice.premio_total', 'Prêmio total'], ['apolice.premio_liquido', 'Prêmio líquido'],
    ['apolice.iof', 'IOF'], ['apolice.forma_pagamento', 'Forma de pagamento'], ['apolice.estado', 'Estado do contrato'],
    ['apolice.assistencia', 'Telefone da assistência'], ['apolice.observacoes', 'Observações'],
  ] },
  { group: 'Outros', fields: [
    ['corretor.nome', 'Corretor / produtor'], ['emissao.data', 'Data de emissão (impressão)'], ['apolice.cadastro', 'Data de cadastro da apólice'],
  ] },
];

export const FIELD_KEYS = FIELD_GROUPS.flatMap((g) => g.fields.map(([k]) => k));
export const FIELD_LABEL = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields));

/** Tabelas que repetem uma linha por registro. */
export const TABLE_SOURCES = {
  coberturas: { label: 'Coberturas', columns: [['nome', 'Cobertura'], ['limite', 'Limite'], ['franquia', 'Franquia']] },
  parcelas: { label: 'Parcelas', columns: [['numero', 'Nº'], ['vencimento', 'Vencimento'], ['valor', 'Valor'], ['situacao', 'Situação']] },
  itens: { label: 'Itens / riscos segurados', columns: [['descricao', 'Descrição'], ['identificador', 'Identificação'], ['tipo', 'Tipo']] },
  franquias: { label: 'Franquias', columns: [['cobertura', 'Cobertura'], ['franquia', 'Franquia']] },
};

const CONTRACT = { vigente: 'Vigente', cancelamento_solicitado: 'Cancelamento solicitado', cancelada: 'Cancelada', vencida: 'Vencida', renovada: 'Renovada', suspensa: 'Suspensa' };
const INST = { pagamento_confirmado: 'Paga', prevista: 'Prevista', aberta: 'Em aberto', proxima_vencimento: 'Próxima do vencimento', vencida: 'Vencida', paga: 'Paga', parcial: 'Parcial',
  pagamento_informado: 'Pagamento informado', em_divergencia: 'Em divergência', cancelada: 'Cancelada', restituida: 'Restituída', confirmada: 'Paga' };
const ITEM_KIND = { veiculo: 'Veículo', imovel: 'Imóvel', vida: 'Vida', bem: 'Bem', local: 'Local' };

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
export const text = (v) => (blank(v) ? EMPTY : String(v));

export function money(cents) {
  if (blank(cents) || !Number.isFinite(Number(cents))) return EMPTY;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents) / 100);
}
export function date(v) {
  if (blank(v)) return EMPTY;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : EMPTY;
}
export function docMask(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return text(v);
}
function address(a) {
  if (!a) return EMPTY;
  const l1 = [a.street, a.number].filter((x) => !blank(x)).join(', ');
  const l2 = [a.complement, a.district].filter((x) => !blank(x)).join(' — ');
  const l3 = [a.city, a.uf].filter((x) => !blank(x)).join('/');
  const s = [l1, l2, l3, blank(a.cep) ? '' : `CEP ${a.cep}`].filter(Boolean).join(' · ');
  return s || EMPTY;
}
const deductible = (c) => {
  const t = blank(c?.deductible_text) ? '' : String(c.deductible_text);
  const v = blank(c?.deductible_cents) ? '' : money(c.deductible_cents);
  if (t && v && !t.includes(v)) return `${t} (${v})`;
  return t || v || EMPTY;
};

/** Converte a resposta de /policies/:id/print-data (ou o exemplo) em campos de texto e linhas de tabela. */
export function buildPrintData(raw = {}, { logo = null, today } = {}) {
  const c = raw.company || {};
  const cl = raw.client || {};
  const p = raw.policy || {};
  const iso = today || new Date().toISOString().slice(0, 10);
  const fields = {
    'corretora.nome': text(c.trade_name || c.name), 'corretora.cnpj': blank(c.document) ? EMPTY : docMask(c.document), 'corretora.susep': text(c.susep_code),
    'corretora.endereco': address(c), 'corretora.telefone': text(c.phone), 'corretora.email': text(c.email),
    'cliente.nome': text(cl.name), 'cliente.documento': blank(cl.document) ? EMPTY : docMask(cl.document), 'cliente.endereco': address(cl.address || cl),
    'cliente.telefone': text(cl.phone), 'cliente.email': text(cl.email),
    'segurado.nome': text(raw.insured?.name || cl.name), 'pagador.nome': text(raw.payer?.name || cl.name),
    'apolice.numero': text(p.policy_number), 'apolice.certificado': text(p.certificate_number), 'apolice.seguradora': text(p.institution_name),
    'apolice.ramo': text(p.branch_label), 'apolice.produto': text(p.product_name), 'apolice.inicio': date(p.start_date), 'apolice.fim': date(p.end_date),
    'apolice.vigencia': blank(p.start_date) && blank(p.end_date) ? EMPTY : `${date(p.start_date)} a ${date(p.end_date)}`,
    'apolice.premio_total': money(p.total_premium_cents), 'apolice.premio_liquido': money(p.premium_net_cents), 'apolice.iof': money(p.taxes_cents),
    'apolice.forma_pagamento': text(p.payment_summary), 'apolice.estado': blank(p.contract_state) ? EMPTY : (CONTRACT[p.contract_state] || String(p.contract_state)),
    'apolice.assistencia': text(p.assistance_phone), 'apolice.observacoes': text(p.notes),
    'corretor.nome': text(raw.broker?.name), 'emissao.data': date(iso), 'apolice.cadastro': date(p.created_at),
  };
  const coverages = Array.isArray(raw.coverages) ? raw.coverages : [];
  const tables = {
    coberturas: coverages.map((x) => ({ nome: text(x.name || x.code), limite: money(x.limit_cents), franquia: deductible(x) })),
    franquias: coverages.filter((x) => !blank(x.deductible_text) || !blank(x.deductible_cents)).map((x) => ({ cobertura: text(x.name || x.code), franquia: deductible(x) })),
    parcelas: (Array.isArray(raw.installments) ? raw.installments : []).map((x) => ({ numero: text(x.number), vencimento: date(x.due_date), valor: money(x.amount_cents),
      situacao: blank(x.status) ? EMPTY : (INST[x.status] || String(x.status)) })),
    itens: (Array.isArray(raw.items) ? raw.items : []).map((x) => ({ descricao: text(x.description), identificador: text(x.identifier), tipo: blank(x.kind) ? EMPTY : (ITEM_KIND[x.kind] || String(x.kind)) })),
  };
  return { fields, tables, logo: typeof logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(logo) ? logo : null };
}

/** Valor de um campo de mesclagem como texto ("—" quando ausente ou desconhecido). */
export function resolveField(data, key) {
  const v = data?.fields?.[key];
  return blank(v) ? EMPTY : String(v);
}

/** Dados fictícios para a pré-visualização do modelo. */
export const SAMPLE_RAW = {
  company: { name: 'Sua Corretora de Seguros Ltda', trade_name: 'Sua Corretora', document: '12345678000195', susep_code: '10.2034567.8', phone: '(19) 3232-0000', email: 'contato@suacorretora.com.br',
    street: 'Av. Brasil', number: '1000', complement: 'Sala 12', district: 'Centro', city: 'Campinas', uf: 'SP', cep: '13010-000' },
  client: { name: 'Ana Beatriz Oliveira', document: '12345678909', phone: '(19) 99111-1001', email: 'ana.oliveira@exemplo.com',
    address: { street: 'Rua das Flores', number: '45', district: 'Cambuí', city: 'Campinas', uf: 'SP', cep: '13025-000' } },
  policy: { policy_number: '0531.2026.000123', certificate_number: '7788', institution_name: 'Seguradora Exemplo S.A.', branch_label: 'Auto, moto e caminhão',
    product_name: 'Auto Clássico', start_date: '2026-10-16', end_date: '2027-10-16', total_premium_cents: 219000, premium_net_cents: 203990, taxes_cents: 15010,
    payment_summary: 'Cartão de crédito em 4x de R$ 547,50', contract_state: 'vigente', assistance_phone: '0800 000 0000', notes: null, created_at: '2026-10-06' },
  broker: { name: 'Carla Mendes' },
  items: [{ description: 'Hatch 1.0 Flex 2024', identifier: 'ABC1D23', kind: 'veiculo' }],
  coverages: [
    { name: 'Casco (colisão, incêndio e roubo/furto)', limit_cents: 8500000, deductible_text: 'Franquia normal', deductible_cents: 350000 },
    { name: 'RCF danos materiais', limit_cents: 10000000 },
    { name: 'RCF danos corporais', limit_cents: 10000000 },
    { name: 'Carro reserva', deductible_text: '7 dias' },
  ],
  installments: [1, 2, 3, 4].map((n) => ({ number: n, due_date: `2026-${String(9 + n).padStart(2, '0')}-16`.replace('2026-13', '2027-01'), amount_cents: 54750, status: n === 1 ? 'paga' : 'prevista' })),
};
