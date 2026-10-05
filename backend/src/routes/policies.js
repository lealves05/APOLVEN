// Apólices e certificados (10), endossos e cancelamentos (11), renovações (12), plano de comissão (14) e
// vínculo de repasses (15) por contrato. Estado contratual, documental e financeiro são separados.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, BRANCH_KEYS, BRANCHES, today, addDays, daysBetween, splitEven, addMonths, safeHttpsUrl } from '../util.js';
import { nextNumber, own, portfolioFilter, assertClientVisible, logActivity, docNumber, institutionFor } from '../lib/common.js';
import { commissionSchedule, validateSplits, RECEIVABLE_AGG, receivableState } from '../lib/finance.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';

const r = Router();

const coverageSchema = z.object({ code: z.string().max(60), name: z.string().max(160), limit_cents: z.number().int().nonnegative().nullable().optional(),
  deductible_text: z.string().max(300).nullable().optional(), deductible_cents: z.number().int().nonnegative().nullable().optional() });
const installmentInput = z.object({ number: z.number().int().min(1).max(120), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount_cents: z.number().int().positive(),
  method: z.string().max(40).nullable().optional(), charge_url: z.string().max(500).nullable().optional() });
const policyBase = z.object({
  policy_number: z.string().trim().max(80).nullable().optional(),
  certificate_number: z.string().trim().max(80).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  total_premium_cents: z.number().int().nonnegative(),
  premium_net_cents: z.number().int().nonnegative().nullable().optional(),
  taxes_cents: z.number().int().nonnegative().nullable().optional(),
  payment_summary: z.string().max(300).nullable().optional(),
  coverages: z.array(coverageSchema).max(80).default([]),
  insured_client_id: z.string().uuid().nullable().optional(),
  payer_client_id: z.string().uuid().nullable().optional(),
  installments: z.array(installmentInput).max(120).default([]),
  document_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  commission: z.object({ rule_version_id: z.string().uuid().optional(), base_cents: z.number().int().nonnegative().optional() }).nullable().optional(),
});

/** Plano de comissão a partir da regra vigente (snapshot) — mudança futura de percentual não recalcula (A17). */
async function applyCommissionPlan(db, req, policy, { rule_version_id, base_cents }) {
  if (!can(req, 'commissions_rules')) throw new HttpError(403, 'Aplicar regra de comissão exige a permissão de regras de comissão.');
  const { rows: [rule] } = await db.query(`select v.*, a.institution_id, a.name as agreement_name from commission_rule_versions v join commission_agreements a on a.id = v.agreement_id
     where v.id = $1 and v.company_id = $2`, [rule_version_id, req.companyId]);
  if (!rule) throw notFound('Regra de comissão não encontrada.');
  if (rule.institution_id !== policy.institution_id) throw new HttpError(400, 'A regra de comissão é de outra seguradora.');
  if (rule.valid_from > policy.start_date || (rule.valid_to && rule.valid_to < policy.start_date)) throw new HttpError(400, 'A regra não estava vigente no início da apólice.');
  const { rows: [alloc] } = await db.query(`select count(*)::int as n from commission_allocations a join commission_receivables r on r.id = a.receivable_id
     where r.company_id = $1 and r.policy_id = $2 and a.reversed_at is null`, [req.companyId, policy.id]);
  if (alloc.n) throw conflict('Já há comissão liquidada nesta apólice: ajustes retroativos exigem operação específica com aprovação.');
  const base = rule.kind === 'fixo' ? null : (base_cents ?? policy.premium_net_cents);
  if (rule.kind === 'percentual' && base == null) throw new HttpError(400, 'Informe a base comissionável documentada (o sistema não presume o prêmio líquido).');
  const snapshot = { rule_version_id: rule.id, agreement: rule.agreement_name, version: rule.version, kind: rule.kind, rate: rule.rate, fixed_cents: rule.fixed_cents,
    base_definition: rule.base_definition, base_notes: rule.base_notes, schedule: rule.schedule, installments: rule.installments, right_event: rule.right_event, base_cents: base };
  await db.query('delete from commission_receivables where company_id = $1 and policy_id = $2 and endorsement_id is null and confirmed_cents is null', [req.companyId, policy.id]);
  const plan = commissionSchedule({ rule, baseCents: base, startDate: policy.start_date });
  for (const x of plan) {
    await db.query(`insert into commission_receivables (company_id, policy_id, installment_no, installments_total, rule_snapshot, base_cents, rate, category, expected_cents, due_date)
       values ($1,$2,$3,$4,$5,$6,$7,'prevista',$8,$9)`, [req.companyId, policy.id, x.installment_no, x.installments_total, snapshot, base, rule.rate, x.expected_cents, x.due_date]);
  }
  await db.query('update policies set commission_rule_version_id = $3, commission_snapshot = $4 where id = $1 and company_id = $2', [policy.id, req.companyId, rule.id, snapshot]);
  return { snapshot, plan };
}

