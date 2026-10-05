// Motor financeiro: comissões (previsão, confirmação, liquidação, alocação, ajustes) e repasses (liberação,
// redução/recuperação, lotes). Funções determinísticas com aritmética inteira em centavos (14.4, 15, 16).
// Regras-chave:
//  - pagamento do prêmio pelo segurado NÃO liquida comissão (A13): só liquidações da seguradora alocam saldo;
//  - "liquidações alocadas" consideram o valor BRUTO quitado; retenção não vira saldo em aberto (A14);
//  - um depósito pode liquidar várias comissões e uma comissão pode receber várias liquidações (A16);
//  - regra de comissão/repasse é copiada (snapshot) no contrato: mudança futura não recalcula o passado (A17);
//  - estorno após repasse pago preserva o pagamento e cria ajuste recuperável separado (A18).
import { HttpError, applyRate, bad, conflict, splitEven, splitWeighted, today } from '../util.js';

export const RECEIVABLE_AGG = `
  coalesce((select sum(a.amount_cents) from commission_allocations a where a.company_id = r.company_id and a.receivable_id = r.id and a.reversed_at is null), 0)::bigint as allocated_cents,
  coalesce((select sum(x.amount_cents) from commission_adjustments x where x.company_id = r.company_id and x.receivable_id = r.id and x.kind = 'credito'), 0)::bigint as credit_cents,
  coalesce((select sum(x.amount_cents) from commission_adjustments x where x.company_id = r.company_id and x.receivable_id = r.id and x.kind in ('debito', 'estorno')), 0)::bigint as debit_cents,
  coalesce((select sum(x.amount_cents) from commission_adjustments x where x.company_id = r.company_id and x.receivable_id = r.id and x.kind = 'estorno'), 0)::bigint as reversal_cents,
  exists (select 1 from statement_lines s where s.company_id = r.company_id and s.receivable_id = r.id and s.status = 'divergente') as divergent`;

/**
 * Situação de uma comissão a receber (14.5) a partir dos valores cumulativos — não de um campo de status.
 * saldo_confirmado = confirmada + créditos − alocações − débitos (14.4)
 */
export function receivableState(r, ref = today()) {
  const confirmed = r.confirmed_cents;
  const allocated = Number(r.allocated_cents || 0);
  const credits = Number(r.credit_cents || 0);
  const debits = Number(r.debit_cents || 0);
  const due = confirmed == null ? null : confirmed + credits - debits;
  const balance = due == null ? null : due - allocated;
  let status;
  if (r.contested) status = 'contestada';
  else if (r.divergent) status = 'divergente';
  else if (confirmed == null) status = r.category === 'estimativa' ? 'estimativa' : 'prevista';
  else if (Number(r.reversal_cents || 0) > 0 && balance <= 0 && !(due > 0 && balance === 0)) status = 'estornada';
  else if (due > 0 && balance <= 0) status = 'liquidada';
  else if (allocated > 0) status = 'recebida_parcial';
  else if (r.due_date && r.due_date < ref) status = 'vencida';
  else if (r.due_date) status = 'a_vencer';
  else status = 'confirmada';
  return { ...r, due_cents: due, balance_cents: balance, status, adjusted: credits + debits > 0 };
}

/**
 * Calendário de comissão de uma apólice a partir do snapshot da regra (14.1 / 16.1):
 * base documentada × taxa, dividido em N parcelas com resíduo determinístico.
 */
export function commissionSchedule({ rule, baseCents, startDate }) {
  if (!rule) return [];
  const total = rule.kind === 'fixo' ? Number(rule.fixed_cents || 0) : applyRate(baseCents, rule.rate);
  const n = rule.schedule === 'parcelada' ? Number(rule.installments || 1) : 1;
  const parts = splitEven(total, n);
  return parts.map((amount, i) => ({ installment_no: i + 1, installments_total: n, expected_cents: amount, due_date: addMonthsSafe(startDate, i + 1) }));
}
function addMonthsSafe(ymd, m) {
  if (!ymd) return null;
  const [y, mo, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1, 12));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0, 12)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// ---------------- Repasses ----------------

/**
 * Validação dos rateios de uma apólice (15.2): percentuais da MESMA base e MESMA etapa não passam de 100%;
 * bases diferentes e valores fixos são validados pelo efeito final em dinheiro sobre a comissão de referência.
 * Devolve { ok, perGroup, moneyCents, referenceCents, problems }.
 */
