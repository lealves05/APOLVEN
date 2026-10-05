import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, ExternalLink, FileText, RefreshCw, ShieldCheck, XCircle, ArrowUpDown, Receipt } from 'lucide-react';
import { api } from '../lib/api';
import { moneyReais as money, fmt } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Loading, Empty, Modal, Select, Tabs, useFetch, useAction, FAIL } from '../components/ui';
import { StatusChip, PlanPicker, priceFor, PAYMENT_STATUS_LABEL, CYCLE_LABEL, TRIAL_LABEL, REASON_LABEL } from '../components/Billing';

/** Abre a página segura de pagamento do gateway (o cartão nunca passa pelo APOLVEN nem pela central). */
const openCheckout = (url) => { if (url && /^https:\/\//.test(url)) window.location.assign(url); };

export default function Subscription({ autoContract = false }) {
  const { refresh, user } = useAuth();
  const { confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'resumo';
  const { data, loading, reload } = useFetch(() => api.get('/v1/billing'), []);
  // voltando da página de pagamento: confere a situação na central
  useEffect(() => { api.post('/v1/billing/refresh').then(() => refresh()).catch(() => {}); }, []); // eslint-disable-line
  const [run, busy] = useAction();
  const [pick, setPick] = useState(null); // { mode: 'checkout'|'change', plan, cycle }
  const [autoDone, setAutoDone] = useState(false);
  // teste encerrado: já abre a escolha do plano
  useEffect(() => {
    if (!autoContract || autoDone || !data || data.restricted || !data.gateway_configured || !data.plans?.length) return;
    const active = data.subscription && ['ACTIVE', 'PAST_DUE'].includes(data.subscription.status);
    if (!active && !data.pending_payment) setPick({ mode: 'checkout', plan: data.access.plan?.id || data.plans[0].id, cycle: data.access.cycle || 'MONTHLY' });
    setAutoDone(true);
  }, [autoContract, autoDone, data]);

  if (loading && !data) return <Loading />;
  if (!data) return <Empty title="Não foi possível carregar a assinatura" />;
  const a = data.access;
  if (data.restricted) {
    return (
      <div>
        <PageHeader title="Assinatura e plano" />
        <div className="card p-5 text-sm">Situação: <StatusChip status={a.status} /> — somente o proprietário ou um administrador gerencia a assinatura.</div>
      </div>
    );
  }
  const sub = data.subscription;
  const activeSub = sub && ['ACTIVE', 'PAST_DUE'].includes(sub.status) ? sub : null;
  const pending = data.pending_payment;
  const gw = data.gateway_configured;
  const after = async () => { await reload(); await refresh(); };

  const checkout = async () => {
    const r = await run(() => api.post('/v1/billing/checkout', { plan_id: pick.plan, cycle: pick.cycle }));
    if (r === FAIL) return;
    setPick(null);
    if (r.checkout_url) openCheckout(r.checkout_url); else after();
  };
  const changePlan = async () => {
    const r = await run(() => api.post('/v1/billing/change-plan', { plan_id: pick.plan }), 'Plano alterado. O novo valor vale a partir da próxima cobrança.');
    if (r !== FAIL) { setPick(null); after(); }
  };
  const renew = async () => {
    const r = await run(() => api.post('/v1/billing/renew'));
    if (r !== FAIL) { if (r.checkout_url) openCheckout(r.checkout_url); else after(); }
  };
  const cancel = async () => {
    const ok = await confirm({ title: 'Cancelar assinatura?', message: 'Você continua usando o sistema até o fim do período já pago. Depois disso o acesso é suspenso, mas nenhum dado é apagado.', confirmText: 'Cancelar assinatura' });
    if (!ok) return;
    const r = await run(() => api.post('/v1/billing/cancel', { confirm: true }), 'Assinatura cancelada ao fim do período.');
    if (r !== FAIL) after();
  };

  const info = [
    ['Situação', <StatusChip key="s" status={a.status} />],
    ['Plano', a.plan?.name || sub?.plan_name || '—'],
    ['Ciclo', CYCLE_LABEL[a.cycle] || '—'],
    ['Valor', sub ? money(sub.value) : '—'],
    ['Próxima cobrança', activeSub?.next_charge_at && !activeSub.cancel_at_period_end ? fmt(activeSub.next_charge_at) : '—'],
    ['Válido até', a.valid_until ? fmt(a.valid_until) : '—'],
    ['Forma de pagamento', sub?.card_last4 ? `${sub.card_brand || 'Cartão'} •••• ${sub.card_last4}` : '—'],
  ];
  if (a.trial) info.push(['Período de teste', `${TRIAL_LABEL[a.trial.type] || a.trial.type}${a.trial.days_left != null ? ` · ${Math.max(0, a.trial.days_left)} dia(s) restantes` : ''}`]);
  if (a.reason) info.push(['Motivo', REASON_LABEL[a.reason] || a.reason]);

  return (
    <div>
      <PageHeader title="Assinatura e plano" subtitle="Contratação, cobranças e recibos da sua corretora no APOLVEN."
        actions={<button className="btn-ghost" onClick={after}><RefreshCw className="h-4 w-4" /> Atualizar</button>} />
      {!gw && (
        <div className="mb-4 rounded-app-sm border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-100">
          A cobrança on-line ainda não está disponível. Fale com o suporte{data.support ? ` (${data.support})` : ''} para contratar.
        </div>
      )}
      <Tabs value={tab} onChange={(v) => setParams(v === 'resumo' ? {} : { tab: v })}
        tabs={[{ value: 'resumo', label: 'Resumo' }, { value: 'pagamento', label: 'Pagamento' }, { value: 'historico', label: 'Histórico' }]} />

      {tab === 'resumo' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {info.map(([k, v]) => (<div key={k}><dt className="text-xs text-ink-faint">{k}</dt><dd className="mt-0.5 text-sm font-medium">{v}</dd></div>))}
            </dl>
            {activeSub?.cancel_at_period_end && <p className="mt-4 text-sm text-ink-soft">Cancelamento agendado: o acesso termina em {fmt(a.valid_until)}.</p>}
          </div>
          <div className="card flex flex-col gap-2 p-5">
            <h2 className="mb-1 text-sm font-semibold">Ações</h2>
            {pending && (
              <a className="btn-primary" href={pending.invoice_url} target="_blank" rel="noreferrer noopener">
                <CreditCard className="h-4 w-4" /> Pagar cobrança pendente ({money(pending.amount)})
              </a>
            )}
            {!activeSub && gw && data.plans.length > 0 && (
              <button className="btn-primary" disabled={busy} onClick={() => setPick({ mode: 'checkout', plan: a.plan?.id || data.plans[0].id, cycle: a.cycle || 'MONTHLY' })}>
                <ShieldCheck className="h-4 w-4" /> Contratar plano
              </button>
            )}
            {activeSub?.cycle === 'ANNUAL' && gw && <button className="btn-outline" disabled={busy} onClick={renew}><RefreshCw className="h-4 w-4" /> Renovar plano anual</button>}
            {activeSub?.cycle === 'MONTHLY' && !activeSub.cancel_at_period_end && gw && (
              <button className="btn-outline" disabled={busy} onClick={() => setPick({ mode: 'change', plan: activeSub.plan_id, cycle: 'MONTHLY' })}>
                <ArrowUpDown className="h-4 w-4" /> Alterar plano
              </button>
            )}
            {activeSub && !activeSub.cancel_at_period_end && user.role === 'owner' && (
              <button className="btn-ghost text-red-600" disabled={busy} onClick={cancel}><XCircle className="h-4 w-4" /> Cancelar assinatura</button>
            )}
            {!pending && !activeSub && !gw && <p className="text-sm text-ink-faint">Nenhuma ação disponível no momento.</p>}
          </div>
        </div>
      )}

      {tab === 'pagamento' && (
        <div className="card max-w-2xl p-5 text-sm">
          <h2 className="font-semibold">Forma de pagamento</h2>
          <p className="mt-1 text-ink-soft">
            {sub?.card_last4 ? `Cartão cadastrado: ${sub.card_brand || 'Cartão'} •••• ${sub.card_last4}.` : 'Nenhum cartão salvo.'}{' '}
            Os dados de cartão são informados apenas na página segura do gateway de pagamento — a plataforma guarda somente a bandeira e os 4 últimos dígitos.
          </p>
          {data.provider === 'mercadopago' ? (
            <p className="mt-3 text-ink-soft">Plano <b>mensal</b>: a cobrança é automática no cartão autorizado no Mercado Pago. Para trocar o cartão, entre na sua conta do Mercado Pago › <b>Assinaturas</b> e altere o meio de pagamento da assinatura “APOLVEN”.
              Plano <b>anual</b>: pagamento único por Pix, boleto ou cartão, escolhido na página do Mercado Pago.</p>
          ) : (
            <p className="mt-3 text-ink-soft">Para trocar a forma de pagamento (cartão, Pix ou boleto), abra a cobrança pendente e escolha a nova forma. Nas próximas cobranças mensais, a forma usada no último pagamento é mantida.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {pending
              ? <a className="btn-primary" href={pending.invoice_url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" /> Abrir cobrança pendente</a>
              : <span className="text-ink-faint">Não há cobrança pendente agora. A troca poderá ser feita na próxima fatura.</span>}
          </div>
        </div>
      )}

      {tab === 'historico' && (
        <div className="card overflow-x-auto">
          {!data.payments.length ? <Empty icon={Receipt} title="Nenhuma cobrança ainda" /> : (
            <table className="table-clean min-w-[640px]">
              <thead><tr><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Período</th><th>Pago em</th><th /></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmt(p.due_date)}</td>
                    <td className="tabular-nums">{money(p.amount)}</td>
                    <td>{PAYMENT_STATUS_LABEL[p.status] || p.status}</td>
                    <td className="text-xs text-ink-faint">{p.period_start ? `${fmt(p.period_start)} – ${fmt(p.period_end)}` : '—'}</td>
                    <td>{p.paid_at ? fmt(p.paid_at) : '—'}</td>
                    <td className="text-right">
                      {p.receipt_url && <a className="btn-ghost" href={p.receipt_url} target="_blank" rel="noreferrer noopener"><FileText className="h-4 w-4" /> Recibo</a>}
                      {!p.receipt_url && p.invoice_url && ['PENDING', 'OVERDUE'].includes(p.status) && <a className="btn-ghost" href={p.invoice_url} target="_blank" rel="noreferrer noopener">Pagar</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal open={!!pick} onClose={() => setPick(null)} size="lg" title={pick?.mode === 'change' ? 'Alterar plano' : 'Contratar plano'}
        subtitle={pick?.mode === 'change' ? 'O novo valor é aplicado a partir da próxima cobrança mensal.' : 'Você será levado à página segura de pagamento.'}
        footer={<>
          <button className="btn-ghost" onClick={() => setPick(null)}>Voltar</button>
          <button className="btn-primary" disabled={busy || !pick?.plan || !priceFor(data.plans.find((p) => p.id === pick?.plan), pick?.cycle)}
            onClick={pick?.mode === 'change' ? changePlan : checkout}>{pick?.mode === 'change' ? 'Confirmar alteração' : 'Ir para o pagamento'}</button>
        </>}>
        {pick && (pick.mode === 'change'
          ? <Select label="Novo plano" value={pick.plan} onChange={(e) => setPick({ ...pick, plan: e.target.value })}>
              {data.plans.filter((p) => priceFor(p, 'MONTHLY')).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.monthly_price)}/mês</option>)}
            </Select>
          : <PlanPicker plans={data.plans} value={pick.plan} cycle={pick.cycle} onChange={(plan) => setPick({ ...pick, plan })} onCycle={(cycle) => setPick({ ...pick, cycle })} />)}
      </Modal>
    </div>
  );
}
