// "Padrão APOLVEN" de API de cotação (contrato apolven-cotacao/1): o que o APOLVEN envia a uma seguradora,
// parceiro de multicálculo ou middleware, e o que aceita de volta. Os JSON Schemas abaixo são a fonte da verdade e
// ficam publicados em docs/api-cotacao/ (um teste garante que os arquivos continuam iguais) e na tela
// "Seguradoras e Integrações › Contrato da API".
// Princípios: só os dados necessários para precificar (sem e-mail, telefone ou observações internas); valores em
// centavos (inteiros); datas AAAA-MM-DD; campos desconhecidos são recusados nos dois sentidos.
import { z } from 'zod';
import { BRANCH_KEYS } from '../util.js';

export const CONTRACT = 'apolven-cotacao/1';
export const PATHS = { status: 'v1/status', quote: 'v1/cotacoes' };
export const AUTH_TYPES = { bearer: 'Bearer token', api_key: 'Chave de API em cabeçalho', oauth2_cc: 'OAuth2 (client credentials)' };
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const MONEY = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const str = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const nstr = (max) => ({ type: ['string', 'null'], maxLength: max });

// ---------------- JSON Schemas (draft 2020-12) ----------------
export const REQUEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://apolven.app/schemas/apolven-cotacao-1/requisicao.json',
  title: 'APOLVEN — requisição de cotação (POST {base}/v1/cotacoes)',
  type: 'object',
  additionalProperties: false,
  required: ['contrato', 'id_requisicao', 'ramo', 'cotacao', 'corretora', 'segurado', 'risco', 'coberturas_desejadas'],
  properties: {
    contrato: { const: CONTRACT },
    id_requisicao: { ...str(64), description: 'Identificador único desta consulta. Repetições com o mesmo id devem devolver a mesma resposta (idempotência). Também vai no cabeçalho Idempotency-Key.' },
    ramo: { type: 'string', enum: BRANCH_KEYS },
    cotacao: {
      type: 'object', additionalProperties: false, required: ['numero', 'rodada', 'cenario'],
      properties: {
        numero: str(40), rodada: { type: 'integer', minimum: 1 },
        cenario: { type: 'string', enum: ['minima', 'ampliada', 'franquia_reduzida', 'franquia_majorada'] },
      },
    },
    vigencia: {
      type: 'object', additionalProperties: false, required: ['inicio', 'fim'],
      properties: { inicio: { type: ['string', 'null'], pattern: DATE }, fim: { type: ['string', 'null'], pattern: DATE } },
    },
    corretora: {
      type: 'object', additionalProperties: false, required: ['cnpj', 'susep', 'codigo_na_seguradora'],
      properties: { cnpj: nstr(14), susep: nstr(40), codigo_na_seguradora: { ...nstr(60), description: 'Código comercial da corretora nesta seguradora (cadastro da conexão).' } },
    },
    segurado: {
      type: 'object', additionalProperties: false, required: ['tipo_pessoa', 'nome', 'documento'],
      properties: {
        tipo_pessoa: { type: 'string', enum: ['pf', 'pj'] }, nome: str(200), documento: { ...nstr(14), description: 'CPF ou CNPJ, só dígitos.' },
        data_nascimento: { type: ['string', 'null'], pattern: DATE },
        endereco: { type: 'object', additionalProperties: false, properties: { cep: nstr(9), cidade: nstr(120), uf: nstr(2) } },
      },
    },
    risco: {
      type: 'object', description: 'Questionário do ramo (campos e versão em "versao_questionario"). Resposta não informada vai como null — nunca é preenchida pelo APOLVEN.',
      required: ['versao_questionario'], properties: { versao_questionario: str(40) },
      additionalProperties: { type: ['string', 'number', 'integer', 'boolean', 'null'] },
    },
    coberturas_desejadas: {
      type: 'array', maxItems: 40,
      items: {
        type: 'object', additionalProperties: false, required: ['codigo', 'nome', 'obrigatoria'],
        properties: { codigo: str(60), nome: str(160), limite_minimo_centavos: { ...MONEY, type: ['integer', 'null'] }, obrigatoria: { type: 'boolean' } },
      },
    },
    preferencias: {
      type: 'object', additionalProperties: false,
      properties: { assistencias: { type: 'array', maxItems: 20, items: str(80) }, franquia: nstr(200), pagamento: nstr(200) },
    },
  },
};