async function insertInstallments(db, req, policyId, list, { endorsementId = null, source = 'manual', payer = null } = {}) {
  for (const i of list) {
    await db.query(`insert into premium_installments (company_id, policy_id, endorsement_id, number, total_count, due_date, amount_cents, method, charge_url, payer_client_id, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [req.companyId, policyId, endorsementId, i.number, list.length, i.due_date, i.amount_cents, i.method || null, i.charge_url ? safeHttpsUrl(i.charge_url) : null, payer, source]);
  }
}

async function snapshotVersion(db, req, policyId, reason) {
  const { rows: [p] } = await db.query('select * from policies where id = $1 and company_id = $2', [policyId, req.companyId]);
  await db.query(`insert into policy_versions (company_id, policy_id, version, snapshot, reason, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6,$7)`,
    [req.companyId, policyId, p.version, p, reason, req.user.id, req.user.name]);
}

/** Compara o documento emitido com a versão autorizada (9.4 / A12). */
export function divergences(snapshot, doc) {
  const out = [];
  if (snapshot.total_premium_cents !== doc.total_premium_cents) out.push({ field: 'prêmio total', authorized: snapshot.total_premium_cents, issued: doc.total_premium_cents });
  for (const c of snapshot.coverages || []) {
    const d = (doc.coverages || []).find((x) => x.code === c.code);
    if (!d) { out.push({ field: `cobertura ${c.name || c.code}`, authorized: 'incluída', issued: 'ausente' }); continue; }
    if (c.limit_cents != null && d.limit_cents != null && c.limit_cents !== d.limit_cents) out.push({ field: `limite ${c.name || c.code}`, authorized: c.limit_cents, issued: d.limit_cents });
    if (c.deductible_cents != null && d.deductible_cents != null && c.deductible_cents !== d.deductible_cents) out.push({ field: `franquia ${c.name || c.code}`, authorized: c.deductible_cents, issued: d.deductible_cents });
  }
  if (doc.expected_start && doc.start_date !== doc.expected_start) out.push({ field: 'início de vigência', authorized: doc.expected_start, issued: doc.start_date });
  if (doc.expected_end && doc.end_date !== doc.expected_end) out.push({ field: 'fim de vigência', authorized: doc.expected_end, issued: doc.end_date });
  if (doc.expected_insured && doc.insured_client_id && doc.expected_insured !== doc.insured_client_id) out.push({ field: 'segurado', authorized: doc.expected_insured, issued: doc.insured_client_id });
  return out;
}

export async function createPolicyFromProposal(db, req, p, body) {
  const d = parse(policyBase.extend({ policy_number: z.string().trim().min(1).max(80) }), body);
  if (d.end_date <= d.start_date) throw new HttpError(400, 'Fim de vigência deve ser posterior ao início.');
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id', db);
  const { rows: [round] } = await db.query('select r.start_date, r.end_date from quote_offers o join quote_rounds r on r.id = o.round_id where o.id = $1', [p.offer_id]);
  const div = divergences(p.offer_snapshot, { ...d, expected_start: round?.start_date, expected_end: round?.end_date });
  const { rows: [pol] } = await db.query(`insert into policies (company_id, client_id, insured_client_id, payer_client_id, institution_id, product_id, product_name, branch, policy_number, certificate_number,
      proposal_id, start_date, end_date, start_time, contract_state, doc_state, total_premium_cents, premium_net_cents, taxes_cents, payment_summary, coverages, source, notes, owner_user_id, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'vigente',$15,$16,$17,$18,$19,$20,'proposta',$21,(select owner_user_id from clients where id = $2),$22) returning *`,
  [req.companyId, p.client_id, d.insured_client_id || p.client_id, d.payer_client_id || p.client_id, p.institution_id, p.offer_snapshot.product_id || null, p.offer_snapshot.product_name,
    p.branch, d.policy_number, d.certificate_number || null, p.id, d.start_date, d.end_date, d.start_time || '24:00', div.length ? 'divergente' : 'recebido',
    d.total_premium_cents, d.premium_net_cents ?? null, d.taxes_cents ?? null, d.payment_summary || (p.payment_option ? `${p.payment_option.method} ${p.payment_option.installments}x` : null),
    JSON.stringify(d.coverages.length ? d.coverages : p.offer_snapshot.coverages || []), d.notes || null, req.user.id]);
  await insertInstallments(db, req, pol.id, d.installments, { payer: d.payer_client_id || p.client_id, source: 'manual' });
  if (d.document_id) await db.query(`update documents set entity = 'policy', entity_id = $3, kind = 'apolice' where id = $1 and company_id = $2`, [d.document_id, req.companyId, pol.id]);
  await db.query(`update proposals set policy_id = $3, divergences = $4 where id = $1 and company_id = $2`, [p.id, req.companyId, pol.id, JSON.stringify(div)]);
  await db.query(`update proposals set status = 'documento_recebido', updated_at = now() where id = $1`, [p.id]);
  await db.query(`insert into proposal_status_events (company_id, proposal_id, from_status, to_status, source, notes, user_id, user_name) values ($1,$2,$3,'documento_recebido','manual',$4,$5,$6)`,
    [req.companyId, p.id, p.status, div.length ? `Documento recebido com ${div.length} divergência(s) — revisão necessária` : 'Documento recebido; aguardando conferência', req.user.id, req.user.name]);
  if (d.commission?.rule_version_id) await applyCommissionPlan(db, req, pol, d.commission);
  if (div.length) {
    await db.query(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, auto_key, created_by)
       values ($1,$2,'documento','alta',now() + interval '1 day',$3,$4,'policy',$5,$6,$3)`,
    [req.companyId, `Divergência entre apólice ${d.policy_number} e versão autorizada`, req.user.id, p.client_id, pol.id, `divergencia:${pol.id}`]);
  }
  await db.query(`update policies set version = 1 where id = $1`, [pol.id]);
  await snapshotVersion(db, req, pol.id, 'Documento contratual recebido');
  await emit(db, req.companyId, 'PolicyDocumentReceived', 'policy', pol.id, { divergences: div.length });
  await audit(db, req, { entity: 'policy', entityId: pol.id, action: 'policy.from_proposal', summary: `Apólice ${d.policy_number} registrada a partir da proposta ${p.number}${div.length ? ` — ${div.length} divergência(s)` : ''}` });
  return { policy: pol, divergences: div };
}

