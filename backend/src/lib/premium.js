// Parcelas do seguro (13): obrigação do segurado perante a seguradora. A corretora acompanha; não recebe.
// "Pagamento informado" (cliente/comprovante) ≠ "pagamento confirmado" (fonte oficial) — A24.
import { addDays } from '../util.js';

export const INSTALLMENT_AGG = `
  coalesce((select sum(p.amount_cents) from premium_payments p where p.company_id = i.company_id and p.installment_id = i.id and p.kind = 'confirmado' and p.voided_at is null), 0)::bigint as confirmed_cents,
  coalesce((select sum(p.amount_cents) from premium_payments p where p.company_id = i.company_id and p.installment_id = i.id and p.kind = 'informado' and p.voided_at is null
             and not exists (select 1 from premium_payments c where c.company_id = p.company_id and c.confirms_payment_id = p.id and c.voided_at is null)), 0)::bigint as informed_pending_cents,
  (select max(p.created_at) from premium_payments p where p.company_id = i.company_id and p.installment_id = i.id and p.voided_at is null) as last_payment_at`;

/** Estado da parcela (13.3) a partir dos pagamentos — saldo calculado, sem baixa integral de pagamento parcial. */
export function installmentState(i, ref, upcomingDays = 7) {
  const due = Number(i.amount_cents) + Number(i.adjustments_cents || 0);
  const confirmed = Number(i.confirmed_cents || 0);
  const informed = Number(i.informed_pending_cents || 0);
  const balance = due - confirmed;
  let status;
  if (i.status_override) status = i.status_override;
  else if (balance <= 0) status = 'pagamento_confirmado';
  else if (informed > 0) status = 'pagamento_informado';
  else if (confirmed > 0) status = 'parcial';
  else if (i.due_date < ref) status = 'vencida';
  else if (i.due_date <= addDays(ref, upcomingDays)) status = 'proxima_vencimento';
  else status = 'aberta';
  const overdueDays = balance > 0 && i.due_date < ref ? Math.round((new Date(`${ref}T12:00:00Z`) - new Date(`${i.due_date}T12:00:00Z`)) / 86400000) : 0;
  return { ...i, due_total_cents: due, balance_cents: Math.max(0, balance), status, overdue_days: overdueDays };
}
