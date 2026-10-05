// Painel de parcelas do seguro (13). Submódulo próprio, separado das contas a receber da corretora:
// a corretora acompanha e comunica; quem recebe o prêmio é a seguradora. Pagamento informado ≠ confirmado.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { audit, emit } from '../audit.js';
import { parse, HttpError, notFound, conflict, idParam, today, safeHttpsUrl, brl } from '../util.js';
import { own, portfolioFilter, assertClientVisible, logActivity } from '../lib/common.js';
import { INSTALLMENT_AGG, installmentState } from '../lib/premium.js';

const r = Router();
const OFFICIAL = ['seguradora_api', 'arquivo_oficial', 'seguradora_portal'];

async function loadInstallment(req, id, db = null) {
  const run = db ? (t, p) => db.query(t, p) : q;
  const { rows: [i] } = await run(`select i.*, ${INSTALLMENT_AGG}, p.client_id, p.policy_number, p.institution_id, inst.name as institution_name, c.name as client_name, c.phone as client_phone
     from premium_installments i join policies p on p.id = i.policy_id join institutions inst on inst.id = p.institution_id join clients c on c.id = p.client_id
     where i.id = $1 and i.company_id = $2`, [idParam(id), req.companyId]);
  if (!i) throw notFound();
  await assertClientVisible(req, 'policies_view', i.client_id);
  return installmentState(i, today(req.settings.timezone), req.settings.installments.upcomingDays);
}

r.get('/', need('installments'), async (req, res) => {
  const params = [req.companyId];
  const f = portfolioFilter(req, 'policies_view', 'c', params);
  const where = ['i.company_id = $1', f.sql];
  const add = (cond, v) => { params.push(v); where.push(cond.replace('?', `$${params.length}`)); };
  if (req.query.from) add('i.due_date >= ?', req.query.from);
  if (req.query.to) add('i.due_date <= ?', req.query.to);
  if (req.query.institution_id) add('p.institution_id = ?', idParam(req.query.institution_id));
  if (req.query.client_id) add('p.client_id = ?', idParam(req.query.client_id));
  if (req.query.policy_id) add('i.policy_id = ?', idParam(req.query.policy_id));
  const { rows } = await q(`select i.*, ${INSTALLMENT_AGG}, p.policy_number, p.branch, p.client_id, c.name as client_name, c.phone as client_phone, inst.name as institution_name, u.name as owner_name
     from premium_installments i join policies p on p.id = i.policy_id join clients c on c.id = p.client_id join institutions inst on inst.id = p.institution_id
     left join users u on u.id = c.owner_user_id where ${where.join(' and ')} order by i.due_date limit 2000`, params);
  const ref = today(req.settings.timezone);
  let list = rows.map((x) => installmentState(x, ref, req.settings.installments.upcomingDays));
  if (req.query.status) list = list.filter((x) => String(req.query.status).split(',').includes(x.status));
  const bands = req.settings.installments.agingBands || [15, 30, 60];
  const band = (d) => (d <= 0 ? null : d <= bands[0] ? `1-${bands[0]}` : d <= bands[1] ? `${bands[0] + 1}-${bands[1]}` : d <= bands[2] ? `${bands[1] + 1}-${bands[2]}` : `${bands[2] + 1}+`);
  const aging = {};
  for (const x of list) { const b = band(x.overdue_days); if (b) aging[b] = (aging[b] || 0) + x.balance_cents; }
  res.json({ items: list.map((x) => ({ ...x, aging_band: band(x.overdue_days), hours_since_update: Math.round((Date.now() - new Date(x.last_update_at).getTime()) / 3600000) })), aging,
    note: 'Valores e estados conforme a última informação da fonte; "pagamento informado" aguarda confirmação da seguradora.' });
});

r.get('/:id', need('installments'), async (req, res) => {
  const i = await loadInstallment(req, req.params.id);
  const { rows: pays } = await q(`select p.*, d.filename from premium_payments p left join documents d on d.id = p.document_id where p.company_id = $1 and p.installment_id = $2 order by p.created_at`, [req.companyId, i.id]);
  const { rows: refunds } = await q('select * from premium_refunds where company_id = $1 and installment_id = $2', [req.companyId, i.id]);
  res.json({ ...i, payments: pays, refunds });
});