export function validateSplits(splits, referenceCents) {
  const problems = [];
  const groups = {};
  for (const s of splits) {
    if (s.kind === 'percentual') {
      if (!(s.rate >= 0 && s.rate <= 100)) problems.push(`Percentual inválido para ${s.partner_name || 'participante'}.`);
      const k = `${s.base}|${s.stage}|${s.sequential ? 'seq' : 'par'}`;
      groups[k] = (groups[k] || 0) + Number(s.rate);
    }
  }
  for (const [k, sum] of Object.entries(groups)) {
    if (sum > 100.00001) problems.push(`A soma dos percentuais da base ${k.split('|')[0].replace('_', ' ')} na etapa ${k.split('|')[1]} é ${sum}% (máximo 100%).`);
  }
  // efeito em dinheiro sobre a referência (comissão bruta prevista da apólice)
  const sim = simulateRelease(splits, { grossCents: referenceCents, netCents: referenceCents });
  const moneyCents = sim.reduce((a, x) => a + x.amount_cents, 0);
  if (moneyCents > referenceCents) problems.push(`Os repasses somam ${moneyCents / 100} e ultrapassam a comissão de referência (${referenceCents / 100}).`);
  return { ok: problems.length === 0, perGroup: groups, moneyCents, referenceCents, problems, simulation: sim };
}

/**
 * Valores liberados para cada participante sobre um recebimento (15.1):
 *  - comissao_bruta: base = valor bruto liquidado;  comissao_liquida/recebimento_efetivo: base = líquido recebido;
 *  - etapa sequencial aplica sobre o restante após as etapas anteriores da mesma base (mostra o restante antes de cada etapa);
 *  - valor fixo: liberado proporcionalmente à parcela da comissão recebida (fixedShare informado pelo chamador).
 */
export function simulateRelease(splits, { grossCents, netCents, fixedShare = 1 }) {
  const ordered = [...splits].sort((a, b) => a.stage - b.stage);
  const remaining = { comissao_bruta: grossCents, comissao_liquida: netCents, recebimento_efetivo: netCents };
  const out = [];
  let stageCursor = null;
  let stageStart = { ...remaining };
  for (const s of ordered) {
    if (s.stage !== stageCursor) { stageCursor = s.stage; stageStart = { ...remaining }; }
    const fullBase = s.base === 'comissao_bruta' ? grossCents : netCents;
    const base = s.sequential ? stageStart[s.base] : fullBase;
    const amount = s.kind === 'fixo'
      ? Math.round(Number(s.fixed_cents || 0) * fixedShare)
      : applyRate(base, s.rate);
    out.push({ policy_split_id: s.id, partner_id: s.partner_id, base_cents: base, remaining_before_cents: stageStart[s.base], amount_cents: amount });
    remaining[s.base] -= amount;
  }
  return out;
}

/** Repasse a reverter em um estorno de comissão (16.3): regra proporcional sobre o valor estornado. */
export function reversalFor(split, reversalCents) {
  if (split.reversal === 'nenhuma') return 0;
  if (split.kind === 'fixo') return 0; // valor fixo: recuperação só por ajuste manual com fundamento
  return applyRate(reversalCents, split.rate);
}

/**
 * Libera repasses de uma alocação de liquidação (consumidor idempotente: índice único por alocação+participante).
 */
export async function releaseSplitsForAllocation(db, companyId, { allocation, receivable, settlement }) {
  const { rows: splits } = await db.query(
    `select ps.id, ps.partner_id, ps.snapshot from policy_splits ps where ps.company_id = $1 and ps.policy_id = $2`, [companyId, receivable.policy_id]);
  if (!splits.length) return [];
  const rules = splits.map((s) => ({ id: s.id, partner_id: s.partner_id, ...s.snapshot }));
  // líquido proporcional desta alocação dentro da liquidação (retenção/deduções informadas)
  const netShare = settlement.gross_cents ? Math.round((allocation.amount_cents * settlement.net_cents) / settlement.gross_cents) : 0;
  // parcela da comissão total da apólice coberta por esta alocação (para valores fixos)
  const { rows: [tot] } = await db.query(
    `select coalesce(sum(coalesce(confirmed_cents, expected_cents)), 0)::bigint as total from commission_receivables where company_id = $1 and policy_id = $2`,
    [companyId, receivable.policy_id]);
  const fixedShare = Number(tot.total) > 0 ? allocation.amount_cents / Number(tot.total) : 0;
  const advanced = rules.filter((r) => r.release === 'antecipado').map((r) => r.id);
  const sim = simulateRelease(rules.filter((r) => !advanced.includes(r.id)), { grossCents: allocation.amount_cents, netCents: netShare, fixedShare });
  const created = [];
  for (const x of sim) {
    if (x.amount_cents <= 0) continue;
    // valor fixo nunca ultrapassa o total contratado
    const rule = rules.find((r) => r.id === x.policy_split_id);
    let amount = x.amount_cents;
    if (rule.kind === 'fixo') {
      const { rows: [done] } = await db.query(`select coalesce(sum(amount_cents),0)::bigint as v from split_accruals where company_id=$1 and policy_split_id=$2 and amount_cents > 0 and status <> 'compensada'`, [companyId, x.policy_split_id]);
      amount = Math.max(0, Math.min(amount, Number(rule.fixed_cents) - Number(done.v)));
      if (!amount) continue;
    }
    const { rows: [a] } = await db.query(
      `insert into split_accruals (company_id, policy_split_id, partner_id, policy_id, receivable_id, allocation_id, base_cents, amount_cents, kind, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'liberacao',$9)
       on conflict do nothing returning *`,
      [companyId, x.policy_split_id, x.partner_id, receivable.policy_id, receivable.id, allocation.id, x.base_cents, amount,
        `Liberado pelo recebimento de ${(allocation.amount_cents / 100).toFixed(2)} (base ${rule.base.replace('_', ' ')}${rule.sequential ? `, restante antes da etapa ${(x.remaining_before_cents / 100).toFixed(2)}` : ''})`]);
    if (a) created.push(a);
  }
  return created;
}

