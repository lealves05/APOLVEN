// Propostas (9): autorização do cliente, transmissão, recepção, aceite e emissão são fatos distintos, com histórico.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ChevronLeft, Send, ShieldCheck, FileUp, FileText, X, AlertTriangle, Plus, Trash2, History, ClipboardCheck, Undo2, Info, ThumbsUp, ThumbsDown } from 'lucide-react';
import {
  PageHeader, Section, KV, Tabs, Modal, Input, Textarea, Select, CentsInput, FileButton, StatusChip, Notice, Empty, Loading, Spinner, cx, useFetch, useAction, FAIL, SubmitButton,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { useAuth } from '../context/AuthContext';
import { api, idemKey, fileToPayload, download, qs } from '../lib/api';
import { money, moneyOrNA, fmt, fmtDateTime, ymd, pct, docNumber, PROPOSAL_STATUS } from '../lib/format';
import { ClientPicker, PaymentOptions, Validity, PAY_METHOD, ORIGIN, QUOTE_KIND } from './Quotes';

const MODE = { automatica: 'Automática', assistida: 'Assistida (canal oficial)' };
const SOURCE = { manual: 'Registro manual', fornecedor: 'Informado pela seguradora', sistema: 'Sistema' };
const AUTH_VIA = { presencial: 'Presencial', email: 'E-mail', whatsapp: 'WhatsApp', telefone: 'Telefone', assinatura_eletronica: 'Assinatura eletrônica (provedor)', portal: 'Link do cliente (portal)' };
const OP_STATUS = { enviada: 'Enviada — sem confirmação', indeterminada: 'Resultado indeterminado', confirmada: 'Confirmada', falhou: 'Falhou', registrada_manual: 'Registrada (assistida)' };
const STATUS_UPDATES = ['recepcionada', 'em_analise', 'aceita', 'recusada', 'retirada'];

// ================= Lista =================
export default function Proposals() {
  const { company } = useAuth();
  const [tab, setTab] = useState('open');
  const query = tab === 'open' ? { open: 1 } : tab === 'all' ? {} : { status: tab };
  const { data, loading } = useFetch(() => api.get(`/v1/proposals${qs(query)}`), [tab]);
  const t = useTable(data || [], { sort: 'updated_at', dir: 'desc' });
  return (
    <>
      <PageHeader title="Propostas e transmissão" subtitle="Autorização do cliente, transmissão, recepção, aceite e documento contratual — cada etapa com evidência." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'open', label: 'Em andamento' }, { value: 'autorizada_cliente', label: 'Aguardando transmissão' }, { value: 'transmitida', label: 'Transmitidas' },
        { value: 'aceita', label: 'Aceitas' }, { value: 'documento_recebido', label: 'Documento a conferir' }, { value: 'all', label: 'Todas' },
      ]} />
      {loading ? <Loading /> : !data?.length ? (
        <div className="card"><Empty icon={Send} title="Nenhuma proposta" text="Propostas nascem da opção escolhida pelo cliente em um comparativo." /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="client_name">Cliente</SortTh><SortTh t={t} k="institution_name">Seguradora</SortTh>
              <SortTh t={t} k="product_name">Produto</SortTh><SortTh t={t} k="total_premium_cents">Prêmio total</SortTh><SortTh t={t} k="status">Situação</SortTh>
              <SortTh t={t} k="mode">Modo</SortTh><th>Protocolo</th>
            </tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/propostas/${r.id}`} className="font-medium text-primary hover:underline">{docNumber(company?.settings, 'proposal', r.number)}</Link>
                    <span className="block text-xs text-ink-faint">{fmt(r.updated_at)}</span></td>
                  <td>{r.client_name}</td><td>{r.institution_name}</td><td>{r.product_name}</td>
                  <td className="tabular-nums">{money(r.total_premium_cents)}</td>
                  <td><StatusChip map={PROPOSAL_STATUS} value={r.status} /></td>
                  <td>{r.mode ? MODE[r.mode] || r.mode : '—'}</td>
                  <td className="text-xs">{r.external_protocol || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
    </>
  );
}

// ================= Detalhe =================
const STEPS = [
  { key: 'rascunho', label: 'Rascunho' }, { key: 'aprovada_internamente', label: 'Aprovada internamente' }, { key: 'autorizada_cliente', label: 'Autorizada pelo cliente' },
  { key: 'transmitida', label: 'Transmitida' }, { key: 'recepcionada', label: 'Recepcionada' }, { key: 'em_analise', label: 'Em análise' },
  { key: 'decisao', label: 'Aceita / Recusada / Retirada', keys: ['aceita', 'recusada', 'retirada'] },
  { key: 'documento_recebido', label: 'Documento recebido' }, { key: 'conferida', label: 'Conferida' },
];

function Stepper({ status, events }) {
  const reached = new Set([status, ...events.map((e) => e.to_status)]);
  const idxOf = (s) => STEPS.findIndex((x) => x.key === s || x.keys?.includes(s));
  const cur = idxOf(status);
  const terminal = ['recusada', 'retirada'].includes(status);
  return (
    <ol className="flex gap-0 overflow-x-auto pb-1" aria-label="Etapas da proposta">
      {STEPS.map((s, i) => {
        const decided = s.keys?.find((k) => reached.has(k));
        const done = s.keys ? !!decided && i < cur : reached.has(s.key) && i < cur;
        const isCur = i === cur;
        const skipped = !done && !isCur && i < cur;
        const label = s.keys && decided ? PROPOSAL_STATUS[decided].label : s.label;
        const bad = isCur && terminal;
        return (
          <li key={s.key} className="flex min-w-[7.5rem] flex-1 flex-col items-center text-center" aria-current={isCur ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <span className={cx('h-0.5 flex-1', i === 0 ? 'invisible' : i <= cur ? 'bg-primary' : 'bg-line')} />
              <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold',
                bad ? 'border-red-500 bg-red-500 text-white' : isCur ? 'border-primary bg-primary text-primary-fg' : done ? 'border-primary bg-primary/10 text-primary' : 'border-line bg-surface text-ink-faint')}>
                {bad ? <X className="h-3.5 w-3.5" /> : done ? <Check className="h-3.5 w-3.5" /> : skipped ? '–' : i + 1}
              </span>
              <span className={cx('h-0.5 flex-1', i === STEPS.length - 1 ? 'invisible' : i < cur ? 'bg-primary' : 'bg-line')} />
            </div>
            <span className={cx('mt-1.5 px-1 text-[11px] leading-tight', isCur ? 'font-semibold text-ink' : done ? 'text-ink-soft' : 'text-ink-faint')}>{label}</span>
            {skipped && <span className="px-1 text-[10px] leading-tight text-ink-faint">{s.key === 'aprovada_internamente' ? 'não exigida pela corretora' : 'não registrada'}</span>}
          </li>
        );
      })}
    </ol>
  );
}

const ERR_HELP = {
  QUOTE_EXPIRED: 'A cotação desta proposta venceu ou foi retirada. Faça uma nova rodada (recalcular) na cotação, gere um novo comparativo e obtenha nova autorização do cliente.',
  AUTHORIZATION_MISMATCH: 'Preço, cobertura ou forma de pagamento mudaram desde a autorização do cliente. Recalcule e obtenha nova autorização para a versão exata antes de transmitir.',
  CONSENT_REVOKED: 'O cliente revogou a autorização de compartilhamento de dados depois da escolha. Regularize no cadastro do cliente antes de seguir.',
  NOT_AUTHORIZED: 'A transmissão exige a autorização do cliente registrada para esta versão.',
  ALREADY_SUBMITTED: 'Esta proposta já foi transmitida. Não repita a operação: acompanhe a recepção pela seguradora.',
};

function ErrorHelp({ err, requestId }) {
  if (!err) return null;
  return (
    <Notice tone="danger">
      <b>{err.message}</b>{ERR_HELP[err.code] && <span className="block">{ERR_HELP[err.code]}</span>}
      {['QUOTE_EXPIRED', 'AUTHORIZATION_MISMATCH'].includes(err.code) && requestId && <Link to={`/cotacoes/${requestId}`} className="mt-1 inline-block font-medium underline">Abrir a cotação para recalcular</Link>}
    </Notice>
  );
}

export function ProposalDetail() {
  const { id } = useParams();
  const { company, can, branchLabel } = useAuth();
  const [run, busy] = useAction();
  const { data: p, loading, reload } = useFetch(() => api.get(`/v1/proposals/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  if (loading && !p) return <Loading />;
  if (!p) return <Empty title="Proposta não encontrada" action={<Link to="/propostas" className="btn-outline">Voltar</Link>} />;

  const snap = p.offer_snapshot || {};
  const settings = company?.settings || {};
  const needsInternal = !!settings.approvals?.internalProposalApproval;
  const pendingOps = (p.operations || []).filter((o) => ['indeterminada', 'enviada'].includes(o.status));
  const offerExpired = p.offer_current && (p.offer_current.status !== 'ativa' || (p.offer_current.valid_until && String(p.offer_current.valid_until).slice(0, 10) < ymd()));
  const preSubmit = ['rascunho', 'aprovada_internamente', 'autorizada_cliente'].includes(p.status);
  const updates = (p.next || []).filter((s) => STATUS_UPDATES.includes(s));
  const divergences = p.divergences || [];
  const handle = (e) => { if (ERR_HELP[e.code]) { setErr(e); return true; } return false; };

  const approve = async () => { setErr(null); const r = await run(() => api.post(`/v1/proposals/${id}/approve-internal`), 'Proposta aprovada internamente.', handle); if (r !== FAIL) reload(); };
  const done = () => { setModal(null); setErr(null); reload(); };

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">Proposta {p.number_label}<StatusChip map={PROPOSAL_STATUS} value={p.status} /></span>}
        subtitle={<><Link to={`/clientes/${p.client_id}`} className="hover:underline">{p.client_name}</Link> · {p.institution_name} · {snap.product_name} · {p.branch_label || branchLabel(p.branch)}</>}
        actions={<>
          <Link to="/propostas" className="btn-ghost"><ChevronLeft className="h-4 w-4" />Propostas</Link>
          {p.request_id && <Link to={`/cotacoes/${p.request_id}`} className="btn-ghost">Cotação</Link>}
          {p.comparison_id && <Link to={`/comparativos/${p.comparison_id}`} className="btn-ghost">Comparativo</Link>}
          {p.policy_id && <Link to={`/apolices/${p.policy_id}`} className="btn-outline">Apólice</Link>}
        </>} />

      <div className="space-y-5">
        <div className="card px-3 py-4"><Stepper status={p.status} events={p.events || []} /></div>

        <ErrorHelp err={err} requestId={p.request_id} />
        {preSubmit && offerExpired && (
          <Notice tone="danger"><b>A cotação desta proposta venceu ou foi retirada</b> (validade {fmt(p.offer_current?.valid_until)}). Não é possível autorizar nem transmitir: recalcule na{' '}
            <Link to={`/cotacoes/${p.request_id}`} className="font-medium underline">cotação</Link> e obtenha nova autorização.</Notice>
        )}
        {pendingOps.map((op) => (
          <Notice key={op.id} tone="warn">
            <b>Transmissão com resultado indeterminado</b> ({OP_STATUS[op.status] || op.status}, {op.attempts} tentativa(s), desde {fmtDateTime(op.created_at)}).
            Não transmita de novo: consulte a seguradora pelo protocolo e registre o resultado.
            {can('proposals_submit') && <button className="btn-outline ml-2 mt-1 h-8 px-2.5 text-xs" onClick={() => setModal({ kind: 'resolve', op })}>Registrar resultado da consulta</button>}
          </Notice>
        ))}
        {divergences.length > 0 && <DivergenceList list={divergences} policyId={p.policy_id} />}

        <Section title="Próximo passo">
          <NextActions p={p} can={can} needsInternal={needsInternal} updates={updates} pending={pendingOps.length > 0} offerExpired={offerExpired}
            busy={busy} onApprove={approve} open={(kind, initial) => { setErr(null); setModal({ kind, initial }); }} />
        </Section>

        <div className="grid gap-5 lg:grid-cols-3">
          <Section title="Versão autorizada (snapshot da oferta)" subtitle="Valores exatos que vão à seguradora; não editáveis." className="lg:col-span-2">
            <KV cols={3} items={[
              ['Seguradora / produto', `${p.institution_name} — ${snap.product_name}`],
              ['Tipo e origem', `${QUOTE_KIND[snap.quote_kind]?.label || snap.quote_kind || '—'} · ${ORIGIN[snap.origin] || snap.origin || '—'}`],
              ['Ref. da cotação', snap.external_id || '—'],
              ['Prêmio total', <b key="t" className="tabular-nums">{money(snap.total_premium_cents)}</b>],
              ['Líquido / tributos', `${moneyOrNA(snap.premium_net_cents)} / ${moneyOrNA(snap.taxes_cents)}`],
              ['Validade', <Validity key="v" date={snap.valid_until} soonDays={settings.quotes?.expiringDays ?? 3} />],
              ['Forma de pagamento escolhida', p.payment_option ? `${PAY_METHOD[p.payment_option.method] || p.payment_option.method} ${p.payment_option.installments}x — total ${money(p.payment_option.total_cents)}` : 'não indicada'],
              ['Situação atual da oferta', p.offer_current ? `${p.offer_current.status === 'ativa' ? 'Ativa' : 'Retirada'}${p.offer_current.valid_until ? ` · válida até ${fmt(p.offer_current.valid_until)}` : ''}` : '—'],
              ['Transmissão', p.mode ? `${MODE[p.mode] || p.mode}${p.external_protocol ? ` · protocolo ${p.external_protocol}` : ''}${p.external_proposal_number ? ` · nº proposta ${p.external_proposal_number}` : ''}` : 'ainda não transmitida'],
            ]} />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Coberturas</h3>
            {snap.coverages?.length ? (
              <div className="overflow-x-auto"><table className="table-clean">
                <thead><tr><th>Cobertura</th><th>Limite</th><th>Franquia</th></tr></thead>
                <tbody>{snap.coverages.map((c) => (
                  <tr key={c.code}><td>{c.name || c.code}</td><td className="tabular-nums">{c.limit_cents == null ? 'não informado' : money(c.limit_cents)}</td>
                    <td>{c.deductible_text || (c.deductible_cents != null ? money(c.deductible_cents) : 'não informada')}{c.deductible_text && c.deductible_cents != null ? ` (${money(c.deductible_cents)})` : ''}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="text-sm text-ink-faint">Nenhuma cobertura informada.</p>}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><h3 className="mb-1 text-sm font-semibold">Formas de pagamento da oferta</h3><PaymentOptions options={snap.payment_options} chosen={p.payment_option?.id} /></div>
              <div><h3 className="mb-1 text-sm font-semibold">Assistências</h3>
                {snap.assistances?.length ? <ul className="list-inside list-disc text-sm">{snap.assistances.map((a, i) => <li key={i}>{a.name || a.code}</li>)}</ul> : <p className="text-sm text-ink-faint">não informado</p>}</div>
            </div>
            {(snap.requirements || snap.conditions) && <div className="mt-4 space-y-1 text-sm">{snap.requirements && <p><b>Exigências:</b> {snap.requirements}</p>}{snap.conditions && <p><b>Condições:</b> {snap.conditions}</p>}</div>}
            {can('commissions_view') && snap.commission_rate != null && (
              <p className="mt-4 rounded-app-sm border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">Comissão (informação interna, não aparece ao cliente): {pct(snap.commission_rate)}{snap.commission_source ? ` · ${snap.commission_source.replace(/_/g, ' ')}` : ''}</p>
            )}
            {snap.document_id && <button className="btn-ghost mt-3 text-sm" onClick={() => download(`/v1/documents/${snap.document_id}/download`, 'cotacao.pdf').catch(() => {})}><FileText className="h-4 w-4" />Documento da cotação</button>}
          </Section>

          <Section title="Autorizações do cliente" subtitle="Para a opção exata (vigência, coberturas, pagamento).">
            {p.authorizations?.length ? (
              <ul className="space-y-3 text-sm">
                {p.authorizations.map((a) => (
                  <li key={a.id} className={cx('rounded-app-sm border border-line p-3', a.revoked_at && 'opacity-60')}>
                    <div className="flex items-center gap-1.5 font-medium"><ShieldCheck className="h-4 w-4 text-emerald-600" />{a.authorized_by_name}</div>
                    <div className="text-xs text-ink-soft">{AUTH_VIA[a.via] || a.via} · {fmtDateTime(a.authorized_at)}{a.revoked_at && ' · revogada'}</div>
                    {a.evidence && <p className="mt-1 text-xs">{a.evidence}</p>}
                    {a.snapshot_hash !== p.snapshot_hash && <p className="mt-1 text-xs font-medium text-red-600">Autorização de outra versão da oferta.</p>}
                    {a.evidence_document_id && <button className="btn-ghost mt-1 h-7 px-2 text-xs" onClick={() => download(`/v1/documents/${a.evidence_document_id}/download`, 'evidencia').catch(() => {})}><FileText className="h-3.5 w-3.5" />Evidência</button>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-faint">Nenhuma autorização registrada.</p>}
            <p className="mt-3 text-xs text-ink-faint">Um clique ou mensagem não é assinatura eletrônica qualificada: a modalidade fica registrada como informada.</p>
          </Section>
        </div>

        <Section title="Histórico" subtitle="Ocorrido em = data do fato; registrado em = quando chegou ao sistema." bodyClass="p-0">
          <ol className="divide-y divide-line">
            {(p.events || []).slice().reverse().map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-3">
                <History className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.from_status && <><StatusChip map={PROPOSAL_STATUS} value={e.from_status} /><span className="text-ink-faint">→</span></>}
                    <StatusChip map={PROPOSAL_STATUS} value={e.to_status} />
                    <span className="chip bg-muted text-ink-soft">{SOURCE[e.source] || e.source}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">
                    Ocorrido em {fmtDateTime(e.occurred_at)}
                    {e.received_at && Math.abs(new Date(e.received_at) - new Date(e.occurred_at)) > 60000 && <> · registrado em {fmtDateTime(e.received_at)}</>}
                    {e.user_name && <> · por {e.user_name}</>}
                  </div>
                  {e.protocol && <div className="text-xs">Protocolo: <b>{e.protocol}</b></div>}
                  {e.evidence && <div className="text-xs">Evidência: {e.evidence}</div>}
                  {e.notes && <div className="text-xs text-ink-faint">{e.notes}</div>}
                </div>
              </li>
            ))}
          </ol>
          {p.operations?.length > 0 && (
            <div className="border-t border-line px-4 py-3 text-xs text-ink-soft">
              <b>Operações de transmissão:</b> {p.operations.map((o) => `${OP_STATUS[o.status] || o.status}${o.protocol ? ` (protocolo ${o.protocol})` : ''} em ${fmtDateTime(o.created_at)}`).join(' · ')}
            </div>
          )}
        </Section>
      </div>

      {modal?.kind === 'authorize' && <AuthorizeModal p={p} onClose={() => setModal(null)} onDone={done} onError={handle} />}
      {modal?.kind === 'submit' && <SubmitModal p={p} onClose={() => setModal(null)} onDone={done} onError={handle} onIndeterminate={() => { setModal(null); reload(); }} />}
      {modal?.kind === 'resolve' && <ResolveModal p={p} op={modal.op} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'status' && <StatusModal p={p} options={updates} initial={modal.initial} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'policy' && <PolicyModal p={p} onClose={() => setModal(null)} onDone={reload} />}
    </>
  );
}

function NextActions({ p, can, needsInternal, updates, pending, offerExpired, busy, onApprove, open }) {
  const items = [];
  if (p.status === 'rascunho') {
    if (can('proposals_approve')) items.push(<button key="ap" className="btn-primary" disabled={busy} onClick={onApprove}><Check className="h-4 w-4" />Aprovar internamente</button>);
    if (!needsInternal && can('proposals_manage')) items.push(<button key="au" className={items.length ? 'btn-outline' : 'btn-primary'} disabled={offerExpired} onClick={() => open('authorize')}><ShieldCheck className="h-4 w-4" />Registrar autorização do cliente</button>);
  }
  if (p.status === 'aprovada_internamente' && can('proposals_manage')) items.push(<button key="au" className="btn-primary" disabled={offerExpired} onClick={() => open('authorize')}><ShieldCheck className="h-4 w-4" />Registrar autorização do cliente</button>);
  if (p.status === 'autorizada_cliente' && can('proposals_submit')) items.push(<button key="tx" className="btn-primary" disabled={pending || offerExpired} onClick={() => open('submit')}><Send className="h-4 w-4" />Transmitir à seguradora</button>);
  if (p.status === 'aceita' && can('policies_manage')) items.push(<button key="pol" className="btn-primary" onClick={() => open('policy')}><FileUp className="h-4 w-4" />Registrar documento contratual (apólice)</button>);
  // atalhos da decisão da seguradora (abrem o mesmo registro, já com o estado escolhido)
  if (can('proposals_manage') && updates.includes('aceita')) {
    items.push(<button key="ok" className="btn-primary" onClick={() => open('status', 'aceita')}><ThumbsUp className="h-4 w-4" />Seguradora aceitou</button>);
    if (updates.includes('recusada')) items.push(<button key="no" className="btn-outline" onClick={() => open('status', 'recusada')}><ThumbsDown className="h-4 w-4" />Seguradora recusou</button>);
  }
  if (updates.length && can('proposals_manage')) {
    const onlyWithdraw = updates.length === 1 && updates[0] === 'retirada';
    items.push(<button key="st" className={onlyWithdraw ? 'btn-ghost text-red-600' : 'btn-outline'} onClick={() => open('status')}>
      {onlyWithdraw ? <><Undo2 className="h-4 w-4" />Retirar proposta</> : <><ClipboardCheck className="h-4 w-4" />{updates.includes('aceita') ? 'Outro andamento' : 'Registrar andamento da seguradora'}</>}</button>);
  }
  const hint = {
    rascunho: needsInternal ? 'A política da corretora exige aprovação interna antes da autorização do cliente.' : 'Registre a autorização do cliente para esta opção exata (ou aprove internamente, se for o caso).',
    aprovada_internamente: 'Aguardando a autorização do cliente para a versão exata.',
    autorizada_cliente: 'Pronta para transmissão. Sem conector com transmissão ativa, a transmissão é assistida pelo canal oficial da seguradora.',
    transmitida: 'Aguardando a seguradora. Quando ela responder, registre aqui — dá para ir direto para “aceita” ou “recusada”, sem passar pelas etapas intermediárias.',
    recepcionada: 'Recepcionada pela seguradora; registre a decisão quando sair.',
    em_analise: 'Em análise de subscrição na seguradora; registre a decisão quando sair.',
    aceita: 'Aceita pela seguradora. Aceite e emissão são fatos distintos: registre o documento contratual quando chegar.',
    recusada: 'Recusada pela seguradora (com evidência).',
    retirada: 'Proposta retirada.',
    documento_recebido: 'Documento contratual recebido: confira contra a versão autorizada na apólice.',
    conferida: 'Documento conferido.',
  }[p.status];
  return (
    <div className="space-y-3">
      {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      {items.length ? <div className="flex flex-wrap gap-2">{items}</div> : <p className="text-xs text-ink-faint">Nenhuma ação disponível para o seu perfil nesta etapa.</p>}
      {['documento_recebido', 'conferida'].includes(p.status) && p.policy_id && <Link to={`/apolices/${p.policy_id}`} className="btn-outline">Abrir apólice para conferência</Link>}
    </div>
  );
}

function DivergenceList({ list, policyId }) {
  const fmtV = (v) => (typeof v === 'number' ? money(v) : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fmt(v) : String(v ?? '—'));
  return (
    <div className="rounded-app border-2 border-red-500/40 bg-red-500/5 p-4">
      <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300"><AlertTriangle className="h-5 w-5" />{list.length} divergência(s) entre o documento emitido e a versão autorizada</p>
      <p className="mt-1 text-sm text-ink-soft">A apólice só pode ser marcada como conferida depois de tratar estas diferenças (pedido de correção/endosso à seguradora ou nova autorização do cliente).</p>
      <div className="mt-3 overflow-x-auto"><table className="table-clean">
        <thead><tr><th>Campo</th><th>Autorizado</th><th>Emitido</th></tr></thead>
        <tbody>{list.map((d, i) => <tr key={i}><td className="font-medium">{d.field}</td><td>{fmtV(d.authorized)}</td><td className="font-medium text-red-700 dark:text-red-300">{fmtV(d.issued)}</td></tr>)}</tbody>
      </table></div>
      {policyId && <Link to={`/apolices/${policyId}`} className="btn-outline mt-3">Abrir apólice</Link>}
    </div>
  );
}

function useUpload(p, kind) {
  const [run] = useAction();
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    setBusy(true);
    const r = await run(async () => api.post('/v1/documents', { entity: 'proposal', entity_id: p.id, client_id: p.client_id, kind, ...(await fileToPayload(file)) }), 'Documento anexado.');
    setBusy(false);
    if (r !== FAIL) setDoc(r);
  };
  return { doc, setDoc, busy, upload };
}

function DocSlot({ label, up }) {
  return (
    <div>
      <span className="label">{label}</span>
      {up.doc ? (
        <div className="flex items-center justify-between gap-2 rounded-app-sm border border-line px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-ink-faint" /><span className="truncate">{up.doc.filename}</span></span>
          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => up.setDoc(null)}><X className="h-3.5 w-3.5" />Trocar</button>
        </div>
      ) : (
        <FileButton accept="application/pdf,image/png,image/jpeg,image/webp" onFile={up.upload} disabled={up.busy}>{up.busy ? <Spinner className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}Anexar arquivo</FileButton>
      )}
    </div>
  );
}

function AuthorizeModal({ p, onClose, onDone, onError }) {
  const [run, busy] = useAction();
  const [via, setVia] = useState('whatsapp');
  const [name, setName] = useState(p.client_name || '');
  const [evidence, setEvidence] = useState('');
  const up = useUpload(p, 'evidencia');
  const pay = p.payment_option;
  const submit = async () => {
    const r = await run(() => api.post(`/v1/proposals/${p.id}/authorizations`, { via, authorized_by_name: name.trim(), evidence: evidence.trim(), evidence_document_id: up.doc?.id || null }),
      'Autorização do cliente registrada.', (e) => { const h = onError(e); if (h) onClose(); return h; });
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Registrar autorização do cliente" subtitle="Para a opção exata desta proposta."
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit}
        problems={[name.trim().length < 2 && { text: 'Informe o nome de quem autorizou.', field: 'Nome de quem autorizou' }, evidence.trim().length < 5 && { text: 'Descreva a evidência da autorização (mín. 5 caracteres).', field: 'Evidência' }]}>Registrar autorização</SubmitButton></>}>
      <div className="space-y-3">
        <div className="rounded-app-sm bg-muted px-3 py-2.5 text-sm">
          <b>{p.institution_name} — {p.offer_snapshot?.product_name}</b>
          <div className="text-ink-soft">Prêmio total {money(p.offer_snapshot?.total_premium_cents)}{pay ? ` · ${PAY_METHOD[pay.method] || pay.method} ${pay.installments}x (total ${money(pay.total_cents)})` : ''}</div>
        </div>
        <Select label="Como o cliente autorizou" value={via} onChange={(e) => setVia(e.target.value)}>
          {['presencial', 'email', 'whatsapp', 'telefone', 'assinatura_eletronica'].map((k) => <option key={k} value={k}>{AUTH_VIA[k]}</option>)}
        </Select>
        <Input label="Nome de quem autorizou *" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea label="Evidência *" rows={3} value={evidence} placeholder="ex.: mensagem de WhatsApp de 05/10 às 14h32 confirmando a opção e o pagamento" onChange={(e) => setEvidence(e.target.value)} />
        <DocSlot label="Arquivo de evidência (opcional)" up={up} />
        <Notice><Info className="mr-1 inline h-4 w-4" />Um clique, e-mail ou mensagem não é assinatura qualificada. A modalidade fica registrada exatamente como informada. Para assinatura eletrônica, anexe o documento e as evidências do provedor.</Notice>
      </div>
    </Modal>
  );
}

function SubmitModal({ p, onClose, onDone, onError, onIndeterminate }) {
  const [run, busy] = useAction();
  const key = useMemo(() => idemKey('tx'), []); // uma chave por abertura do formulário
  const [protocol, setProtocol] = useState('');
  const [number, setNumber] = useState('');
  const [evidence, setEvidence] = useState('');
  const [assisted, setAssisted] = useState(null);
  const submit = async () => {
    setAssisted(null);
    const r = await run(() => api.post(`/v1/proposals/${p.id}/submit`, { protocol: protocol.trim() || null, evidence: evidence.trim() || null, external_proposal_number: number.trim() || null }, { 'Idempotency-Key': key }),
      'Transmissão registrada.', (e) => {
        if (e.code === 'ASSISTED_PROTOCOL_REQUIRED') { setAssisted(e.message); return true; }
        if (e.code === 'OPERATION_INDETERMINATE') { onIndeterminate(); return false; }
        const h = onError(e); if (h) onClose(); return h;
      });
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Transmitir proposta" subtitle={`${p.institution_name} — ${p.offer_snapshot?.product_name} · ${money(p.offer_snapshot?.total_premium_cents)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}Transmitir</button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Antes de enviar, o sistema confere de novo a validade da cotação, a autorização do cliente para esta versão, o consentimento e o credenciamento. São transmitidos exatamente os valores autorizados.</p>
        {assisted ? (
          <Notice tone="warn"><b>Transmissão assistida.</b> Não há conector com transmissão ativa para esta seguradora. Envie a proposta pelo canal oficial (portal/e-mail da seguradora) e informe abaixo o protocolo de envio.</Notice>
        ) : (
          <Notice>Se houver conector com transmissão ativa, o envio é automático. Caso contrário, a transmissão é <b>assistida</b>: envie pelo canal oficial e informe o protocolo.</Notice>
        )}
        <Input label={assisted ? 'Protocolo de envio *' : 'Protocolo de envio (obrigatório na transmissão assistida)'} value={protocol} onChange={(e) => setProtocol(e.target.value)} />
        <Input label="Número da proposta na seguradora (se houver)" value={number} onChange={(e) => setNumber(e.target.value)} />
        <Textarea label="Evidência do envio" rows={3} value={evidence} placeholder="ex.: proposta enviada pelo portal do corretor às 15h10" onChange={(e) => setEvidence(e.target.value)} />
        <p className="text-xs text-ink-faint">Operação protegida contra duplicidade (chave {key.slice(0, 12)}…). Em caso de falha de conexão, tente de novo nesta mesma janela; não abra uma nova transmissão.</p>
      </div>
    </Modal>
  );
}

function ResolveModal({ p, op, onClose, onDone }) {
  const [run, busy] = useAction();
  const [result, setResult] = useState('confirmada');
  const [protocol, setProtocol] = useState(op.protocol || '');
  const [evidence, setEvidence] = useState('');
  const submit = async () => {
    const r = await run(() => api.post(`/v1/proposals/${p.id}/operations/${op.id}/resolve`, { result, protocol: protocol.trim() || null, evidence: evidence.trim() }), 'Resultado registrado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Resultado da transmissão indeterminada" subtitle="Registre o que a seguradora informou após a consulta."
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit}
        problems={evidence.trim().length < 5 ? [{ text: 'Descreva a evidência da consulta (mín. 5 caracteres).', field: 'Evidência da consulta' }] : []}>Registrar</SubmitButton></>}>
      <div className="space-y-3">
        <Select label="Resultado confirmado com a seguradora" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="confirmada">A seguradora recebeu a proposta</option>
          <option value="falhou">A seguradora não recebeu — pode transmitir de novo</option>
        </Select>
        <Input label="Protocolo" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
        <Textarea label="Evidência da consulta *" rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </div>
    </Modal>
  );
}

function StatusModal({ p, options, initial, onClose, onDone }) {
  const [run, busy] = useAction();
  const [status, setStatus] = useState(initial && options.includes(initial) ? initial : options[0]);
  const [protocol, setProtocol] = useState('');
  const [evidence, setEvidence] = useState('');
  const [occurred, setOccurred] = useState('');
  const [source, setSource] = useState('fornecedor');
  const [notes, setNotes] = useState('');
  const needsEvidence = ['aceita', 'recusada'].includes(status);
  const submit = async () => {
    const r = await run(() => api.post(`/v1/proposals/${p.id}/status`, {
      status, protocol: protocol.trim() || null, evidence: evidence.trim() || null, occurred_at: occurred ? new Date(occurred).toISOString() : null, source, notes: notes.trim() || null,
    }), 'Andamento registrado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Registrar andamento" subtitle={`Situação atual: ${PROPOSAL_STATUS[p.status]?.label}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton className={status === 'retirada' ? 'btn-danger' : 'btn-primary'} busy={busy} onClick={submit}
        problems={needsEvidence && evidence.trim().length < 3 ? [{ text: `Informe a evidência ${status === 'aceita' ? 'do aceite' : 'da recusa'} (ex.: e-mail da seguradora de 06/10).`, field: 'Evidência' }] : []}>Registrar</SubmitButton></>}>
      <div className="space-y-3">
        <Select label="Novo estado" value={status} onChange={(e) => setStatus(e.target.value)}>
          {options.map((s) => <option key={s} value={s}>{PROPOSAL_STATUS[s]?.label || s}</option>)}
        </Select>
        {status === 'aceita' && <Notice>Registre o aceite somente com aceite expresso ou fato documentado. Não presuma aceitação pela falta de resposta. A emissão (apólice) é registrada depois, em separado.</Notice>}
        {status === 'recusada' && <Notice tone="warn">Recusa só com comunicação expressa da seguradora. Falha técnica ou falta de resposta não é recusa.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Fonte da informação" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="fornecedor">Informado pela seguradora</option><option value="manual">Registro manual da equipe</option>
          </Select>
          <Input label="Ocorrido em (se diferente de agora)" type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
        </div>
        <Input label="Protocolo" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
        <Textarea label={`Evidência${needsEvidence ? ' *' : ''}`} rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        <Textarea label="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ---------- Documento contratual → apólice ----------
const addMonths = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setMonth(x.getMonth() + n); return ymd(x); };

function PolicyModal({ p, onClose, onDone }) {
  const [run, busy] = useAction();
  const snap = p.offer_snapshot || {};
  // vigência sugerida = a pedida na cotação; sem ela, 1 ano a partir de hoje (confira no documento)
  const startSug = p.period?.start || ymd();
  const endSug = p.period?.end || addMonths(startSug, 12);
  const [f, setF] = useState({ policy_number: '', certificate_number: '', start_date: startSug, end_date: endSug, total_premium_cents: snap.total_premium_cents ?? null, premium_net_cents: snap.premium_net_cents ?? null, taxes_cents: snap.taxes_cents ?? null, notes: '' });
  const [covs, setCovs] = useState(() => (snap.coverages || []).map((c) => ({ code: c.code, name: c.name, limit_cents: c.limit_cents ?? null, deductible_text: c.deductible_text || '', deductible_cents: c.deductible_cents ?? null })));
  const planInstallments = (base) => {
    const po = p.payment_option;
    const n = po?.installments || 1;
    return Array.from({ length: n }, (_, i) => ({
      number: i + 1, due_date: addMonths(base || ymd(), i),
      amount_cents: po ? (i === 0 ? po.first_cents ?? po.installment_cents ?? po.total_cents : po.installment_cents) ?? null : snap.total_premium_cents ?? null, charge_url: '',
    }));
  };
  const [inst, setInst] = useState(() => planInstallments(startSug));
  const [insured, setInsured] = useState(null);
  const [payer, setPayer] = useState(null);
  const [result, setResult] = useState(null);
  const up = useUpload(p, 'apolice');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const genInstallments = () => setInst(planInstallments(f.start_date));
  const instSum = inst.reduce((a, x) => a + (x.amount_cents || 0), 0);

  const submit = async () => {
    const body = {
      policy_number: f.policy_number.trim(), certificate_number: f.certificate_number.trim() || null, start_date: f.start_date, end_date: f.end_date,
      total_premium_cents: f.total_premium_cents, premium_net_cents: f.premium_net_cents, taxes_cents: f.taxes_cents,
      coverages: covs.filter((c) => c.code).map((c) => ({ code: c.code, name: c.name, limit_cents: c.limit_cents, deductible_text: c.deductible_text?.trim() || null, deductible_cents: c.deductible_cents })),
      installments: inst.map((x) => ({ number: x.number, due_date: x.due_date, amount_cents: x.amount_cents, charge_url: x.charge_url?.trim() || null })),
      document_id: up.doc?.id || null, insured_client_id: insured?.id || null, payer_client_id: payer?.id || null, notes: f.notes.trim() || null,
    };
    const r = await run(() => api.post(`/v1/proposals/${p.id}/policy`, body), 'Documento contratual registrado.');
    if (r !== FAIL) { setResult(r); onDone(); }
  };

  if (result) {
    return (
      <Modal open onClose={onClose} title="Documento contratual registrado" size="lg"
        footer={<><button className="btn-ghost" onClick={onClose}>Fechar</button><Link to={`/apolices/${result.policy.id}`} className="btn-primary">Abrir apólice</Link></>}>
        {result.divergences?.length ? <DivergenceList list={result.divergences} policyId={null} />
          : <Notice tone="ok">Nenhuma divergência entre o documento emitido e a versão autorizada. Faça a conferência final na apólice.</Notice>}
      </Modal>
    );
  }

  return (
    <Modal open size="xl" onClose={onClose} title="Registrar documento contratual (apólice)" subtitle="Transcreva o documento emitido; o sistema compara com a versão autorizada."
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit} problems={[
        !f.policy_number.trim() && { text: 'Informe o número da apólice.', field: 'Número da apólice' },
        !f.start_date && { text: 'Informe o início de vigência.', field: 'Início de vigência' },
        !f.end_date && { text: 'Informe o fim de vigência.', field: 'Fim de vigência' },
        f.start_date && f.end_date && f.end_date <= f.start_date && { text: 'O fim da vigência deve ser posterior ao início.', field: 'Fim de vigência' },
        f.total_premium_cents == null && { text: 'Informe o prêmio total emitido.', field: 'Prêmio total emitido' },
        ...inst.map((x, i) => (!x.due_date || !(x.amount_cents > 0)) && { text: `Parcela ${x.number || i + 1}: informe vencimento e valor (ou remova a linha).`, field: `#inst-due-${i}` }),
      ]}>Registrar apólice</SubmitButton></>}>
      <div className="space-y-5">
        <Notice>Informe os dados <b>como emitidos</b> pela seguradora, mesmo que diferentes do autorizado: divergências de prêmio, vigência, coberturas, franquias e segurado ficam pendentes antes da conferência.</Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Número da apólice *" value={f.policy_number} onChange={(e) => set('policy_number', e.target.value)} />
          <Input label="Número do certificado" value={f.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} />
          <Input label="Início de vigência *" type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)}
            hint={f.start_date === startSug ? (p.period?.start ? 'Sugerido pela vigência pedida na cotação — confira no documento.' : 'Sugestão: hoje — confira no documento.') : undefined} />
          <Input label="Fim de vigência *" type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)}
            hint={f.end_date === endSug ? 'Sugerido — confira no documento.' : undefined} />
          <CentsInput label="Prêmio total emitido *" value={f.total_premium_cents} onChange={(v) => set('total_premium_cents', v)} hint={`Autorizado: ${money(snap.total_premium_cents)}`} />
          <DocSlot label="Arquivo da apólice" up={up} />
          <CentsInput label="Prêmio líquido" value={f.premium_net_cents} onChange={(v) => set('premium_net_cents', v)} />
          <CentsInput label="Tributos (IOF)" value={f.taxes_cents} onChange={(v) => set('taxes_cents', v)} />
        </div>
        {f.start_date && f.end_date && f.end_date <= f.start_date && <Notice tone="warn">O fim da vigência deve ser posterior ao início.</Notice>}

        <div>
          <h3 className="mb-2 text-sm font-semibold">Coberturas emitidas</h3>
          <div className="space-y-2">
            {covs.map((c, i) => (
              <div key={i} className="grid items-end gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
                <Input label="Cobertura" value={c.name} onChange={(e) => setCovs((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value, code: x.code || e.target.value.toLowerCase().replace(/\W+/g, '_') } : x)))} />
                <CentsInput label="Limite" value={c.limit_cents} onChange={(v) => setCovs((l) => l.map((x, j) => (j === i ? { ...x, limit_cents: v } : x)))} />
                <Input label="Franquia (texto)" value={c.deductible_text} onChange={(e) => setCovs((l) => l.map((x, j) => (j === i ? { ...x, deductible_text: e.target.value } : x)))} />
                <CentsInput label="Franquia (valor)" value={c.deductible_cents} onChange={(v) => setCovs((l) => l.map((x, j) => (j === i ? { ...x, deductible_cents: v } : x)))} />
                <button className="btn-ghost btn-icon mb-0.5" aria-label="Remover cobertura" onClick={() => setCovs((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 text-sm" onClick={() => setCovs((l) => [...l, { code: '', name: '', limit_cents: null, deductible_text: '', deductible_cents: null }])}><Plus className="h-4 w-4" />Cobertura</button>
          <p className="mt-1 text-xs text-ink-faint">Remova a cobertura que não consta no documento emitido — a ausência vira divergência.</p>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Parcelas do prêmio (pagas à seguradora)</h3>
            <div className="flex gap-2">
              <button className="btn-ghost text-sm" onClick={genInstallments}>Recalcular pela forma de pagamento</button>
              <button className="btn-ghost text-sm" onClick={() => setInst((l) => [...l, { number: l.length + 1, due_date: '', amount_cents: null, charge_url: '' }])}><Plus className="h-4 w-4" />Parcela</button>
            </div>
          </div>
          {inst.length ? (
            <div className="space-y-2">
              {inst.map((x, i) => (
                <div key={i} className="grid items-end gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-[4rem_1fr_1fr_2fr_auto]">
                  <Input label="Nº" type="number" min={1} value={x.number} onChange={(e) => setInst((l) => l.map((y, j) => (j === i ? { ...y, number: Number(e.target.value) || 1 } : y)))} />
                  <Input id={`inst-due-${i}`} label="Vencimento" type="date" value={x.due_date} onChange={(e) => setInst((l) => l.map((y, j) => (j === i ? { ...y, due_date: e.target.value } : y)))} />
                  <CentsInput label="Valor" value={x.amount_cents} onChange={(v) => setInst((l) => l.map((y, j) => (j === i ? { ...y, amount_cents: v } : y)))} />
                  <Input label="Link oficial de pagamento" placeholder="https://" value={x.charge_url} onChange={(e) => setInst((l) => l.map((y, j) => (j === i ? { ...y, charge_url: e.target.value } : y)))} />
                  <button className="btn-ghost btn-icon mb-0.5" aria-label="Remover parcela" onClick={() => setInst((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <p className={cx('text-xs', f.total_premium_cents != null && instSum !== f.total_premium_cents ? 'text-amber-700 dark:text-amber-300' : 'text-ink-faint')}>
                Soma das parcelas: {money(instSum)}{f.total_premium_cents != null && instSum !== f.total_premium_cents ? ` — difere do prêmio total (${money(f.total_premium_cents)})` : ''}</p>
            </div>
          ) : <p className="text-xs text-ink-faint">Sem parcelas informadas. Você pode registrá-las depois na apólice.</p>}
          {inst.length > 0 && p.payment_option && <p className="mt-1 text-xs text-ink-faint">Parcelas sugeridas pela forma de pagamento escolhida ({PAY_METHOD[p.payment_option.method] || p.payment_option.method} {p.payment_option.installments}x), com vencimento mensal a partir do início da vigência. Ajuste conforme o documento.</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ClientPicker label="Segurado (se diferente do cliente)" value={insured} onChange={setInsured} />
          <ClientPicker label="Pagador (se diferente do cliente)" value={payer} onChange={setPayer} />
        </div>
        <Textarea label="Observações" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Modal>
  );
}
