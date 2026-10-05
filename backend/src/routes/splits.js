// Repasses a produtores, assessorias e parceiros (15). Liberação pela regra; pagamento só com evidência bancária
// conciliada; lote aprovado travado (A28); estorno após pagamento vira valor recuperável separado (A18).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can, scopeOf, reauth } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, hashOf, onlyDigits, validDocument, brl, today } from '../util.js';
import { nextNumber, own, assertPeriodOpen } from '../lib/common.js';

export const partners = Router();

const maskBank = (b) => (b ? { ...b, account: b.account ? `••••${String(b.account).slice(-3)}` : null, pix_key: b.pix_key ? `••••${String(b.pix_key).slice(-4)}` : null, holder_document: b.holder_document ? `•••${String(b.holder_document).replace(/\D/g, '').slice(-4)}` : null } : null);

partners.get('/', need('splits_view'), async (req, res) => {
  const own2 = scopeOf(req, 'splits_view') === 'own';
  const { rows } = await q(`select p.*,
      coalesce((select sum(amount_cents) from split_accruals a where a.partner_id = p.id and a.status = 'liberada' and a.kind <> 'recuperacao'), 0)::bigint as payable_cents,
      coalesce((select sum(-amount_cents) from split_accruals a where a.partner_id = p.id and a.status = 'liberada' and a.kind = 'recuperacao'), 0)::bigint as recoverable_cents,
      coalesce((select sum(amount_cents) from split_accruals a where a.partner_id = p.id and a.status = 'em_lote'), 0)::bigint as in_batch_cents,
      coalesce((select sum(amount_cents) from split_accruals a where a.partner_id = p.id and a.status = 'paga'), 0)::bigint as paid_cents
    from partners p where p.company_id = $1 ${own2 ? 'and p.user_id = $2' : ''} order by p.active desc, p.name`, own2 ? [req.companyId, req.user.id] : [req.companyId]);
  res.json(rows.map((p) => ({ ...p, bank_info: can(req, 'splits_manage') ? maskBank(p.bank_info) : null })));
});

const bankSchema = z.object({ holder: z.string().trim().min(2).max(160), holder_document: z.string().trim().max(20), bank: z.string().max(80).optional(), agency: z.string().max(20).optional(),
  account: z.string().max(30).optional(), pix_key: z.string().max(120).optional() });