// ---------------- Lista e detalhe ----------------
r.get('/', need('policies_view'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'policies_view', 'c', params);
  const where = ['p.company_id = $1', f.sql];
  const add = (cond, v) => { params.push(v); where.push(cond.replace('?', `$${params.length}`)); };
  if (req.query.state) add('p.contract_state = ?', req.query.state);
  if (req.query.doc_state) add('p.doc_state = ?', req.query.doc_state);
  if (req.query.branch) add('p.branch = ?', req.query.branch);
  if (req.query.institution_id) add('p.institution_id = ?', idParam(req.query.institution_id));
  if (req.query.client_id) add('? in (p.client_id, p.insured_client_id, p.payer_client_id)', idParam(req.query.client_id));
  if (req.query.ending_within) add(`p.end_date between current_date and current_date + make_interval(days => ?::int) and p.contract_state = 'vigente'`, Number(req.query.ending_within) || 90);
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim().toUpperCase()}%`);
    where.push(`(upper(coalesce(p.policy_number,'')) like $${params.length} or exists (select 1 from policy_items it where it.policy_id = p.id and upper(coalesce(it.identifier,'')) like $${params.length}) or upper(c.name) like $${params.length})`);
  }
  const { rows } = await q(`select p.id, p.policy_number, p.certificate_number, p.branch, p.product_name, p.start_date, p.end_date, p.contract_state, p.doc_state, p.total_premium_cents,
       p.client_id, c.name as client_name, c.phone as client_phone, i.name as institution_name, p.institution_id, i.assistance_phone, p.previous_policy_id,
       exists (select 1 from policies n where n.previous_policy_id = p.id) as renewed
     from policies p join clients c on c.id = p.client_id join institutions i on i.id = p.institution_id where ${where.join(' and ')} order by p.end_date desc limit 500`, params);
  res.json(rows);
});

r.post('/', need('policies_manage'), async (req, res) => {
  const d = parse(policyBase.extend({
    client_id: z.string().uuid(), institution_id: z.string().uuid(), branch: z.enum(BRANCH_KEYS), product_name: z.string().trim().min(2).max(200),
    product_id: z.string().uuid().nullable().optional(), previous_policy_id: z.string().uuid().nullable().optional(),
    source_evidence: z.string().trim().min(3, 'informe a origem (documento da seguradora, importação…)').max(500),
    items: z.array(z.object({ kind: z.string().max(30), description: z.string().max(300), identifier: z.string().max(80).nullable().optional() })).max(500).default([]),
  }), req.body);
  if (d.end_date <= d.start_date) throw new HttpError(400, 'Fim de vigência deve ser posterior ao início.');
  await own('clients', d.client_id, req.companyId, 'id');
  await assertClientVisible(req, 'policies_view', d.client_id);
  for (const k of ['insured_client_id', 'payer_client_id']) if (d[k]) await own('clients', d[k], req.companyId, 'id');
  await institutionFor(null, req.companyId, d.institution_id);
  if (d.product_id) await own('products', d.product_id, req.companyId, 'id');
  if (d.previous_policy_id) await own('policies', d.previous_policy_id, req.companyId, 'id');
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id');
  const out = await tx(async (db) => {
    const { rows: [pol] } = await db.query(`insert into policies (company_id, client_id, insured_client_id, payer_client_id, institution_id, product_id, product_name, branch, policy_number, certificate_number,
        previous_policy_id, start_date, end_date, start_time, doc_state, total_premium_cents, premium_net_cents, taxes_cents, payment_summary, coverages, source, notes, owner_user_id, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'manual',$21,(select owner_user_id from clients where id = $2),$22) returning *`,
    [req.companyId, d.client_id, d.insured_client_id || d.client_id, d.payer_client_id || d.client_id, d.institution_id, d.product_id || null, d.product_name, d.branch,
      d.policy_number || null, d.certificate_number || null, d.previous_policy_id || null, d.start_date, d.end_date, d.start_time || '24:00',
      d.document_id ? 'recebido' : 'aguardando_documento', d.total_premium_cents, d.premium_net_cents ?? null, d.taxes_cents ?? null, d.payment_summary || null,
      JSON.stringify(d.coverages), `${d.notes ? `${d.notes}\n` : ''}Origem: ${d.source_evidence}`, req.user.id]);
    for (const it of d.items) {
      await db.query('insert into policy_items (company_id, policy_id, kind, description, identifier) values ($1,$2,$3,$4,$5)', [req.companyId, pol.id, it.kind, it.description, it.identifier || null]);
    }
    await insertInstallments(db, req, pol.id, d.installments, { payer: d.payer_client_id || d.client_id });
    if (d.document_id) await db.query(`update documents set entity = 'policy', entity_id = $3, kind = 'apolice' where id = $1 and company_id = $2`, [d.document_id, req.companyId, pol.id]);
    if (d.commission?.rule_version_id) await applyCommissionPlan(db, req, pol, d.commission);
    if (d.previous_policy_id) await db.query(`update policies set contract_state = 'renovada', status_reason = 'Renovada pela apólice ' || coalesce($3, 'nova') where id = $1 and company_id = $2 and contract_state in ('vigente','vencida')`, [d.previous_policy_id, req.companyId, d.policy_number]);
    await snapshotVersion(db, req, pol.id, `Cadastro manual — ${d.source_evidence}`);
    await logActivity(db, req, { clientId: d.client_id, entity: 'policy', entityId: pol.id, summary: `Apólice ${d.policy_number || '(sem número)'} cadastrada: ${BRANCHES[d.branch]}` });
    await audit(db, req, { entity: 'policy', entityId: pol.id, action: 'policy.create', summary: `Apólice ${d.policy_number || ''} cadastrada manualmente` });
    return pol;
  });
  res.status(201).json(out);
});

async function loadPolicy(req, id) {
  const p = await one(`select p.*, c.name as client_name, c.phone as client_phone, ins.name as insured_name, pay.name as payer_name, i.name as institution_name, i.assistance_phone, u.name as unit_name
     from policies p join clients c on c.id = p.client_id left join clients ins on ins.id = p.insured_client_id left join clients pay on pay.id = p.payer_client_id
     join institutions i on i.id = p.institution_id left join units u on u.id = p.unit_id where p.id = $1 and p.company_id = $2`, [idParam(id), req.companyId]);
  if (!p) throw notFound();
  await assertClientVisible(req, 'policies_view', p.client_id);
  return p;
}

r.get('/:id', need('policies_view'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const ref = today(req.settings.timezone);
  const [items, versions, inst, recv, splits, ends, cancels, claims, docs, chain, proposal] = await Promise.all([
    q('select * from policy_items where company_id = $1 and policy_id = $2 order by created_at', [req.companyId, p.id]),
    q('select id, version, reason, created_by_name, created_at from policy_versions where company_id = $1 and policy_id = $2 order by version desc', [req.companyId, p.id]),
    q(`select i.*, ${INSTALLMENT_AGG} from premium_installments i where i.company_id = $1 and i.policy_id = $2 order by i.endorsement_id nulls first, i.number`, [req.companyId, p.id]),
    can(req, 'commissions_view') ? q(`select r.*, ${RECEIVABLE_AGG} from commission_receivables r where r.company_id = $1 and r.policy_id = $2 order by r.endorsement_id nulls first, r.installment_no`, [req.companyId, p.id]) : { rows: null },
    can(req, 'splits_view') ? q(`select ps.*, pa.name as partner_name,
        coalesce((select sum(amount_cents) from split_accruals a where a.policy_split_id = ps.id and a.status <> 'compensada'), 0)::bigint as accrued_cents
      from policy_splits ps join partners pa on pa.id = ps.partner_id where ps.company_id = $1 and ps.policy_id = $2`, [req.companyId, p.id]) : { rows: null },
    q('select * from endorsements where company_id = $1 and policy_id = $2 order by created_at desc', [req.companyId, p.id]),
    q('select * from cancellations where company_id = $1 and policy_id = $2 order by created_at desc', [req.companyId, p.id]),
    q('select id, number, work_status, occurred_at from claims where company_id = $1 and policy_id = $2 order by occurred_at desc', [req.companyId, p.id]),
    q(`select id, kind, filename, mime, size, access_level, created_at, version from documents where company_id = $1 and entity = 'policy' and entity_id = $2 ${can(req, 'documents_restricted') ? '' : "and access_level = 'normal'"} order by created_at desc`, [req.companyId, p.id]),
    q(`with recursive prev as (select id, previous_policy_id, policy_number, start_date, end_date from policies where id = $2 and company_id = $1
         union all select x.id, x.previous_policy_id, x.policy_number, x.start_date, x.end_date from policies x join prev on x.id = prev.previous_policy_id)
       select * from prev where id <> $2`, [req.companyId, p.id]),
    p.proposal_id ? one('select id, number, status, divergences, offer_snapshot->>\'total_premium_cents\' as authorized_total from proposals where id = $1', [p.proposal_id]) : null,
  ]);
  const renewal = await one('select id, policy_number, start_date from policies where company_id = $1 and previous_policy_id = $2 limit 1', [req.companyId, p.id]);
  res.json({ ...p, branch_label: BRANCHES[p.branch], items: items.rows, versions: versions.rows,
    installments: inst.rows.map((i) => installmentState(i, ref, req.settings.installments.upcomingDays)),
    commissions: recv.rows ? recv.rows.map((x) => receivableState(x, ref)) : null, commission_snapshot: can(req, 'commissions_view') ? p.commission_snapshot : null,
    splits: splits.rows, endorsements: ends.rows, cancellations: cancels.rows, claims: claims.rows, documents: docs.rows, previous: chain.rows, renewal, proposal });
});

/** Alteração: nunca sobrescreve silenciosamente uma apólice conferida (10.2) — exige endosso. */
r.put('/:id', need('policies_manage'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const d = parse(policyBase.partial().omit({ installments: true, commission: true }).extend({
    reason: z.string().trim().min(3, 'informe o motivo da alteração').max(500), version: z.number().int(),
    product_name: z.string().max(200).optional(), unit_id: z.string().uuid().nullable().optional(), owner_user_id: z.string().uuid().nullable().optional(),
  }), req.body);
  const contractual = ['start_date', 'end_date', 'total_premium_cents', 'premium_net_cents', 'taxes_cents', 'coverages', 'insured_client_id', 'payer_client_id', 'policy_number'];
  if (p.doc_state === 'conferido' && contractual.some((k) => k in d)) throw conflict('Apólice conferida: alterações contratuais são feitas por endosso.', { code: 'USE_ENDORSEMENT' });
  for (const k of ['insured_client_id', 'payer_client_id']) if (d[k]) await own('clients', d[k], req.companyId, 'id');
  if (d.unit_id) await own('units', d.unit_id, req.companyId, 'id');
  if (d.owner_user_id) await own('users', d.owner_user_id, req.companyId, 'id');
  const { reason, version, ...fields } = d;
  const keys = Object.keys(fields);
  const out = await tx(async (db) => {
    const vals = keys.map((k) => (k === 'coverages' ? JSON.stringify(fields[k]) : fields[k] ?? null));
    const { rows: [x] } = await db.query(`update policies set ${[...keys.map((k, i) => `${k} = $${i + 4}`), 'version = version + 1', 'updated_at = now()'].join(', ')}
       where id = $1 and company_id = $2 and version = $3 returning *`, [p.id, req.companyId, version, ...vals]);
    if (!x) throw conflict('Apólice alterada por outra pessoa. Recarregue.', { code: 'VERSION_CONFLICT' });
    if (x.end_date <= x.start_date) throw new HttpError(400, 'Fim de vigência deve ser posterior ao início.');
    await snapshotVersion(db, req, p.id, reason);
    await audit(db, req, { entity: 'policy', entityId: p.id, action: 'policy.update', summary: `Apólice ${p.policy_number || ''} alterada`, reason, data: { fields: keys } });
    return x;
  });
  res.json(out);
});

/** Conferência do documento emitido: bloqueada enquanto houver divergência não resolvida (A12). */
r.post('/:id/verify', need('policies_verify'), async (req, res) => {
  const d = parse(z.object({ resolution: z.string().trim().max(2000).nullable().optional() }), req.body);
  const p = await loadPolicy(req, req.params.id);
  if (p.doc_state === 'conferido') throw conflict('Apólice já conferida.');
  if (p.doc_state === 'aguardando_documento') throw conflict('Anexe o documento contratual antes de conferir.');
  if (p.doc_state === 'divergente' && !d.resolution) throw conflict('Há divergência entre o documento emitido e a versão autorizada. Registre a resolução (endosso solicitado, aceite do cliente…) para conferir.', { code: 'DIVERGENCE_OPEN' });
  await tx(async (db) => {
    await db.query(`update policies set doc_state = 'conferido', verified_at = now(), verified_by = $3, version = version + 1, notes = case when $4::text is null then notes else coalesce(notes || E'\n', '') || 'Resolução de divergência: ' || $4 end
       where id = $1 and company_id = $2`, [p.id, req.companyId, req.user.id, d.resolution || null]);
    if (p.proposal_id) {
      await db.query(`update proposals set status = 'conferida', updated_at = now() where id = $1 and status = 'documento_recebido'`, [p.proposal_id]);
      await db.query(`insert into proposal_status_events (company_id, proposal_id, from_status, to_status, source, notes, user_id, user_name) values ($1,$2,'documento_recebido','conferida','manual',$3,$4,$5)`,
        [req.companyId, p.proposal_id, d.resolution || 'Documento conferido', req.user.id, req.user.name]);
    }
    await db.query(`update tasks set status = 'concluida', done_at = now(), done_by = $3 where company_id = $1 and auto_key = $2 and status = 'aberta'`, [req.companyId, `divergencia:${p.id}`, req.user.id]);
    await snapshotVersion(db, req, p.id, `Conferida${d.resolution ? ` — ${d.resolution}` : ''}`);
    await emit(db, req.companyId, 'PolicyVerified', 'policy', p.id, null);
    await audit(db, req, { entity: 'policy', entityId: p.id, action: 'policy.verify', summary: `Apólice ${p.policy_number} conferida`, reason: d.resolution || null });
  });
  res.json({ ok: true });
});

/** Estado contratual manual: exige justificativa e evidência; origem manual fica identificada (10.2). */
r.post('/:id/status', need('policies_manage'), async (req, res) => {
  const d = parse(z.object({ contract_state: z.enum(['vigente', 'vencida', 'suspensa']), reason: z.string().trim().min(5).max(500), evidence: z.string().trim().min(3).max(500) }), req.body);
  const p = await loadPolicy(req, req.params.id);
  await tx(async (db) => {
    await db.query(`update policies set contract_state = $3, status_source = 'manual', status_reason = $4, version = version + 1, updated_at = now() where id = $1 and company_id = $2`,
      [p.id, req.companyId, d.contract_state, `${d.reason} (evidência: ${d.evidence})`]);
    await snapshotVersion(db, req, p.id, `Estado contratual ${p.contract_state} → ${d.contract_state}: ${d.reason}`);
    await audit(db, req, { entity: 'policy', entityId: p.id, action: 'policy.status', summary: `Estado contratual: ${d.contract_state} (manual)`, reason: d.reason });
  });
  res.json({ ok: true });
});

r.post('/:id/items', need('policies_manage'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const d = parse(z.object({ kind: z.enum(['veiculo', 'imovel', 'vida', 'bem', 'local']), description: z.string().trim().min(2).max(300), identifier: z.string().max(80).nullable().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), data: z.record(z.any()).optional() }), req.body);
  if (p.doc_state === 'conferido') throw conflict('Apólice conferida: inclusão de item é feita por endosso.', { code: 'USE_ENDORSEMENT' });
  const item = await tx(async (db) => {
    const { rows: [x] } = await db.query(`insert into policy_items (company_id, policy_id, kind, description, identifier, start_date, end_date, data) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [req.companyId, p.id, d.kind, d.description, d.identifier || null, d.start_date || null, d.end_date || null, d.data || {}]);
    await audit(db, req, { entity: 'policy', entityId: p.id, action: 'policy.item_add', summary: `Item incluído: ${d.description}` });
    return x;
  });
  res.status(201).json(item);
});

