// Leitura de planilhas (XLSX/XLS/ODS) num Web Worker: o arquivo vem da seguradora e é processado
// isolado da página (a biblioteca roda fora do contexto da aplicação). Devolve linhas como texto.
import { read, utils } from 'xlsx';

const iso = (d) => new Date(d.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
const cell = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : iso(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v).trim();
};

self.onmessage = (e) => {
  try {
    const wb = read(e.data, { type: 'array', cellDates: true, dense: true, cellFormula: false, cellHTML: false, cellStyles: false });
    const name = wb.SheetNames[0];
    const rows = utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    self.postMessage({ ok: true, sheet: name, rows: rows.slice(0, 20002).map((r) => r.map(cell)) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
