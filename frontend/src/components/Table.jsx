// Tabelas: ordenação por coluna, paginação e contagem. No celular as tabelas viram cards (ver index.css).
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './ui';

const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
};

/**
 * @param {Array} rows
 * @param {{ sort?: string, dir?: 'asc'|'desc', pageSize?: number, get?: Record<string, (row) => any> }} opts
 */
export function useTable(rows, { sort: s0 = null, dir: d0 = 'asc', pageSize = 25, get = {} } = {}) {
  const [sort, setSort] = useState(s0);
  const [dir, setDir] = useState(d0);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const list = [...(rows || [])];
    if (!sort) return list;
    const g = get[sort] || ((r) => r[sort]);
    list.sort((a, b) => cmp(g(a), g(b)) * (dir === 'asc' ? 1 : -1));
    return list;
  }, [rows, sort, dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { if (page >= pages) setPage(0); }, [pages, page]);
  const view = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const toggle = (key) => {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDir('asc'); }
  };
  return { rows: view, total: sorted.length, page, pages, setPage, sort, dir, toggle, pageSize };
}

/** Cabeçalho clicável para ordenar. */
export function SortTh({ t, k, children, className }) {
  const active = t.sort === k;
  const Icon = !active ? ArrowUpDown : t.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={className} aria-sort={active ? (t.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => t.toggle(k)} className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}>
        {children}<Icon className={cx('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </th>
  );
}

export function Pager({ t }) {
  if (t.total <= t.pageSize) return t.total ? <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">{t.total} registro(s)</div> : null;
  const from = t.page * t.pageSize + 1;
  const to = Math.min(t.total, from + t.pageSize - 1);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs text-ink-faint">
      <span>{from}–{to} de {t.total}</span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost btn-icon h-8" disabled={t.page === 0} onClick={() => t.setPage(t.page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
        <span className="tabular-nums">{t.page + 1}/{t.pages}</span>
        <button className="btn-ghost btn-icon h-8" disabled={t.page >= t.pages - 1} onClick={() => t.setPage(t.page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