const offerSchemaJson = {
  type: 'object', additionalProperties: false,
  required: ['seguradora', 'produto', 'status'],
  properties: {
    seguradora: { ...str(160), description: 'Nome da seguradora que emite a oferta.' },
    produto: str(200),
    numero_cotacao: { ...nstr(120), description: 'Número/protocolo da cotação na seguradora (obrigatório para status "valida").' },
    status: { type: 'string', enum: ['valida', 'indicativa', 'recusa'], description: 'valida = cotação firme; indicativa = valor a confirmar; recusa = a seguradora não aceita o risco (informe motivo_recusa).' },
    motivo_recusa: nstr(500),
    validade: { type: ['string', 'null'], pattern: DATE, description: 'Último dia de validade (obrigatório para "valida").' },
    premio: {
      type: 'object', additionalProperties: false, required: ['total_centavos'],
      properties: { total_centavos: { ...MONEY, minimum: 1 }, liquido_centavos: { ...MONEY, type: ['integer', 'null'] }, iof_centavos: { ...MONEY, type: ['integer', 'null'] } },
    },
    coberturas: {
      type: 'array', maxItems: 60,
      items: {
        type: 'object', additionalProperties: false, required: ['codigo', 'nome'],
        properties: {
          codigo: { ...str(60), description: 'Use os códigos de "coberturas_desejadas" quando equivalentes.' }, nome: str(160),
          limite_centavos: { ...MONEY, type: ['integer', 'null'] }, franquia_centavos: { ...MONEY, type: ['integer', 'null'] }, franquia_descricao: nstr(300),
        },
      },
    },
    franquias: {
      type: 'array', maxItems: 60,
      items: { type: 'object', additionalProperties: false, required: ['descricao'], properties: { cobertura: nstr(60), descricao: str(300), valor_centavos: { ...MONEY, type: ['integer', 'null'] } } },
    },
    assistencias: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['nome'], properties: { codigo: nstr(60), nome: str(160) } } },
    formas_pagamento: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object', additionalProperties: false, required: ['meio', 'parcelas', 'total_centavos'],
        properties: {
          id: nstr(30), meio: { type: 'string', enum: ['boleto', 'cartao', 'debito', 'pix', 'carne', 'outro'] }, parcelas: { type: 'integer', minimum: 1, maximum: 24 },
          valor_primeira_centavos: { ...MONEY, type: ['integer', 'null'] }, valor_parcela_centavos: { ...MONEY, type: ['integer', 'null'] }, total_centavos: { ...MONEY, minimum: 1 },
        },
      },
    },
    observacoes: nstr(1000),
  },
  allOf: [
    { if: { properties: { status: { const: 'recusa' } } }, then: { required: ['motivo_recusa'] } },
    { if: { properties: { status: { enum: ['valida', 'indicativa'] } } }, then: { required: ['premio'] } },
    { if: { properties: { status: { const: 'valida' } } }, then: { required: ['numero_cotacao', 'validade'] } },
  ],
};

export const RESPONSE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://apolven.app/schemas/apolven-cotacao-1/resposta.json',
  title: 'APOLVEN — resposta de cotação (HTTP 200)',
  type: 'object', additionalProperties: false,
  required: ['contrato', 'id_requisicao', 'ofertas'],
  properties: {
    contrato: { const: CONTRACT },
    id_requisicao: { ...str(64), description: 'O mesmo id recebido.' },
    ofertas: { type: 'array', minItems: 1, maxItems: 20, items: offerSchemaJson },
  },
};

export const STATUS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://apolven.app/schemas/apolven-cotacao-1/status.json',
  title: 'APOLVEN — teste de conexão (GET {base}/v1/status)',
  type: 'object', additionalProperties: false,
  required: ['contrato', 'status'],
  properties: {
    contrato: { const: CONTRACT },
    status: { type: 'string', enum: ['ok', 'indisponivel'] },
    seguradora: nstr(160),
    ambiente: { type: ['string', 'null'], enum: ['producao', 'homologacao', null] },
    ramos: { type: 'array', maxItems: 40, items: { type: 'string', enum: BRANCH_KEYS }, description: 'Ramos que esta API cota (vazio = não informado).' },
  },
};