partners.post('/', need('splits_manage'), async (req, res) => {
  const d = parse(z.object({ kind: z.enum(['produtor', 'assessoria', 'parceiro', 'filial']), name: z.string().trim().min(2).max(160), document: z.string().nullable().optional(),
    email: z.string().email().max(160).nullable().optional().or(z.literal('').transform(() => null)), phone: z.string().max(40).nullable().optional(),
    user_id: z.string().uuid().nullable().optional(), bank_info: bankSchema.nullable().optional() }), req.body);
  if (d.document && !validDocument(d.document)) throw new HttpError(400, 'CPF/CNPJ inválido.');
  if (d.user_id) await own('users', d.user_id, req.companyId, 'id');
  const p = await one(`insert into partners (company_id, kind, name, document, email, phone, user_id, bank_info, bank_info_changed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [req.companyId, d.kind, d.name, d.document ? onlyDigits(d.document) : null, d.email || null, d.phone || null, d.user_id || null, d.bank_info || null, d.bank_info ? new Date() : null]);
  await audit(null, req, { entity: 'partner', entityId: p.id, action: 'partner.create', summary: `Parceiro ${d.name} cadastrado` });
  res.status(201).json({ ...p, bank_info: maskBank(p.bank_info) });
});

partners.put('/:id', need('splits_manage'), async (req, res) => {
  const p = await own('partners', req.params.id, req.companyId);
  const d = parse(z.object({ name: z.string().trim().min(2).max(160).optional(), email: z.string().email().max(160).nullable().optional(), phone: z.string().max(40).nullable().optional(),
    active: z.boolean().optional(), user_id: z.string().uuid().nullable().optional() }), req.body);
  if (d.user_id) await own('users', d.user_id, req.companyId, 'id');
  const out = await one(`update partners set name = coalesce($3, name), email = coalesce($4, email), phone = coalesce($5, phone), active = coalesce($6, active), user_id = coalesce($7, user_id)
     where id = $1 and company_id = $2 returning *`, [p.id, req.companyId, d.name ?? null, d.email ?? null, d.phone ?? null, d.active ?? null, d.user_id ?? null]);
  res.json({ ...out, bank_info: maskBank(out.bank_info) });
});

/** Troca de favorecido: reautenticação + auditoria (26.4). Lotes já aprovados mantêm o favorecido congelado. */
partners.put('/:id/bank', need('splits_manage'), async (req, res) => {
  const d = parse(z.object({ bank_info: bankSchema, reason: z.string().trim().min(3).max(300), mfa_code: z.string().optional(), password: z.string().optional() }), req.body);
  await reauth(req, { code: d.mfa_code, password: d.password });
  const p = await own('partners', req.params.id, req.companyId);
  await tx(async (db) => {
    await db.query('update partners set bank_info = $3, bank_info_changed_at = now() where id = $1 and company_id = $2', [p.id, req.companyId, d.bank_info]);
    await audit(db, req, { entity: 'partner', entityId: p.id, action: 'partner.bank_change', summary: `Favorecido de ${p.name} alterado`, reason: d.reason, data: { before: maskBank(p.bank_info), after: maskBank(d.bank_info) } });
  });
  res.json({ ok: true, bank_info: maskBank(d.bank_info) });
});

// ---------------- Regras de repasse ----------------
export const splitRoutes = Router();

splitRoutes.get('/rules', need('splits_view'), async (req, res) => {
  const { rows } = await q(`select r.*, p.name as partner_name, i.name as institution_name from split_rule_versions r join partners p on p.id = r.partner_id
     left join institutions i on i.id = r.institution_id where r.company_id = $1 order by p.name, r.version desc`, [req.companyId]);
  res.json(rows);
});

splitRoutes.post('/rules', need('splits_manage'), async (req, res) => {
  const d = parse(z.object({ partner_id: z.string().uuid(), name: z.string().trim().min(2).max(160), institution_id: z.string().uuid().nullable().optional(), branch: z.string().max(40).nullable().optional(),
    kind: z.enum(['percentual', 'fixo']), rate: z.number().min(0).max(100).nullable().optional(), fixed_cents: z.number().int().nonnegative().nullable().optional(),
    base: z.enum(['comissao_bruta', 'comissao_liquida', 'recebimento_efetivo']), stage: z.number().int().min(1).max(9).default(1), sequential: z.boolean().default(false),
    release: z.enum(['no_recebimento', 'antecipado']).default('no_recebimento'), reversal: z.enum(['proporcional', 'nenhuma']).default('proporcional'),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  if (d.kind === 'percentual' && d.rate == null) throw new HttpError(400, 'Informe o percentual (0 a 100).');
  if (d.kind === 'fixo' && !d.fixed_cents) throw new HttpError(400, 'Informe o valor fixo.');
  if (d.release === 'antecipado' && !can(req, 'splits_approve')) throw new HttpError(403, 'Repasse antes do recebimento exige aprovação de quem aprova repasses.');
  await own('partners', d.partner_id, req.companyId, 'id');
  const { rows: [n] } = await q('select coalesce(max(version),0)+1 as n from split_rule_versions where company_id = $1 and partner_id = $2 and name = $3', [req.companyId, d.partner_id, d.name]);
  const r2 = await one(`insert into split_rule_versions (company_id, partner_id, name, version, institution_id, branch, kind, rate, fixed_cents, base, stage, sequential, release, reversal, valid_from, approved_by, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15, current_date),$16,$17) returning *`,
  [req.companyId, d.partner_id, d.name, n.n, d.institution_id || null, d.branch || null, d.kind, d.rate ?? null, d.fixed_cents ?? null, d.base, d.stage, d.sequential, d.release, d.reversal,
    d.valid_from || null, d.release === 'antecipado' ? req.user.id : null, req.user.id]);
  await audit(null, req, { entity: 'split_rule', entityId: r2.id, action: 'split.rule', summary: `Regra de repasse ${d.name} v${r2.version}: ${d.kind === 'percentual' ? `${d.rate}%` : brl(d.fixed_cents)} sobre ${d.base}` });
  res.status(201).json(r2);
});

splitRoutes.post('/rules/:id/deactivate', need('splits_manage'), async (req, res) => {
  const r2 = await one(`update split_rule_versions set active = false, valid_to = current_date where id = $1 and company_id = $2 returning *`, [idParam(req.params.id), req.companyId]);
  if (!r2) throw notFound();
  res.json(r2);
});

splitRoutes.get('/accruals', need('splits_view'), async (req, res) => {
  const params = [req.companyId];
  const where = ['a.company_id = $1'];
  if (scopeOf(req, 'splits_view') === 'own') { params.push(req.user.id); where.push(`pa.user_id = $${params.length}`); }
  if (req.query.partner_id) { params.push(idParam(req.query.partner_id)); where.push(`a.partner_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`a.status = $${params.length}`); }
  const { rows } = await q(`select a.*, pa.name as partner_name, p.policy_number, c.name as client_name from split_accruals a join partners pa on pa.id = a.partner_id
     join policies p on p.id = a.policy_id join clients c on c.id = p.client_id where ${where.join(' and ')} order by a.created_at desc limit 2000`, params);
  res.json(rows);
});

