// Esteira de renovação (12): vencimentos agrupados por janela, oportunidade de renovação e contato.
// Os marcos de alerta são sugestões de rotina comercial, não prazos legais.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Repeat, MessageCircle, Calculator, BellRing, AlertTriangle, Users, TrendingDown, Loader } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, ago, waLink, fillTemplate, STAGES, BRANCHES } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { PageHeader, Section, Stat, Select, StatusChip, Notice, Empty, Loading, cx, useFetch, useAction, FAIL } from '../components/ui';

const WINDOWS = [
  { key: 'vencidas', label: 'Vencidas (até 30 dias)', test: (d) => d < 0, tone: 'text-red-700 dark:text-red-300' },
  { key: '0-15', label: '0 a 15 dias', test: (d) => d >= 0 && d <= 15, tone: 'text-red-700 dark:text-red-300' },
  { key: '16-30', label: '16 a 30 dias', test: (d) => d >= 16 && d <= 30, tone: 'text-amber-700 dark:text-amber-300' },
  { key: '31-60', label: '31 a 60 dias', test: (d) => d >= 31 && d <= 60, tone: 'text-amber-700 dark:text-amber-300' },
  { key: '61-90', label: '61 a 90 dias', test: (d) => d >= 61 && d <= 90, tone: '' },
  { key: '90+', label: 'Mais de 90 dias', test: (d) => d > 90, tone: '' },
];
const NO_CONTACT_DAYS = 30;
const closedStage = (o) => o && ['ganho', 'perdido'].includes(o.stage);

