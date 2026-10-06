// Extensões do editor do modelo de impressão (TipTap): campos de mesclagem, número de página, quebra de página,
// tabela de dados repetida, imagem com largura/alinhamento (inclui o logotipo) e tabelas com/sem bordas.
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableCell, TableHeader, TableView } from '@tiptap/extension-table';
import { FIELD_LABEL, LOGO_SRC, TABLE_SOURCES } from './printFields';

const LOGO_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90"><rect width="300" height="90" rx="8" fill="#eef2ff" stroke="#a5b4fc" stroke-dasharray="6 4"/><text x="150" y="52" font-family="sans-serif" font-size="18" fill="#4f46e5" text-anchor="middle">Logotipo da corretora</text></svg>')}`;

export const MergeField = Node.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { key: { default: null, parseHTML: (el) => el.getAttribute('data-merge') } }; },
  parseHTML() { return [{ tag: 'span[data-merge]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-merge': node.attrs.key, class: 'pt-chip', contenteditable: 'false' }), FIELD_LABEL[node.attrs.key] || node.attrs.key || '?'];
  },
  renderText({ node }) { return `{${FIELD_LABEL[node.attrs.key] || node.attrs.key}}`; },
});

export const PageNumber = Node.create({
  name: 'pageNumber',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { kind: { default: 'current', parseHTML: (el) => el.getAttribute('data-page-number') } }; },
  parseHTML() { return [{ tag: 'span[data-page-number]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-page-number': node.attrs.kind, class: 'pt-chip pt-chip-page', contenteditable: 'false' }), node.attrs.kind === 'total' ? 'Total de páginas' : 'Nº da página'];
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-page-break]' }]; },
  renderHTML() { return ['div', { 'data-page-break': '', class: 'pt-break-editor' }, ['span', {}, 'Quebra de página']]; },
  addCommands() { return { setPageBreak: () => ({ commands }) => commands.insertContent({ type: 'pageBreak' }) }; },
});

function DataTableView({ node, updateAttributes, selected, deleteNode }) {
  const src = TABLE_SOURCES[node.attrs.source];
  if (!src) return <NodeViewWrapper />;
  const cols = node.attrs.columns?.length ? node.attrs.columns : src.columns.map(([k]) => k);
  const toggle = (k) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : src.columns.map(([c]) => c).filter((c) => c === k || cols.includes(c));
    if (next.length) updateAttributes({ columns: next });
  };
  const shown = src.columns.filter(([k]) => cols.includes(k));
  return (
    <NodeViewWrapper className={`pt-dt-editor${selected ? ' is-selected' : ''}`} data-drag-handle="">
      <div className="pt-dt-title" contentEditable={false}>
        <span>Tabela de {src.label.toLowerCase()} — uma linha por registro</span>
        <button type="button" className="pt-dt-del" onClick={deleteNode} aria-label="Remover tabela de dados">Remover</button>
      </div>
      <table><thead><tr>{shown.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
        <tbody><tr>{shown.map(([k]) => <td key={k}>…</td>)}</tr></tbody></table>
      <div className="pt-dt-cols" contentEditable={false}>
        Colunas: {src.columns.map(([k, l]) => (
          <label key={k}><input type="checkbox" checked={cols.includes(k)} onChange={() => toggle(k)} /> {l}</label>
        ))}
      </div>
    </NodeViewWrapper>
  );
}

export const DataTable = Node.create({
  name: 'dataTable',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: { default: 'coberturas', parseHTML: (el) => el.getAttribute('data-source') },
      columns: { default: null, parseHTML: (el) => (el.getAttribute('data-columns') || '').split(',').filter(Boolean) || null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-data-table]' }]; },
  renderHTML({ node }) { return ['div', { 'data-data-table': '', 'data-source': node.attrs.source, 'data-columns': (node.attrs.columns || []).join(',') }]; },
  addNodeView() { return ReactNodeViewRenderer(DataTableView); },
});

// Logotipo dentro do editor: as imagens marcadas como logotipo são atualizadas no lugar quando o logotipo carrega/troca,
// sem recriar o editor (o que perderia o que está sendo editado).
const logoImgs = new Set();
let currentLogo = null;
export function setEditorLogo(url) {
  currentLogo = typeof url === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(url) ? url : null;
  logoImgs.forEach((img) => { img.src = currentLogo || LOGO_PLACEHOLDER; });
}

/** Imagem com largura e alinhamento; o logotipo fica guardado como referência (troca de logo não exige refazer o modelo). */
export const PrintImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, parseHTML: (el) => (el.hasAttribute('data-logo') ? LOGO_SRC : el.getAttribute('src')) },
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('width')) || null },
      align: { default: 'left', parseHTML: (el) => el.getAttribute('data-align') || 'left' },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const isLogo = node.attrs.src === LOGO_SRC;
    const attrs = { ...HTMLAttributes, src: isLogo ? LOGO_PLACEHOLDER : node.attrs.src, 'data-align': node.attrs.align, class: `pt-img-editor align-${node.attrs.align || 'left'}` };
    if (isLogo) attrs['data-logo'] = '';
    if (node.attrs.width) attrs.style = `width:${node.attrs.width}px`;
    delete attrs.height;
    return ['img', attrs];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      let cur = node;
      const apply = (n) => {
        const isLogo = n.attrs.src === LOGO_SRC;
        if (isLogo) logoImgs.add(dom); else logoImgs.delete(dom);
        const src = isLogo ? (currentLogo || LOGO_PLACEHOLDER) : n.attrs.src;
        if (dom.getAttribute('src') !== src) dom.setAttribute('src', src || '');
        dom.className = `pt-img-editor align-${n.attrs.align || 'left'}`;
        dom.style.width = n.attrs.width ? `${n.attrs.width}px` : '';
        dom.alt = n.attrs.alt || (isLogo ? 'Logotipo da corretora' : '');
        dom.draggable = false;
      };
      apply(node);
      return {
        dom,
        update: (n) => { if (n.type !== cur.type) return false; cur = n; apply(n); return true; },
        destroy: () => logoImgs.delete(dom),
        ignoreMutation: () => true,
      };
    };
  },
}).configure({ inline: false, allowBase64: true });