/**
 * Efeito de um estorno de comissão sobre os repasses (15.3): reduz o saldo ainda não pago e, se o valor já foi pago,
 * cria um ajuste recuperável separado — o pagamento original é preservado; nada é debitado da conta do parceiro.
 */
export async function applyReversalToSplits(db, companyId, { adjustment, receivable }) {
  const { rows: splits } = await db.query(
    `select ps.id, ps.partner_id, ps.snapshot from policy_splits ps where ps.company_id = $1 and ps.policy_id = $2`, [companyId, receivable.policy_id]);
  const out = [];
  for (const s of splits) {
    const rule = { id: s.id, partner_id: s.partner_id, ...s.snapshot };
    const target = reversalFor(rule, adjustment.amount_cents);
    if (target <= 0) continue;
    const { rows: [bal] } = await db.query(
      `select coalesce(sum(amount_cents) filter (where status = 'liberada'), 0)::bigint as unpaid,
              coalesce(sum(amount_cents) filter (where status in ('paga', 'em_lote')), 0)::bigint as paid
         from split_accruals where company_id = $1 and policy_split_id = $2`, [companyId, s.id]);
    const unpaid = Math.max(0, Number(bal.unpaid));
    const reduce = Math.min(unpaid, target);
    const recover = target - reduce;
    if (reduce > 0) {
      const { rows: [a] } = await db.query(
        `insert into split_accruals (company_id, policy_split_id, partner_id, policy_id, receivable_id, adjustment_id, base_cents, amount_cents, kind, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'reducao',$9) on conflict do nothing returning *`,
        [companyId, s.id, s.partner_id, receivable.policy_id, receivable.id, adjustment.id, adjustment.amount_cents, -reduce,
          `Redução do repasse ainda não pago pelo estorno de ${(adjustment.amount_cents / 100).toFixed(2)}`]);
      if (a) out.push(a);
    }
    if (recover > 0) {
      const { rows: [a] } = await db.query(
        `insert into split_accruals (company_id, policy_split_id, partner_id, policy_id, receivable_id, adjustment_id, base_cents, amount_cents, kind, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'recuperacao',$9) on conflict do nothing returning *`,
        [companyId, s.id, s.partner_id, receivable.policy_id, receivable.id, adjustment.id, adjustment.amount_cents, -recover,
          `Valor recuperável: repasse já pago e comissão estornada (${(adjustment.amount_cents / 100).toFixed(2)}). Compensação só com autorização.`]);
      if (a) out.push(a);
    }
  }
  return out;
}

/** Saldo de comissão travado para alteração concorrente (FOR UPDATE) com agregados. */
export async function lockReceivable(db, companyId, id) {
  const { rows: [base] } = await db.query('select * from commission_receivables where id = $1 and company_id = $2 for update', [id, companyId]);
  if (!base) throw new HttpError(404, 'Comissão não encontrada.');
  const { rows: [r] } = await db.query(`select r.*, ${RECEIVABLE_AGG} from commission_receivables r where r.id = $1 and r.company_id = $2`, [id, companyId]);
  return receivableState(r);
}

/**
 * Cria uma liquidação com alocações (17.1): soma das alocações = bruto liquidado; cada alocação ≤ saldo confirmado.
 * Devolve { settlement, allocations, accruals }.
 */
