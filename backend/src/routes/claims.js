// Sinistros (18.1/18.2) e solicitações de pós-venda (18.3). O sistema organiza e acompanha: não decide cobertura
// nem indenização; estado informado pela seguradora ≠ estado de trabalho da corretora.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam } from '../util.js';
import { nextNumber, own, portfolioFilter, assertClientVisible, logActivity } from '../lib/common.js';

export const claims = Router();
export const CLAIM_STATUS = { aberto: 'Aberto', documentacao: 'Documentação', aguardando_seguradora: 'Aguardando seguradora', em_regulacao: 'Em regulação', indenizado: 'Indenizado (informado)', negado: 'Negado (informado)', encerrado: 'Encerrado' };

claims.get('/', need('claims'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'policies_view', 'c', params);
  const where = ['s.company_id = $1', f.sql];
  if (req.query.open === '1') where.push(`s.work_status not in ('encerrado')`);
  const { rows } = await q(`select s.*, c.name as client_name, p.policy_number, i.name as institution_name, u.name as assignee_name,
       (s.deadline_at is not null and s.deadline_at < now() + interval '3 days' and s.work_status not in ('encerrado','indenizado','negado')) as deadline_near
     from claims s join clients c on c.id = s.client_id join policies p on p.id = s.policy_id join institutions i on i.id = p.institution_id left join users u on u.id = s.assignee_user_id
     where ${where.join(' and ')} order by s.occurred_at desc limit 500`, params);
  res.json(rows);
});

claims.post('/', need('claims'), async (req, res) => {
  const d = parse(z.object({ policy_id: z.string().uuid(), item_id: z.string().uuid().nullable().optional(), occurred_at: z.string(), location: z.string().max(300).nullable().optional(),
    description: z.string().trim().min(5).max(4000), contact_name: z.string().max(160).nullable().optional(), contact_phone: z.string().max(40).nullable().optional(),
    insurer_protocol: z.string().max(120).nullable().optional(), deadline_at: z.string().nullable().optional(), deadline_rule: z.string().max(300).nullable().optional(),
    assignee_user_id: z.string().uuid().nullable().optional() }), req.body);
  const p = await own('policies', d.policy_id, req.companyId);
  await assertClientVisible(req, 'policies_view', p.client_id);
  if (d.item_id) { const it = await own('policy_items', d.item_id, req.companyId); if (it.policy_id !== p.id) throw new HttpError(400, 'Item de outra apólice.'); }
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  if (d.deadline_at && !d.deadline_rule) throw new HttpError(400, 'Prazo exige a regra/fundamento aplicado (produto, norma, fato gerador).');
  const out = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'claim');
    const { rows: [x] } = await db.query(`insert into claims (company_id, number, policy_id, client_id, item_id, occurred_at, location, description, contact_name, contact_phone, insurer_protocol,
        deadline_at, deadline_rule, assignee_user_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
    [req.companyId, n, p.id, p.client_id, d.item_id || null, d.occurred_at, d.location || null, d.description, d.contact_name || null, d.contact_phone || null,
      d.insurer_protocol || null, d.deadline_at || null, d.deadline_rule || null, d.assignee_user_id || req.user.id, req.user.id]);
    await db.query(`insert into claim_events (company_id, claim_id, kind, summary, user_id, user_name) values ($1,$2,'nota','Sinistro registrado',$3,$4)`, [req.companyId, x.id, req.user.id, req.user.name]);
    await logActivity(db, req, { clientId: p.client_id, entity: 'claim', entityId: x.id, summary: `Sinistro ${n} registrado` });
    return x;
  });
  res.status(201).json(out);
});

claims.get('/:id', need('claims'), async (req, res) => {
  const s = await one(`select s.*, c.name as client_name, c.phone as client_phone, p.policy_number, p.branch, i.name as institution_name, i.assistance_phone, it.description as item_description
     from claims s join clients c on c.id = s.client_id join policies p on p.id = s.policy_id join institutions i on i.id = p.institution_id left join policy_items it on it.id = s.item_id
     where s.id = $1 and s.company_id = $2`, [idParam(req.params.id), req.companyId]);
  if (!s) throw notFound();
  await assertClientVisible(req, 'policies_view', s.client_id);
  const { rows } = await q(`select e.*, d.filename from claim_events e left join documents d on d.id = e.document_id where e.company_id = $1 and e.claim_id = $2 order by e.occurred_at, e.id`, [req.companyId, s.id]);
  res.json({ ...s, events: rows, statuses: CLAIM_STATUS });
});

claims.put('/:id', need('claims'), async (req, res) => {
  const s = await own('claims', req.params.id, req.companyId);
  await assertClientVisible(req, 'policies_view', s.client_id);
  const d = parse(z.object({ work_status: z.enum(Object.keys(CLAIM_STATUS)).optional(), insurer_protocol: z.string().max(120).nullable().optional(),
    insurer_status: z.string().max(300).nullable().optional(), coverage_decision: z.string().max(1000).nullable().optional(), decision_evidence: z.string().max(1000).nullable().optional(),
    amount_paid_cents: z.number().int().nonnegative().nullable().optional(), deadline_at: z.string().nullable().optional(), deadline_rule: z.string().max(300).nullable().optional(),
    assignee_user_id: z.string().uuid().nullable().optional() }), req.body);
  if (['indenizado', 'negado'].includes(d.work_status) && !(d.decision_evidence || s.decision_evidence)) throw new HttpError(400, 'Registre a decisão informada pela seguradora e a evidência.');
  if (d.coverage_decision && !d.decision_evidence) throw new HttpError(400, 'Decisão sobre cobertura exige evidência da seguradora.');
  if (d.deadline_at && !(d.deadline_rule || s.deadline_rule)) throw new HttpError(400, 'Prazo exige a regra/fundamento aplicado.');
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  const keys = Object.keys(d);
  const out = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update claims set ${[...keys.map((k, i) => `${k} = $${i + 3}`), 'updated_at = now()'].join(', ')},
       insurer_status_at = case when $${keys.length + 3}::boolean then now() else insurer_status_at end where id = $1 and company_id = $2 returning *`,
    [s.id, req.companyId, ...keys.map((k) => d[k] ?? null), 'insurer_status' in d]);
    const changes = keys.map((k) => `${k}: ${d[k] ?? '—'}`).join('; ');
    await db.query(`insert into claim_events (company_id, claim_id, kind, summary, user_id, user_name) values ($1,$2,'status',$3,$4,$5)`, [req.companyId, s.id, `Atualização — ${changes}`, req.user.id, req.user.name]);
    await audit(db, req, { entity: 'claim', entityId: s.id, action: 'claim.update', summary: `Sinistro ${s.number} atualizado`, data: d });
    return x;
  });
  res.json(out);
});