r.post('/:id/installments', need('policies_manage'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const d = parse(z.object({ installments: z.array(installmentInput).min(1).max(120), endorsement_id: z.string().uuid().nullable().optional(),
    source: z.enum(['manual', 'arquivo', 'api']).default('manual') }), req.body);
  if (d.endorsement_id) await own('endorsements', d.endorsement_id, req.companyId, 'id');
  await tx(async (db) => insertInstallments(db, req, p.id, d.installments, { endorsementId: d.endorsement_id || null, source: d.source, payer: p.payer_client_id }));
  res.status(201).json({ ok: true });
});

/** Gera parcelas iguais a partir do plano informado pela seguradora (resíduo nas primeiras — 16.4). */
r.post('/:id/installments/plan', need('policies_manage'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const d = parse(z.object({ count: z.number().int().min(1).max(24), first_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), total_cents: z.number().int().positive(), method: z.string().max(40).optional() }), req.body);
  const parts = splitEven(d.total_cents, d.count);
  const list = parts.map((amount, i) => ({ number: i + 1, due_date: addMonths(d.first_due, i), amount_cents: amount, method: d.method }));
  await tx(async (db) => {
    const { rows: [has] } = await db.query('select count(*)::int as n from premium_installments where company_id = $1 and policy_id = $2 and endorsement_id is null', [req.companyId, p.id]);
    if (has.n) throw conflict('A apólice já tem parcelas cadastradas.');
    await insertInstallments(db, req, p.id, list, { payer: p.payer_client_id });
  });
  res.status(201).json(list);
});

