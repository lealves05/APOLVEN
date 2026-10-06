// Comissões (14), liquidações e conciliação com a seguradora (17.1). Regras por acordo, base e versão;
// snapshot no contrato; previsão separada do confirmado; saldo derivado de alocações e ajustes auditáveis.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can, scopeOf } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, today, sha256, brl } from '../util.js';
import { nextNumber, own, idempotent, assertPeriodOpen, institutionFor, logActivity } from '../lib/common.js';
import { RECEIVABLE_AGG, receivableState, lockReceivable, createSettlement, applyReversalToSplits } from '../lib/finance.js';
import { parseCsv, moneyToCents, parseDate, withOrdinals } from '../lib/csv.js';

const r = Router();

// ---------------- Acordos e regras versionadas ----------------
r.get('/agreements', need('commissions_view'), async (req, res) => {
  const { rows } = await q(`select a.*, i.name as institution_name,
      (select json_agg(v order by v.version desc) from commission_rule_versions v where v.agreement_id = a.id) as versions
     from commission_agreements a join institutions i on i.id = a.institution_id where a.company_id = $1 order by i.name, a.name`, [req.companyId]);
  res.json(rows);
});

r.post('/agreements', need('commissions_rules'), async (req, res) => {
  const d = parse(z.object({ institution_id: z.string().uuid(), name: z.string().trim().min(2).max(160), branch: z.string().max(40).nullable().optional(),
    product_id: z.string().uuid().nullable().optional(), unit_id: z.string().uuid().nullable().optional() }), req.body);
  await institutionFor(null, req.companyId, d.institution_id);
  if (d.product_id) await own('products', d.product_id, req.companyId, 'id');
  if (d.unit_id) await own('units', d.unit_id, req.companyId, 'id');
  const a = await one(`insert into commission_agreements (company_id, institution_id, name, branch, product_id, unit_id) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.companyId, d.institution_id, d.name, d.branch || null, d.product_id || null, d.unit_id || null]);
  await audit(null, req, { entity: 'commission_agreement', entityId: a.id, action: 'commission.agreement', summary: `Acordo de comissão ${d.name}` });
  res.status(201).json(a);
});

/** Nova versão da regra (append-only). Versões anteriores continuam valendo para os contratos já firmados. */
r.post('/agreements/:id/versions', need('commissions_rules'), async (req, res) => {
  const a = await own('commission_agreements', req.params.id, req.companyId);
  const d = parse(z.object({
    kind: z.enum(['percentual', 'fixo']), rate: z.number().min(0).max(100).nullable().optional(), fixed_cents: z.number().int().nonnegative().nullable().optional(),
    base_definition: z.enum(['premio_liquido', 'premio_total', 'outra']), base_notes: z.string().max(500).nullable().optional(),
    schedule: z.enum(['unica', 'parcelada']).default('unica'), installments: z.number().int().min(1).max(120).default(1), right_event: z.string().max(200).nullable().optional(),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    document_id: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional(),
  }), req.body);
  if (d.kind === 'percentual' && d.rate == null) throw new HttpError(400, 'Informe o percentual.');
  if (d.kind === 'fixo' && d.fixed_cents == null) throw new HttpError(400, 'Informe o valor fixo.');
  if (d.base_definition === 'outra' && !d.base_notes) throw new HttpError(400, 'Descreva a base de cálculo documentada.');
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id');
  const v = await tx(async (db) => {
    const { rows: [n] } = await db.query('select coalesce(max(version),0)+1 as n from commission_rule_versions where agreement_id = $1', [a.id]);
    const { rows: [x] } = await db.query(`insert into commission_rule_versions (company_id, agreement_id, version, kind, rate, fixed_cents, base_definition, base_notes, schedule, installments,
        right_event, valid_from, valid_to, document_id, notes, approved_by, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) returning *`,
    [req.companyId, a.id, n.n, d.kind, d.rate ?? null, d.fixed_cents ?? null, d.base_definition, d.base_notes || null, d.schedule, d.installments, d.right_event || null,
      d.valid_from, d.valid_to || null, d.document_id || null, d.notes || null, req.user.id]);
    await audit(db, req, { entity: 'commission_rule', entityId: x.id, action: 'commission.rule_version', summary: `Regra v${x.version} de ${a.name}: ${d.kind === 'percentual' ? `${d.rate}%` : brl(d.fixed_cents)} sobre ${d.base_definition}` });
    return x;
  });
  res.status(201).json(v);
});

// ---------------- Comissões a receber ----------------
const RECV_LIST = `select r.*, ${RECEIVABLE_AGG}, p.policy_number, p.branch, p.institution_id, i.name as institution_name, c.name as client_name, c.owner_user_id
  from commission_receivables r join policies p on p.id = r.policy_id join institutions i on i.id = p.institution_id join clients c on c.id = p.client_id`;

r.get('/receivables', need('commissions_view'), async (req, res) => {
  const params = [req.companyId];
  const where = ['r.company_id = $1'];
  if (scopeOf(req, 'commissions_view') === 'own') { params.push(req.user.id); where.push(`c.owner_user_id = $${params.length}`); }
  if (req.query.institution_id) { params.push(idParam(req.query.institution_id)); where.push(`p.institution_id = $${params.length}`); }
  if (req.query.policy_id) { params.push(idParam(req.query.policy_id)); where.push(`r.policy_id = $${params.length}`); }
  const { rows } = await q(`${RECV_LIST} where ${where.join(' and ')} order by r.due_date nulls last limit 3000`, params);
  const ref = today(req.settings.timezone);
  let list = rows.map((x) => receivableState(x, ref));
  if (req.query.status) list = list.filter((x) => String(req.query.status).split(',').includes(x.status));
  if (req.query.open === '1') list = list.filter((x) => x.balance_cents == null || x.balance_cents > 0);
  // totais por categoria — previsão nunca misturada ao confirmado (14.4)
  const sum = (f) => list.reduce((a, x) => a + (f(x) || 0), 0);
  res.json({ items: list, totals: {
    projected_cents: sum((x) => (x.confirmed_cents == null ? x.expected_cents : 0)),
    confirmed_cents: sum((x) => x.due_cents),
    settled_cents: sum((x) => Number(x.allocated_cents)),
    open_confirmed_cents: sum((x) => (x.balance_cents > 0 ? x.balance_cents : 0)),
    overdue_cents: sum((x) => (x.status === 'vencida' ? x.balance_cents : 0)),
    reversed_cents: sum((x) => Number(x.reversal_cents)),
    divergent: list.filter((x) => x.status === 'divergente').length,
  }, definitions: {
    projected: 'Previsão ainda não confirmada pela seguradora (projeção).',
    confirmed: 'Comissão confirmada + créditos − débitos/estornos confirmados.',
    settled: 'Valor bruto quitado pelas liquidações alocadas (retenções não geram saldo).',
    open_confirmed: 'Saldo confirmado a receber = confirmado + créditos − liquidações − débitos.',
  } });
});

r.post('/receivables/:id/confirm', need('commissions_settle'), async (req, res) => {
  const d = parse(z.object({ confirmed_cents: z.number().int().nonnegative(), source: z.string().trim().min(3).max(300), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  const out = await tx(async (db) => {
    const r2 = await lockReceivable(db, req.companyId, idParam(req.params.id));
    if (Number(r2.allocated_cents) > d.confirmed_cents) throw conflict('O valor confirmado não pode ser menor que o já liquidado; use ajuste/estorno.');
    const { rows: [x] } = await db.query(`update commission_receivables set confirmed_cents = $3, confirmed_at = now(), confirmation_source = $4, due_date = coalesce($5, due_date)
       where id = $1 and company_id = $2 returning *`, [r2.id, req.companyId, d.confirmed_cents, d.source, d.due_date || null]);
    await audit(db, req, { entity: 'commission_receivable', entityId: r2.id, action: 'commission.confirm', summary: `Comissão confirmada: ${brl(d.confirmed_cents)} (previsto ${brl(r2.expected_cents)})`, reason: d.source });
    return x;
  });
  res.json(out);
});

/** Ajuste/estorno: lançamento vinculado; estorno reduz repasse não pago ou cria valor recuperável (A18). */
r.post('/receivables/:id/adjustments', need('commissions_adjust'), async (req, res) => {
  const d = parse(z.object({ kind: z.enum(['credito', 'debito', 'estorno']), amount_cents: z.number().int().positive(), reason: z.string().trim().min(3).max(500),
    evidence: z.string().trim().min(3).max(500), cancellation_id: z.string().uuid().nullable().optional() }), req.body);
  const out = await tx(async (db) => {
    const r2 = await lockReceivable(db, req.companyId, idParam(req.params.id));
    if (r2.confirmed_cents == null && d.kind !== 'estorno') throw conflict('Confirme a comissão antes de lançar ajustes.');
    if (d.cancellation_id) await own('cancellations', d.cancellation_id, req.companyId, 'id', db);
    const { rows: [adj] } = await db.query(`insert into commission_adjustments (company_id, receivable_id, kind, amount_cents, reason, evidence, cancellation_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [req.companyId, r2.id, d.kind, d.amount_cents, d.reason, d.evidence, d.cancellation_id || null, req.user.id]);
    if (r2.confirmed_cents == null && d.kind === 'estorno') {
      // estorno sobre previsão ainda não confirmada: a previsão é confirmada pelo valor original para o ajuste ficar rastreável
      await db.query('update commission_receivables set confirmed_cents = expected_cents, confirmed_at = now(), confirmation_source = $3 where id = $1 and company_id = $2',
        [r2.id, req.companyId, 'confirmada no registro do estorno']);
    }
    let splits = [];
    if (d.kind === 'estorno') {
      splits = await applyReversalToSplits(db, req.companyId, { adjustment: adj, receivable: r2 });
      await emit(db, req.companyId, 'CommissionReversed', 'commission_receivable', r2.id, { amount: d.amount_cents });
    }
    await audit(db, req, { entity: 'commission_receivable', entityId: r2.id, action: `commission.${d.kind}`, summary: `${d.kind} de ${brl(d.amount_cents)} na comissão`, reason: d.reason });
    return { adjustment: adj, split_effects: splits };
  });
  res.status(201).json(out);
});

