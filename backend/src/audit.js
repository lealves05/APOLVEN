// Trilha de auditoria (25.4): quem, em qual corretora, quando, o quê, versão/motivo e resultado.
import { q } from './db.js';

const SECRET = /(password|senha|token|secret|segredo|certificate|certificado|private|chave|mfa|code|credential)/i;
export const clean = (v, depth = 0) => {
  if (v == null || depth > 3) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, clean(x, depth + 1)]));
  }
  return typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
};

/**
 * @param {{query: Function}|null} db  conexão da transação (ou null para o pool)
 */
export async function audit(db, req, { entity, entityId = null, action, summary = null, reason = null, data = null }) {
  const run = db ? (t, p) => db.query(t, p) : q;
  const sql = `insert into audit_log (company_id, user_id, user_name, entity, entity_id, action, summary, reason, data, ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  const params = [req.companyId, req.user?.id || null, req.user?.name || null, entity, entityId ? String(entityId) : null, action,
    summary, reason, data ? JSON.stringify(clean(data)) : null, req.ip || null];
  if (db) return run(sql, params); // dentro da transação: falha de auditoria desfaz a operação
  try { await run(sql, params); } catch (e) { console.error('[audit] falha ao registrar', e.message); }
}

/** Evento de negócio (29.3) com identificador, tenant, entidade, versão, origem e correlação. */
export async function emit(db, companyId, type, entity, entityId, data = null, { source = 'sistema', version = 1, occurredAt = null, correlationId = null } = {}) {
  const run = db ? (t, p) => db.query(t, p) : q;
  await run(`insert into business_events (company_id, type, entity, entity_id, version, source, occurred_at, correlation_id, data)
             values ($1,$2,$3,$4,$5,$6,coalesce($7, now()),$8,$9)`,
  [companyId, type, entity, entityId, version, source, occurredAt, correlationId, data ? JSON.stringify(clean(data)) : null]);
}