r.post('/:id/commission', need('commissions_rules'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const d = parse(z.object({ rule_version_id: z.string().uuid(), base_cents: z.number().int().nonnegative().optional() }), req.body);
  const out = await tx(async (db) => {
    const x = await applyCommissionPlan(db, req, p, d);
    await audit(db, req, { entity: 'policy', entityId: p.id, action: 'policy.commission_plan', summary: `Plano de comissão aplicado (snapshot da regra v${x.snapshot.version})` });
    return x;
  });
  res.json(out);
});

/** Vínculo de repasse: valida o orçamento de distribuição pelo efeito em dinheiro (15.2 / A19). */
r.post('/:id/splits', need('splits_manage'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const d = parse(z.object({ rule_version_id: z.string().uuid(), extraordinary_reason: z.string().max(500).nullable().optional() }), req.body);
  const rule = await own('split_rule_versions', d.rule_version_id, req.companyId);
  if (!rule.active) throw conflict('Regra de repasse inativa.');
  if (rule.institution_id && rule.institution_id !== p.institution_id) throw new HttpError(400, 'A regra é de outra seguradora.');
  if (rule.branch && rule.branch !== p.branch) throw new HttpError(400, 'A regra é de outro ramo.');
  const out = await tx(async (db) => {
    const { rows: current } = await db.query('select ps.id, ps.partner_id, ps.snapshot from policy_splits ps where ps.company_id = $1 and ps.policy_id = $2', [req.companyId, p.id]);
    const { rows: [ref] } = await db.query('select coalesce(sum(coalesce(confirmed_cents, expected_cents)),0)::bigint as v from commission_receivables where company_id = $1 and policy_id = $2', [req.companyId, p.id]);
    const snap = { name: rule.name, version: rule.version, kind: rule.kind, rate: rule.rate, fixed_cents: rule.fixed_cents, base: rule.base, stage: rule.stage, sequential: rule.sequential, release: rule.release, reversal: rule.reversal };
    const all = [...current.map((c) => ({ id: c.id, partner_id: c.partner_id, ...c.snapshot })), { id: 'novo', partner_id: rule.partner_id, ...snap }];
    const reference = Number(ref.v) || 10000;
    const check = validateSplits(all, reference);
    if (!check.ok && !d.extraordinary_reason) throw conflict(`Rateio inválido: ${check.problems.join(' ')}`, { code: 'SPLIT_BUDGET', simulation: check.simulation });
    if (!check.ok && !can(req, 'splits_approve')) throw new HttpError(403, 'Operação extraordinária acima do orçamento exige aprovação de quem aprova repasses.');
    const { rows: [x] } = await db.query(`insert into policy_splits (company_id, policy_id, partner_id, rule_version_id, snapshot, extraordinary, extraordinary_reason, approved_by, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [req.companyId, p.id, rule.partner_id, rule.id, snap, !check.ok, d.extraordinary_reason || null, !check.ok ? req.user.id : null, req.user.id]);
    // repasse antecipado: só com regra que prevê e aprovação (15.1)
    if (rule.release === 'antecipado') {
      if (!can(req, 'splits_approve')) throw new HttpError(403, 'Repasse antes do recebimento exige aprovação de quem aprova repasses.');
      const sim = check.simulation.find((s) => s.policy_split_id === 'novo');
      if (sim?.amount_cents > 0 && Number(ref.v) > 0) {
        await db.query(`insert into split_accruals (company_id, policy_split_id, partner_id, policy_id, base_cents, amount_cents, kind, note) values ($1,$2,$3,$4,$5,$6,'antecipacao',$7)`,
          [req.companyId, x.id, rule.partner_id, p.id, Number(ref.v), sim.amount_cents, 'Repasse antecipado aprovado (antes do recebimento da comissão)']);
      }
    }
    await audit(db, req, { entity: 'policy', entityId: p.id, action: 'policy.split', summary: `Repasse vinculado: ${rule.name}${!check.ok ? ' (extraordinário aprovado)' : ''}`, reason: d.extraordinary_reason || null });
    return { split: x, validation: check };
  });
  res.status(201).json(out);
});

r.delete('/:id/splits/:sid', need('splits_manage'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  const s = await own('policy_splits', req.params.sid, req.companyId);
  if (s.policy_id !== p.id) throw notFound();
  const used = await one('select 1 from split_accruals where company_id = $1 and policy_split_id = $2 limit 1', [req.companyId, s.id]);
  if (used) throw conflict('Este repasse já teve liberações; encerre com ajuste em vez de excluir.');
  await q('delete from policy_splits where id = $1 and company_id = $2', [s.id, req.companyId]);
  await audit(null, req, { entity: 'policy', entityId: p.id, action: 'policy.split_remove', summary: 'Vínculo de repasse removido (sem liberações)' });
  res.json({ ok: true });
});

// ---------------- Endossos ----------------
r.post('/:id/endorsements', need('endorsements'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  if (!['vigente', 'cancelamento_solicitado'].includes(p.contract_state)) throw conflict('Endosso só para apólice vigente.');
  const d = parse(z.object({ kind: z.enum(['inclusao', 'exclusao', 'alteracao_dados', 'alteracao_cobertura', 'alteracao_local', 'alteracao_capital', 'outro']),
    reason: z.string().trim().min(3).max(500), requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), changes: z.string().trim().min(3).max(4000) }), req.body);
  const e = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'endorsement');
    const { rows: [x] } = await db.query(`insert into endorsements (company_id, policy_id, number, kind, reason, requested_date, changes, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [req.companyId, p.id, n, d.kind, d.reason, d.requested_date, d.changes, req.user.id]);
    await logActivity(db, req, { clientId: p.client_id, entity: 'endorsement', entityId: x.id, summary: `Endosso ${n} solicitado: ${d.kind}` });
    return x;
  });
  res.status(201).json(e);
});

/** Andamento do endosso; impacto em prêmio/parcelas/comissão só depois de emitido (11.1). */
r.put('/endorsements/:eid', need('endorsements'), async (req, res) => {
  const e = await own('endorsements', req.params.eid, req.companyId);
  const p = await loadPolicy(req, e.policy_id);
  const d = parse(z.object({ status: z.enum(['em_analise', 'aceito', 'recusado', 'emitido', 'cancelado']), protocol: z.string().max(120).nullable().optional(),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), premium_diff_cents: z.number().int().nullable().optional(),
    commission_diff_cents: z.number().int().nullable().optional(), document_id: z.string().uuid().nullable().optional(),
    installments: z.array(installmentInput).max(24).optional(), coverages: z.array(coverageSchema).max(80).optional() }), req.body);
  if (['emitido', 'cancelado', 'recusado'].includes(e.status)) throw conflict('Endosso encerrado.');
  if (d.status === 'emitido' && (!d.effective_date || !(d.document_id || d.protocol))) throw new HttpError(400, 'Endosso emitido exige data de efeito e documento ou protocolo.');
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id');
  const out = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update endorsements set status = $3, protocol = coalesce($4, protocol), effective_date = coalesce($5, effective_date),
        premium_diff_cents = coalesce($6, premium_diff_cents), commission_diff_cents = coalesce($7, commission_diff_cents), document_id = coalesce($8, document_id), updated_at = now()
      where id = $1 and company_id = $2 returning *`, [e.id, req.companyId, d.status, d.protocol || null, d.effective_date || null, d.premium_diff_cents ?? null, d.commission_diff_cents ?? null, d.document_id || null]);
    if (d.status === 'emitido') {
      // a versão original é preservada; o contrato recebe nova versão com o endosso
      const sets = ['version = version + 1', 'updated_at = now()'];
      const vals = [p.id, req.companyId];
      if (d.premium_diff_cents) { vals.push(d.premium_diff_cents); sets.push(`total_premium_cents = total_premium_cents + $${vals.length}`); }
      if (d.coverages) { vals.push(JSON.stringify(d.coverages)); sets.push(`coverages = $${vals.length}`); }
      await db.query(`update policies set ${sets.join(', ')} where id = $1 and company_id = $2`, vals);
      if (d.installments?.length) await insertInstallments(db, req, p.id, d.installments, { endorsementId: e.id, payer: p.payer_client_id });
      if (d.commission_diff_cents > 0) {
        await db.query(`insert into commission_receivables (company_id, policy_id, endorsement_id, installment_no, category, expected_cents, due_date, notes)
           values ($1,$2,$3,1,'prevista',$4,$5,'Comissão do endosso (informada)')`, [req.companyId, p.id, e.id, d.commission_diff_cents, addDays(d.effective_date, 30)]);
      }
      await snapshotVersion(db, req, p.id, `Endosso ${e.number} emitido (${e.kind})`);
      await emit(db, req.companyId, 'EndorsementConfirmed', 'endorsement', e.id, { premium_diff: d.premium_diff_cents ?? null });
    }
    await audit(db, req, { entity: 'endorsement', entityId: e.id, action: 'endorsement.update', summary: `Endosso ${e.number}: ${d.status}` });
    return x;
  });
  res.json(out);
});

// ---------------- Cancelamentos ----------------
r.post('/:id/cancellations', need('endorsements'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  if (p.contract_state !== 'vigente') throw conflict('Só apólice vigente pode ter cancelamento solicitado.');
  const d = parse(z.object({ requested_by_name: z.string().trim().min(2).max(160), powers: z.string().max(300).nullable().optional(), reason: z.string().trim().min(3).max(1000),
    requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), refund_estimate_cents: z.number().int().nonnegative().nullable().optional() }), req.body);
  const out = await tx(async (db) => {
    const { rows: [x] } = await db.query(`insert into cancellations (company_id, policy_id, requested_by_name, powers, reason, requested_date, refund_estimate_cents, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [req.companyId, p.id, d.requested_by_name, d.powers || null, d.reason, d.requested_date, d.refund_estimate_cents ?? null, req.user.id]);
    await db.query(`update policies set contract_state = 'cancelamento_solicitado', version = version + 1 where id = $1`, [p.id]);
    await snapshotVersion(db, req, p.id, `Cancelamento solicitado por ${d.requested_by_name}`);
    await logActivity(db, req, { clientId: p.client_id, entity: 'cancellation', entityId: x.id, summary: 'Cancelamento solicitado (ainda não efetivado)' });
    return x;
  });
  res.status(201).json(out);
});

