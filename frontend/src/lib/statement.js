// Extrato de comissões: leitura local (CSV ou planilha), mapeamento de colunas e geração do CSV padrão
// aceito pela API (separador ";", cabeçalho canônico). O caminho CSV padrão continua igual.

export const STATEMENT_FIELDS = [
  { key: 'apolice', label: 'Nº da apólice', required: true, help: 'Chave para achar a comissão.' },
  { key: 'parcela', label: 'Nº da parcela', help: 'Recomendado: sem ele, usa a próxima parcela em aberto.' },
  { key: 'valor_bruto', label: 'Valor bruto da comissão', required: true, help: 'Negativo em comissão = estorno.' },
  { key: 'retencao', label: 'Retenção (IR etc.)' },
  { key: 'data', label: 'Data do pagamento' },
  { key: 'tipo', label: 'Tipo (comissão, estorno…)' },
  { key: 'id_externo', label: 'Identificador da linha', help: 'Evita duplicar linhas ao reimportar.' },
  { key: 'descricao', label: 'Descrição / histórico' },
];

// sinônimos aceitos pela API (mantidos em sincronia com backend/src/routes/commissions.js) + nomes comuns em extratos
const SYN = {
  apolice: ['apolice', 'numero_apolice', 'apolice_certificado', 'n_apolice', 'no_apolice', 'num_apolice', 'numero_da_apolice', 'apolice_numero', 'certificado'],
  parcela: ['parcela', 'numero_parcela', 'n_parcela', 'no_parcela', 'num_parcela', 'parc'],
  valor_bruto: ['valor_bruto', 'valor', 'comissao', 'valor_comissao', 'vl_comissao', 'comissao_bruta', 'valor_bruto_comissao', 'vlr_comissao'],
  retencao: ['retencao', 'ir', 'irrf', 'valor_retencao', 'vl_ir', 'imposto_retido', 'ir_retido', 'irrf_retido', 'valor_ir'],
  data: ['data', 'data_pagamento', 'competencia', 'data_credito', 'dt_pagamento', 'data_do_pagamento', 'data_pagto', 'dt_pagto', 'data_pgto', 'data_de_pagamento'],
  tipo: ['tipo', 'natureza', 'tipo_lancamento'],
  id_externo: ['id_externo', 'id', 'identificador', 'id_lancamento'],
  descricao: ['descricao', 'historico', 'observacao'],
};
const API_SYN = {
  apolice: ['apolice', 'numero_apolice', 'apolice_certificado'], parcela: ['parcela', 'numero_parcela'],
  valor_bruto: ['valor_bruto', 'valor', 'comissao', 'valor_comissao'], retencao: ['retencao', 'ir', 'irrf', 'valor_retencao'],
  data: ['data', 'data_pagamento', 'competencia'], tipo: ['tipo', 'natureza'], id_externo: ['id_externo', 'id', 'identificador'], descricao: ['descricao', 'historico'],
};

export const normHeader = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** CSV com ; ou , (detectado pelo cabeçalho), aspas e quebras dentro de aspas → matriz de textos. */
export function csvRows(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
  return rows;
}

/** Lê planilha num worker isolado. */
export function xlsxRows(file) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./xlsxWorker.js', import.meta.url), { type: 'module' });
    const done = () => w.terminate();
    w.onmessage = (e) => { done(); if (e.data?.ok) resolve(e.data.rows); else reject(new Error(`Não foi possível ler a planilha: ${e.data?.error || 'formato desconhecido'}`)); };
    w.onerror = (e) => { done(); reject(new Error(`Não foi possível ler a planilha: ${e.message || 'erro'}`)); };
    file.arrayBuffer().then((buf) => w.postMessage(buf, [buf]), (err) => { done(); reject(err); });
  });
}

export const isSheet = (name) => /\.(xlsx|xlsm)$/i.test(name || '');
/** Formatos de planilha antigos/alternativos que não lemos: pedir XLSX ou CSV. */
export const isOldSheet = (name) => /\.(xls|ods|xlsb)$/i.test(name || '');

/** Linha de cabeçalho: a primeira (entre as 15 iniciais) com ao menos 2 células preenchidas e algum nome conhecido. */
export function splitHeader(rows) {
  const known = new Set(Object.values(SYN).flat());
  let idx = rows.slice(0, 15).findIndex((r) => r.filter((c) => String(c).trim()).length >= 2 && r.some((c) => known.has(normHeader(c))));
  if (idx < 0) idx = rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2);
  if (idx < 0) return { headers: [], data: [] };
  return { headers: rows[idx].map((h) => String(h).trim()), data: rows.slice(idx + 1).filter((r) => r.some((c) => String(c).trim() !== '')) };
}

/** Sugestão de mapeamento: salvo para a seguradora (por nome de coluna) > sinônimos. */
export function guessMapping(headers, saved = {}) {
  const out = {};
  const hn = headers.map(normHeader);
  for (const f of Object.keys(SYN)) {
    const s = saved[f];
    if (s && headers.includes(s)) { out[f] = s; continue; }
    const i = hn.findIndex((h) => SYN[f].includes(h));
    out[f] = i >= 0 ? headers[i] : '';
  }
  return out;
}

/** true se o arquivo CSV já está no formato que a API entende sozinha (envia o original, sem conversão). */
export function isNativeCsv(headers, mapping) {
  const hn = headers.map(normHeader);
  return Object.keys(API_SYN).every((f) => {
    const apiPick = API_SYN[f].find((k) => hn.includes(k)) || null; // a API usa o 1º sinônimo presente
    const col = mapping[f] ? normHeader(mapping[f]) : null;
    return apiPick === col;
  });
}

const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Gera o CSV canônico (;) a partir do mapeamento. */
export function toCanonicalCsv(headers, data, mapping) {
  const fields = STATEMENT_FIELDS.map((f) => f.key).filter((k) => mapping[k]);
  const idx = Object.fromEntries(fields.map((k) => [k, headers.indexOf(mapping[k])]));
  const lines = [fields.join(';')];
  for (const r of data) lines.push(fields.map((k) => q(r[idx[k]])).join(';'));
  return `${lines.join('\n')}\n`;
}

export const TEMPLATE_CSV = 'data;apolice;parcela;valor_bruto;retencao;tipo;id_externo;descricao\n'
  + '16/09/2026;1234567;1;300,00;0,00;comissao;EXT-0001;Comissão parcela 1\n'
  + '16/09/2026;1234567;2;-50,00;0,00;estorno;EXT-0002;Estorno por cancelamento\n';
