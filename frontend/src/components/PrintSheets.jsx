// Folhas de papel (A4/Carta) a partir do modelo de impressão: mede cada bloco, distribui em páginas
// (tabelas quebram por linha repetindo o cabeçalho, quebra de página manual, título não fica sozinho no fim)
// e repete cabeçalho/rodapé com "Página X de Y". O mesmo resultado vai para a tela e para a impressão/PDF.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderNode, renderTable, renderDataTable, dataTableRows } from '../lib/printRender';

const MM = 96 / 25.4;
const PAPER = { A4: [210, 297], Letter: [215.9, 279.4] };

export function sheetSize(page) {
  const [w, h] = PAPER[page?.paper] || PAPER.A4;
  return page?.orientation === 'landscape' ? [h, w] : [w, h];
}

const blocksOf = (doc) => (doc?.type === 'doc' && Array.isArray(doc.content) ? doc.content : []);
const isTable = (n) => n?.type === 'table' || n?.type === 'dataTable';

function renderBlock(node, ctx, key, range) {
  if (node.type === 'table') return renderTable(node, ctx, key, range);
  if (node.type === 'dataTable') return renderDataTable(node, ctx, key, range);
  return renderNode(node, ctx, key);
}

/** Distribui os blocos medidos em páginas. Exportada para teste visual/depuração. */
export function paginate(blocks, m, avail) {
  const pages = [[]];
  let used = 0;
  const newPage = () => { pages.push([]); used = 0; };
  const firstChunk = (i) => {
    const b = blocks[i];
    if (!b) return 0;
    const mt = m.blocks[i];
    if (isTable(b) && mt?.rows?.length) return mt.head + mt.extra + mt.rows[0];
    return mt?.h || 0;
  };
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    const mt = m.blocks[i] || { h: 0 };
    if (b.type === 'pageBreak') { if (pages[pages.length - 1].length) newPage(); continue; }
    if (b.type === 'heading' && used > 0 && used + mt.h + firstChunk(i + 1) > avail) newPage();
    if (used + mt.h <= avail || (used === 0 && !(isTable(b) && mt.rows?.length > 1))) {
      pages[pages.length - 1].push({ i }); used += mt.h; continue;
    }
    if (isTable(b) && mt.rows?.length) {
      let start = 0;
      while (start < mt.rows.length) {
        const space = avail - used - mt.head - mt.extra;
        let n = 0;
        let sum = 0;
        while (start + n < mt.rows.length && sum + mt.rows[start + n] <= space) { sum += mt.rows[start + n]; n += 1; }
        if (!n) {
          if (used > 0) { newPage(); continue; }
          n = 1; sum = mt.rows[start];
        }
        pages[pages.length - 1].push({ i, range: [start, start + n] });
        used += mt.head + mt.extra + sum;
        start += n;
        if (start < mt.rows.length) newPage();
      }
      continue;
    }
    newPage();
    pages[pages.length - 1].push({ i }); used = mt.h;
  }
  if (pages.length > 1 && !pages[pages.length - 1].length) pages.pop();
  return pages;
}

function Sheet({ size, page, header, footer, ctx, children, measureRef }) {
  const mg = page.margins;
  return (
    <div className="pt-sheet" style={{ '--pt-h': `${size[1]}mm`, width: `${size[0]}mm`, height: `${size[1]}mm`, padding: `${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm` }} ref={measureRef}>
      <div className="pt-sheet-inner">
        {header && <div className="pt-content pt-header">{renderNode(header, ctx, 'h')}</div>}
        <div className="pt-content pt-body">{children}</div>
        {footer && <div className="pt-content pt-footer" style={{ left: `${mg.left}mm`, right: `${mg.right}mm`, bottom: `${mg.bottom}mm` }}>{renderNode(footer, ctx, 'f')}</div>}
      </div>
    </div>
  );
}

/**
 * template = { doc, header, footer, page }, data = buildPrintData(...).
 * printable: também monta a cópia usada pela impressão (Ctrl+P / Imprimir / Salvar PDF).
 */