/**
 * Efetivação/desistência do cancelamento. Restituição de prêmio, estorno de comissão e ajuste de repasse são
 * operações distintas (11.2): aqui só fica a informação da seguradora; o estorno da comissão é lançado em Comissões.
 */
r.put('/cancellations/:cid', need('endorsements'), async (req, res) => {
  const c = await own('cancellations', req.params.cid, req.companyId);
  const p = await loadPolicy(req, c.policy_id);
  const d = parse(z.object({ status: z.enum(['efetivado', 'desistencia', 'recusado']), effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    evidence: z.string().trim().min(3).max(1000), protocol: z.string().max(120).nullable().optional(), refund_cents: z.number().int().nonnegative().nullable().optional(),
    refund_recipient: z.string().max(200).nullable().optional(), refund_payer: z.string().max(200).nullable().optional() }), req.body);
  if (c.status !== 'solicitado') throw conflict('Cancelamento já concluído.');
  if (d.status === 'efetivado' && !d.effective_date) throw new HttpError(400, 'Informe a data de efeito do cancelamento.');
  await tx(async (db) => {
    await db.query(`update cancellations set status = $3, effective_date = $4, evidence = $5, protocol = $6, refund_cents = $7, refund_recipient = $8, refund_payer = $9, updated_at = now()
       where id = $1 and company_id = $2`, [c.id, req.companyId, d.status, d.effective_date || null, d.evidence, d.protocol || null, d.refund_cents ?? null, d.refund_recipient || null, d.refund_payer || null]);
    const state = d.status === 'efetivado' ? 'cancelada' : 'vigente';
    await db.query(`update policies set contract_state = $3, status_source = 'manual', status_reason = $4, version = version + 1 where id = $1 and company_id = $2`,
      [p.id, req.companyId, state, `Cancelamento ${d.status}: ${d.evidence}`]);
    if (d.status === 'efetivado') {
      // parcelas futuras em aberto ficam canceladas (histórico de pagamentos preservado)
      await db.query(`update premium_installments i set status_override = 'cancelada', status_reason = 'Apólice cancelada em ' || $3
         where company_id = $1 and policy_id = $2 and due_date > $3::date and status_override is null
           and not exists (select 1 from premium_payments x where x.installment_id = i.id and x.voided_at is null)`, [req.companyId, p.id, d.effective_date]);
      await emit(db, req.companyId, 'CancellationConfirmed', 'policy', p.id, { refund_cents: d.refund_cents ?? null });
    }
    await snapshotVersion(db, req, p.id, `Cancelamento ${d.status}`);
    await audit(db, req, { entity: 'cancellation', entityId: c.id, action: 'cancellation.update', summary: `Cancelamento ${d.status}`, reason: d.evidence });
  });
  res.json({ ok: true, note: d.status === 'efetivado' ? 'Se a seguradora confirmar estorno de comissão, lance-o em Comissões (operação separada da restituição de prêmio).' : null });
});

