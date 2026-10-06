// Renderiza o modelo de impressão (JSON do editor) como elementos React — nunca como HTML cru.
// Texto e valores de campos passam pelo React (escapados); estilos e imagens só entram se forem seguros.
import React from 'react';

const h = React.createElement;
const { Fragment } = React;
import { EMPTY, LOGO_SRC, TABLE_SOURCES, resolveField } from './printFields.js';

const ALIGN = new Set(['left', 'center', 'right', 'justify']);
export const safeColor = (c) => (typeof c === 'string' && (/^#[0-9a-f]{3,8}$/i.test(c)
  || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i.test(c)) ? c : undefined);
export const safeSize = (s) => (typeof s === 'string' && /^\d{1,2}(\.\d+)?(pt|px)$/.test(s) ? s : undefined);
const IMG_DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const safeImage = (src, data) => (src === LOGO_SRC ? data?.logo || null : typeof src === 'string' && IMG_DATA.test(src) ? src : null);
const int = (v, min, max, d) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };

function withMarks(content, marks = [], key) {
  let el = content;
  for (const m of marks || []) {
    const a = m.attrs || {};
    if (m.type === 'bold') el = h('strong', null, el);
    else if (m.type === 'italic') el = h('em', null, el);
    else if (m.type === 'underline') el = h('u', null, el);
    else if (m.type === 'strike') el = h('s', null, el);
    else if (m.type === 'textStyle') {
      const style = { color: safeColor(a.color), fontSize: safeSize(a.fontSize) };
      if (style.color || style.fontSize) el = h('span', { style }, el);
    } else if (m.type === 'highlight') el = h('mark', { style: { backgroundColor: safeColor(a.color) || '#fef08a', color: 'inherit' } }, el);
  }
  return h(Fragment, { key }, el);
}

const blockStyle = (a = {}) => (ALIGN.has(a.textAlign) && a.textAlign !== 'left' ? { textAlign: a.textAlign } : undefined);
const children = (node, ctx) => (node.content || []).map((c, i) => renderNode(c, ctx, i));

/** Linhas de uma tabela do editor; as primeiras linhas só com cabeçalhos repetem em cada página. */
export function tableParts(node) {
  const rows = (node.content || []).filter((r) => r.type === 'tableRow');
  let head = 0;
  while (head < rows.length && (rows[head].content || []).length && rows[head].content.every((c) => c.type === 'tableHeader')) head += 1;
  if (head === rows.length) head = 0;
  return { head: rows.slice(0, head), body: rows.slice(head) };
}

function cell(c, ctx, i) {
  const a = c.attrs || {};
  const w = Array.isArray(a.colwidth) && a.colwidth[0] ? int(a.colwidth[0], 10, 2000, undefined) : undefined;
  return h(c.type === 'tableHeader' ? 'th' : 'td', {
    key: i, colSpan: int(a.colspan, 1, 30, 1), rowSpan: int(a.rowspan, 1, 200, 1),
    style: { width: w ? `${w}px` : undefined, backgroundColor: safeColor(a.backgroundColor) },
  }, children(c, ctx));
}
const row = (r, ctx, i) => h('tr', { key: i }, (r.content || []).map((c, j) => cell(c, ctx, j)));

/** Tabela do editor; range = [início, fim) das linhas do corpo (paginação). */
export function renderTable(node, ctx, key, range) {
  const { head, body } = tableParts(node);
  const rows = range ? body.slice(range[0], range[1]) : body;
  return h('table', { key, className: node.attrs?.variant === 'plain' ? 'pt-table pt-plain' : 'pt-table' },
    head.length ? h('thead', null, head.map((r, i) => row(r, ctx, i))) : null,
    h('tbody', null, rows.map((r, i) => row(r, ctx, i))));
}

export function dataTableRows(node, ctx) {
  return ctx?.data?.tables?.[node.attrs?.source] || [];
}

/** Tabela que repete uma linha por registro (coberturas, parcelas, itens, franquias). */
export function renderDataTable(node, ctx, key, range) {
  const src = TABLE_SOURCES[node.attrs?.source];
  if (!src) return null;
  const wanted = Array.isArray(node.attrs?.columns) && node.attrs.columns.length ? node.attrs.columns : src.columns.map(([k]) => k);
  const cols = src.columns.filter(([k]) => wanted.includes(k));
  const all = dataTableRows(node, ctx);
  const rows = range ? all.slice(range[0], range[1]) : all;
  return h('table', { key, className: 'pt-table pt-data' },
    h('thead', null, h('tr', null, cols.map(([k, label]) => h('th', { key: k }, label)))),
    h('tbody', null, all.length
      ? rows.map((r, i) => h('tr', { key: i }, cols.map(([k]) => h('td', { key: k }, r?.[k] == null || r[k] === '' ? EMPTY : String(r[k])))))
      : h('tr', null, h('td', { colSpan: cols.length, className: 'pt-none' }, 'Nenhum registro'))));
}

export function renderNode(node, ctx, key) {
  if (!node || typeof node !== 'object') return null;
  const a = node.attrs || {};
  switch (node.type) {
    case 'doc': return h(Fragment, { key }, children(node, ctx));
    case 'paragraph': return h('p', { key, style: blockStyle(a) }, node.content?.length ? children(node, ctx) : h('br'));
    case 'heading': return h(`h${int(a.level, 1, 4, 2)}`, { key, style: blockStyle(a) }, children(node, ctx));
    case 'text': return withMarks(typeof node.text === 'string' ? node.text : '', node.marks, key);
    case 'hardBreak': return h('br', { key });
    case 'bulletList': return h('ul', { key }, children(node, ctx));
    case 'orderedList': return h('ol', { key, start: int(a.start, 1, 10000, 1) }, children(node, ctx));
    case 'listItem': return h('li', { key }, children(node, ctx));
    case 'blockquote': return h('blockquote', { key }, children(node, ctx));
    case 'horizontalRule': return h('hr', { key });
    case 'pageBreak': return h('div', { key, className: 'pt-page-break' });
    case 'table': return renderTable(node, ctx, key);
    case 'dataTable': return renderDataTable(node, ctx, key);
    case 'image': {
      const src = safeImage(a.src, ctx?.data);
      if (!src) return null;
      const w = int(a.width, 10, 2000, null);
      const align = ALIGN.has(a.align) ? a.align : 'left';
      return h('div', { key, className: 'pt-img', style: { textAlign: align } },
        h('img', { src, alt: typeof a.alt === 'string' ? a.alt.slice(0, 200) : '', style: { width: w ? `${w}px` : undefined } }));
    }
    case 'mergeField': return withMarks(h('span', { className: 'pt-field' }, resolveField(ctx?.data, a.key)), node.marks, key);
    case 'pageNumber': {
      const v = a.kind === 'total' ? ctx?.pages : ctx?.page;
      return withMarks(h('span', null, v == null ? '#' : String(v)), node.marks, key);
    }
    default: return null;
  }
}

/** Corpo inteiro (sem paginação). */
export function renderDoc(doc, ctx) {
  return renderNode(doc && doc.type === 'doc' ? doc : { type: 'doc', content: [] }, ctx, 'doc');
}
