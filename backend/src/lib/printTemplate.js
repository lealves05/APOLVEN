// Validação estrita do modelo de impressão (JSON do editor): só tipos, marcas e atributos conhecidos,
// imagens apenas PNG/JPEG/WEBP embutidas (ou o logotipo da corretora), cores e tamanhos em formato seguro.
// Nada é aceito como HTML: o navegador monta o documento a partir deste JSON.
import { HttpError } from '../util.js';

/** Mesmas chaves de frontend/src/lib/printFields.js (um teste garante que continuam iguais). */
export const FIELD_KEYS = [
  'corretora.nome', 'corretora.cnpj', 'corretora.susep', 'corretora.endereco', 'corretora.telefone', 'corretora.email',
  'cliente.nome', 'cliente.documento', 'cliente.endereco', 'cliente.telefone', 'cliente.email', 'segurado.nome', 'pagador.nome',
  'apolice.numero', 'apolice.certificado', 'apolice.seguradora', 'apolice.ramo', 'apolice.produto', 'apolice.inicio', 'apolice.fim',
  'apolice.vigencia', 'apolice.premio_total', 'apolice.premio_liquido', 'apolice.iof', 'apolice.forma_pagamento', 'apolice.estado',
  'apolice.assistencia', 'apolice.observacoes', 'corretor.nome', 'emissao.data', 'apolice.cadastro',
];
export const TABLE_COLUMNS = {
  coberturas: ['nome', 'limite', 'franquia'], parcelas: ['numero', 'vencimento', 'valor', 'situacao'],
  itens: ['descricao', 'identificador', 'tipo'], franquias: ['cobertura', 'franquia'],
};
export const LOGO_SRC = 'logo:corretora';

const BLOCK = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'pageBreak', 'table', 'image', 'dataTable']);
const INLINE = new Set(['text', 'hardBreak', 'mergeField', 'pageNumber']);
const CHILDREN = {
  doc: BLOCK, paragraph: INLINE, heading: INLINE, blockquote: BLOCK, bulletList: new Set(['listItem']), orderedList: new Set(['listItem']),
  listItem: BLOCK, table: new Set(['tableRow']), tableRow: new Set(['tableCell', 'tableHeader']), tableCell: BLOCK, tableHeader: BLOCK,
};
const LEAF = new Set(['text', 'hardBreak', 'mergeField', 'pageNumber', 'horizontalRule', 'pageBreak', 'image', 'dataTable']);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight']);
const ALIGN = new Set(['left', 'center', 'right', 'justify', null]);
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const FONT_SIZE = /^\d{1,2}(\.\d+)?(pt|px)$/;
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG = 900_000; // caracteres base64 por imagem embutida
const MAX_NODES = 20_000;
const MAX_DEPTH = 40;
export const MAX_BYTES = 2_500_000;

const fail = (msg) => { throw new HttpError(400, `Modelo de impressão inválido: ${msg}.`); };
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const optColor = (v) => v == null || (typeof v === 'string' && COLOR.test(v));

function checkAttrs(type, a = {}) {
  if (a == null || typeof a !== 'object' || Array.isArray(a)) fail(`atributos de ${type}`);
  const allowed = {
    paragraph: ['textAlign'], heading: ['textAlign', 'level'], orderedList: ['start', 'type'], table: ['variant'],
    tableCell: ['colspan', 'rowspan', 'colwidth', 'backgroundColor'], tableHeader: ['colspan', 'rowspan', 'colwidth', 'backgroundColor'],
    image: ['src', 'alt', 'title', 'width', 'height', 'align'], mergeField: ['key'], pageNumber: ['kind'], dataTable: ['source', 'columns'],
  }[type] || [];
  for (const k of Object.keys(a)) if (!allowed.includes(k)) fail(`atributo "${k}" não permitido em ${type}`);
  if ('textAlign' in a && !ALIGN.has(a.textAlign)) fail('alinhamento');
  if (type === 'heading' && !isInt(a.level, 1, 4)) fail('nível de título');
  if (type === 'orderedList' && a.start != null && !isInt(a.start, 1, 100000)) fail('início da lista');
  if (type === 'orderedList' && a.type != null && typeof a.type !== 'string') fail('tipo da lista');
  if (type === 'table' && a.variant != null && !['grid', 'plain'].includes(a.variant)) fail('estilo da tabela');
  if (type === 'tableCell' || type === 'tableHeader') {
    if (a.colspan != null && !isInt(a.colspan, 1, 30)) fail('colspan');
    if (a.rowspan != null && !isInt(a.rowspan, 1, 200)) fail('rowspan');
    if (a.colwidth != null && !(Array.isArray(a.colwidth) && a.colwidth.length <= 30 && a.colwidth.every((w) => w == null || isInt(w, 0, 3000)))) fail('largura de coluna');
    if (!optColor(a.backgroundColor)) fail('cor de fundo da célula');
  }
  if (type === 'image') {
    if (!(a.src === LOGO_SRC || (typeof a.src === 'string' && a.src.length <= MAX_IMG && IMG.test(a.src)))) fail('imagem (use PNG, JPEG ou WEBP de até ~650 KB)');
    for (const k of ['alt', 'title']) if (a[k] != null && !(typeof a[k] === 'string' && a[k].length <= 200)) fail(`texto ${k} da imagem`);
    for (const k of ['width', 'height']) if (a[k] != null && !isInt(a[k], 10, 3000)) fail(`${k} da imagem`);
    if (a.align != null && !ALIGN.has(a.align)) fail('alinhamento da imagem');
  }
  if (type === 'mergeField' && !FIELD_KEYS.includes(a.key)) fail(`campo "${String(a.key).slice(0, 40)}" desconhecido`);
  if (type === 'pageNumber' && !['current', 'total'].includes(a.kind)) fail('número de página');
  if (type === 'dataTable') {
    const cols = TABLE_COLUMNS[a.source];
    if (!cols) fail('tabela de dados desconhecida');
    if (a.columns != null && !(Array.isArray(a.columns) && a.columns.length && a.columns.every((c) => cols.includes(c)))) fail('colunas da tabela de dados');
  }
}

