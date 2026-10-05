// Painel de parcelas do seguro (13.5). Submódulo separado das contas a receber da corretora:
// o prêmio é pago à seguradora; a corretora acompanha, comunica e confere. Informado ≠ confirmado.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, Bell, ExternalLink, Info, Clock, Download, CalendarClock } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, fmtDateTime, ymd, addDaysYmd, downloadCSV, INSTALLMENT_STATUS } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { PageHeader, Tabs, Input, Select, StatusChip, Notice, Empty, Loading, cx, useFetch } from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { PaymentModal, ReminderModal, PREMIUM_BANNER } from './Policies';

const QUEUES = {
  vencidas: { label: 'Vencidas', status: ['vencida'] },
  proximas: { label: 'Próximas', status: ['proxima_vencimento'] },
  informado: { label: 'Pagamento informado (conferência)', status: ['pagamento_informado'] },
  divergencia: { label: 'Em divergência', status: ['em_divergencia'] },
  todas: { label: 'Todas', status: null },
};
const queueFor = (list) => Object.entries(QUEUES).find(([, q]) => q.status && list.length === q.status.length && q.status.every((s) => list.includes(s)))?.[0];

/** Faixa de idade da atualização: estado antigo não pode parecer tempo real (13.4). */
function Staleness({ hours, at }) {
  const h = Number(hours) || 0;
  const label = h < 1 ? 'há menos de 1 h' : h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', h > 72 ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-ink-faint')} title={at ? `Última atualização: ${fmtDateTime(at)}` : undefined}>
      <Clock className="h-3 w-3" /> atualizado {label}
    </span>
  );
}

