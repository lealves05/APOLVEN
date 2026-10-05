// Financeiro da corretora (17.2–17.4): contas, extrato bancário (OFX/CSV sem duplicar), conciliação com trilha,
// contas a pagar/receber próprias, fechamento de período e projeção com previsto ≠ confirmado.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, sha256, today, addDays, brl, periodOf } from '../util.js';
import { own, assertPeriodOpen } from '../lib/common.js';
import { parseCsv, parseOfx, moneyToCents, parseDate, withOrdinals } from '../lib/csv.js';
import { RECEIVABLE_AGG, receivableState } from '../lib/finance.js';

const r = Router();

r.get('/accounts', need('finance'), async (req, res) => {
  const { rows } = await q(`select a.*,
      a.opening_balance_cents + coalesce((select sum(amount_cents) from bank_transactions t where t.account_id = a.id and t.status <> 'ignorada'), 0)::bigint as balance_cents,
      (select count(*)::int from bank_transactions t where t.account_id = a.id and t.status = 'pendente') as pending
     from bank_accounts a where a.company_id = $1 order by a.active desc, a.name`, [req.companyId]);
  res.json(rows);
});
r.post('/accounts', need('finance'), async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2).max(120), bank: z.string().max(80).nullable().optional(), agency: z.string().max(20).nullable().optional(),
    account: z.string().max(30).nullable().optional(), opening_balance_cents: z.number().int().default(0), opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }), req.body);
  const a = await one(`insert into bank_accounts (company_id, name, bank, agency, account, opening_balance_cents, opening_date) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.companyId, d.name, d.bank || null, d.agency || null, d.account || null, d.opening_balance_cents, d.opening_date || null]);
  await audit(null, req, { entity: 'bank_account', entityId: a.id, action: 'bank.account', summary: `Conta ${d.name} cadastrada` });
  res.status(201).json(a);
});

/** Importação de extrato: arquivo repetido recusado; linhas iguais legítimas preservadas com ordinal. */
r.post('/bank/import', need('finance'), async (req, res) => {
  const d = parse(z.object({ account_id: z.string().uuid(), filename: z.string().max(200), content: z.string().max(5_000_000), preview: z.boolean().default(false) }), req.body);
  const acc = await own('bank_accounts', d.account_id, req.companyId);
  const hash = sha256(d.content);
  let txs;
  if (/<OFX>|<STMTTRN>/i.test(d.content)) txs = parseOfx(d.content);
  else {
    const { rows } = parseCsv(d.content);
    txs = rows.map((x) => ({ __line: x.__line, date: parseDate(x.data || x.date), amount_cents: moneyToCents(x.valor || x.amount), fitid: x.id || x.fitid || null, description: x.descricao || x.historico || x.description || '' }));
  }
  const errors = txs.filter((t) => !t.date || !Number.isFinite(t.amount_cents) || !t.amount_cents).map((t) => ({ line: t.__line, error: 'data ou valor inválido' }));
  const valid = withOrdinals(txs.filter((t) => t.date && Number.isFinite(t.amount_cents) && t.amount_cents), (t) => sha256(t.fitid ? `fitid:${t.fitid}` : `${t.date}|${t.amount_cents}|${t.description}`));
  const { rows: existing } = await q('select fingerprint, ordinal from bank_transactions where company_id = $1 and account_id = $2 and fingerprint = any($3)', [req.companyId, acc.id, valid.map((t) => t.fingerprint)]);
  const isDup = (t) => existing.some((x) => x.fingerprint === t.fingerprint && x.ordinal === t.ordinal);
  const fresh = valid.filter((t) => !isDup(t));
  if (d.preview) return res.json({ lines: fresh, duplicates: valid.length - fresh.length, errors, duplicate_file: !!(await one(`select 1 from import_files where company_id = $1 and kind = 'extrato_bancario' and sha256 = $2`, [req.companyId, hash])) });
  const out = await tx(async (db) => {
    const { rows: [dup] } = await db.query(`select id from import_files where company_id = $1 and kind = 'extrato_bancario' and sha256 = $2`, [req.companyId, hash]);
    if (dup) throw conflict('Este arquivo de extrato já foi importado.', { code: 'DUPLICATE_FILE' });
    const { rows: [file] } = await db.query(`insert into import_files (company_id, kind, filename, sha256, size, bank_account_id, created_by) values ($1,'extrato_bancario',$2,$3,$4,$5,$6) returning *`,
      [req.companyId, d.filename, hash, Buffer.byteLength(d.content), acc.id, req.user.id]);
    let inserted = 0;
    for (const t of fresh) {
      const { rowCount } = await db.query(`insert into bank_transactions (company_id, account_id, file_id, tx_date, amount_cents, description, fitid, fingerprint, ordinal)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`, [req.companyId, acc.id, file.id, t.date, t.amount_cents, t.description?.slice(0, 300) || null, t.fitid, t.fingerprint, t.ordinal]);
      inserted += rowCount;
    }
    const summary = { inserted, duplicates: valid.length - fresh.length, errors };
    await db.query('update import_files set summary = $2 where id = $1', [file.id, summary]);
    await audit(db, req, { entity: 'import_file', entityId: file.id, action: 'bank.import', summary: `Extrato bancário ${d.filename}: ${inserted} lançamento(s)` });
    return { file, summary };
  });
  res.status(201).json(out);
});

r.get('/bank/transactions', need('finance'), async (req, res) => {
  const params = [req.companyId];
  let cond = '';
  if (req.query.account_id) { params.push(idParam(req.query.account_id)); cond += ` and t.account_id = $${params.length}`; }
  if (req.query.status) { params.push(req.query.status); cond += ` and t.status = $${params.length}`; }
  const { rows } = await q(`select t.*, a.name as account_name,
      coalesce((select sum(m.amount_cents) from reconciliation_matches m where m.bank_transaction_id = t.id and m.undone_at is null), 0)::bigint as matched_cents,
      (select json_agg(json_build_object('id', m.id, 'kind', m.target_kind, 'target_id', m.target_id, 'amount_cents', m.amount_cents)) from reconciliation_matches m where m.bank_transaction_id = t.id and m.undone_at is null) as matches
     from bank_transactions t join bank_accounts a on a.id = t.account_id where t.company_id = $1${cond} order by t.tx_date desc, t.created_at desc limit 1000`, params);
  res.json(rows);
});

/** Sugestões: depósito agrupado da seguradora × liquidações ainda não conciliadas (valor e data como apoio — 17.1). */
r.get('/bank/transactions/:id/suggestions', need('finance'), async (req, res) => {
  const t = await own('bank_transactions', req.params.id, req.companyId);
  if (t.amount_cents > 0) {
    const { rows } = await q(`select s.id, s.number, s.settled_date, s.net_cents, i.name as institution_name from commission_settlements s join institutions i on i.id = s.institution_id
       where s.company_id = $1 and s.reversed_at is null and not exists (select 1 from reconciliation_matches m where m.target_kind = 'commission_settlement' and m.target_id = s.id and m.undone_at is null)
         and s.settled_date between $2::date - 10 and $2::date + 10 order by abs(s.net_cents - $3), s.settled_date limit 20`, [req.companyId, t.tx_date, t.amount_cents]);
    const { rows: entries } = await q(`select id, description, amount_cents, due_date from cash_entries where company_id = $1 and kind = 'receber' and status = 'aberto' and source = 'manual' order by abs(amount_cents - $2) limit 10`, [req.companyId, t.amount_cents]);
    return res.json({ settlements: rows, entries });
  }
  const { rows: batches } = await q(`select id, number, total_cents, approved_at from split_payment_batches where company_id = $1 and status = 'aprovado' order by abs(total_cents + $2) limit 10`, [req.companyId, t.amount_cents]);
  const { rows: entries } = await q(`select id, description, amount_cents, due_date from cash_entries where company_id = $1 and kind = 'pagar' and status = 'aberto' order by abs(amount_cents + $2) limit 10`, [req.companyId, t.amount_cents]);
  res.json({ batches, entries });
});

/** Conciliação: soma dos vínculos ≤ valor do lançamento; um depósito pode cobrir várias liquidações. */
r.post('/bank/reconcile', need('finance'), async (req, res) => {
  const d = parse(z.object({ transaction_id: z.string().uuid(), target_kind: z.enum(['commission_settlement', 'cash_entry']), target_id: z.string().uuid() }), req.body);
  const out = await tx(async (db) => {
    const { rows: [t] } = await db.query('select * from bank_transactions where id = $1 and company_id = $2 for update', [d.transaction_id, req.companyId]);
    if (!t) throw notFound();
    await assertPeriodOpen(db, req.companyId, t.tx_date);
    let amount;
    if (d.target_kind === 'commission_settlement') {
      const { rows: [s] } = await db.query('select * from commission_settlements where id = $1 and company_id = $2 and reversed_at is null', [d.target_id, req.companyId]);
      if (!s) throw notFound('Liquidação não encontrada.');
      if (t.amount_cents <= 0) throw new HttpError(400, 'Liquidação de comissão se concilia com uma entrada.');
      amount = s.net_cents;
    } else {
      const { rows: [e] } = await db.query('select * from cash_entries where id = $1 and company_id = $2', [d.target_id, req.companyId]);
      if (!e || e.status === 'cancelado') throw notFound('Lançamento não encontrado.');
      if ((e.kind === 'receber') !== (t.amount_cents > 0)) throw new HttpError(400, 'Direção do lançamento não corresponde ao extrato.');
      amount = e.amount_cents;
      if (e.status === 'aberto') await db.query(`update cash_entries set status = 'pago', paid_date = $3 where id = $1 and company_id = $2`, [e.id, req.companyId, t.tx_date]);
    }
    const { rows: [used] } = await db.query('select coalesce(sum(amount_cents),0)::bigint as v from reconciliation_matches where bank_transaction_id = $1 and undone_at is null', [t.id]);
    if (Number(used.v) + amount > Math.abs(t.amount_cents)) throw conflict(`Os vínculos (${brl(Number(used.v) + amount)}) passariam do valor do extrato (${brl(Math.abs(t.amount_cents))}).`);
    const { rows: [m] } = await db.query(`insert into reconciliation_matches (company_id, bank_transaction_id, target_kind, target_id, amount_cents, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
      [req.companyId, t.id, d.target_kind, d.target_id, amount, req.user.id]);
    const full = Number(used.v) + amount === Math.abs(t.amount_cents);
    if (full) await db.query(`update bank_transactions set status = 'conciliada' where id = $1`, [t.id]);
    await audit(db, req, { entity: 'bank_transaction', entityId: t.id, action: 'bank.reconcile', summary: `Extrato ${t.tx_date} ${brl(t.amount_cents)} vinculado a ${d.target_kind} (${brl(amount)})${full ? ' — conciliado' : ' — parcial'}` });
    return { match: m, fully_reconciled: full };
  });
  res.json(out);
});