function checkMarks(marks) {
  if (marks == null) return;
  if (!Array.isArray(marks) || marks.length > 10) fail('formatação');
  for (const m of marks) {
    if (!m || !MARKS.has(m.type)) fail(`formatação "${String(m?.type).slice(0, 30)}" não permitida`);
    const a = m.attrs || {};
    for (const k of Object.keys(a)) {
      if (m.type === 'textStyle' && ['color', 'fontSize', 'fontFamily', 'lineHeight', 'backgroundColor'].includes(k)) continue;
      if (m.type === 'highlight' && k === 'color') continue;
      fail(`atributo "${k}" da formatação`);
    }
    if (!optColor(a.color) || !optColor(a.backgroundColor)) fail('cor do texto');
    if (a.fontSize != null && !(typeof a.fontSize === 'string' && FONT_SIZE.test(a.fontSize))) fail('tamanho da fonte');
    if (a.fontFamily != null) fail('família de fonte (não suportada)');
    if (a.lineHeight != null) fail('altura de linha (não suportada)');
  }
}

/** Valida um documento do editor; lança HttpError 400 com o motivo. */
export function validateDoc(doc, label = 'corpo') {
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') fail(`${label} deve ser um documento do editor`);
  let count = 0;
  const walk = (n, parentType, depth) => {
    if (depth > MAX_DEPTH) fail('documento muito aninhado');
    if (++count > MAX_NODES) fail('documento grande demais');
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') fail('nó inválido');
    for (const k of Object.keys(n)) if (!['type', 'attrs', 'content', 'marks', 'text'].includes(k)) fail(`propriedade "${k}"`);
    if (parentType && !CHILDREN[parentType]?.has(n.type)) fail(`"${n.type}" não pode ficar dentro de "${parentType}"`);
    if (n.type !== 'doc' && !CHILDREN[n.type] && !LEAF.has(n.type)) fail(`tipo "${n.type.slice(0, 30)}" não permitido`);
    checkAttrs(n.type, n.attrs || {});
    if (n.marks != null && !INLINE.has(n.type)) fail('formatação só vale para texto');
    checkMarks(n.marks);
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || !n.text.length || n.text.length > 20000) fail('texto');
      if (n.content != null) fail('texto com conteúdo');
      return;
    }
    if (n.text != null) fail('texto fora de nó de texto');
    if (LEAF.has(n.type)) { if (n.content != null) fail(`"${n.type}" não tem conteúdo`); return; }
    if (n.content != null) {
      if (!Array.isArray(n.content)) fail('conteúdo');
      for (const c of n.content) walk(c, n.type, depth + 1);
    }
  };
  walk(doc, null, 0);
  return doc;
}

export const DEFAULT_PAGE = { paper: 'A4', orientation: 'portrait', margins: { top: 18, right: 16, bottom: 18, left: 16 } };

export function validatePage(page) {
  if (!page || typeof page !== 'object') fail('configuração da página');
  const m = page.margins || {};
  const out = {
    paper: page.paper, orientation: page.orientation,
    margins: { top: Number(m.top), right: Number(m.right), bottom: Number(m.bottom), left: Number(m.left) },
  };
  if (!['A4', 'Letter'].includes(out.paper)) fail('papel (A4 ou Carta)');
  if (!['portrait', 'landscape'].includes(out.orientation)) fail('orientação');
  for (const k of ['top', 'right', 'bottom', 'left']) if (!Number.isFinite(out.margins[k]) || out.margins[k] < 5 || out.margins[k] > 50) fail('margens entre 5 e 50 mm');
  return out;
}

/** Valida o modelo completo (corpo, cabeçalho, rodapé e página) e o tamanho total. */
export function validateTemplate({ doc, header, footer, page }) {
  const size = Buffer.byteLength(JSON.stringify({ doc, header, footer, page }) || '', 'utf8');
  if (size > MAX_BYTES) fail('o modelo passa de 2,5 MB (reduza as imagens)');
  return {
    doc: validateDoc(doc, 'corpo'),
    header: header == null ? null : validateDoc(header, 'cabeçalho'),
    footer: footer == null ? null : validateDoc(footer, 'rodapé'),
    page: validatePage(page),
  };
}

// ---------- Logotipo: tipo pela assinatura do arquivo, não pela extensão ----------
const SIG = [
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** Decodifica um data URL de imagem e confere a assinatura e o tamanho. Retorna { mime, buf }. */
export function decodeImage(dataUrl, maxBytes, label = 'imagem') {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, `${label}: envie PNG, JPEG ou WEBP (SVG não é aceito).`);
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new HttpError(400, `${label}: arquivo vazio.`);
  if (buf.length > maxBytes) throw new HttpError(400, `${label}: arquivo maior que ${Math.round(maxBytes / 1024)} KB.`);
  const real = SIG.find((s) => s.test(buf));
  if (!real) throw new HttpError(400, `${label}: o conteúdo não é uma imagem PNG, JPEG ou WEBP válida.`);
  if (real.mime !== m[1]) throw new HttpError(400, `${label}: o tipo declarado não confere com o conteúdo do arquivo.`);
  return { mime: real.mime, buf };
}