const withBg = (ext) => ext.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-bg') || null,
        renderHTML: (a) => (a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color:${a.backgroundColor}` } : {}),
      },
    };
  },
});

/** Tabela redimensionável que mostra no editor o estilo escolhido (com bordas / sem bordas para layout). */
class PrintTableView extends TableView {
  constructor(node, ...rest) { super(node, ...rest); this.applyVariant(node); }
  applyVariant(node) { this.table.classList.toggle('pt-plain', node.attrs.variant === 'plain'); }
  update(node) { const ok = super.update(node); if (ok) this.applyVariant(node); return ok; }
}

export const PrintTable = Table.extend({
  addAttributes() {
    return { ...this.parent?.(), variant: { default: 'grid', parseHTML: (el) => el.getAttribute('data-variant') || 'grid', renderHTML: (a) => ({ 'data-variant': a.variant, class: a.variant === 'plain' ? 'pt-plain' : '' }) } };
  },
}).configure({ resizable: true, lastColumnResizable: false, View: PrintTableView });

export function printExtensions() {
  return [
    StarterKit.configure({ link: false, code: false, codeBlock: false, heading: { levels: [1, 2, 3, 4] }, trailingNode: false }),
    TextStyle, Color, FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    PrintImage,
    PrintTable, TableRow, withBg(TableHeader), withBg(TableCell),
    MergeField, PageNumber, PageBreak, DataTable,
  ];
}

// ---------- Limpeza antes de salvar (conteúdo colado de Word/navegador) ----------
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const KEEP = {
  paragraph: ['textAlign'], heading: ['textAlign', 'level'], orderedList: ['start', 'type'], table: ['variant'],
  tableCell: ['colspan', 'rowspan', 'colwidth', 'backgroundColor'], tableHeader: ['colspan', 'rowspan', 'colwidth', 'backgroundColor'],
  image: ['src', 'alt', 'title', 'width', 'align'], mergeField: ['key'], pageNumber: ['kind'], dataTable: ['source', 'columns'],
};
const NODES = new Set(['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'pageBreak',
  'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'mergeField', 'pageNumber', 'dataTable']);

/** Remove o que o servidor não aceita (marcas/atributos desconhecidos, imagens externas). Retorna { doc, removed }. */
export function cleanDoc(doc) {
  let removed = 0;
  const walk = (n) => {
    if (!n || !NODES.has(n.type)) { removed += 1; return null; }
    if (n.type === 'image' && !(n.attrs?.src === LOGO_SRC || (typeof n.attrs?.src === 'string' && IMG.test(n.attrs.src)))) { removed += 1; return null; }
    const out = { type: n.type };
    if (n.attrs) {
      const a = {};
      for (const k of KEEP[n.type] || []) if (n.attrs[k] !== undefined) a[k] = n.attrs[k];
      if (n.type === 'image') {
        if (a.width != null) a.width = Math.max(10, Math.min(3000, Math.round(Number(a.width)) || 0)) || null;
        if (a.alt == null) delete a.alt;
        if (a.title == null) delete a.title;
      }
      if ((n.type === 'tableCell' || n.type === 'tableHeader') && a.backgroundColor && !COLOR.test(a.backgroundColor)) a.backgroundColor = null;
      if (Object.keys(a).length) out.attrs = a;
    }
    if (n.marks) {
      const marks = n.marks.filter((m) => ['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight'].includes(m.type)).map((m) => {
        if (m.type === 'textStyle') {
          const a = {};
          if (m.attrs?.color && COLOR.test(m.attrs.color)) a.color = m.attrs.color;
          if (m.attrs?.fontSize && /^\d{1,2}(\.\d+)?(pt|px)$/.test(m.attrs.fontSize)) a.fontSize = m.attrs.fontSize;
          return Object.keys(a).length ? { type: 'textStyle', attrs: a } : null;
        }
        if (m.type === 'highlight') return { type: 'highlight', attrs: { color: m.attrs?.color && COLOR.test(m.attrs.color) ? m.attrs.color : '#fef08a' } };
        return { type: m.type };
      }).filter(Boolean);
      if (marks.length) out.marks = marks;
    }
    if (n.type === 'text') { if (!n.text) return null; out.text = n.text; return out; }
    if (Array.isArray(n.content)) {
      const c = n.content.map(walk).filter(Boolean);
      if (c.length || ['doc', 'paragraph', 'heading', 'tableCell', 'tableHeader', 'listItem', 'blockquote'].includes(n.type)) out.content = c;
      if (['tableCell', 'tableHeader', 'listItem', 'blockquote'].includes(n.type) && !c.length) out.content = [{ type: 'paragraph' }];
    }
    return out;
  };
  const d = walk(doc) || { type: 'doc', content: [] };
  return { doc: d, removed };
}
