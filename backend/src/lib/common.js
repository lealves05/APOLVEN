// Utilidades de domínio compartilhadas pelas rotas: numeração, escopo de carteira, idempotência, período fechado.
import { q, one, runner } from '../db.js';
import { HttpError, conflict, hashOf, isUuid, notFound, periodOf } from '../util.js';
import { scopeOf } from '../auth.js';

/** Próximo número sequencial da corretora (atômico). */
export async function nextNumber(db, companyId, kind) {
  const run = runner(db);
  const { rows: [r] } = await run(
    `insert into counters (company_id, kind, value) values ($1, $2, 1)
     on conflict (company_id, kind) do update set value = counters.value + 1 returning value`, [companyId, kind]);
  return r.value;
}

/** Número formatado com prefixo da corretora: COT-00012. */
export function docNumber(settings, kind, n) {
  if (n == null) return null;
  const cfg = settings?.numbering || {};
  return `${cfg[kind] || kind.toUpperCase()}-${String(n).padStart(Number(cfg.digits) || 5, '0')}`;
}

/**
 * Busca um registro da corretora atual. O identificador sozinho nunca autoriza acesso (26.2):
 * sempre filtrado por company_id; formato inválido ou de outra corretora = 404.
 */
export async function own(table, id, companyId, cols = '*', db = null) {
  if (!isUuid(id)) throw notFound();
  const run = runner(db);
  const { rows: [r] } = await run(`select ${cols} from ${table} where id = $1 and company_id = $2`, [id, companyId]);
  if (!r) throw notFound();
  return r;
}

/**
 * Filtro de carteira para permissões com escopo: 'all' = sem filtro; 'own' = só os clientes do usuário;
 * 'none' = nada. Devolve um trecho SQL usando o alias da tabela de clientes informado.
 */
export function portfolioFilter(req, key, clientAlias = 'c', params = []) {
  const sc = scopeOf(req, key);
  if (sc === 'all') return { sql: 'true', params };
  if (sc === 'own') { params.push(req.user.id); return { sql: `${clientAlias}.owner_user_id = $${params.length}`, params }; }
  return { sql: 'false', params };
}

/** Confere se o usuário pode ver o cliente (carteira própria). */
export async function assertClientVisible(req, key, clientId) {
  const sc = scopeOf(req, key);
  if (sc === 'all') return;
  if (sc === 'own') {
    const c = await one('select owner_user_id from clients where id = $1 and company_id = $2', [clientId, req.companyId]);
    if (c && c.owner_user_id === req.user.id) return;
  }
  throw notFound();
}

/**
 * Idempotência (29.2): a mesma chave com o mesmo comando devolve o resultado anterior; com conteúdo diferente,
 * conflito sem executar. A chave é gravada na mesma transação da operação.
 */
export async function idempotent(db, req, operation, key, command, fn) {
  if (!key) return fn();
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(key)) throw new HttpError(400, 'Chave de idempotência inválida.');
  const h = hashOf({ operation, command });
  const { rows: [prev] } = await db.query(
    'select request_hash, response, operation from idempotency_keys where company_id = $1 and key = $2 for update', [req.companyId, key]);
  if (prev) {
    if (prev.request_hash !== h || prev.operation !== operation) throw conflict('Esta chave de idempotência já foi usada com outro conteúdo.', { code: 'IDEMPOTENCY_CONFLICT' });
    return { ...prev.response, replayed: true };
  }
  const out = await fn();
  await db.query(`insert into idempotency_keys (company_id, key, operation, request_hash, response, status) values ($1,$2,$3,$4,$5,'concluida')`,
    [req.companyId, key, operation, h, JSON.stringify(out ?? {})]);
  return out;
}

/** Período fechado não aceita lançamento novo ou alteração (17.3/17.4) — reabertura exige alçada. */
export async function assertPeriodOpen(db, companyId, ymd) {
  const run = runner(db);
  const { rows: [p] } = await run('select 1 from period_closures where company_id = $1 and period = $2 and reopened_at is null', [companyId, periodOf(ymd)]);
  if (p) throw conflict(`O período ${periodOf(ymd)} está fechado. Lance o ajuste em um período aberto ou peça a reabertura.`, { code: 'PERIOD_CLOSED' });
}

/** Linha do tempo do cliente (atividades). */
export async function logActivity(db, req, { clientId = null, opportunityId = null, entity = null, entityId = null, kind = 'sistema', summary }) {
  const run = runner(db);
  await run(`insert into activities (company_id, client_id, opportunity_id, entity, entity_id, kind, summary, created_by, created_by_name)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [req.companyId, clientId, opportunityId, entity, entityId, kind, summary, req.user?.id || null, req.user?.name || null]);
}

/** Instituição visível para a corretora: do catálogo global ou cadastrada por ela. */
export async function institutionFor(db, companyId, id) {
  if (!isUuid(id)) throw notFound('Seguradora não encontrada.');
  const run = runner(db);
  const { rows: [i] } = await run('select * from institutions where id = $1 and (company_id is null or company_id = $2)', [id, companyId]);
  if (!i) throw notFound('Seguradora não encontrada.');
  return i;
}

export { q, one };
