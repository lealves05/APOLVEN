// Controles compartilhados: política de senha, troca de senha com versão de autenticação e
// limites de tentativas guardados no Postgres (valem para todas as instâncias da Edge Function).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from './db.js';
import { HttpError, passwordProblem } from './util.js';

export const passwordSchema = z.string().max(200).superRefine((p, ctx) => {
  const m = passwordProblem(p);
  if (m) ctx.addIssue({ code: 'custom', message: m });
});

/** Troca a senha e invalida todas as sessões anteriores do usuário. */
export async function setPassword(db, userId, companyId, password) {
  const run = db ? (t, p) => db.query(t, p) : q;
  const hash = await bcrypt.hash(password, 10);
  const r = await run(`update users set password_hash = $1, password_changed_at = now(), auth_version = auth_version + 1
     where id = $2 and company_id = $3 returning id`, [hash, userId, companyId]);
  if (!r.rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
}

const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');

/** Conta uma tentativa (atômico). Devolve { blocked, retryAfter }. */
export async function hit(key, limit, windowSec) {
  const { rows: [r] } = await q(
    `insert into rate_limits (key, count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at <= now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count, greatest(1, extract(epoch from (reset_at - now()))::int) as left`, [hashKey(key), windowSec]);
  if (Math.random() < 0.01) q('delete from rate_limits where reset_at < now() - interval \'1 day\'').catch(() => {});
  return { count: r.count, blocked: r.count > limit, retryAfter: r.left };
}
export const clearHits = (key) => q('delete from rate_limits where key = $1', [hashKey(key)]).catch(() => {});

export function limitByIp(scope, limit, windowSec, message = 'Muitas tentativas. Aguarde alguns minutos.') {
  return async (req, res, next) => {
    try {
      const r = await hit(`${scope}:ip:${req.ip}`, limit, windowSec);
      if (r.blocked) { res.set('Retry-After', String(r.retryAfter)); return next(new HttpError(429, message)); }
      next();
    } catch (e) { next(e); }
  };
}
export async function limitByKey(scope, id, limit, windowSec, res, message = 'Muitas tentativas. Aguarde alguns minutos.') {
  const r = await hit(`${scope}:id:${String(id).toLowerCase()}`, limit, windowSec);
  if (r.blocked) { res?.set('Retry-After', String(r.retryAfter)); throw new HttpError(429, message); }
  return r;
}