// ---------------- Renovações (12) ----------------
export const renewals = Router();

renewals.get('/', need('renewals'), async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 90);
  const params = [req.companyId, days];
  const f = portfolioFilter(req, 'policies_view', 'c', params);
  const { rows } = await q(`select p.id, p.policy_number, p.branch, p.end_date, p.total_premium_cents, p.contract_state, c.id as client_id, c.name as client_name, c.phone as client_phone, i.name as institution_name,
       (p.end_date - current_date) as days_left,
       (select json_build_object('id', o.id, 'stage', o.stage, 'owner', u.name, 'next_action_at', o.next_action_at) from opportunities o left join users u on u.id = o.owner_user_id where o.company_id = p.company_id and o.renewal_of_policy_id = p.id order by o.created_at desc limit 1) as opportunity,
       (select json_build_object('id', n.id, 'policy_number', n.policy_number) from policies n where n.previous_policy_id = p.id limit 1) as renewed_by,
       (select max(a.created_at) from activities a where a.company_id = p.company_id and a.client_id = p.client_id) as last_contact
     from policies p join clients c on c.id = p.client_id join institutions i on i.id = p.institution_id
     where p.company_id = $1 and ${f.sql} and p.contract_state in ('vigente','vencida') and p.end_date between current_date - 30 and current_date + make_interval(days => $2::int)
     order by p.end_date`, params);
  res.json(rows);
});