r.post('/receivables/:id/contest', need('commissions_adjust'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(1000), amount_cents: z.number().int().nullable().optional() }), req.body);
  const out = await tx(async (db) => {
    const r2 = await lockReceivable(db, req.companyId, idParam(req.params.id));
    await db.query('update commission_receivables set contested = true where id = $1', [r2.id]);
    const { rows: [x] } = await db.query(`insert into disputes (company_id, entity, entity_id, amount_cents, reason, opened_by) values ($1,'commission_receivable',$2,$3,$4,$5) returning *`,
      [req.companyId, r2.id, d.amount_cents ?? null, d.reason, req.user.id]);
    await audit(db, req, { entity: 'commission_receivable', entityId: r2.id, action: 'commission.contest', summary: 'Contestação aberta', reason: d.reason });
    return x;
  });
  res.status(201).json(out);
});

r.get('/disputes', need('commissions_view'), async (req, res) => {
  const { rows } = await q('select * from disputes where company_id = $1 order by created_at desc limit 300', [req.companyId]);
  res.json(rows);
});
r.put('/disputes/:id', need('commissions_adjust'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(['enviada', 'respondida', 'encerrada']), response: z.string().max(2000).nullable().optional() }), req.body);
  const out = await tx(async (db) => {
    const { rows: [x] } = await db.query(`update disputes set status = $3, response = coalesce($4, response), closed_at = case when $3 = 'encerrada' then now() else null end
       where id = $1 and company_id = $2 returning *`, [idParam(req.params.id), req.companyId, d.status, d.response || null]);
    if (!x) throw notFound();
    if (d.status === 'encerrada' && x.entity === 'commission_receivable') {
      await db.query(`update commission_receivables set contested = exists (select 1 from disputes where entity_id = $1 and status <> 'encerrada') where id = $1`, [x.entity_id]);
    }
    await audit(db, req, { entity: 'dispute', entityId: x.id, action: 'dispute.update', summary: `Contestação: ${d.status}` });
    return x;
  });
  res.json(out);
});