// ---------------- Lotes de repasse ----------------
splitRoutes.get('/batches', need('splits_view'), async (req, res) => {
  const { rows } = await q(`select b.*, (select count(*)::int from split_batch_items i where i.batch_id = b.id) as items, u.name as approved_by_name
     from split_payment_batches b left join users u on u.id = b.approved_by where b.company_id = $1 order by b.created_at desc limit 200`, [req.companyId]);
  res.json(rows);
});

splitRoutes.get('/batches/:id', need('splits_view'), async (req, res) => {
  const b = await own('split_payment_batches', req.params.id, req.companyId);
  const { rows } = await q(`select i.*, p.name as partner_name from split_batch_items i join partners p on p.id = i.partner_id where i.company_id = $1 and i.batch_id = $2`, [req.companyId, b.id]);
  res.json({ ...b, items: rows.map((x) => ({ ...x, payee: maskBank(x.payee) })) });
});

/** Prepara o lote: valores liberados (menos reduções); recuperáveis só entram com compensação autorizada. */
splitRoutes.post('/batches', need('splits_manage'), async (req, res) => {
  const d = parse(z.object({ partner_ids: z.array(z.string().uuid()).min(1).max(200), compensate_recoverable: z.boolean().default(false) }), req.body);
  if (d.compensate_recoverable && !can(req, 'splits_approve')) throw new HttpError(403, 'Compensar valores recuperáveis exige aprovação.');
  const out = await tx(async (db) => {
    const n = await nextNumber(db, req.companyId, 'batch');
    const { rows: [b] } = await db.query(`insert into split_payment_batches (company_id, number, created_by) values ($1,$2,$3) returning *`, [req.companyId, n, req.user.id]);
    let total = 0;
    const skipped = [];
    for (const pid of d.partner_ids) {
      const { rows: [p] } = await db.query('select * from partners where id = $1 and company_id = $2 and active', [pid, req.companyId]);
      if (!p) { skipped.push({ partner_id: pid, reason: 'parceiro inativo/inexistente' }); continue; }
      if (!p.bank_info) { skipped.push({ partner_id: pid, reason: 'sem favorecido cadastrado' }); continue; }
      const kinds = d.compensate_recoverable ? ['liberacao', 'antecipacao', 'reducao', 'recuperacao'] : ['liberacao', 'antecipacao', 'reducao'];
      const { rows: acc } = await db.query(`select id, amount_cents from split_accruals where company_id = $1 and partner_id = $2 and status = 'liberada' and kind = any($3) for update`, [req.companyId, pid, kinds]);
      const amount = acc.reduce((a, x) => a + Number(x.amount_cents), 0);
      if (amount <= 0) { skipped.push({ partner_id: pid, reason: amount < 0 ? 'saldo negativo (reduções/recuperações maiores que o liberado)' : 'sem valor liberado' }); continue; }
      await db.query(`insert into split_batch_items (company_id, batch_id, partner_id, amount_cents, payee, accrual_ids) values ($1,$2,$3,$4,$5,$6)`,
        [req.companyId, b.id, pid, amount, p.bank_info, acc.map((x) => x.id)]);
      await db.query(`update split_accruals set status = 'em_lote', batch_id = $3 where company_id = $1 and id = any($2)`, [req.companyId, acc.map((x) => x.id), b.id]);
      total += amount;
    }
    if (!total) throw conflict('Nenhum valor liberado para os parceiros selecionados.', { skipped });
    await db.query('update split_payment_batches set total_cents = $2 where id = $1', [b.id, total]);
    await audit(db, req, { entity: 'split_batch', entityId: b.id, action: 'split.batch_create', summary: `Lote de repasse nº ${n} preparado: ${brl(total)}` });
    return { batch: { ...b, total_cents: total }, skipped };
  });
  res.status(201).json(out);
});

