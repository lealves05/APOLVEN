// Leitura de planilhas XLSX num Web Worker: o arquivo vem da seguradora e é processado
// isolado da página. Usa read-excel-file (mantida, sem as falhas conhecidas da SheetJS do npm).
// Devolve a primeira aba como matriz de textos.
import { readSheet } from 'read-excel-file/web-worker';

const iso = (d) => new Date(d.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
const cell = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : iso(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v).trim();
};

self.onmessage = async (e) => {
  try {
    const rows = await readSheet(e.data);
    self.postMessage({ ok: true, rows: (rows || []).slice(0, 20002).map((r) => (r || []).map(cell)) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