export const EXAMPLES = {
  requisicao: {
    contrato: CONTRACT, id_requisicao: '7f3c2a10-5d4e-4b8a-9c11-2f0d6b7e8a90', ramo: 'auto',
    cotacao: { numero: 'COT-000123', rodada: 1, cenario: 'minima' },
    vigencia: { inicio: '2026-11-01', fim: '2027-11-01' },
    corretora: { cnpj: '12345678000195', susep: '10.2034567', codigo_na_seguradora: 'ABC-1' },
    segurado: { tipo_pessoa: 'pf', nome: 'Ana Beatriz Oliveira', documento: '12345678909', data_nascimento: '1988-04-12', endereco: { cep: '13025-000', cidade: 'Campinas', uf: 'SP' } },
    risco: { versao_questionario: 'auto-1', placa: 'ABC1D23', marca_modelo: 'Hatch 1.0 Flex', ano_modelo: 2024, chassi: null, uso: 'particular', cep_pernoite: '13025-000', cep_circulacao: null, condutor_principal: 'Ana Beatriz Oliveira', idade_condutor: 38, condutores_18_25: false, classe_bonus: 5, sinistros_12m: 0, garagem: 'ambos' },
    coberturas_desejadas: [{ codigo: 'casco', nome: 'Casco (colisão, incêndio e roubo/furto)', limite_minimo_centavos: null, obrigatoria: true }, { codigo: 'rcf_dm', nome: 'RCF danos materiais', limite_minimo_centavos: 10000000, obrigatoria: true }],
    preferencias: { assistencias: ['Guincho 400 km'], franquia: 'normal', pagamento: 'cartão em até 10x' },
  },
  resposta: {
    contrato: CONTRACT, id_requisicao: '7f3c2a10-5d4e-4b8a-9c11-2f0d6b7e8a90',
    ofertas: [{
      seguradora: 'Seguradora Exemplo S.A.', produto: 'Auto Completo', numero_cotacao: 'Q-2026-889912', status: 'valida', validade: '2026-11-10',
      premio: { total_centavos: 245000, liquido_centavos: 228190, iof_centavos: 16810 },
      coberturas: [{ codigo: 'casco', nome: 'Casco', limite_centavos: 8500000, franquia_centavos: 350000, franquia_descricao: 'Franquia normal' }, { codigo: 'rcf_dm', nome: 'RCF danos materiais', limite_centavos: 10000000 }],
      franquias: [{ cobertura: 'casco', descricao: 'Franquia normal', valor_centavos: 350000 }],
      assistencias: [{ codigo: 'guincho', nome: 'Guincho 400 km' }],
      formas_pagamento: [{ id: 'boleto-1x', meio: 'boleto', parcelas: 1, total_centavos: 245000 }, { id: 'cartao-10x', meio: 'cartao', parcelas: 10, valor_primeira_centavos: 24500, valor_parcela_centavos: 24500, total_centavos: 245000 }],
      observacoes: null,
    }],
  },
  recusa: { contrato: CONTRACT, id_requisicao: '7f3c2a10-5d4e-4b8a-9c11-2f0d6b7e8a90', ofertas: [{ seguradora: 'Seguradora Exemplo S.A.', produto: 'Auto Completo', status: 'recusa', numero_cotacao: 'R-5521', motivo_recusa: 'Região de pernoite fora da política de aceitação.' }] },
  status: { contrato: CONTRACT, status: 'ok', seguradora: 'Seguradora Exemplo S.A.', ambiente: 'producao', ramos: ['auto', 'residencial'] },
};

// ---------------- Validação (espelha os schemas) ----------------
const money = z.number().int().min(0).max(1_000_000_000_000);
const nmoney = money.nullable().optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)), 'data inválida');
const nstrZ = (max) => z.string().max(max).nullable().optional();