// ---------------- Liquidações ----------------
r.get('/settlements', need('commissions_view'), async (req, res) => {
  const { rows } = await q(`select s.*, i.name as institution_name,
      (select count(*)::int from commission_allocations a where a.settlement_id = s.id) as allocations,
      exists (select 1 from reconciliation_matches m where m.target_kind = 'commission_settlement' and m.target_id = s.id and m.undone_at is null) as reconciled
     from commission_settlements s join institutions i on i.id = s.institution_id where s.company_id = $1 order by s.settled_date desc, s.number desc limit 300`, [req.companyId]);
  res.json(rows);
});

r.get('/settlements/:id', need('commissions_view'), async (req, res) => {
  const s = await own('commission_settlements', req.params.id, req.companyId);
  const { rows: allocs } = await q(`select a.*, r.installment_no, p.policy_number, c.name as client_name from commission_allocations a join commission_receivables r on r.id = a.receivable_id
     join policies p on p.id = r.policy_id join clients c on c.id = p.client_id where a.company_id = $1 and a.settlement_id = $2`, [req.companyId, s.id]);
  const { rows: accruals } = await q(`select sa.*, pa.name as partner_name from split_accruals sa join partners pa on pa.id = sa.partner_id
     where sa.company_id = $1 and sa.allocation_id = any($2)`, [req.companyId, allocs.map((a) => a.id)]);
  res.json({ ...s, allocations: allocs, split_accruals: accruals });
});

