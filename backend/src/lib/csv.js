// Leitura de CSV/OFX para importações (19.1): cabeçalhos normalizados, valores em centavos sem ponto flutuante.
import { bad } from '../util.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** CSV com ; ou , (detectado pelo cabeçalho), aspas e quebras dentro de aspas. */
export function parseCsv(text, { maxRows = 20000 } = {}) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
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
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw bad(`Arquivo com mais de ${maxRows} linhas: divida em partes.`);
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(norm);
  return { headers, rows: rows.slice(1).map((r, idx) => ({ __line: idx + 2, ...Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])) })) };
}

/** "1.234,56" | "1234.56" | "-12,3" | "R$ 10,00" → centavos (inteiro). */
export function moneyToCents(v) {
  if (v == null) return null;
  let s = String(v).replace(/[R$\s]/g, '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [int, dec = ''] = s.split('.');
  const c = Number(int) * 100 + Number((dec + '00').slice(0, 2));
  return neg ? -c : c;
}

/** dd/mm/aaaa | aaaa-mm-dd | aaaammdd → aaaa-mm-dd. */
export function parseDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** OFX (SGML ou XML): transações STMTTRN com data, valor, FITID e memo. */
export function parseOfx(text) {
  const src = String(text || '');
  const blocks = src.split(/<STMTTRN>/i).slice(1);
  return blocks.map((b, i) => {
    const tag = (t) => { const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : null; };
    return { __line: i + 1, date: parseDate(tag('DTPOSTED')), amount_cents: moneyToCents((tag('TRNAMT') || '').replace(',', '.')), fitid: tag('FITID'), description: tag('MEMO') || tag('NAME') || '' };
  });
}

/** Impressão digital estável de uma linha + ordinal para linhas iguais legítimas (A21/A22). */
export function withOrdinals(lines, fpOf) {
  const seen = {};
  return lines.map((l) => {
    const fp = fpOf(l);
    seen[fp] = (seen[fp] || 0) + 1;
    return { ...l, fingerprint: fp, ordinal: seen[fp] };
  });
}