const offerZ = z.object({
  seguradora: z.string().min(1).max(160),
  produto: z.string().min(1).max(200),
  numero_cotacao: nstrZ(120),
  status: z.enum(['valida', 'indicativa', 'recusa']),
  motivo_recusa: nstrZ(500),
  validade: ymd.nullable().optional(),
  premio: z.object({ total_centavos: money.min(1), liquido_centavos: nmoney, iof_centavos: nmoney }).strict().optional(),
  coberturas: z.array(z.object({ codigo: z.string().min(1).max(60), nome: z.string().min(1).max(160), limite_centavos: nmoney, franquia_centavos: nmoney, franquia_descricao: nstrZ(300) }).strict()).max(60).optional(),
  franquias: z.array(z.object({ cobertura: nstrZ(60), descricao: z.string().min(1).max(300), valor_centavos: nmoney }).strict()).max(60).optional(),
  assistencias: z.array(z.object({ codigo: nstrZ(60), nome: z.string().min(1).max(160) }).strict()).max(30).optional(),
  formas_pagamento: z.array(z.object({
    id: nstrZ(30), meio: z.enum(['boleto', 'cartao', 'debito', 'pix', 'carne', 'outro']), parcelas: z.number().int().min(1).max(24),
    valor_primeira_centavos: nmoney, valor_parcela_centavos: nmoney, total_centavos: money.min(1),
  }).strict()).max(20).optional(),
  observacoes: nstrZ(1000),
}).strict().superRefine((o, ctx) => {
  if (o.status === 'recusa' && !o.motivo_recusa) ctx.addIssue({ code: 'custom', message: 'recusa sem motivo_recusa' });
  if (o.status !== 'recusa' && !o.premio) ctx.addIssue({ code: 'custom', message: `oferta "${o.status}" sem prêmio` });
  if (o.status === 'valida' && (!o.numero_cotacao || !o.validade)) ctx.addIssue({ code: 'custom', message: 'cotação válida exige numero_cotacao e validade' });
  for (const p of o.formas_pagamento || []) {
    if (p.parcelas > 1 && p.valor_primeira_centavos != null && p.valor_parcela_centavos != null && p.valor_primeira_centavos + p.valor_parcela_centavos * (p.parcelas - 1) !== p.total_centavos) {
      ctx.addIssue({ code: 'custom', message: `forma de pagamento ${p.meio} ${p.parcelas}x: parcelas não fecham com o total` });
    }
  }
  if (o.premio?.liquido_centavos != null && o.premio?.iof_centavos != null && o.premio.liquido_centavos + o.premio.iof_centavos > o.premio.total_centavos) {
    ctx.addIssue({ code: 'custom', message: 'prêmio líquido + IOF maior que o total' });
  }
});

export const responseZ = z.object({ contrato: z.literal(CONTRACT), id_requisicao: z.string().min(1).max(64), ofertas: z.array(offerZ).min(1).max(20) }).strict();
export const statusZ = z.object({
  contrato: z.literal(CONTRACT), status: z.enum(['ok', 'indisponivel']), seguradora: nstrZ(160),
  ambiente: z.enum(['producao', 'homologacao']).nullable().optional(), ramos: z.array(z.enum(BRANCH_KEYS)).max(40).optional(),
}).strict();