export default function Installments() {
  const { can } = useAuth();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const initial = (params.get('status') || '').split(',').filter(Boolean);
  const [queue, setQueue] = useState(() => (initial.length ? queueFor(initial) || 'todas' : 'vencidas'));
  const [multi, setMulti] = useState(() => (initial.length && !queueFor(initial) ? initial : []));
  const [f, setF] = useState({ from: params.get('from') || '', to: params.get('to') || '', institution_id: params.get('institution_id') || '', client_id: params.get('client_id') || '' });
  const [act, setAct] = useState(null);
  const { data: insts } = useFetch(() => api.get('/v1/catalog/institutions'), []);

  const statuses = queue === 'todas' ? multi : QUEUES[queue].status;
  const query = { ...f, status: statuses.join(',') };
  useEffect(() => {
    setParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v)), { replace: true });
  }, [JSON.stringify(query)]); // eslint-disable-line
  const { data, loading, reload } = useFetch(() => api.get(`/v1/premium-installments${qs(query)}`), [JSON.stringify(query)]);
  const items = data?.items || [];
  const t = useTable(items, { sort: queue === 'vencidas' ? 'overdue_days' : 'due_date', dir: queue === 'vencidas' ? 'desc' : 'asc' });

  const bands = settings?.installments?.agingBands || [15, 30, 60];
  const bandKeys = [`1-${bands[0]}`, `${bands[0] + 1}-${bands[1]}`, `${bands[1] + 1}-${bands[2]}`, `${bands[2] + 1}+`];
  const totals = useMemo(() => ({
    balance: items.reduce((a, x) => a + Number(x.balance_cents || 0), 0),
    stale: items.filter((x) => Number(x.hours_since_update) > 72).length,
  }), [items]);
  const toggleStatus = (s) => setMulti((m) => (m.includes(s) ? m.filter((x) => x !== s) : [...m, s]));
  const exportCsv = () => downloadCSV('parcelas.csv', items.map((x) => ({
    cliente: x.client_name, apolice: x.policy_number || '', seguradora: x.institution_name, parcela: `${x.number}/${x.total_count || ''}`, vencimento: x.due_date,
    valor: (x.due_total_cents / 100).toFixed(2).replace('.', ','), saldo: (x.balance_cents / 100).toFixed(2).replace('.', ','),
    situacao: INSTALLMENT_STATUS[x.status]?.label || x.status, dias_atraso: x.overdue_days, responsavel: x.owner_name || '', horas_desde_atualizacao: x.hours_since_update,
  })));

  return (
    <div>
      <PageHeader title="Parcelas do seguro" subtitle="Acompanhamento do prêmio pago pelos clientes às seguradoras — separado das receitas da corretora"
        actions={<button className="btn-ghost" onClick={exportCsv} disabled={!items.length}><Download className="h-4 w-4" /> CSV</button>} />
      <Notice tone="info" className="mb-4"><Info className="mr-1 inline h-4 w-4" />{PREMIUM_BANNER}</Notice>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {bandKeys.map((k) => (
          <div key={k} className="card p-4">
            <div className="text-xs font-medium text-ink-faint">Atraso {k.replace('+', ' ou mais')} dias</div>
            <div className={cx('mt-2 text-lg font-semibold tabular-nums', data?.aging?.[k] ? 'text-red-700 dark:text-red-300' : '')}>{money(data?.aging?.[k] || 0)}</div>
            <div className="text-xs text-ink-faint">saldo em atraso (filtro atual)</div>
          </div>
        ))}
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Saldo das parcelas listadas</div>
          <div className="mt-2 text-lg font-semibold tabular-nums">{money(totals.balance)}</div>
          <div className="text-xs text-ink-faint">{items.length} parcela(s)</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Sem atualização há +72 h</div>
          <div className={cx('mt-2 text-lg font-semibold tabular-nums', totals.stale ? 'text-amber-700 dark:text-amber-300' : '')}>{totals.stale}</div>
          <div className="text-xs text-ink-faint">confira na fonte antes de cobrar</div>
        </div>
      </div>

      <Tabs tabs={Object.entries(QUEUES).map(([value, q]) => ({ value, label: q.label }))} value={queue} onChange={setQueue} />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Vencimento de" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input label="até" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Select label="Seguradora" value={f.institution_id} onChange={(e) => setF({ ...f, institution_id: e.target.value })}>
          <option value="">Todas</option>{(insts || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-ghost" onClick={() => setF({ ...f, from: ymd(), to: addDaysYmd(30) })}><CalendarClock className="h-4 w-4" /> Próximos 30 dias</button>
          {(f.from || f.to || f.institution_id || f.client_id) && <button className="btn-ghost" onClick={() => setF({ from: '', to: '', institution_id: '', client_id: '' })}>Limpar</button>}
        </div>
        {queue === 'todas' && (
          <fieldset className="sm:col-span-2 lg:col-span-4">
            <legend className="label">Situação (nenhuma marcada = todas)</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(INSTALLMENT_STATUS).map(([k, v]) => (
                <label key={k} className={cx('chip cursor-pointer border', multi.includes(k) ? cx(v.cls, 'border-current') : 'border-line bg-surface text-ink-soft')}>
                  <input type="checkbox" className="sr-only" checked={multi.includes(k)} onChange={() => toggleStatus(k)} />{v.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      {data?.note && <p className="mb-2 text-xs text-ink-faint">{data.note}</p>}
      {loading && !data ? <Loading /> : !items.length ? (
        <div className="card"><Empty icon={CreditCard} title="Nenhuma parcela nesta fila" text={queue === 'informado' ? 'Não há pagamentos informados aguardando conferência.' : undefined} /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="client_name">Cliente</SortTh><SortTh t={t} k="policy_number">Apólice</SortTh><SortTh t={t} k="institution_name">Seguradora</SortTh>
              <th>Parcela</th><SortTh t={t} k="due_date">Vencimento</SortTh><SortTh t={t} k="balance_cents" className="text-right">Saldo</SortTh>
              <SortTh t={t} k="overdue_days">Situação</SortTh><SortTh t={t} k="owner_name">Responsável</SortTh><SortTh t={t} k="hours_since_update">Atualização</SortTh><th />
            </tr></thead>
            <tbody>{t.rows.map((x) => (
              <tr key={x.id}>
                <td className="font-medium">{x.client_name}{x.client_phone && <div className="text-xs font-normal text-ink-faint">{x.client_phone}</div>}</td>
                <td><Link to={`/apolices/${x.policy_id}?tab=parcelas`} className="text-primary hover:underline">{x.policy_number || '(sem número)'}</Link></td>
                <td>{x.institution_name}</td>
                <td className="whitespace-nowrap">{x.number}/{x.total_count || '?'}{x.endorsement_id && <div className="text-xs text-ink-faint">endosso</div>}</td>
                <td className="whitespace-nowrap">{fmt(x.due_date)}</td>
                <td className="text-right tabular-nums">
                  <div className="font-medium">{money(x.balance_cents)}</div>
                  {Number(x.balance_cents) !== Number(x.due_total_cents) && <div className="text-xs text-ink-faint">de {money(x.due_total_cents)}</div>}
                  {Number(x.informed_pending_cents) > 0 && <div className="text-xs text-violet-700 dark:text-violet-300">informado {money(x.informed_pending_cents)}</div>}
                </td>
                <td>
                  <StatusChip map={INSTALLMENT_STATUS} value={x.status} />
                  {x.overdue_days > 0 && <div className="text-xs text-red-600">{x.overdue_days} dia(s) · faixa {x.aging_band}</div>}
                  {x.status_reason && <div className="max-w-[12rem] text-xs text-ink-faint">{x.status_reason}</div>}
                </td>
                <td>{x.owner_name || '—'}</td>
                <td><Staleness hours={x.hours_since_update} at={x.last_update_at} />{x.source && <div className="text-xs text-ink-faint">fonte: {x.source}</div>}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    {x.charge_url && <a href={x.charge_url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-icon" title="Cobrança oficial" aria-label={`Abrir cobrança oficial da parcela ${x.number}`}><ExternalLink className="h-4 w-4" /></a>}
                    {!['cancelada', 'restituida', 'pagamento_confirmado'].includes(x.status) &&
                      <button className="btn-ghost btn-icon" title="Registrar pagamento" aria-label={`Registrar pagamento da parcela ${x.number} de ${x.client_name}`} onClick={() => setAct({ kind: 'pay', inst: x })}><CreditCard className="h-4 w-4" /></button>}
                    {['aberta', 'proxima_vencimento', 'vencida', 'parcial'].includes(x.status) && !x.reminders_paused &&
                      <button className="btn-ghost btn-icon" title="Lembrete por WhatsApp" aria-label={`Lembrete da parcela ${x.number} de ${x.client_name}`} onClick={() => setAct({ kind: 'remind', inst: x })}><Bell className="h-4 w-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      {!can('installments_confirm') && <p className="mt-3 text-xs text-ink-faint">Seu perfil registra pagamentos informados; a confirmação pela fonte oficial exige permissão de conferência.</p>}
      {act?.kind === 'pay' && <PaymentModal inst={act.inst} clientId={act.inst.client_id} onClose={() => setAct(null)} onDone={() => { setAct(null); reload(); }} />}
      {act?.kind === 'remind' && <ReminderModal inst={act.inst} onClose={() => setAct(null)} />}
    </div>
  );
}