export default function Renewals() {
  const { can, branchLabel } = useAuth();
  const settings = useSettings();
  const nav = useNavigate();
  const [days, setDays] = useState(90);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/renewals${qs({ days })}`), [days]);
  const [run, busy] = useAction();
  const [working, setWorking] = useState(null);
  const rows = data || [];
  const alertDays = settings?.renewals?.alertDays || [];
  const label = (b) => (branchLabel ? branchLabel(b) : BRANCHES[b] || b);

  const noContact = (r) => !r.last_contact || (Date.now() - new Date(r.last_contact).getTime()) / 86400000 > NO_CONTACT_DAYS;
  const kpi = useMemo(() => {
    const open = rows.filter((r) => !r.renewed_by);
    const exposed = open.filter((r) => !r.opportunity || r.opportunity.stage === 'perdido');
    return {
      exposed: exposed.length, exposedPremium: exposed.reduce((a, r) => a + Number(r.total_premium_cents || 0), 0),
      progress: open.filter((r) => r.opportunity && !closedStage(r.opportunity)).length,
      noContact: open.filter(noContact).length, renewed: rows.filter((r) => r.renewed_by).length,
    };
  }, [rows]);
  const groups = WINDOWS.map((w) => ({ ...w, rows: rows.filter((r) => w.test(Number(r.days_left))) })).filter((g) => g.rows.length);

  const startRenewal = async (r, thenQuote = false) => {
    if (thenQuote && !can('renewals')) { nav(`/cotacoes/nova${qs({ client: r.client_id, branch: r.branch, renewal: r.id })}`); return; }
    setWorking(r.id);
    const o = await run(() => api.post(`/v1/renewals/${r.id}/opportunity`), thenQuote ? null : 'Renovação iniciada (oportunidade criada).');
    setWorking(null);
    if (o === FAIL) return;
    if (thenQuote) nav(`/cotacoes/nova${qs({ client: r.client_id, branch: r.branch, renewal: r.id })}`);
    else reload();
  };
  const generate = async () => {
    const r = await run(() => api.post('/v1/renewals/generate'));
    if (r !== FAIL) { reload(); }
    return r;
  };
  const [genResult, setGenResult] = useState(null);
  const wa = (r) => {
    const text = fillTemplate(settings?.whatsapp?.renewal || 'Olá {cliente}! Seu seguro {ramo} vence em {vencimento}. Vamos revisar a renovação?', {
      cliente: (r.client_name || '').split(' ')[0], ramo: label(r.branch), vencimento: fmt(r.end_date),
    });
    return waLink(r.client_phone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  return (
    <div>
      <PageHeader title="Renovações" subtitle="Vencimentos da carteira, oportunidades de renovação e contato com o cliente"
        actions={<>
          <Select aria-label="Janela" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180].map((d) => <option key={d} value={d}>Próximos {d} dias</option>)}
          </Select>
          {can('renewals') && <button className="btn-outline" disabled={busy} onClick={async () => { const r = await generate(); if (r !== FAIL) setGenResult(r.created); }}>
            <BellRing className="h-4 w-4" /> Gerar tarefas de alerta</button>}
        </>} />

      <Notice tone="info" className="mb-4">
        Marcos de alerta configurados: {alertDays.length ? alertDays.map((d) => `${d}`).join(', ') + ' dias antes do vencimento' : 'nenhum'}.
        São <b>sugestões de rotina comercial, não prazos legais</b>. A renovação revisa o risco: declarações antigas não são retransmitidas sem revisão e não há renovação automática presumida.
        {genResult != null && <span className="ml-1 font-medium">{genResult ? `${genResult} tarefa(s) de alerta criada(s).` : 'Nenhuma tarefa nova (alertas já gerados).'}</span>}
      </Notice>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Carteira exposta" value={kpi.exposed} hint={`${money(kpi.exposedPremium)} em prêmio sem renovação iniciada`} icon={TrendingDown} tone="text-red-500" />
        <Stat label="Renovações em andamento" value={kpi.progress} hint="Com oportunidade aberta" icon={Loader} tone="text-sky-500" />
        <Stat label="Clientes sem contato" value={kpi.noContact} hint={`Sem registro de contato há mais de ${NO_CONTACT_DAYS} dias`} icon={Users} tone="text-amber-500" />
        <Stat label="Já renovadas" value={kpi.renewed} hint="Nova apólice cadastrada" icon={Repeat} tone="text-emerald-500" />
      </div>

      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="card"><Empty icon={Repeat} title="Nenhum vencimento na janela" text={`Não há apólices vigentes vencendo nos próximos ${days} dias nem vencidas nos últimos 30.`} /></div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Section key={g.key} title={<span className={g.tone}>{g.label}</span>} subtitle={`${g.rows.length} apólice(s) · ${money(g.rows.reduce((a, r) => a + Number(r.total_premium_cents || 0), 0))} em prêmio`} bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="table-clean">
                  <thead><tr><th>Apólice</th><th>Cliente</th><th>Ramo / seguradora</th><th>Vencimento</th><th className="text-right">Prêmio atual</th><th>Renovação</th><th>Último contato</th><th /></tr></thead>
                  <tbody>{g.rows.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={`/apolices/${r.id}?tab=renovacao`} className="font-medium text-primary hover:underline">{r.policy_number || '(sem número)'}</Link></td>
                      <td><Link to={`/clientes/${r.client_id}`} className="hover:underline">{r.client_name}</Link></td>
                      <td>{label(r.branch)}<div className="text-xs text-ink-faint">{r.institution_name}</div></td>
                      <td className="whitespace-nowrap">{fmt(r.end_date)}
                        <div className={cx('text-xs', Number(r.days_left) < 0 ? 'font-medium text-red-600' : Number(r.days_left) <= 15 ? 'text-amber-600' : 'text-ink-faint')}>
                          {Number(r.days_left) < 0 ? `vencida há ${-r.days_left} dia(s)` : Number(r.days_left) === 0 ? 'vence hoje' : `faltam ${r.days_left} dia(s)`}</div></td>
                      <td className="text-right tabular-nums">{money(r.total_premium_cents)}</td>
                      <td>
                        {r.renewed_by ? (
                          <span className="text-sm">Renovada: <Link to={`/apolices/${r.renewed_by.id}`} className="text-primary hover:underline">{r.renewed_by.policy_number || 'nova apólice'}</Link></span>
                        ) : r.opportunity ? (
                          <div><StatusChip map={STAGES} value={r.opportunity.stage} />
                            <div className="text-xs text-ink-faint">{r.opportunity.owner || 'sem responsável'}{r.opportunity.next_action_at ? ` · próxima ação ${fmt(r.opportunity.next_action_at)}` : ''}</div></div>
                        ) : <span className="chip bg-red-500/10 text-red-700 dark:text-red-300"><AlertTriangle className="h-3 w-3" /> Não iniciada</span>}
                      </td>
                      <td className={cx('whitespace-nowrap text-sm', noContact(r) ? 'text-amber-700 dark:text-amber-300' : '')}>{r.last_contact ? ago(r.last_contact) : 'sem registro'}</td>
                      <td>
                        {!r.renewed_by && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {can('renewals') && !r.opportunity && <button className="btn-outline" disabled={busy && working === r.id} onClick={() => startRenewal(r)}><Repeat className="h-4 w-4" /> Iniciar</button>}
                            {can('quotes_manage') && <button className="btn-ghost" disabled={busy && working === r.id} onClick={() => startRenewal(r, true)}><Calculator className="h-4 w-4" /> Cotar</button>}
                            <a className="btn-ghost btn-icon" href={wa(r)} target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label={`Mensagem de renovação para ${r.client_name}`}><MessageCircle className="h-4 w-4" /></a>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
