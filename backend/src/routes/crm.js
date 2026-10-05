// Oportunidades (funil configurável — 5.2) e agenda/tarefas (5.3).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can, scopeOf } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, idParam, BRANCH_KEYS } from '../util.js';
import { nextNumber, own, portfolioFilter, assertClientVisible, logActivity } from '../lib/common.js';

export const STAGES = ['novo_contato', 'qualificacao', 'coleta_dados', 'cotacao', 'comparativo', 'negociacao', 'autorizacao_cliente', 'transmissao', 'acompanhamento', 'ganho', 'perdido'];

export const opportunities = Router();

opportunities.get('/', need('opportunities'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'opportunities', 'c', params);
  const where = ['o.company_id = $1', f.sql];
  if (req.query.stage) { params.push(req.query.stage); where.push(`o.stage = $${params.length}`); }
  if (req.query.open === '1') where.push(`o.stage not in ('ganho','perdido')`);
  if (req.query.client_id) { params.push(idParam(req.query.client_id)); where.push(`o.client_id = $${params.length}`); }
  const { rows } = await q(`select o.*, c.name as client_name, u.name as owner_name from opportunities o join clients c on c.id = o.client_id
     left join users u on u.id = o.owner_user_id where ${where.join(' and ')} order by o.updated_at desc limit 500`, params);
  res.json(rows);
});

const oppSchema = z.object({
  client_id: z.string().uuid(),
  branch: z.enum(BRANCH_KEYS),
  title: z.string().trim().min(2).max(200),
  need: z.string().max(4000).nullable().optional(),
  stage: z.enum(STAGES).optional(),
  estimated_premium_cents: z.number().int().nonnegative().nullable().optional(),
  origin: z.string().max(80).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  next_action: z.string().max(300).nullable().optional(),
  next_action_at: z.string().datetime({ offset: true }).nullable().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)),
  lost_reason: z.string().max(200).nullable().optional(),
});