const issuesText = (e) => (e?.issues || []).slice(0, 4).map((i) => `${i.path?.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('; ');

/** Valida a resposta de cotação. Devolve { ok, data } ou { ok:false, error } (texto curto, sem dados do cliente). */
export function validateResponse(json, idRequisicao) {
  const r = responseZ.safeParse(json);
  if (!r.success) return { ok: false, error: `Resposta fora do contrato ${CONTRACT}: ${issuesText(r.error)}` };
  if (idRequisicao && r.data.id_requisicao !== idRequisicao) return { ok: false, error: 'Resposta com id_requisicao diferente do enviado.' };
  return { ok: true, data: r.data };
}
export function validateStatus(json) {
  const r = statusZ.safeParse(json);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: `Resposta de status fora do contrato ${CONTRACT}: ${issuesText(r.error)}` };
}

// ---------------- Requisição: mínimo necessário ----------------
const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '') || null;

/**
 * Monta a requisição a partir da rodada (já validada e imutável), do cliente, da corretora e da conexão.
 * Devolve { body, fields } — fields = caminhos dos dados pessoais/de risco efetivamente enviados (para a trilha LGPD).
 */
export function buildQuoteRequest({ taskId, request, round, scenario, client, company, connection }) {
  const risk = { versao_questionario: round.risk_schema_version };
  for (const [k, v] of Object.entries(round.risk_data || {})) {
    if (['string', 'number', 'boolean'].includes(typeof v) || v === null) risk[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  const addr = client?.address || {};
  const prefs = round.preferences || {};
  const body = {
    contrato: CONTRACT,
    id_requisicao: taskId,
    ramo: request.branch,
    cotacao: { numero: String(request.number_label || request.number), rodada: round.round_no, cenario: scenario || 'minima' },
    vigencia: { inicio: round.start_date ? String(round.start_date).slice(0, 10) : null, fim: round.end_date ? String(round.end_date).slice(0, 10) : null },
    corretora: { cnpj: onlyDigits(company?.document), susep: company?.susep_code || null, codigo_na_seguradora: connection?.broker_code || null },
    segurado: {
      tipo_pessoa: client?.kind === 'pj' ? 'pj' : 'pf', nome: String(client?.name || '').slice(0, 200), documento: onlyDigits(client?.document),
      data_nascimento: client?.kind === 'pj' || !client?.birth_date ? null : String(client.birth_date instanceof Date ? client.birth_date.toISOString() : client.birth_date).slice(0, 10),
      endereco: { cep: addr.cep || null, cidade: addr.city || null, uf: addr.uf || null },
    },
    risco: risk,
    coberturas_desejadas: (Array.isArray(round.min_coverages) ? round.min_coverages : []).map((m) => ({
      codigo: m.code, nome: m.name, limite_minimo_centavos: m.min_limit_cents ?? null, obrigatoria: m.required !== false,
    })),
    preferencias: { assistencias: Array.isArray(prefs.assistances) ? prefs.assistances : [], franquia: prefs.deductible || null, pagamento: prefs.payment || null },
  };
  // caminhos com valor (o que de fato saiu): base da trilha "quais dados foram para qual seguradora"
  const fields = [];
  const walk = (v, path) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) { if (v.length) fields.push(path); return; }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k); return; }
    fields.push(path);
  };
  walk({ segurado: body.segurado, risco: body.risco, vigencia: body.vigencia, coberturas_desejadas: body.coberturas_desejadas, preferencias: body.preferencias }, '');
  return { body, fields };
}

// ---------------- Resposta → ofertas do APOLVEN ----------------
const PAY_ID = (p, i) => (p.id ? String(p.id).slice(0, 30) : `api${i + 1}`);

/** Converte a resposta validada. Devolve { status, offers[], refusal } no vocabulário das tarefas/ofertas. */
export function mapResponse(data, today) {
  const offers = [];
  let refusal = null;
  for (const o of data.ofertas) {
    if (o.status === 'recusa') { refusal ??= { reason: o.motivo_recusa, protocol: o.numero_cotacao || null, product: o.produto }; continue; }
    const covs = (o.coberturas || []).map((c) => ({ code: c.codigo, name: c.nome, limit_cents: c.limite_centavos ?? null, deductible_cents: c.franquia_centavos ?? null, deductible_text: c.franquia_descricao ?? null }));
    for (const f of o.franquias || []) {
      const c = covs.find((x) => x.code === f.cobertura);
      if (c && c.deductible_text == null) c.deductible_text = f.descricao;
      if (c && c.deductible_cents == null && f.valor_centavos != null) c.deductible_cents = f.valor_centavos;
    }
    const kind = o.status === 'valida' ? 'cotacao_valida' : 'valor_indicativo';
    // validade vencida não vira "cotação válida": fica como indicativa para conferência
    const expired = o.validade && today && o.validade < today;
    offers.push({
      product_name: o.produto, external_id: o.numero_cotacao || null, quote_kind: expired ? 'valor_indicativo' : kind,
      valid_until: o.validade || null, total_premium_cents: o.premio.total_centavos, premium_net_cents: o.premio.liquido_centavos ?? null, taxes_cents: o.premio.iof_centavos ?? null,
      coverages: covs, assistances: (o.assistencias || []).map((a) => ({ code: a.codigo || undefined, name: a.nome })),
      payment_options: (o.formas_pagamento || []).map((p, i) => ({ id: PAY_ID(p, i), method: p.meio, installments: p.parcelas, first_cents: p.valor_primeira_centavos ?? null, installment_cents: p.valor_parcela_centavos ?? null, total_cents: p.total_centavos })),
      fields_definition: `${CONTRACT}: total = prêmio total informado; líquido e IOF como informados pela fonte`,
      commission_source: 'nao_informada',
      notes: [o.seguradora ? `Emitida por: ${o.seguradora}` : null, expired ? 'Validade já vencida no retorno da API' : null, o.observacoes || null].filter(Boolean).join(' · ') || null,
    });
  }
  const status = offers.some((x) => x.quote_kind === 'cotacao_valida') ? 'cotacao_valida' : offers.length ? 'valor_indicativo' : 'recusa_informada';
  return { status, offers, refusal };
}