/** Atualização da cobrança oficial (link/código só de origem https verificada — 26.3). */
r.put('/:id', need('installments'), async (req, res) => {
  const d = parse(z.object({ charge_url: z.string().max(500).nullable().optional(), charge_ref: z.string().max(120).nullable().optional(), method: z.string().max(40).nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), source: z.enum(['manual', 'arquivo', 'api']).default('manual'), reason: z.string().max(300).optional() }), req.body);
  const i = await loadInstallment(req, req.params.id);
  if (d.due_date && !d.reason) throw new HttpError(400, 'Alterar o vencimento exige o motivo (nova cobrança emitida pela seguradora).');
  const out = await one(`update premium_installments set charge_url = coalesce($3, charge_url), charge_ref = coalesce($4, charge_ref), method = coalesce($5, method),
      due_date = coalesce($6, due_date), source = $7, last_update_at = now() where id = $1 and company_id = $2 returning *`,
  [i.id, req.companyId, d.charge_url ? safeHttpsUrl(d.charge_url) : null, d.charge_ref ?? null, d.method ?? null, d.due_date ?? null, d.source]);
  await audit(null, req, { entity: 'premium_installment', entityId: i.id, action: 'installment.update', summary: `Parcela ${i.number}: cobrança atualizada`, reason: d.reason || null });
  res.json(out);
});

/**
 * Pagamento: "informado" (cliente/corretora, cria conferência e pausa lembretes) ou "confirmado" (fonte oficial,
 * permissão própria). Nunca acima do saldo. Parcela quitada NÃO liquida comissão (A13).
 */
r.post('/:id/payments', need('installments'), async (req, res) => {
  const d = parse(z.object({ kind: z.enum(['informado', 'confirmado']), amount_cents: z.number().int().positive(), paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.enum(['cliente', 'corretora', ...OFFICIAL]), evidence: z.string().trim().max(1000).nullable().optional(), document_id: z.string().uuid().nullable().optional(),
    confirms_payment_id: z.string().uuid().nullable().optional() }), req.body);
  if (d.kind === 'confirmado') {
    if (!req.perms.installments_confirm && req.user.role !== 'owner') throw new HttpError(403, 'Confirmar pagamento exige permissão de conferência com a fonte oficial.');
    if (!OFFICIAL.includes(d.source)) throw new HttpError(400, 'Confirmação só por fonte oficial da seguradora (API, arquivo oficial ou consulta ao portal).');
    if (!d.evidence) throw new HttpError(400, 'Informe a evidência da confirmação (consulta, arquivo, protocolo).');
  } else if (OFFICIAL.includes(d.source)) throw new HttpError(400, 'Fonte oficial deve ser registrada como pagamento confirmado.');
  if (d.paid_date > today(req.settings.timezone)) throw new HttpError(400, 'Data de pagamento no futuro.');
  if (d.document_id) await own('documents', d.document_id, req.companyId, 'id');
  const out = await tx(async (db) => {
    await db.query('select id from premium_installments where id = $1 and company_id = $2 for update', [idParam(req.params.id), req.companyId]);
    const i = await loadInstallment(req, req.params.id, db);
    if (['cancelada', 'restituida'].includes(i.status)) throw conflict('Parcela cancelada/restituída.');
    if (d.kind === 'confirmado' && d.amount_cents > i.balance_cents) throw conflict(`O valor confirmado passa do saldo da parcela (${brl(i.balance_cents)}). Diferenças vão para "em divergência".`, { code: 'OVER_BALANCE' });
    if (d.confirms_payment_id) {
      const { rows: [inf] } = await db.query(`select * from premium_payments where id = $1 and company_id = $2 and installment_id = $3 and kind = 'informado' and voided_at is null`, [d.confirms_payment_id, req.companyId, i.id]);
      if (!inf) throw notFound('Pagamento informado não encontrado.');
    }
    const { rows: [pay] } = await db.query(`insert into premium_payments (company_id, installment_id, kind, amount_cents, paid_date, source, evidence, document_id, confirms_payment_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.companyId, i.id, d.kind, d.amount_cents, d.paid_date, d.source, d.evidence || null, d.document_id || null, d.confirms_payment_id || null, req.user.id]);
    await db.query('update premium_installments set last_update_at = now(), reminders_paused = $3 where id = $1 and company_id = $2', [i.id, req.companyId, d.kind === 'informado']);
    if (d.kind === 'informado') {
      await db.query(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, entity, entity_id, auto_key, created_by)
         values ($1,$2,'parcela','normal',now() + interval '2 days',null,$3,'premium_installment',$4,$5,$6) on conflict do nothing`,
      [req.companyId, `Conferir pagamento informado: parcela ${i.number} da apólice ${i.policy_number || ''}`, i.client_id, i.id, `conferir-pagto:${pay.id}`, req.user.id]);
      await emit(db, req.companyId, 'PremiumPaymentReported', 'premium_installment', i.id, { amount: d.amount_cents, source: d.source });
    } else {
      await emit(db, req.companyId, 'PremiumPaymentConfirmed', 'premium_installment', i.id, { amount: d.amount_cents, source: d.source });
      if (d.confirms_payment_id) await db.query(`update tasks set status = 'concluida', done_at = now() where company_id = $1 and auto_key = $2`, [req.companyId, `conferir-pagto:${d.confirms_payment_id}`]);
    }
    await logActivity(db, req, { clientId: i.client_id, entity: 'premium_installment', entityId: i.id, summary: `Parcela ${i.number}: pagamento ${d.kind} de ${brl(d.amount_cents)} (${d.source})` });
    await audit(db, req, { entity: 'premium_installment', entityId: i.id, action: `installment.payment_${d.kind}`, summary: `Parcela ${i.number}: ${d.kind} ${brl(d.amount_cents)}` });
    return pay;
  });
  res.status(201).json(out);
});