opportunities.post('/', need('opportunities'), async (req, res) => {
  const d = parse(oppSchema, req.body);
  await assertClientVisible(req, 'clients_view', d.client_id);
  await own('clients', d.client_id, req.companyId, 'id');
  const owner = scopeOf(req, 'opportunities') === 'own' ? req.user.id : (d.owner_user_id || req.user.id);
  const o = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'opportunity');
    const { rows: [x] } = await db.query(`insert into opportunities (company_id, number, client_id, branch, title, need, stage, estimated_premium_cents, origin, owner_user_id, next_action, next_action_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [req.companyId, n, d.client_id, d.branch, d.title, d.need || null, d.stage || 'novo_contato', d.estimated_premium_cents ?? null, d.origin || null, owner, d.next_action || null, d.next_action_at || null, req.user.id]);
    await logActivity(db, req, { clientId: d.client_id, opportunityId: x.id, summary: `Oportunidade criada: ${d.title}` });
    return x;
  });
  res.status(201).json(o);
});

opportunities.put('/:id', need('opportunities'), async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await own('opportunities', id, req.companyId);
  await assertClientVisible(req, 'clients_view', cur.client_id);
  const d = parse(oppSchema.partial().omit({ client_id: true }), req.body);
  if (d.stage === 'perdido' && !(d.lost_reason || cur.lost_reason)) throw new HttpError(400, 'Informe o motivo da perda.');
  if (scopeOf(req, 'opportunities') === 'own') delete d.owner_user_id;
  if (d.owner_user_id) await own('users', d.owner_user_id, req.companyId, 'id');
  const keys = Object.keys(d);
  const o = await tx(async (db) => {
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const closing = d.stage && ['ganho', 'perdido'].includes(d.stage) ? ', closed_at = now()' : d.stage ? ', closed_at = null' : '';
    const { rows: [x] } = await db.query(`update opportunities set ${[...sets, 'updated_at = now()'].join(', ')}${closing} where id = $1 and company_id = $2 returning *`,
      [id, req.companyId, ...keys.map((k) => d[k] ?? null)]);
    if (d.stage && d.stage !== cur.stage) await logActivity(db, req, { clientId: cur.client_id, opportunityId: id, summary: `Oportunidade "${cur.title}": ${cur.stage} → ${d.stage}${d.stage === 'perdido' ? ` (${d.lost_reason || cur.lost_reason})` : ''}` });
    return x;
  });
  res.json(o);
});

opportunities.get('/:id', need('opportunities'), async (req, res) => {
  const id = idParam(req.params.id);
  const o = await one(`select o.*, c.name as client_name from opportunities o join clients c on c.id = o.client_id where o.id = $1 and o.company_id = $2`, [id, req.companyId]);
  if (!o) throw notFound();
  await assertClientVisible(req, 'clients_view', o.client_id);
  const [acts, quotes] = await Promise.all([
    q('select * from activities where company_id = $1 and opportunity_id = $2 order by created_at desc', [req.companyId, id]),
    q('select id, number, status, branch, created_at from quote_requests where company_id = $1 and opportunity_id = $2 order by created_at desc', [req.companyId, id]),
  ]);
  res.json({ ...o, activities: acts.rows, quote_requests: quotes.rows });
});

// ---------------- Tarefas e agenda ----------------
export const tasks = Router();

tasks.get('/', async (req, res) => {
  const params = [req.companyId];
  const where = ['t.company_id = $1'];
  const mine = req.query.mine === '1' || !can(req, 'tasks');
  if (mine) { params.push(req.user.id); where.push(`(t.assignee_user_id = $${params.length} or (t.assignee_user_id is null and t.created_by = $${params.length}))`); }
  if (req.query.status) { params.push(req.query.status); where.push(`t.status = $${params.length}`); } else where.push(`t.status = 'aberta'`);
  if (req.query.from) { params.push(req.query.from); where.push(`t.due_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`t.due_at < ($${params.length}::date + 1)`); }
  if (req.query.entity_id) { params.push(idParam(req.query.entity_id)); where.push(`t.entity_id = $${params.length}`); }
  const { rows } = await q(`select t.*, u.name as assignee_name, c.name as client_name from tasks t left join users u on u.id = t.assignee_user_id
     left join clients c on c.id = t.client_id where ${where.join(' and ')} order by t.due_at nulls last, t.created_at limit 500`, params);
  res.json(rows);
});

const taskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(4000).nullable().optional(),
  kind: z.string().max(30).optional(),
  priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).optional(),
  due_at: z.string().nullable().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  entity: z.string().max(40).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
});

tasks.post('/', async (req, res) => {
  const d = parse(taskSchema, req.body);
  if (d.assignee_user_id && d.assignee_user_id !== req.user.id && !can(req, 'tasks')) throw new HttpError(403, 'Você só pode criar tarefas para si.');
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  if (d.client_id) await own('clients', d.client_id, req.companyId, 'id');
  const t = await one(`insert into tasks (company_id, title, description, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
  [req.companyId, d.title, d.description || null, d.kind || 'tarefa', d.priority || 'normal', d.due_at || null, d.assignee_user_id || req.user.id, d.client_id || null, d.entity || null, d.entity_id || null, req.user.id]);
  res.status(201).json(t);
});

tasks.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const cur = await own('tasks', id, req.companyId);
  if (!can(req, 'tasks') && cur.assignee_user_id !== req.user.id && cur.created_by !== req.user.id) throw notFound();
  const d = parse(taskSchema.partial().extend({ status: z.enum(['aberta', 'concluida', 'cancelada']).optional() }), req.body);
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  const keys = Object.keys(d);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const vals = keys.map((k) => d[k] ?? null);
  const extra = d.status === 'concluida' ? `, done_at = now(), done_by = $${keys.length + 3}` : d.status === 'aberta' ? ', done_at = null, done_by = null' : '';
  if (d.status === 'concluida') vals.push(req.user.id);
  const t = await one(`update tasks set ${sets.join(', ') || 'title = title'}${extra} where id = $1 and company_id = $2 returning *`, [id, req.companyId, ...vals]);
  if (d.status && t.client_id) await logActivity(null, req, { clientId: t.client_id, summary: `Tarefa "${t.title}" ${d.status}` });
  res.json(t);
});

export default opportunities;