/** Lançamento direto do extrato (tarifa, despesa) com classificação. */
r.post('/bank/transactions/:id/entry', need('finance'), async (req, res) => {
  const d = parse(z.object({ category: z.string().trim().min(2).max(80), description: z.string().trim().min(2).max(300) }), req.body);
  const out = await tx(async (db) => {
    const { rows: [t] } = await db.query('select * from bank_transactions where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!t) throw notFound();
    if (t.status !== 'pendente') throw conflict('Lançamento já conciliado.');
    await assertPeriodOpen(db, req.companyId, t.tx_date);
    const { rows: [e] } = await db.query(`insert into cash_entries (company_id, kind, category, description, amount_cents, competence, due_date, paid_date, status, source, created_by)
       values ($1,$2,$3,$4,$5,$6,$6,$6,'pago','manual',$7) returning *`, [req.companyId, t.amount_cents > 0 ? 'receber' : 'pagar', d.category, d.description, Math.abs(t.amount_cents), t.tx_date, req.user.id]);
    await db.query(`insert into reconciliation_matches (company_id, bank_transaction_id, target_kind, target_id, amount_cents, created_by) values ($1,$2,'cash_entry',$3,$4,$5)`, [req.companyId, t.id, e.id, Math.abs(t.amount_cents), req.user.id]);
    await db.query(`update bank_transactions set status = 'conciliada' where id = $1`, [t.id]);
    return e;
  });
  res.status(201).json(out);
});

/** Desfazer conciliação: trilha preservada, pendências reabertas, operação original intacta (17.2). */
r.post('/bank/matches/:id/undo', need('finance'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  await tx(async (db) => {
    const { rows: [m] } = await db.query('select m.*, t.tx_date from reconciliation_matches m join bank_transactions t on t.id = m.bank_transaction_id where m.id = $1 and m.company_id = $2 and m.undone_at is null for update', [idParam(req.params.id), req.companyId]);
    if (!m) throw notFound();
    await assertPeriodOpen(db, req.companyId, m.tx_date);
    if (m.target_kind === 'split_batch') throw conflict('Pagamento de lote de repasse conciliado não se desfaz aqui: registre ajuste.');
    await db.query('update reconciliation_matches set undone_at = now(), undone_by = $2, undo_reason = $3 where id = $1', [m.id, req.user.id, d.reason]);
    await db.query(`update bank_transactions set status = 'pendente' where id = $1`, [m.bank_transaction_id]);
    await audit(db, req, { entity: 'bank_transaction', entityId: m.bank_transaction_id, action: 'bank.reconcile_undo', summary: 'Conciliação desfeita', reason: d.reason });
  });
  res.json({ ok: true });
});

// ---------------- Contas a pagar e receber próprias ----------------
r.get('/entries', need('finance'), async (req, res) => {
  const params = [req.companyId];
  let cond = '';
  if (req.query.kind) { params.push(req.query.kind); cond += ` and kind = $${params.length}`; }
  if (req.query.status) { params.push(req.query.status); cond += ` and status = $${params.length}`; }
  if (req.query.from) { params.push(req.query.from); cond += ` and due_date >= $${params.length}`; }
  if (req.query.to) { params.push(req.query.to); cond += ` and due_date <= $${params.length}`; }
  const { rows } = await q(`select e.*, exists (select 1 from reconciliation_matches m where m.target_kind = 'cash_entry' and m.target_id = e.id and m.undone_at is null) as reconciled
     from cash_entries e where company_id = $1${cond} order by due_date desc limit 2000`, params);
  res.json(rows);
});

const entrySchema = z.object({ kind: z.enum(['receber', 'pagar']), category: z.string().trim().min(2).max(80), description: z.string().trim().min(2).max(300),
  amount_cents: z.number().int().positive(), competence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost_center: z.string().max(80).nullable().optional(), unit_id: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional() });

r.post('/entries', need('finance'), async (req, res) => {
  const d = parse(entrySchema, req.body);
  if (d.kind === 'receber' && /pr[eê]mio/i.test(`${d.category} ${d.description}`)) throw new HttpError(400, 'Prêmio do seguro não é receita da corretora: acompanhe em Parcelas do seguro.');
  if (d.unit_id) await own('units', d.unit_id, req.companyId, 'id');
  const e = await tx(async (db) => {
    await assertPeriodOpen(db, req.companyId, d.competence);
    const { rows: [x] } = await db.query(`insert into cash_entries (company_id, kind, category, description, amount_cents, competence, due_date, cost_center, unit_id, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [req.companyId, d.kind, d.category, d.description, d.amount_cents, d.competence, d.due_date, d.cost_center || null, d.unit_id || null, d.notes || null, req.user.id]);
    await audit(db, req, { entity: 'cash_entry', entityId: x.id, action: 'cash.create', summary: `${d.kind === 'receber' ? 'Conta a receber' : 'Conta a pagar'}: ${d.description} ${brl(d.amount_cents)}` });
    return x;
  });
  res.status(201).json(e);
});

r.post('/entries/:id/settle', need('finance'), async (req, res) => {
  const d = parse(z.object({ paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), evidence: z.string().trim().min(3, 'baixa manual exige evidência').max(300) }), req.body);
  const out = await tx(async (db) => {
    const { rows: [e] } = await db.query('select * from cash_entries where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!e) throw notFound();
    if (e.status !== 'aberto') throw conflict('Lançamento não está em aberto.');
    await assertPeriodOpen(db, req.companyId, d.paid_date);
    const { rows: [x] } = await db.query(`update cash_entries set status = 'pago', paid_date = $3, notes = coalesce(notes || ' · ', '') || $4 where id = $1 and company_id = $2 returning *`, [e.id, req.companyId, d.paid_date, `Baixa manual: ${d.evidence}`]);
    await audit(db, req, { entity: 'cash_entry', entityId: e.id, action: 'cash.settle', summary: `Baixa manual: ${e.description}`, reason: d.evidence });
    return x;
  });
  res.json(out);
});

/** Lançamento confirmado não é apagado: cancelamento só em período aberto e sem conciliação, com motivo. */
r.post('/entries/:id/cancel', need('finance'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  await tx(async (db) => {
    const { rows: [e] } = await db.query('select * from cash_entries where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!e) throw notFound();
    if (e.source !== 'manual') throw conflict('Lançamento gerado por comissão/repasse: desfaça na origem.');
    await assertPeriodOpen(db, req.companyId, e.paid_date || e.competence);
    const { rows: [m] } = await db.query(`select 1 from reconciliation_matches where target_kind = 'cash_entry' and target_id = $1 and undone_at is null`, [e.id]);
    if (m) throw conflict('Lançamento conciliado: desfaça a conciliação antes.');
    await db.query(`update cash_entries set status = 'cancelado', notes = coalesce(notes || ' · ', '') || $3 where id = $1 and company_id = $2`, [e.id, req.companyId, `Cancelado: ${d.reason}`]);
    await audit(db, req, { entity: 'cash_entry', entityId: e.id, action: 'cash.cancel', summary: `Lançamento cancelado: ${e.description}`, reason: d.reason });
  });
  res.json({ ok: true });
});

// ---------------- Períodos ----------------
r.get('/periods', need('finance'), async (req, res) => {
  const { rows } = await q(`select p.*, u.name as closed_by_name, u2.name as reopened_by_name from period_closures p left join users u on u.id = p.closed_by left join users u2 on u2.id = p.reopened_by
     where p.company_id = $1 order by p.period desc, p.closed_at desc`, [req.companyId]);
  res.json(rows);
});
r.post('/periods/close', need('finance_close'), async (req, res) => {
  const d = parse(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
  if (d.period >= periodOf(today(req.settings.timezone))) throw new HttpError(400, 'Só é possível fechar meses já encerrados.');
  const p = await one(`insert into period_closures (company_id, period, closed_by) values ($1,$2,$3) on conflict do nothing returning *`, [req.companyId, d.period, req.user.id]);
  if (!p) throw conflict('Período já fechado.');
  await audit(null, req, { entity: 'period', entityId: p.id, action: 'period.close', summary: `Período ${d.period} fechado` });
  res.status(201).json(p);
});
r.post('/periods/:id/reopen', need('finance_close'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  if (!['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Reabertura exige alçada de proprietário/administrador.');
  const p = await one(`update period_closures set reopened_at = now(), reopened_by = $3, reopen_reason = $4 where id = $1 and company_id = $2 and reopened_at is null returning *`,
    [idParam(req.params.id), req.companyId, req.user.id, d.reason]);
  if (!p) throw notFound();
  await audit(null, req, { entity: 'period', entityId: p.id, action: 'period.reopen', summary: `Período ${p.period} reaberto`, reason: d.reason });
  res.json(p);
});

/** Projeção de caixa por semana: confirmado e previsto em colunas separadas (17.3). */
r.get('/projection', need('finance'), async (req, res) => {
  const days = Math.min(180, Number(req.query.days) || 60);
  const ref = today(req.settings.timezone);
  const end = addDays(ref, days);
  const [{ rows: entries }, { rows: recvRows }, { rows: splits }, { rows: accts }] = await Promise.all([
    q(`select kind, amount_cents, due_date from cash_entries where company_id = $1 and status = 'aberto' and due_date <= $2`, [req.companyId, end]),
    q(`select r.*, ${RECEIVABLE_AGG} from commission_receivables r where r.company_id = $1 and (r.due_date is null or r.due_date <= $2)`, [req.companyId, end]),
    q(`select coalesce(sum(amount_cents),0)::bigint as v from split_accruals where company_id = $1 and status in ('liberada','em_lote') and kind <> 'recuperacao'`, [req.companyId]),
    q(`select coalesce(sum(a.opening_balance_cents + coalesce((select sum(amount_cents) from bank_transactions t where t.account_id = a.id and t.status <> 'ignorada'),0)),0)::bigint as v from bank_accounts a where a.company_id = $1 and a.active`, [req.companyId]),
  ]);
  const weeks = [];
  for (let s = ref; s <= end; s = addDays(s, 7)) weeks.push({ start: s, end: addDays(s, 6), confirmed_in: 0, confirmed_out: 0, forecast_in: 0 });
  const bucket = (date) => (date < ref ? null : weeks.find((w) => date >= w.start && date <= w.end));
  let overdueIn = 0;
  let overdueOut = 0;
  for (const e of entries) {
    const w = bucket(e.due_date);
    if (!w) { if (e.kind === 'receber') overdueIn += e.amount_cents; else overdueOut += e.amount_cents; continue; }
    if (e.kind === 'receber') w.confirmed_in += e.amount_cents; else w.confirmed_out += e.amount_cents;
  }
  for (const x of recvRows.map((r2) => receivableState(r2, ref))) {
    const value = x.confirmed_cents == null ? x.expected_cents : Math.max(0, x.balance_cents);
    if (!value || !x.due_date) continue;
    const w = bucket(x.due_date);
    if (!w) continue;
    // comissão de seguradora entra como PREVISÃO até a liquidação (mesmo confirmada, não é dinheiro em caixa)
    w.forecast_in += value;
  }
  res.json({ bank_balance_cents: Number(accts[0].v), overdue_in_cents: overdueIn, overdue_out_cents: overdueOut, splits_payable_cents: Number(splits[0].v), weeks,
    method: 'Saldo bancário atual + contas próprias em aberto (confirmado) + comissões previstas/confirmadas a liquidar (previsão). Prêmios de seguro não entram: pertencem às seguradoras.' });
});

/** Resultado gerencial por competência (regime documentado): receitas de comissão e despesas próprias. */
r.get('/result', need('finance'), async (req, res) => {
  const year = Number(req.query.year) || Number(today(req.settings.timezone).slice(0, 4));
  const { rows } = await q(`select to_char(competence, 'YYYY-MM') as period, kind, category, sum(amount_cents)::bigint as total
     from cash_entries where company_id = $1 and status = 'pago' and extract(year from competence) = $2 group by 1, 2, 3 order by 1`, [req.companyId, year]);
  const { rows: ret } = await q(`select to_char(s.settled_date, 'YYYY-MM') as period, sum(s.gross_cents)::bigint as gross, sum(s.retention_cents)::bigint as retention
     from commission_settlements s where s.company_id = $1 and s.reversed_at is null and extract(year from s.settled_date) = $2 group by 1`, [req.companyId, year]);
  res.json({ rows, settlements: ret, method: 'Regime de caixa por competência dos lançamentos pagos. Comissão entra pelo valor líquido recebido; o bruto e as retenções aparecem à parte (natureza tributária conforme orientação contábil). Não substitui escrituração contábil.' });
});

export default r;