r.post('/:id/payments/:pid/void', need('installments_confirm'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const i = await loadInstallment(req, req.params.id);
  const p = await one(`update premium_payments set voided_at = now(), voided_reason = $4 where id = $1 and company_id = $2 and installment_id = $3 and voided_at is null returning *`,
    [idParam(req.params.pid), req.companyId, i.id, d.reason]);
  if (!p) throw notFound();
  await q('update premium_installments set reminders_paused = false, last_update_at = now() where id = $1', [i.id]);
  await audit(null, req, { entity: 'premium_installment', entityId: i.id, action: 'installment.payment_void', summary: `Pagamento ${p.kind} anulado`, reason: d.reason });
  res.json(p);
});

/** Estados que dependem de informação formal: renegociada, cancelada, em divergência, restituída (com devolução confirmada). */
r.post('/:id/status', need('installments_confirm'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(['renegociada', 'cancelada', 'em_divergencia', 'restituida']).nullable(), reason: z.string().trim().min(3).max(500),
    refund: z.object({ amount_cents: z.number().int().positive(), confirmed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recipient: z.string().max(200).optional(), evidence: z.string().trim().min(3).max(500) }).optional() }), req.body);
  const i = await loadInstallment(req, req.params.id);
  if (d.status === 'restituida' && !d.refund) throw new HttpError(400, 'Restituída exige a devolução confirmada (valor, data e evidência).');
  await tx(async (db) => {
    await db.query('update premium_installments set status_override = $3, status_reason = $4, last_update_at = now() where id = $1 and company_id = $2', [i.id, req.companyId, d.status, d.reason]);
    if (d.refund) {
      await db.query(`insert into premium_refunds (company_id, installment_id, amount_cents, confirmed_date, recipient, evidence, created_by) values ($1,$2,$3,$4,$5,$6,$7)`,
        [req.companyId, i.id, d.refund.amount_cents, d.refund.confirmed_date, d.refund.recipient || null, d.refund.evidence, req.user.id]);
    }
    await audit(db, req, { entity: 'premium_installment', entityId: i.id, action: 'installment.status', summary: `Parcela ${i.number}: ${d.status || 'estado calculado'}`, reason: d.reason });
  });
  res.json({ ok: true });
});

/** Lembrete: só para parcela aberta/vencida sem pagamento informado; o texto abre no aparelho (nada é enviado sozinho). */
r.post('/:id/reminder', need('installments'), async (req, res) => {
  const i = await loadInstallment(req, req.params.id);
  if (!['aberta', 'proxima_vencimento', 'vencida', 'parcial'].includes(i.status)) throw conflict('Lembrete só para parcela em aberto (pagamento informado suspende lembretes).');
  if (i.reminders_paused) throw conflict('Lembretes pausados: há pagamento em conferência.');
  const tpl = req.settings.whatsapp.installment;
  const body = tpl.replaceAll('{cliente}', i.client_name.split(' ')[0]).replaceAll('{parcela}', `${i.number}/${i.total_count || '?'}`)
    .replaceAll('{seguradora}', i.institution_name).replaceAll('{vencimento}', i.due_date.split('-').reverse().join('/')).replaceAll('{valor}', brl(i.balance_cents))
    + (i.charge_url ? `\nCobrança oficial: ${i.charge_url}` : '');
  await q(`insert into messages (company_id, client_id, channel, purpose, body, entity, entity_id, created_by, created_by_name) values ($1,$2,'whatsapp','parcela',$3,'premium_installment',$4,$5,$6)`,
    [req.companyId, i.client_id, body, i.id, req.user.id, req.user.name]);
  await logActivity(null, req, { clientId: i.client_id, kind: 'whatsapp', entity: 'premium_installment', entityId: i.id, summary: `Lembrete da parcela ${i.number} preparado` });
  res.json({ body, phone: i.client_phone });
});

export default r;