renewals.post('/:id/opportunity', need('renewals'), async (req, res) => {
  const p = await loadPolicy(req, req.params.id);
  if (!['vigente', 'vencida'].includes(p.contract_state)) throw conflict('Só apólices vigentes ou recém-vencidas entram em renovação.');
  const existing = await one('select * from opportunities where company_id = $1 and renewal_of_policy_id = $2 and stage not in (\'perdido\')', [req.companyId, p.id]);
  if (existing) return res.json(existing);
  const o = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'opportunity');
    const { rows: [x] } = await db.query(`insert into opportunities (company_id, number, client_id, branch, title, need, stage, estimated_premium_cents, origin, owner_user_id, renewal_of_policy_id, next_action, next_action_at, created_by)
       values ($1,$2,$3,$4,$5,$6,'coleta_dados',$7,'renovacao',coalesce((select owner_user_id from clients where id = $3), $8),$9,'Atualizar risco e necessidades do cliente', now() + interval '2 days', $8) returning *`,
    [req.companyId, n, p.client_id, p.branch, `Renovação ${BRANCHES[p.branch]} — vence ${p.end_date}`, 'Revisar dados do risco e coberturas: declarações antigas não são retransmitidas sem revisão.',
      p.total_premium_cents, req.user.id, p.id]);
    await logActivity(db, req, { clientId: p.client_id, opportunityId: x.id, summary: `Renovação iniciada para a apólice ${p.policy_number || ''}` });
    return x;
  });
  res.status(201).json(o);
});

/** Alertas de renovação nos marcos configurados (90/60/45/30/15/7 dias) — idempotentes por apólice e marco. */
export async function generateRenewalTasks(req) {
  const marks = (req.settings.renewals.alertDays || []).map(Number).filter((n) => n > 0).sort((a, b) => b - a);
  if (!marks.length) return 0;
  const { rows } = await q(`select p.id, p.client_id, p.policy_number, p.end_date, p.branch, (p.end_date - current_date) as left, c.owner_user_id from policies p join clients c on c.id = p.client_id
     where p.company_id = $1 and p.contract_state = 'vigente' and p.end_date between current_date and current_date + make_interval(days => $2::int)
       and not exists (select 1 from policies n where n.previous_policy_id = p.id)`, [req.companyId, marks[0]]);
  let n = 0;
  for (const p of rows) {
    const mark = marks.filter((m) => p.left <= m).pop();
    if (mark == null) continue;
    const r2 = await q(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, auto_key)
       values ($1,$2,'renovacao',$3,current_date,$4,$5,'policy',$6,$7) on conflict do nothing`,
    [req.companyId, `Renovação: apólice ${p.policy_number || ''} (${BRANCHES[p.branch]}) vence em ${p.left} dia(s)`, mark <= 15 ? 'alta' : 'normal', p.owner_user_id, p.client_id, p.id, `renov:${p.id}:${mark}`]);
    n += r2.rowCount;
  }
  return n;
}
renewals.post('/generate', need('renewals'), async (req, res) => res.json({ created: await generateRenewalTasks(req) }));

export default r;