export default function PrintSheets({ template, data, printable = false, onPages }) {
  const page = template.page;
  const size = sheetSize(page);
  const blocks = blocksOf(template.doc);
  const measure = useRef(null);
  const wrap = useRef(null);
  const [pages, setPages] = useState(null);
  const [tick, setTick] = useState(0);
  const [scale, setScale] = useState(1);
  const [natH, setNatH] = useState(0);
  const sheetsRef = useRef(null);
  const ctx1 = useMemo(() => ({ data, page: 1, pages: 1 }), [data]);

  // mede e pagina (de novo quando imagens/fontes terminam de carregar)
  useLayoutEffect(() => {
    const root = measure.current;
    if (!root) return;
    const px = (mm) => mm * MM;
    const headH = root.querySelector('.pt-m-header')?.offsetHeight || 0;
    const footH = root.querySelector('.pt-m-footer')?.offsetHeight || 0;
    const avail = px(size[1]) - px(page.margins.top) - px(page.margins.bottom) - headH - footH - 2;
    const m = { blocks: [] };
    root.querySelectorAll('[data-pt-block]').forEach((el) => {
      const i = Number(el.dataset.ptBlock);
      const h = el.getBoundingClientRect().height;
      const entry = { h };
      if (isTable(blocks[i])) {
        const table = el.querySelector('table');
        const thead = table?.querySelector('thead');
        const rows = [...(table?.querySelector('tbody')?.children || [])].map((r) => r.getBoundingClientRect().height);
        entry.head = thead ? thead.getBoundingClientRect().height : 0;
        entry.rows = blocks[i].type === 'dataTable' && !dataTableRows(blocks[i], ctx1).length ? [] : rows;
        entry.extra = Math.max(0, h - entry.head - rows.reduce((a, b) => a + b, 0));
      }
      m.blocks[i] = entry;
    });
    const out = paginate(blocks, m, avail);
    setPages(out);
    onPages?.(out.length);
  }, [template, data, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = measure.current;
    if (!root) return undefined;
    const imgs = [...root.querySelectorAll('img')].filter((i) => !i.complete);
    const bump = () => setTick((t) => t + 1);
    imgs.forEach((i) => i.addEventListener('load', bump, { once: true }));
    document.fonts?.ready?.then(bump).catch(() => {});
    return () => imgs.forEach((i) => i.removeEventListener('load', bump));
  }, [template, data]);

  // reduz as folhas para caber na largura disponível (celular) com transform — o layout interno continua
  // idêntico ao medido (zoom arredonda fontes/bordas e faria o conteúdo invadir o rodapé)
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 8) / (size[0] * MM))));
      if (sheetsRef.current) setNatH(sheetsRef.current.offsetHeight);
    });
    ro.observe(el);
    if (sheetsRef.current) ro.observe(sheetsRef.current);
    return () => ro.disconnect();
  }, [size[0], pages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!printable) return undefined;
    document.documentElement.classList.add('pt-printing');
    return () => document.documentElement.classList.remove('pt-printing');
  }, [printable]);

  const sheets = (pages || []).map((entries, pi) => {
    const ctx = { data, page: pi + 1, pages: pages.length };
    return (
      <Sheet key={pi} size={size} page={page} header={template.header} footer={template.footer} ctx={ctx}>
        {entries.map((e, k) => <div key={k} className="pt-block">{renderBlock(blocks[e.i], ctx, `${e.i}-${k}`, e.range)}</div>)}
      </Sheet>
    );
  });

  const contentWidth = size[0] - page.margins.left - page.margins.right;
  return (
    <div ref={wrap} className="pt-wrap">
      {/* medição invisível (mesma largura útil da folha) */}
      <div ref={measure} className="pt-measure" aria-hidden style={{ width: `${contentWidth}mm` }}>
        {template.header && <div className="pt-content pt-m-header">{renderNode(template.header, ctx1, 'mh')}</div>}
        <div className="pt-content">{blocks.map((b, i) => <div key={i} data-pt-block={i} className="pt-block">{renderBlock(b, ctx1, `m${i}`)}</div>)}</div>
        {template.footer && <div className="pt-content pt-m-footer">{renderNode(template.footer, ctx1, 'mf')}</div>}
      </div>
      <div className="pt-sheets-frame" style={{ width: `${size[0] * MM * scale}px`, height: natH ? `${natH * scale}px` : undefined }}>
        <div ref={sheetsRef} className="pt-sheets" style={{ width: `${size[0] * MM}px`, transform: scale < 1 ? `scale(${scale})` : undefined }}>{sheets}</div>
      </div>
      {printable && pages && createPortal(
        <div className="pt-print-portal">
          <style>{`@page { size: ${page.paper === 'Letter' ? 'letter' : 'A4'} ${page.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }`}</style>
          {sheets}
        </div>, document.body)}
    </div>
  );
}