const settlementSchema = z.object({
  institution_id: z.string().uuid(),
  settled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gross_cents: z.number().int().positive(),
  retention_cents: z.number().int().nonnegative().default(0),
  retention_nature: z.string().max(200).nullable().optional(),
  deductions_cents: z.number().int().nonnegative().default(0),
  reference: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  confirm_missing: z.boolean().default(false),
  allocations: z.array(z.object({ receivable_id: z.string().uuid(), amount_cents: z.number().int().positive() })).min(1).max(500),
});

r.post('/settlements', need('commissions_settle'), async (req, res) => {
  const d = parse(settlementSchema, req.body);
  await institutionFor(null, req.companyId, d.institution_id);
  if (d.settled_date > today(req.settings.timezone)) throw new HttpError(400, 'Data de liquidação no futuro.');
  const out = await tx(async (db) => {
    await assertPeriodOpen(db, req.companyId, d.settled_date);
    return idempotent(db, req, 'commission.settlement', req.headers['idempotency-key'], d, () => createSettlement(db, req, d, { nextNumber, emit, audit }));
  });
  res.status(201).json(out);
});

/** Desfazer liquidação: só em período aberto, sem conciliação bancária e sem repasse em lote/pago — fica a trilha. */
r.post('/settlements/:id/reverse', need('commissions_adjust'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  await tx(async (db) => {
    const { rows: [s] } = await db.query('select * from commission_settlements where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!s) throw notFound();
    if (s.reversed_at) throw conflict('Liquidação já desfeita.');
    await assertPeriodOpen(db, req.companyId, s.settled_date);
    const { rows: [rec] } = await db.query(`select 1 from reconciliation_matches where company_id = $1 and target_kind = 'commission_settlement' and target_id = $2 and undone_at is null`, [req.companyId, s.id]);
    if (rec) throw conflict('Liquidação conciliada com o banco: desfaça a conciliação antes.');
    const { rows: [paid] } = await db.query(`select 1 from split_accruals sa join commission_allocations a on a.id = sa.allocation_id where a.settlement_id = $1 and sa.status in ('em_lote','paga')`, [s.id]);
    if (paid) throw conflict('Há repasse desta liquidação em lote ou pago: registre ajuste em vez de desfazer.');
    await db.query(`update commission_settlements set reversed_at = now(), reversed_reason = $3, reversed_by = $4 where id = $1 and company_id = $2`, [s.id, req.companyId, d.reason, req.user.id]);
    await db.query('update commission_allocations set reversed_at = now() where settlement_id = $1 and company_id = $2', [s.id, req.companyId]);
    await db.query(`update split_accruals set status = 'compensada', note = coalesce(note || ' · ', '') || 'Liquidação desfeita' where company_id = $1 and allocation_id in (select id from commission_allocations where settlement_id = $2)`, [req.companyId, s.id]);
    await db.query(`update cash_entries set status = 'cancelado', notes = 'Liquidação desfeita: ' || $3 where company_id = $1 and source = 'comissao' and source_id = $2`, [req.companyId, s.id, d.reason]);
    await db.query('update statement_lines set status = $3, settlement_id = null where company_id = $1 and settlement_id = $2', [req.companyId, s.id, 'pendente']);
    await audit(db, req, { entity: 'commission_settlement', entityId: s.id, action: 'settlement.reverse', summary: `Liquidação nº ${s.number} desfeita`, reason: d.reason });
  });
  res.json({ ok: true });
});

// ---------------- Extratos de comissão (17.1 / 30.4) ----------------
/**
 * Colunas aceitas (cabeçalho): data, apolice, parcela, valor_bruto (ou valor/comissao), retencao, tipo (comissao/estorno/bonus/adiantamento),
 * id_externo, descricao. Linhas iguais legítimas são preservadas com ordinal; reimportação não duplica.
 */
function readStatement(text) {
  const { rows } = parseCsv(text);
  const pick = (r2, ...keys) => keys.map((k) => r2[k]).find((v) => v != null && v !== '');
  const errors = [];
  const lines = [];
  for (const r2 of rows) {
    const gross = moneyToCents(pick(r2, 'valor_bruto', 'valor', 'comissao', 'valor_comissao'));
    const ret = moneyToCents(pick(r2, 'retencao', 'ir', 'irrf', 'valor_retencao') || '0');
    const kindRaw = String(pick(r2, 'tipo', 'natureza') || 'comissao').toLowerCase();
    const kind = /estorn/.test(kindRaw) ? 'estorno' : /bonus|bonif/.test(kindRaw) ? 'bonus' : /adiant/.test(kindRaw) ? 'adiantamento' : /ajust/.test(kindRaw) ? 'ajuste' : 'comissao';
    const date = parseDate(pick(r2, 'data', 'data_pagamento', 'competencia'));
    if (!Number.isFinite(gross) || gross === 0) { errors.push({ line: r2.__line, error: 'valor inválido' }); continue; }
    if (!Number.isFinite(ret) || ret < 0) { errors.push({ line: r2.__line, error: 'retenção inválida' }); continue; }
    lines.push({ line_no: r2.__line, line_date: date, policy_number: pick(r2, 'apolice', 'numero_apolice', 'apolice_certificado') || null,
      installment_no: Number(pick(r2, 'parcela', 'numero_parcela')) || null, external_id: pick(r2, 'id_externo', 'id', 'identificador') || null,
      gross_cents: Math.abs(gross), retention_cents: ret || 0, kind: gross < 0 && kind === 'comissao' ? 'estorno' : kind, description: pick(r2, 'descricao', 'historico') || null });
  }
  return { lines, errors };
}

async function matchLines(companyId, institutionId, lines) {
  const out = [];
  for (const l of lines) {
    let receivable = null;
    let note = null;
    if (l.policy_number) {
      const { rows } = await q(`select r.*, ${RECEIVABLE_AGG} from commission_receivables r join policies p on p.id = r.policy_id
         where r.company_id = $1 and p.institution_id = $2 and upper(p.policy_number) = upper($3) order by r.installment_no`, [companyId, institutionId, l.policy_number]);
      const cand = l.installment_no ? rows.filter((x) => x.installment_no === l.installment_no) : rows.map(receivableState).filter((x) => x.balance_cents == null || x.balance_cents > 0).slice(0, 1);
      receivable = cand[0] ? receivableState(cand[0]) : null;
      if (!rows.length) note = 'Apólice não encontrada para esta seguradora';
      else if (!receivable) note = 'Parcela de comissão não encontrada';
    } else note = 'Linha sem número de apólice';
    let status = 'pendente';
    let diff = null;
    if (receivable && ['comissao', 'bonus', 'adiantamento'].includes(l.kind) && l.kind === 'comissao') {
      const ref = receivable.balance_cents ?? receivable.expected_cents;
      diff = l.gross_cents - ref;
      status = diff === 0 ? 'conciliavel' : 'divergente';
      if (diff !== 0) note = `Diferença de ${brl(diff)} em relação ao saldo ${receivable.confirmed_cents == null ? 'previsto' : 'confirmado'}`;
    } else if (receivable && l.kind === 'estorno') status = 'conciliavel';
    else if (l.kind !== 'comissao' && !receivable) status = 'divergente';
    else if (!receivable) status = 'divergente';
    out.push({ ...l, receivable_id: receivable?.id || null, match_status: status, diff_cents: diff, note });
  }
  return out;
}

// Mapeamento de colunas do extrato, lembrado por seguradora (fica nas configurações da corretora).
const STATEMENT_FIELDS = ['data', 'apolice', 'parcela', 'valor_bruto', 'retencao', 'tipo', 'id_externo', 'descricao'];
r.get('/statements/mappings', need('commissions_view'), async (req, res) => {
  const c = await one('select settings from companies where id = $1', [req.companyId]);
  res.json(c?.settings?.statement_mappings || {});
});

r.put('/statements/mappings/:institutionId', need('commissions_settle'), async (req, res) => {
  const institutionId = parse(z.string().uuid(), req.params.institutionId);
  const d = parse(z.object({ columns: z.record(z.enum(STATEMENT_FIELDS), z.string().trim().max(120)) }), req.body);
  await institutionFor(null, req.companyId, institutionId);
  const columns = Object.fromEntries(Object.entries(d.columns).filter(([, v]) => v));
  await tx(async (db) => {
    await db.query(`update companies set settings = coalesce(settings, '{}'::jsonb)
        || jsonb_build_object('statement_mappings', coalesce(settings->'statement_mappings', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb))
      where id = $1`, [req.companyId, institutionId, JSON.stringify(columns)]);
    await audit(db, req, { entity: 'company', entityId: req.companyId, action: 'statement.mapping', summary: 'Mapeamento de colunas do extrato de comissões atualizado', data: { institution_id: institutionId, columns } });
  });
  res.json({ institution_id: institutionId, columns });
});

r.post('/statements/preview', need('commissions_settle'), async (req, res) => {
  const d = parse(z.object({ institution_id: z.string().uuid(), filename: z.string().max(200), content: z.string().max(5_000_000) }), req.body);
  await institutionFor(null, req.companyId, d.institution_id);
  const hash = sha256(d.content);
  const dupFile = await one(`select id, filename, created_at from import_files where company_id = $1 and kind = 'extrato_comissao' and sha256 = $2`, [req.companyId, hash]);
  const { lines, errors } = readStatement(d.content);
  const fp = (l) => sha256([d.institution_id, l.line_date, l.policy_number, l.installment_no, l.external_id, l.gross_cents, l.retention_cents, l.kind].join('|'));
  const withOrd = withOrdinals(lines, fp);
  const { rows: existing } = await q(`select fingerprint, ordinal from statement_lines where company_id = $1 and institution_id = $2 and fingerprint = any($3)`, [req.companyId, d.institution_id, withOrd.map((l) => l.fingerprint)]);
  const isDup = (l) => existing.some((x) => x.fingerprint === l.fingerprint && x.ordinal === l.ordinal);
  const matched = await matchLines(req.companyId, d.institution_id, withOrd.filter((l) => !isDup(l)));
  res.json({ duplicate_file: dupFile, errors, duplicates: withOrd.filter(isDup).length, lines: matched,
    totals: { lines: lines.length, gross_cents: lines.filter((l) => l.kind !== 'estorno').reduce((a, l) => a + l.gross_cents, 0), retention_cents: lines.reduce((a, l) => a + l.retention_cents, 0) } });
});

r.post('/statements/import', need('commissions_settle'), async (req, res) => {
  const d = parse(z.object({ institution_id: z.string().uuid(), filename: z.string().max(200), content: z.string().max(5_000_000) }), req.body);
  await institutionFor(null, req.companyId, d.institution_id);
  const hash = sha256(d.content);
  const out = await tx(async (db) => {
    const { rows: [dup] } = await db.query(`select id from import_files where company_id = $1 and kind = 'extrato_comissao' and sha256 = $2`, [req.companyId, hash]);
    if (dup) throw conflict('Este arquivo já foi importado.', { code: 'DUPLICATE_FILE', file_id: dup.id });
    const { lines, errors } = readStatement(d.content);
    const fp = (l) => sha256([d.institution_id, l.line_date, l.policy_number, l.installment_no, l.external_id, l.gross_cents, l.retention_cents, l.kind].join('|'));
    const withOrd = withOrdinals(lines, fp);
    const matched = await matchLines(req.companyId, d.institution_id, withOrd);
    // arquivo original preservado (hash, data, responsável) como documento privado
    const { rows: [doc] } = await db.query(`insert into documents (company_id, entity, kind, filename, mime, size, sha256, data, origin, created_by)
       values ($1,'import_file','extrato_comissao',$2,'text/csv',$3,$4,$5,'seguradora',$6) returning id`,
    [req.companyId, d.filename, Buffer.byteLength(d.content), hash, Buffer.from(d.content, 'utf8'), req.user.id]);
    const { rows: [file] } = await db.query(`insert into import_files (company_id, kind, filename, sha256, size, institution_id, document_id, created_by)
       values ($1,'extrato_comissao',$2,$3,$4,$5,$6,$7) returning *`, [req.companyId, d.filename, hash, Buffer.byteLength(d.content), d.institution_id, doc.id, req.user.id]);
    await db.query(`update documents set entity_id = $2 where id = $1`, [doc.id, file.id]);
    let inserted = 0;
    let skipped = 0;
    for (const l of matched) {
      const { rowCount } = await db.query(`insert into statement_lines (company_id, file_id, line_no, institution_id, policy_number, installment_no, external_id, line_date, gross_cents, retention_cents,
          kind, description, fingerprint, ordinal, status, receivable_id, diff_cents, note)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) on conflict (company_id, institution_id, fingerprint, ordinal) do nothing`,
      [req.companyId, file.id, l.line_no, d.institution_id, l.policy_number, l.installment_no, l.external_id, l.line_date, l.gross_cents, l.retention_cents, l.kind, l.description,
        l.fingerprint, l.ordinal, l.match_status === 'divergente' ? 'divergente' : 'pendente', l.receivable_id, l.diff_cents, l.note]);
      if (rowCount) inserted += 1; else skipped += 1;
    }
    const summary = { lines: matched.length, inserted, duplicates_skipped: skipped, errors };
    await db.query('update import_files set summary = $2 where id = $1', [file.id, summary]);
    await audit(db, req, { entity: 'import_file', entityId: file.id, action: 'statement.import', summary: `Extrato ${d.filename}: ${inserted} linha(s), ${skipped} duplicada(s), ${errors.length} rejeitada(s)` });
    return { file, summary };
  });
  res.status(201).json(out);
});

r.get('/statements/files', need('commissions_view'), async (req, res) => {
  const { rows } = await q(`select f.*, i.name as institution_name,
      (select count(*) filter (where status = 'pendente')::int from statement_lines s where s.file_id = f.id) as pending,
      (select count(*) filter (where status = 'divergente')::int from statement_lines s where s.file_id = f.id) as divergent,
      (select count(*) filter (where status = 'conciliada')::int from statement_lines s where s.file_id = f.id) as reconciled
     from import_files f left join institutions i on i.id = f.institution_id where f.company_id = $1 and f.kind = 'extrato_comissao' order by f.created_at desc limit 100`, [req.companyId]);
  res.json(rows);
});

r.get('/statements/lines', need('commissions_view'), async (req, res) => {
  const params = [req.companyId];
  let cond = '';
  if (req.query.file_id) { params.push(idParam(req.query.file_id)); cond += ` and s.file_id = $${params.length}`; }
  if (req.query.status) { params.push(req.query.status); cond += ` and s.status = $${params.length}`; }
  const { rows } = await q(`select s.*, p.policy_number as matched_policy, c.name as client_name from statement_lines s left join commission_receivables r on r.id = s.receivable_id
     left join policies p on p.id = r.policy_id left join clients c on c.id = p.client_id where s.company_id = $1${cond} order by s.file_id, s.line_no limit 3000`, params);
  res.json(rows);
});

/**
 * Conciliar linhas selecionadas (30.4): comissões viram UMA liquidação agrupada (um depósito para várias comissões — A16),
 * estornos viram ajustes vinculados. Divergências ficam para revisão (vincular, aceitar valor parcial, contestar ou ignorar).
 */
r.post('/statements/reconcile', need('commissions_settle'), async (req, res) => {
  const d = parse(z.object({ line_ids: z.array(z.string().uuid()).min(1).max(1000), settled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().max(200).nullable().optional(),
    retention_nature: z.string().max(200).nullable().optional(), confirm_missing: z.boolean().default(true) }), req.body);
  const out = await tx(async (db) => {
    await assertPeriodOpen(db, req.companyId, d.settled_date);
    const { rows: lines } = await db.query(`select * from statement_lines where company_id = $1 and id = any($2) order by id for update`, [req.companyId, d.line_ids]);
    if (lines.length !== new Set(d.line_ids).size) throw notFound('Linha não encontrada.');
    if (new Set(lines.map((l) => l.institution_id)).size > 1) throw new HttpError(400, 'Selecione linhas de uma única seguradora.');
    if (lines.some((l) => l.status === 'conciliada')) throw conflict('Há linha já conciliada na seleção.');
    if (lines.some((l) => !l.receivable_id)) throw conflict('Há linha sem comissão vinculada: vincule ou contestue antes.');
    const credits = lines.filter((l) => l.kind !== 'estorno');
    const reversals = lines.filter((l) => l.kind === 'estorno').sort((a, b) => (a.receivable_id < b.receivable_id ? -1 : a.receivable_id > b.receivable_id ? 1 : 0));
    let settlement = null;
    if (credits.length) {
      // a mesma comissão pode aparecer em mais de uma linha: soma por comissão
      const byRec = {};
      for (const l of credits) byRec[l.receivable_id] = (byRec[l.receivable_id] || 0) + Number(l.gross_cents);
      const gross = credits.reduce((a, l) => a + Number(l.gross_cents), 0);
      const ret = credits.reduce((a, l) => a + Number(l.retention_cents), 0);
      const s = await createSettlement(db, req, {
        institution_id: lines[0].institution_id, settled_date: d.settled_date, gross_cents: gross, retention_cents: ret, retention_nature: d.retention_nature || (ret ? 'Retenção informada no extrato' : null),
        deductions_cents: 0, reference: d.reference || `Extrato (${credits.length} linha(s))`, source: 'extrato', confirm_missing: d.confirm_missing, import_file_id: lines[0].file_id,
        allocations: Object.entries(byRec).map(([receivable_id, amount_cents]) => ({ receivable_id, amount_cents })),
      }, { nextNumber, emit, audit });
      settlement = s.settlement;
      await db.query(`update statement_lines set status = 'conciliada', settlement_id = $3 where company_id = $1 and id = any($2)`, [req.companyId, credits.map((l) => l.id), settlement.id]);
    }
    const adjustments = [];
    for (const l of reversals) {
      const r2 = await lockReceivable(db, req.companyId, l.receivable_id);
      if (r2.confirmed_cents == null) await db.query('update commission_receivables set confirmed_cents = expected_cents, confirmed_at = now(), confirmation_source = $2 where id = $1', [r2.id, 'confirmada pelo extrato (estorno)']);
      const { rows: [adj] } = await db.query(`insert into commission_adjustments (company_id, receivable_id, kind, amount_cents, reason, evidence, source, created_by)
         values ($1,$2,'estorno',$3,$4,$5,'extrato',$6) returning *`, [req.companyId, r2.id, l.gross_cents, 'Estorno informado no extrato da seguradora', `Linha ${l.line_no} do arquivo ${l.file_id}`, req.user.id]);
      await applyReversalToSplits(db, req.companyId, { adjustment: adj, receivable: r2 });
      await db.query(`update statement_lines set status = 'conciliada' where id = $1`, [l.id]);
      adjustments.push(adj);
    }
    return { settlement, adjustments };
  });
  res.json(out);
});

r.post('/statements/lines/:id/resolve', need('commissions_settle'), async (req, res) => {
  const d = parse(z.object({ action: z.enum(['vincular', 'ignorar', 'contestar', 'aceitar']), receivable_id: z.string().uuid().nullable().optional(), note: z.string().trim().min(3).max(500) }), req.body);
  const out = await tx(async (db) => {
    const { rows: [l] } = await db.query('select * from statement_lines where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    if (!l) throw notFound();
    if (l.status === 'conciliada') throw conflict('Linha já conciliada.');
    if (d.action === 'vincular') {
      if (!d.receivable_id) throw new HttpError(400, 'Escolha a comissão.');
      const r2 = await lockReceivable(db, req.companyId, d.receivable_id);
      const { rows: [pol] } = await db.query('select institution_id from policies where id = $1', [r2.policy_id]);
      if (pol.institution_id !== l.institution_id) throw new HttpError(400, 'A comissão é de outra seguradora.');
      const ref = r2.balance_cents ?? r2.expected_cents;
      const diff = l.kind === 'comissao' ? Number(l.gross_cents) - ref : null;
      await db.query(`update statement_lines set receivable_id = $2, diff_cents = $3, status = $4, note = $5 where id = $1`, [l.id, r2.id, diff, diff ? 'divergente' : 'pendente', d.note]);
    } else if (d.action === 'aceitar') {
      // valor parcial aceito: a linha liquida o que veio; o saldo restante continua em aberto (A15)
      if (!l.receivable_id) throw new HttpError(400, 'Vincule a linha antes.');
      await db.query(`update statement_lines set status = 'pendente', note = $2 where id = $1`, [l.id, `Aceito para conciliação: ${d.note}`]);
    } else if (d.action === 'ignorar') {
      await db.query(`update statement_lines set status = 'ignorada', note = $2 where id = $1`, [l.id, d.note]);
    } else {
      await db.query(`update statement_lines set status = 'divergente', note = $2 where id = $1`, [l.id, d.note]);
      await db.query(`insert into disputes (company_id, entity, entity_id, amount_cents, reason, opened_by) values ($1,'statement_line',$2,$3,$4,$5)`, [req.companyId, l.id, l.diff_cents, d.note, req.user.id]);
      if (l.receivable_id) await db.query('update commission_receivables set contested = true where id = $1', [l.receivable_id]);
    }
    await audit(db, req, { entity: 'statement_line', entityId: l.id, action: `statement.${d.action}`, summary: `Linha ${l.line_no}: ${d.action}`, reason: d.note });
    return { ok: true };
  });
  res.json(out);
});

export default r;