/** Aprovação: congela itens e favorecidos (hash). Quem preparou não aprova o próprio lote (exceto o proprietário). */
splitRoutes.post('/batches/:id/approve', need('splits_approve'), async (req, res) => {
  const out = await tx(async (db) => {
    const { rows: [b] } = await db.query('select * from split_payment_batches where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!b) throw notFound();
    if (b.status !== 'rascunho') throw conflict('Lote não está em rascunho.');
    if (b.created_by === req.user.id && req.user.role !== 'owner') throw new HttpError(403, 'O lote deve ser aprovado por outra pessoa (alçada).');
    const { rows: items } = await db.query('select partner_id, amount_cents, payee from split_batch_items where batch_id = $1 order by partner_id', [b.id]);
    const total = items.reduce((a, i) => a + Number(i.amount_cents), 0);
    if (total !== Number(b.total_cents)) throw conflict('Total do lote diverge dos itens: prepare o lote novamente.');
    const { rows: [x] } = await db.query(`update split_payment_batches set status = 'aprovado', approved_by = $2, approved_at = now(), items_hash = $3 where id = $1 returning *`, [b.id, req.user.id, hashOf(items)]);
    await audit(db, req, { entity: 'split_batch', entityId: b.id, action: 'split.batch_approve', summary: `Lote nº ${b.number} aprovado (${brl(total)}) — favorecidos conferidos` });
    return x;
  });
  res.json(out);
});

/** Pago só com evidência bancária conciliada: a saída no extrato precisa fechar o total do lote (15.2). */
splitRoutes.post('/batches/:id/pay', need('splits_pay'), async (req, res) => {
  const d = parse(z.object({ bank_transaction_id: z.string().uuid() }), req.body);
  const out = await tx(async (db) => {
    const { rows: [b] } = await db.query('select * from split_payment_batches where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!b) throw notFound();
    if (b.status !== 'aprovado') throw conflict('Só lotes aprovados podem ser pagos.');
    const { rows: items } = await db.query('select partner_id, amount_cents, payee from split_batch_items where batch_id = $1 order by partner_id', [b.id]);
    if (hashOf(items) !== b.items_hash) throw conflict('Itens do lote mudaram depois da aprovação: pagamento bloqueado.', { code: 'BATCH_TAMPERED' });
    const { rows: [t] } = await db.query('select * from bank_transactions where id = $1 and company_id = $2 for update', [d.bank_transaction_id, req.companyId]);
    if (!t) throw notFound('Lançamento bancário não encontrado.');
    if (t.amount_cents >= 0) throw new HttpError(400, 'Escolha uma saída (débito) do extrato bancário.');
    const { rows: [used] } = await db.query(`select coalesce(sum(amount_cents),0)::bigint as v from reconciliation_matches where company_id = $1 and bank_transaction_id = $2 and undone_at is null`, [req.companyId, t.id]);
    if (-Number(t.amount_cents) - Number(used.v) < Number(b.total_cents)) throw conflict('O débito do extrato não cobre o total do lote.');
    await assertPeriodOpen(db, req.companyId, t.tx_date);
    await db.query(`insert into reconciliation_matches (company_id, bank_transaction_id, target_kind, target_id, amount_cents, created_by) values ($1,$2,'split_batch',$3,$4,$5)`,
      [req.companyId, t.id, b.id, b.total_cents, req.user.id]);
    if (-Number(t.amount_cents) === Number(used.v) + Number(b.total_cents)) await db.query(`update bank_transactions set status = 'conciliada' where id = $1`, [t.id]);
    await db.query(`update split_payment_batches set status = 'pago', paid_at = now(), bank_transaction_id = $2, payment_evidence = $3 where id = $1`, [b.id, t.id, `Extrato ${t.tx_date}: ${t.description || ''}`]);
    await db.query(`update split_accruals set status = 'paga' where company_id = $1 and batch_id = $2`, [req.companyId, b.id]);
    await db.query(`insert into cash_entries (company_id, kind, category, description, amount_cents, competence, due_date, paid_date, status, source, source_id, created_by)
       values ($1,'pagar','Repasses',$2,$3,$4,$4,$4,'pago','repasse',$5,$6)`, [req.companyId, `Lote de repasse nº ${b.number}`, b.total_cents, t.tx_date, b.id, req.user.id]);
    await emit(db, req.companyId, 'SplitPaymentConfirmed', 'split_batch', b.id, { total: b.total_cents });
    await audit(db, req, { entity: 'split_batch', entityId: b.id, action: 'split.batch_pay', summary: `Lote nº ${b.number} pago (conciliado com o extrato de ${t.tx_date})` });
    return { ok: true };
  });
  res.json(out);
});

splitRoutes.post('/batches/:id/cancel', need('splits_manage'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  await tx(async (db) => {
    const { rows: [b] } = await db.query('select * from split_payment_batches where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!b) throw notFound();
    if (!['rascunho', 'aprovado'].includes(b.status)) throw conflict('Lote pago não pode ser cancelado.');
    await db.query(`update split_accruals set status = 'liberada', batch_id = null where company_id = $1 and batch_id = $2`, [req.companyId, b.id]);
    await db.query(`update split_payment_batches set status = 'cancelado', cancelled_reason = $2 where id = $1`, [b.id, d.reason]);
    await audit(db, req, { entity: 'split_batch', entityId: b.id, action: 'split.batch_cancel', summary: `Lote nº ${b.number} cancelado`, reason: d.reason });
  });
  res.json({ ok: true });
});

/** Recuperação: compensação autorizada (marca como compensada) ou contestação — nunca débito automático na conta do parceiro. */
splitRoutes.post('/accruals/:id/resolve', need('splits_approve'), async (req, res) => {
  const d = parse(z.object({ action: z.enum(['contestar', 'compensado_fora']), note: z.string().trim().min(3).max(500) }), req.body);
  const a = await own('split_accruals', req.params.id, req.companyId);
  if (a.kind !== 'recuperacao' || a.status !== 'liberada') throw conflict('Só valores recuperáveis em aberto.');
  const out = await one(`update split_accruals set status = $3, note = coalesce(note || ' · ', '') || $4 where id = $1 and company_id = $2 returning *`,
    [a.id, req.companyId, d.action === 'contestar' ? 'contestada' : 'compensada', d.note]);
  await audit(null, req, { entity: 'split_accrual', entityId: a.id, action: `split.recovery_${d.action}`, summary: `Recuperação ${brl(-a.amount_cents)}: ${d.action}`, reason: d.note });
  res.json(out);
});

export default splitRoutes;