export async function createSettlement(db, req, d, { nextNumber, emit, audit }) {
  const net = d.gross_cents - d.retention_cents - d.deductions_cents;
  if (net < 0) throw bad('Retenções e deduções não podem passar do valor bruto.');
  const sum = d.allocations.reduce((a, x) => a + x.amount_cents, 0);
  if (sum !== d.gross_cents) throw bad(`As alocações (${(sum / 100).toFixed(2)}) precisam fechar exatamente o valor bruto liquidado (${(d.gross_cents / 100).toFixed(2)}).`, { code: 'ALLOCATION_MISMATCH' });
  const seen = new Set();
  const recs = [];
  // travas sempre na mesma ordem (id da comissão): liquidações simultâneas com as mesmas comissões em ordens
  // diferentes esperam uma pela outra em vez de entrar em deadlock
  const ordered = [...d.allocations].sort((a, b) => (a.receivable_id < b.receivable_id ? -1 : a.receivable_id > b.receivable_id ? 1 : 0));
  for (const a of ordered) {
    if (seen.has(a.receivable_id)) throw bad('Uma comissão aparece duas vezes nas alocações.');
    seen.add(a.receivable_id);
    let r = await lockReceivable(db, req.companyId, a.receivable_id);
    const { rows: [pol] } = await db.query('select institution_id, client_id from policies where id = $1 and company_id = $2', [r.policy_id, req.companyId]);
    if (pol.institution_id !== d.institution_id) throw bad('A comissão alocada é de outra seguradora.');
    if (r.confirmed_cents == null) {
      if (!d.confirm_missing) throw conflict('Há comissão ainda não confirmada. Confirme o valor antes de baixar a liquidação.', { code: 'NOT_CONFIRMED', receivable_id: r.id });
      await db.query(`update commission_receivables set confirmed_cents = expected_cents, confirmed_at = now(), confirmation_source = $3
                      where id = $1 and company_id = $2`, [r.id, req.companyId, `confirmada pela liquidação de ${d.settled_date}`]);
      r = await lockReceivable(db, req.companyId, a.receivable_id);
    }
    if (a.amount_cents > r.balance_cents) {
      throw conflict(`A alocação de ${(a.amount_cents / 100).toFixed(2)} passa do saldo confirmado (${(r.balance_cents / 100).toFixed(2)}). Diferença vai para revisão: registre ajuste com fundamento ou contestação.`, { code: 'OVER_BALANCE', receivable_id: r.id });
    }
    recs.push({ r, amount: a.amount_cents });
  }
  const number = await nextNumber(db, req.companyId, 'settlement');
  const { rows: [st] } = await db.query(
    `insert into commission_settlements (company_id, number, institution_id, settled_date, gross_cents, retention_cents, retention_nature, deductions_cents, net_cents, source, reference, notes, import_file_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [req.companyId, number, d.institution_id, d.settled_date, d.gross_cents, d.retention_cents, d.retention_nature || null, d.deductions_cents, net,
      d.source || 'manual', d.reference || null, d.notes || null, d.import_file_id || null, req.user.id]);
  const allocations = [];
  const accruals = [];
  for (const { r, amount } of recs) {
    const { rows: [al] } = await db.query(
      'insert into commission_allocations (company_id, settlement_id, receivable_id, amount_cents) values ($1,$2,$3,$4) returning *',
      [req.companyId, st.id, r.id, amount]);
    allocations.push(al);
    accruals.push(...await releaseSplitsForAllocation(db, req.companyId, { allocation: al, receivable: r, settlement: st }));
  }
  if (d.retention_cents > 0) {
    await db.query('insert into tax_withholdings (company_id, settlement_id, amount_cents, nature, notes) values ($1,$2,$3,$4,$5)',
      [req.companyId, st.id, d.retention_cents, d.retention_nature || 'Retenção informada pela fonte', 'Natureza e tratamento fiscal conforme orientação contábil']);
  }
  // receita de comissão no financeiro próprio: valor líquido recebido (o bruto e a retenção ficam na liquidação)
  if (net > 0) {
    await db.query(
      `insert into cash_entries (company_id, kind, category, description, amount_cents, competence, due_date, paid_date, status, source, source_id, created_by)
       values ($1,'receber','Comissões',$2,$3,$4,$4,$4,'pago','comissao',$5,$6)`,
      [req.companyId, `Liquidação de comissão nº ${number}`, net, d.settled_date, st.id, req.user.id]);
  }
  await emit(db, req.companyId, 'CommissionSettlementConfirmed', 'commission_settlement', st.id, { gross: d.gross_cents, net, allocations: allocations.length });
  for (const a of accruals) await emit(db, req.companyId, 'SplitReleased', 'split_accrual', a.id, { amount: a.amount_cents });
  await audit(db, req, { entity: 'commission_settlement', entityId: st.id, action: 'settlement.create',
    summary: `Liquidação nº ${number}: bruto ${(d.gross_cents / 100).toFixed(2)}, retenção ${(d.retention_cents / 100).toFixed(2)}, líquido ${(net / 100).toFixed(2)} em ${allocations.length} comissão(ões)` });
  return { settlement: st, allocations, accruals };
}

export { splitWeighted };