claims.post('/:id/events', need('claims'), async (req, res) => {
  const s = await own('claims', req.params.id, req.companyId);
  await assertClientVisible(req, 'policies_view', s.client_id);
  const d = parse(z.object({ kind: z.enum(['nota', 'documento_solicitado', 'documento_entregue', 'contato', 'recurso']), summary: z.string().trim().min(2).max(2000),
    occurred_at: z.string().nullable().optional(), document_id: z.string().uuid().nullable().optional() }), req.body);
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id');
  const e = await one(`insert into claim_events (company_id, claim_id, kind, summary, occurred_at, document_id, user_id, user_name) values ($1,$2,$3,$4,coalesce($5::timestamptz, now()),$6,$7,$8) returning *`,
    [req.companyId, s.id, d.kind, d.summary, d.occurred_at || null, d.document_id || null, req.user.id, req.user.name]);
  res.status(201).json(e);
});

// ---------------- Solicitações e assistências ----------------
export const serviceRequests = Router();
serviceRequests.get('/', need('service_requests'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'clients_view', 'c', params);
  const where = ['s.company_id = $1', f.sql];
  if (req.query.open === '1') where.push(`s.status not in ('concluida','cancelada')`);
  const { rows } = await q(`select s.*, c.name as client_name, p.policy_number, u.name as assignee_name from service_requests s join clients c on c.id = s.client_id
     left join policies p on p.id = s.policy_id left join users u on u.id = s.assignee_user_id where ${where.join(' and ')} order by s.created_at desc limit 500`, params);
  res.json(rows);
});
serviceRequests.post('/', need('service_requests'), async (req, res) => {
  const d = parse(z.object({ client_id: z.string().uuid(), policy_id: z.string().uuid().nullable().optional(), kind: z.enum(['segunda_via', 'assistencia', 'atualizacao_cadastral', 'declaracao', 'duvida', 'reclamacao', 'endosso', 'outro']),
    description: z.string().trim().min(3).max(4000), priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).default('normal'), channel: z.string().max(40).nullable().optional(),
    assignee_user_id: z.string().uuid().nullable().optional(), due_at: z.string().nullable().optional() }), req.body);
  await own('clients', d.client_id, req.companyId, 'id');
  await assertClientVisible(req, 'clients_view', d.client_id);
  if (d.policy_id) { const p = await own('policies', d.policy_id, req.companyId); if (p.client_id !== d.client_id && p.insured_client_id !== d.client_id) throw new HttpError(400, 'Apólice de outro cliente.'); }
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  const out = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'request');
    const { rows: [x] } = await db.query(`insert into service_requests (company_id, number, client_id, policy_id, kind, description, priority, channel, assignee_user_id, due_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [req.companyId, n, d.client_id, d.policy_id || null, d.kind, d.description, d.priority, d.channel || null, d.assignee_user_id || req.user.id, d.due_at || null, req.user.id]);
    await logActivity(db, req, { clientId: d.client_id, kind: d.kind === 'reclamacao' ? 'reclamacao' : 'sistema', entity: 'service_request', entityId: x.id, summary: `Solicitação ${n}: ${d.kind}` });
    return x;
  });
  res.status(201).json(out);
});
serviceRequests.put('/:id', need('service_requests'), async (req, res) => {
  const s = await own('service_requests', req.params.id, req.companyId);
  await assertClientVisible(req, 'clients_view', s.client_id);
  const d = parse(z.object({ status: z.enum(['aberta', 'em_andamento', 'aguardando_cliente', 'aguardando_seguradora', 'concluida', 'cancelada']).optional(), resolution: z.string().max(4000).nullable().optional(),
    assignee_user_id: z.string().uuid().nullable().optional(), priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).optional() }), req.body);
  if (d.status === 'concluida' && !(d.resolution || s.resolution)) throw new HttpError(400, 'Registre a resolução.');
  if (d.assignee_user_id) await own('users', d.assignee_user_id, req.companyId, 'id');
  const out = await one(`update service_requests set status = coalesce($3, status), resolution = coalesce($4, resolution), assignee_user_id = coalesce($5, assignee_user_id), priority = coalesce($6, priority),
      done_at = case when $3 in ('concluida','cancelada') then now() else done_at end, updated_at = now() where id = $1 and company_id = $2 returning *`,
  [s.id, req.companyId, d.status ?? null, d.resolution ?? null, d.assignee_user_id ?? null, d.priority ?? null]);
  if (d.status) await logActivity(null, req, { clientId: s.client_id, entity: 'service_request', entityId: s.id, summary: `Solicitação ${s.number}: ${d.status}` });
  res.json(out);
});
