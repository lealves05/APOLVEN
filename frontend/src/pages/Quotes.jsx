// Cotações e multicálculo (8) + comparativos ao cliente (9.1).
// Regras visíveis: abrangência real da pesquisa, comparação parcial, origem/validade de cada oferta,
// falha técnica ≠ recusa, valor desconhecido = "não informado" (nunca zero), comissão nunca é critério nem vai ao cliente.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, Play, RefreshCw, FileUp, FileText, Ban, Check, AlertTriangle, Copy, MessageCircle, Printer, Link2, Send,
  ChevronRight, ChevronLeft, Trophy, ShieldCheck, Coins, Info, Trash2, Undo2, ExternalLink, Calculator,
} from 'lucide-react';
import {
  PageHeader, Section, KV, Tabs, Stat, Modal, PromptModal, Input, Textarea, Select, Toggle, CentsInput, FileButton, StatusChip, Notice,
  Empty, Loading, Spinner, cx, useFetch, useAction, FAIL, SubmitButton, Hint,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api, appUrl, download, fileToPayload, qs } from '../lib/api';
import {
  money, moneyOrNA, fmt, fmtDateTime, ymd, addDaysYmd, pct, docNumber, waLink, fillTemplate,
  TASK_STATUS, QUOTE_REQUEST_STATUS, COMPARISON_STATUS, CLASSIFICATION, PROPOSAL_STATUS,
} from '../lib/format';

// ---------------- Rótulos ----------------
export const SCENARIOS = {
  minima: { label: 'Coberturas mínimas', hint: 'Exatamente o que o cliente pediu' },
  ampliada: { label: 'Proteção ampliada', hint: 'Coberturas/limites acima do mínimo' },
  franquia_reduzida: { label: 'Franquia reduzida', hint: 'Prêmio maior, franquia menor' },
  franquia_majorada: { label: 'Franquia majorada', hint: 'Prêmio menor, franquia maior' },
};
export const ORIGIN = { api: 'Retorno da API da seguradora', documento_formal: 'Documento formal da seguradora', informada_pela_seguradora: 'Informada pela seguradora' };
export const QUOTE_KIND = {
  cotacao_valida: { label: 'Cotação válida', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  valor_indicativo: { label: 'Valor indicativo', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};
const OFFER_STATUS = { ativa: { label: 'Ativa', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }, retirada: { label: 'Retirada', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' }, vencida: { label: 'Vencida', cls: 'bg-orange-500/15 text-orange-700' } };
export const PAY_METHOD = { boleto: 'Boleto', cartao: 'Cartão de crédito', debito: 'Débito em conta', pix: 'Pix', carne: 'Carnê', outro: 'Outro' };
const payLabel = (m) => PAY_METHOD[m] || m;
const WEIGHT_LABEL = { coverage: 'Aderência às coberturas', cost: 'Custo total', deductible: 'Franquias', assistance: 'Assistências solicitadas' };
const MODE = { automatica: 'Automática', assistida: 'Assistida' };
const VIA = { presencial: 'Presencial', telefone: 'Telefone', whatsapp: 'WhatsApp', email: 'E-mail', portal: 'Link do cliente' };
const humanize = (s) => (s == null ? '' : String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const BADGES = [
  ['lowest_cost', 'Menor custo', Coins, 'bg-sky-500/10 text-sky-700 dark:text-sky-300'],
  ['best_fit', 'Melhor aderência', Trophy, 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'],
  ['highest_protection', 'Maior proteção', ShieldCheck, 'bg-violet-500/10 text-violet-700 dark:text-violet-300'],
];
const SHARING_SUGGESTIONS = [
  'Procedimentos preliminares ao contrato, a pedido do cliente (LGPD art. 7º, V)',
  'Consentimento do cliente registrado para cotação',
  'Renovação de contrato vigente a pedido do cliente',
];

export function OfferBadges({ id, badges, className }) {
  const list = BADGES.filter(([k]) => badges?.[k] && badges[k] === id);
  if (!list.length) return null;
  return (
    <div className={cx('flex flex-wrap gap-1', className)}>
      {list.map(([k, label, Icon, cls]) => <span key={k} className={cx('chip', cls)}><Icon className="h-3 w-3" />{label}</span>)}
    </div>
  );
}

/** Classificação e validade de uma oferta (interna: o.comparison; visão do cliente: o.classification). */
const klassOf = (o) => o.comparison?.klass ?? o.classification;
const issuesOf = (o) => o.comparison?.issues ?? o.issues ?? [];
const expiredOf = (o) => !!(o.comparison?.expired ?? o.expired);
const daysTo = (d) => (d ? Math.round((new Date(`${String(d).slice(0, 10)}T12:00:00`) - new Date(`${ymd()}T12:00:00`)) / 86400000) : null);

export function Validity({ date, expired, soonDays = 3 }) {
  if (!date) return <span className="text-ink-faint">não informada</span>;
  const d = daysTo(date);
  const isExpired = expired || d < 0;
  return (
    <span className={cx('inline-flex items-center gap-1', isExpired ? 'font-medium text-red-600' : d <= soonDays ? 'text-amber-700 dark:text-amber-300' : '')}>
      {(isExpired || d <= soonDays) && <AlertTriangle className="h-3.5 w-3.5" />}
      {fmt(date)}{isExpired ? ' — vencida' : d === 0 ? ' — vence hoje' : d <= soonDays ? ` — vence em ${d} dia(s)` : ''}
    </span>
  );
}

export function PaymentOptions({ options, chosen, compact }) {
  if (!options?.length) return <span className="text-ink-faint">não informado</span>;
  return (
    <ul className="space-y-1">
      {options.map((p) => (
        <li key={p.id || `${p.method}${p.installments}`} className={cx('text-xs', chosen && chosen === p.id && 'rounded bg-primary/10 px-1.5 py-1 font-medium text-primary')}>
          <span className="font-medium">{payLabel(p.method)} {p.installments}x</span>
          {p.installments > 1 && p.installment_cents ? <> · {p.first_cents && p.first_cents !== p.installment_cents ? `entrada ${money(p.first_cents)} + ` : ''}{p.installment_cents && `${p.first_cents && p.first_cents !== p.installment_cents ? p.installments - 1 : p.installments}x ${money(p.installment_cents)}`}</> : null}
          <span className="block text-ink-soft">Total da opção: <b className="tabular-nums">{money(p.total_cents)}</b></span>
          {!compact && p.note && <span className="block text-ink-faint">{p.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function CoverageCell({ cov, min }) {
  if (!cov) return <span className="font-medium text-red-600">Não incluída</span>;
  const below = min?.min_limit_cents != null && cov.limit_cents != null && cov.limit_cents < min.min_limit_cents;
  return (
    <div className="space-y-0.5 text-xs">
      <div>Limite: <b className={cx('tabular-nums', below && 'text-red-600')}>{cov.limit_cents == null ? 'não informado' : money(cov.limit_cents)}</b>{below && ' (abaixo do mínimo)'}</div>
      <div className="text-ink-soft">Franquia: {cov.deductible_text || (cov.deductible_cents != null ? money(cov.deductible_cents) : 'não informada')}
        {cov.deductible_text && cov.deductible_cents != null ? ` (${money(cov.deductible_cents)})` : ''}</div>
    </div>
  );
}

/**
 * Tabela lado a lado (colunas = ofertas). Usada na tela interna, no comparativo do cliente e na impressão.
 * internal: mostra cenário, origem detalhada, pontuação e ações; showCommission só com permissão (rótulo "interno").
 */
const COMMISSION_SOURCE = { retornada: 'retornada pela seguradora', condicao_interna: 'condição comercial interna' };

/**
 * No celular a grade mostra uma oferta por vez (seletor acima), para caber na tela;
 * no computador e na impressão, todas lado a lado.
 */
export function CompareGrid(props) {
  const { offers, printMode, chosenId } = props;
  const [idx, setIdx] = useState(() => Math.max(0, offers.findIndex((o) => o.id === chosenId)));
  if (printMode || offers.length < 2) return <GridTable {...props} />;
  const cur = Math.min(idx, offers.length - 1);
  return (
    <>
      <div className="hidden md:block"><GridTable {...props} /></div>
      <div className="md:hidden">
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Ofertas">
          {offers.map((o, i) => (
            <button key={o.id} type="button" role="tab" aria-selected={cur === i} onClick={() => setIdx(i)}
              className={cx('shrink-0 rounded-app-sm border px-3 py-2 text-left text-xs', cur === i ? 'border-primary bg-primary/5' : 'border-line bg-surface')}>
              <span className="block font-medium">Opção {i + 1} · {o.institution_name}</span>
              <span className="block tabular-nums text-ink-soft">{money(o.total_premium_cents)}{props.selectable && props.selected?.includes(o.id) ? ' · marcada' : ''}</span>
            </button>
          ))}
        </div>
        <GridTable {...props} offers={[offers[cur]]} indexBase={cur} />
      </div>
    </>
  );
}

function GridTable({ offers, minCoverages = [], badges, internal, showCommission, selectable, selected = [], onToggle, actions, chosenId, chosenPayment, soonDays, printMode, indexBase = 0 }) {
  const otherCodes = useMemo(() => {
    const min = new Set(minCoverages.map((m) => m.code));
    const map = new Map();
    offers.forEach((o) => (o.coverages || []).forEach((c) => { if (!min.has(c.code) && !map.has(c.code)) map.set(c.code, c.name || c.code); }));
    return [...map.entries()];
  }, [offers, minCoverages]);
  const Row = ({ label, hint, children, cls }) => (
    <tr className={cls}>
      <th scope="row" className={cx('sticky left-0 z-[1] w-28 min-w-[6.5rem] border-b border-r border-line bg-muted px-3 py-2 text-left align-top text-xs font-medium text-ink-soft sm:w-40 sm:min-w-[9rem]', printMode && 'static bg-zinc-100')}>
        {label}{hint && <span className="mt-0.5 block font-normal text-ink-faint">{hint}</span>}
      </th>
      {offers.map((o, i) => (
        <td key={o.id} className={cx('border-b border-line px-3 py-2 align-top text-sm', offers.length > 1 && 'min-w-[12rem]', o.status === 'retirada' && 'opacity-60', chosenId === o.id && 'bg-primary/5')}>{children(o, i)}</td>
      ))}
    </tr>
  );
  return (
    <div className={cx('overflow-x-auto', !printMode && 'rounded-app-sm border border-line')}>
      <table className={cx('w-full border-collapse', printMode && 'text-[11px]')}>
        <thead>
          <tr>
            <th className={cx('sticky left-0 z-[2] border-b border-r border-line bg-muted px-3 py-2 text-left text-xs font-medium text-ink-faint', printMode && 'static')}>
              {offers.length === 1 && indexBase >= 0 && !printMode ? 'Oferta' : `${offers.length} opção(ões)`}
            </th>
            {offers.map((o, i) => (
              <th key={o.id} scope="col" className={cx('border-b border-line px-3 py-2 text-left align-top', chosenId === o.id && 'bg-primary/10')}>
                <div className="flex items-start gap-2">
                  {selectable && (
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--primary))]" aria-label={`Selecionar ${o.institution_name}`}
                      disabled={o.status !== 'ativa' || expiredOf(o)} checked={selected.includes(o.id)} onChange={() => onToggle?.(o.id)} />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Opção {i + 1 + indexBase}</div>
                    <div className="font-semibold">{o.institution_name}</div>
                    <div className="text-xs font-normal text-ink-soft">{o.product_name}</div>
                    {chosenId === o.id && <span className="chip mt-1 bg-primary text-primary-fg"><Check className="h-3 w-3" />Escolhida pelo cliente</span>}
                    <OfferBadges id={o.id} badges={badges} className="mt-1" />
                    {o.status && o.status !== 'ativa' && <StatusChip map={OFFER_STATUS} value={o.status} className="mt-1" />}
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Tipo e origem">{(o) => (
            <div className="space-y-1">
              <StatusChip map={QUOTE_KIND} value={o.quote_kind} />
              {o.quote_kind === 'valor_indicativo' && <div className="text-xs text-amber-700 dark:text-amber-300">Confirmar com a seguradora antes de contratar</div>}
              {internal && <div className="text-xs text-ink-soft">{ORIGIN[o.origin] || o.origin}</div>}
              {(o.external_id || o.external_reference) && <div className="text-xs text-ink-faint">Ref.: {o.external_id || o.external_reference}</div>}
              {internal && o.scenario && <div className="text-xs text-ink-faint">Cenário: {SCENARIOS[o.scenario]?.label || o.scenario}</div>}
            </div>
          )}</Row>
          <Row label="Validade">{(o) => <Validity date={o.valid_until} expired={expiredOf(o)} soonDays={soonDays} />}</Row>
          <Row label="Prêmio total" hint="período da vigência">{(o) => <b className="text-base tabular-nums">{money(o.total_premium_cents)}</b>}</Row>
          <Row label="Prêmio líquido / tributos">{(o) => (
            <div className="text-xs">
              <div>Líquido: <span className="tabular-nums">{moneyOrNA(o.premium_net_cents)}</span></div>
              <div>Tributos (IOF): <span className="tabular-nums">{moneyOrNA(o.taxes_cents)}</span></div>
              {internal && <div>Custos: <span className="tabular-nums">{moneyOrNA(o.fees_cents)}</span></div>}
              {internal && o.fields_definition && <div className="mt-1 text-ink-faint">Definição na fonte: {o.fields_definition}</div>}
            </div>
          )}</Row>
          <Row label="Formas de pagamento" hint="total por opção">{(o) => <PaymentOptions options={o.payment_options} chosen={chosenId === o.id ? chosenPayment : null} compact={printMode} />}</Row>
          {minCoverages.map((m) => (
            <Row key={m.code} label={m.name || m.code}
              hint={`${m.required === false ? 'Desejável' : 'Exigida'}${m.min_limit_cents != null ? ` · mín. ${money(m.min_limit_cents)}` : ''}`}>
              {(o) => <CoverageCell cov={(o.coverages || []).find((c) => c.code === m.code)} min={m} />}
            </Row>
          ))}
          {otherCodes.length > 0 && (
            <Row label="Outras coberturas">{(o) => {
              const list = otherCodes.map(([code]) => (o.coverages || []).find((c) => c.code === code)).filter(Boolean);
              return list.length ? <ul className="space-y-1 text-xs">{list.map((c) => <li key={c.code}><b>{c.name || c.code}</b>: {c.limit_cents == null ? 'limite não informado' : money(c.limit_cents)}{(c.deductible_text || c.deductible_cents != null) && ` · franquia ${c.deductible_text || money(c.deductible_cents)}`}</li>)}</ul> : <span className="text-ink-faint">—</span>;
            }}</Row>
          )}
          <Row label="Assistências">{(o) => (o.assistances?.length ? <ul className="list-inside list-disc text-xs">{o.assistances.map((a, i) => <li key={i}>{a.name || a.code || String(a)}</li>)}</ul> : <span className="text-ink-faint">não informado</span>)}</Row>
          <Row label="Exigências e condições">{(o) => (o.requirements || o.conditions
            ? <div className="space-y-1 text-xs">{o.requirements && <div><b>Exigências:</b> {o.requirements}</div>}{o.conditions && <div><b>Condições:</b> {o.conditions}</div>}</div>
            : <span className="text-ink-faint">nenhuma informada</span>)}</Row>
          <Row label="Classificação" hint="frente ao mínimo pedido">{(o) => <StatusChip map={CLASSIFICATION} value={klassOf(o)} />}</Row>
          <Row label="Diferenças e alertas">{(o) => (issuesOf(o).length
            ? <ul className="space-y-0.5 text-xs">{issuesOf(o).map((x, i) => <li key={i} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />{x}</li>)}</ul>
            : <span className="text-xs text-emerald-700 dark:text-emerald-300">Sem diferenças em relação ao mínimo</span>)}</Row>
          {internal && (
            <Row label="Pontuação interna" hint="só ofertas elegíveis">{(o) => (o.score == null
              ? <span className="text-xs text-ink-faint">{klassOf(o) === 'incompativel' ? 'Não pontuada: não atende ao mínimo' : expiredOf(o) ? 'Não pontuada: vencida' : o.status !== 'ativa' ? 'Não pontuada: retirada' : '—'}</span>
              : (
                <div className="text-xs">
                  <b className="text-base tabular-nums">{o.score.toLocaleString('pt-BR')}</b> / 100
                  <ul className="mt-1 text-ink-soft">{Object.entries(o.score_detail?.parts || {}).map(([k, v]) => <li key={k}>{WEIGHT_LABEL[k] || k}: {v.toLocaleString('pt-BR')}</li>)}</ul>
                  {o.score_detail?.unknown?.length > 0 && <div className="mt-1 text-amber-700 dark:text-amber-300">Fora do cálculo (não informado): {o.score_detail.unknown.join('; ')}</div>}
                </div>
              ))}</Row>
          )}
          {internal && showCommission && (
            <Row label="Comissão (interno)" hint="não entra na pontuação" cls="bg-amber-500/5">{(o) => (
              <span className="text-xs">{o.commission_rate == null ? 'não informada' : pct(o.commission_rate)}{COMMISSION_SOURCE[o.commission_source] ? ` · ${COMMISSION_SOURCE[o.commission_source]}` : ''}</span>
            )}</Row>
          )}
          {internal && (
            <Row label="Documento fonte">{(o) => (o.document_id
              ? <button className="btn-ghost h-7 px-2 text-xs" onClick={() => download(`/v1/documents/${o.document_id}/download`, 'cotacao.pdf').catch(() => {})}><FileText className="h-3.5 w-3.5" />Baixar cotação</button>
              : <span className="text-xs text-ink-faint">sem documento anexado</span>)}</Row>
          )}
          {actions && <Row label="Ações">{(o) => actions(o)}</Row>}
        </tbody>
      </table>
    </div>
  );
}

// ================= Lista =================
export default function Quotes() {
  const { company, can, branchLabel } = useAuth();
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const [branch, setBranch] = useState('');
  const { data, loading } = useFetch(() => api.get(`/v1/quote-requests${qs({ status })}`), [status]);
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = useMemo(() => {
    const q = norm(term.trim());
    return (data || []).filter((r) => (!branch || r.branch === branch)
      && (!q || [docNumber(company?.settings, 'quote', r.number), r.number, r.title, r.client_name, branchLabel(r.branch)].some((x) => norm(x).includes(q))));
  }, [data, term, branch]); // eslint-disable-line react-hooks/exhaustive-deps
  const branches = useMemo(() => [...new Set((data || []).map((r) => r.branch))], [data]);
  const t = useTable(filtered, { sort: 'created_at', dir: 'desc', get: { client: (r) => r.client_name } });
  return (
    <>
      <PageHeader title="Cotações e multicálculo" subtitle="Rodadas por seguradora, respostas parciais e comparação técnica transparente."
        actions={can('quotes_manage') && <Link to="/cotacoes/nova" className="btn-primary"><Plus className="h-4 w-4" />Nova cotação</Link>} />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'Todas' }, ...Object.entries(QUOTE_REQUEST_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
      {data?.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative block w-full sm:w-96">
            <span className="sr-only">Buscar cotação</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input className="input pl-9" placeholder="Buscar por cliente, número ou título" value={term} onChange={(e) => setTerm(e.target.value)} />
          </label>
          {branches.length > 1 && (
            <select className="input w-full sm:w-56" aria-label="Ramo" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Todos os ramos</option>
              {branches.map((b) => <option key={b} value={b}>{branchLabel(b)}</option>)}
            </select>
          )}
          {(term || branch) && <span className="text-xs text-ink-faint">{filtered.length} de {data.length}</span>}
        </div>
      )}
      {loading ? <Loading /> : !data?.length ? (
        <div className="card"><Empty icon={Calculator} title="Nenhuma cotação" text="Crie uma cotação para consultar as seguradoras elegíveis e comparar as respostas."
          action={can('quotes_manage') && <Link to="/cotacoes/nova" className="btn-primary"><Plus className="h-4 w-4" />Nova cotação</Link>} /></div>
      ) : (
        !filtered.length ? <div className="card"><Empty icon={Search} title="Nenhuma cotação encontrada" text="Revise a busca ou o filtro de ramo." action={<button className="btn-outline" onClick={() => { setTerm(''); setBranch(''); }}>Limpar busca</button>} /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="client">Cliente</SortTh><SortTh t={t} k="branch">Ramo</SortTh>
              <SortTh t={t} k="status">Situação</SortTh><SortTh t={t} k="offers">Ofertas</SortTh><SortTh t={t} k="pending">Pendências</SortTh><SortTh t={t} k="created_at">Criada</SortTh>
            </tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/cotacoes/${r.id}`} className="font-medium text-primary hover:underline">{docNumber(company?.settings, 'quote', r.number)}</Link>
                    {r.title && <span className="block text-xs text-ink-faint">{r.title}</span>}</td>
                  <td>{r.client_name}</td>
                  <td>{branchLabel(r.branch)}</td>
                  <td><StatusChip map={QUOTE_REQUEST_STATUS} value={r.status} /></td>
                  <td className="tabular-nums">{r.offers}</td>
                  <td className="tabular-nums">{r.pending ? <span className="text-amber-700 dark:text-amber-300">{r.pending}</span> : 0}</td>
                  <td>{fmt(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
        )
      )}
    </>
  );
}

// ================= Componentes do formulário da rodada =================

/** Busca de cliente (GET /v1/clients?q=). */
export function ClientPicker({ value, onChange, label = 'Cliente', required }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (value || q.trim().length < 2) { setList([]); return undefined; }
    const h = setTimeout(async () => {
      setBusy(true);
      try { setList((await api.get(`/v1/clients${qs({ q: q.trim() })}`)).slice(0, 8)); setOpen(true); } catch { setList([]); } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(h);
  }, [q, value]);
  if (value) {
    return (
      <div>
        <span className="label">{label}{required && ' *'}</span>
        <div className="flex items-center justify-between gap-2 rounded-app-sm border border-line bg-muted/50 px-3 py-2">
          <div className="min-w-0"><div className="truncate font-medium">{value.name}</div>
            {(value.document_masked || value.email) && <div className="truncate text-xs text-ink-faint">{[value.document_masked, value.email].filter(Boolean).join(' · ')}</div>}</div>
          <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => { onChange(null); setQ(''); }}><X className="h-3.5 w-3.5" />Trocar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <label className="block">
        <span className="label">{label}{required && ' *'}</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" value={q} placeholder="Nome, CPF/CNPJ ou e-mail (mín. 2 letras)" onChange={(e) => setQ(e.target.value)}
            onFocus={() => list.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} role="combobox" aria-expanded={open} aria-autocomplete="list" />
          {busy && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />}
        </div>
      </label>
      {open && (
        <ul className="card absolute z-30 mt-1 max-h-72 w-full overflow-y-auto p-1" role="listbox">
          {list.length ? list.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full rounded-app-sm px-3 py-2 text-left hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(c); setOpen(false); }}>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-ink-faint">{[c.document_masked, c.phone, c.email].filter(Boolean).join(' · ')}</div>
              </button>
            </li>
          )) : <li className="px-3 py-2 text-sm text-ink-faint">Nenhum cliente encontrado.</li>}
        </ul>
      )}
    </div>
  );
}

const missingRisk = (schema, risk) => (schema?.fields || []).filter((f) => f.required && (risk[f.key] === null || risk[f.key] === undefined || risk[f.key] === '')).map((f) => f.label);

/** Formulário de risco gerado do schema do ramo. Resposta desconhecida fica vazia (null). */
export function RiskFields({ schema, value, onChange, highlight = [] }) {
  if (!schema) return <Notice tone="warn">Formulário do ramo indisponível.</Notice>;
  const set = (k, v) => onChange({ ...value, [k]: v === '' ? null : v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {schema.fields.map((f) => {
        const label = `${f.label}${f.required ? ' *' : ''}`;
        const v = value[f.key];
        const miss = highlight.includes(f.label);
        const wrap = (el) => <div key={f.key} className={cx(f.type === 'textarea' && 'sm:col-span-2', miss && 'rounded-app-sm ring-2 ring-amber-500/60 ring-offset-2 ring-offset-surface')}>{el}</div>;
        if (f.type === 'money') return wrap(<CentsInput label={label} value={v ?? null} onChange={(c) => set(f.key, c)} />);
        if (f.type === 'number') return wrap(<Input label={label} type="number" min={f.min} max={f.max} value={v ?? ''} placeholder="não informado" onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} />);
        if (f.type === 'select') {
          return wrap(
            <Select label={label} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">— não informado —</option>
              {f.options.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
            </Select>,
          );
        }
        if (f.type === 'boolean') {
          return wrap(
            <Select label={label} value={v === true ? 'sim' : v === false ? 'nao' : ''} onChange={(e) => set(f.key, e.target.value === '' ? null : e.target.value === 'sim')}>
              <option value="">— não informado —</option><option value="sim">Sim</option><option value="nao">Não</option>
            </Select>,
          );
        }
        if (f.type === 'date') return wrap(<Input label={label} type="date" value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />);
        if (f.type === 'textarea') return wrap(<Textarea label={label} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />);
        return wrap(<Input label={label} value={v ?? ''} placeholder={f.pattern?.includes('\\d{5}') ? '00000-000' : ''} onChange={(e) => set(f.key, e.target.value)} />);
      })}
    </div>
  );
}

/** Coberturas mínimas: inclusão, indispensável/desejável e limite mínimo opcional (centavos). */
export function CoveragePicker({ catalog = [], value, onChange }) {
  const byCode = Object.fromEntries(value.map((c) => [c.code, c]));
  const toggle = (c) => onChange(byCode[c.code] ? value.filter((x) => x.code !== c.code) : [...value, { code: c.code, name: c.name, required: true, min_limit_cents: null }]);
  const patch = (code, p) => onChange(value.map((x) => (x.code === code ? { ...x, ...p } : x)));
  if (!catalog.length) return <p className="text-sm text-ink-faint">Sem catálogo de coberturas para este ramo.</p>;
  return (
    <div className="divide-y divide-line rounded-app-sm border border-line">
      {catalog.map((c) => {
        const sel = byCode[c.code];
        return (
          <div key={c.code} className={cx('px-3 py-2.5', sel && 'bg-primary/5')}>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={!!sel} onChange={() => toggle(c)} />
              <span className="text-sm font-medium">{c.name}</span>
            </label>
            {sel && (
              <div className="mt-2 grid gap-3 pl-6 sm:grid-cols-2">
                <Toggle checked={sel.required !== false} onChange={(v) => patch(c.code, { required: v })}
                  label={sel.required !== false ? 'Indispensável' : 'Desejável'} hint={sel.required !== false ? 'Sem ela a oferta é "não atende ao mínimo"' : 'Ausência só deixa a oferta parcial'} />
                <CentsInput label="Limite mínimo (opcional)" value={sel.min_limit_cents ?? null} onChange={(v) => patch(c.code, { min_limit_cents: v })} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScenarioPicker({ value, onChange }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.entries(SCENARIOS).map(([k, s]) => {
        const on = value.includes(k);
        return (
          <label key={k} className={cx('flex cursor-pointer items-start gap-2.5 rounded-app-sm border px-3 py-2', on ? 'border-primary bg-primary/5' : 'border-line')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" checked={on}
              onChange={() => onChange(on ? (value.length > 1 ? value.filter((x) => x !== k) : value) : [...value, k])} />
            <span><span className="block text-sm font-medium">{s.label}</span><span className="block text-xs text-ink-faint">{s.hint}</span></span>
          </label>
        );
      })}
    </div>
  );
}

function PreferencesFields({ value, onChange }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Textarea label="Assistências desejadas" hint="Uma por linha (ex.: Guincho 24h). Usadas na pontuação de assistências." rows={3}
        value={value.assistancesText ?? ''} onChange={(e) => onChange({ ...value, assistancesText: e.target.value })} />
      <Textarea label="Observações para a pesquisa" rows={3} value={value.notes ?? ''} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      <Input label="Preferência de franquia" value={value.deductible ?? ''} placeholder="ex.: franquia reduzida" onChange={(e) => onChange({ ...value, deductible: e.target.value })} />
      <Input label="Preferência de pagamento" value={value.payment ?? ''} placeholder="ex.: cartão em até 10x" onChange={(e) => onChange({ ...value, payment: e.target.value })} />
    </div>
  );
}
const prefsPayload = (p) => {
  const out = {};
  const a = (p.assistancesText || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (a.length) out.assistances = a;
  ['notes', 'deductible', 'payment'].forEach((k) => { if (p[k]?.trim()) out[k] = p[k].trim(); });
  return out;
};

/** Elegibilidade (GET /v1/catalog/eligible): fontes que entram (automática/assistida) e as excluídas com motivo. */
function SourcesPicker({ branch, value, onChange, scenarios, onLoaded }) {
  const [el, setEl] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!branch) return;
    setEl(null); setErr(null);
    api.get(`/v1/catalog/eligible?branch=${encodeURIComponent(branch)}`).then((d) => { setEl(d); onLoaded?.(d); }).catch((e) => setErr(e.message));
  }, [branch]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!el) return <div className="py-6"><Spinner /></div>;
  const all = value === 'all';
  const chosenIds = all ? el.eligible.map((e) => e.connection_id) : value;
  const chosen = el.eligible.filter((e) => chosenIds.includes(e.connection_id));
  const toggle = (id) => {
    const cur = all ? el.eligible.map((e) => e.connection_id) : value;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange(next.length === el.eligible.length ? 'all' : next);
  };
  return (
    <div className="space-y-4">
      {!el.eligible.length ? (
        <Notice tone="danger">Nenhuma seguradora elegível para este ramo. Cadastre o credenciamento e a conexão em{' '}
          <Link to="/integracoes" className="font-medium underline">Seguradoras e Integrações</Link>.</Notice>
      ) : (
        <>
          <Toggle checked={all} onChange={(v) => onChange(v ? 'all' : [])} label="Consultar todas as fontes elegíveis"
            hint="Desmarque para escolher uma seleção específica." />
          <div className="divide-y divide-line rounded-app-sm border border-line">
            {el.eligible.map((e) => (
              <label key={e.connection_id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" checked={chosenIds.includes(e.connection_id)} onChange={() => toggle(e.connection_id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{e.institution_name}</span>
                    <span className={cx('chip', e.mode === 'automatica' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}>{MODE[e.mode]}</span></span>
                  <span className="block text-xs text-ink-faint">{e.reason}{e.products?.length ? ` · Produtos: ${e.products.map((p) => p.name).join(', ')}` : ''}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {el.excluded.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Fora desta pesquisa</p>
          <ul className="space-y-1 text-sm">
            {el.excluded.map((e, i) => (
              <li key={`${e.institution_id}${i}`} className="flex flex-wrap items-center gap-x-2"><Ban className="h-3.5 w-3.5 text-ink-faint" />
                <span className="font-medium">{e.institution_name}</span><span className="text-ink-faint">— {e.reason}</span></li>
            ))}
          </ul>
        </div>
      )}
      {chosen.length > 0 && (
        <div className="rounded-app-sm bg-muted px-3 py-2.5 text-sm">
          <p className="font-medium">Destinatários previstos dos dados do cliente</p>
          <p className="text-ink-soft">{chosen.map((e) => e.institution_name).join(', ')}</p>
          <p className="mt-1 text-xs text-ink-faint">
            {chosen.length * scenarios.length} consulta(s): {chosen.length} fonte(s) × {scenarios.length} cenário(s).
            {chosen.some((e) => e.mode === 'assistida') && ' Fontes assistidas viram tarefas para a equipe consultar pelo canal oficial e registrar a resposta formal.'}
          </p>
        </div>
      )}
    </div>
  );
}

function SharingBasis({ value, onChange }) {
  return (
    <div>
      <Input label="Base para compartilhar os dados com as seguradoras *" list="apolven-sharing-basis" value={value} onChange={(e) => onChange(e.target.value)}
        hint="Obrigatório. Fica registrado na rodada e na trilha de auditoria (LGPD)." placeholder="ex.: pedido do cliente para cotação" />
      <datalist id="apolven-sharing-basis">{SHARING_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/** Erros de criação de rodada com orientação. */
function RoundErrorNotice({ err, clientId }) {
  if (!err) return null;
  if (err.code === 'INSUFFICIENT_DATA') {
    return <Notice tone="warn"><b>Dados insuficientes para cotar.</b> Preencha: {(err.data?.missing || []).join(', ')}. O sistema não completa respostas desconhecidas.</Notice>;
  }
  if (err.code === 'NO_ELIGIBLE_SOURCE') {
    return <Notice tone="danger"><b>Nenhuma seguradora elegível.</b> {err.message} <Link to="/integracoes" className="font-medium underline">Abrir Seguradoras e Integrações</Link></Notice>;
  }
  if (err.code === 'CONSENT_REVOKED' || err.code === 'CONSENT_REQUIRED') {
    return <Notice tone="danger"><b>{err.code === 'CONSENT_REVOKED' ? 'Autorização revogada.' : 'Autorização específica necessária.'}</b> {err.message}
      {clientId && <> <Link to={`/clientes/${clientId}`} className="font-medium underline">Abrir cadastro do cliente (privacidade e consentimentos)</Link></>}</Notice>;
  }
  return <Notice tone="danger">{err.message}</Notice>;
}

const HANDLED = ['INSUFFICIENT_DATA', 'NO_ELIGIBLE_SOURCE', 'CONSENT_REVOKED', 'CONSENT_REQUIRED'];

// ================= Nova cotação =================
const STEPS = ['Cliente e ramo', 'Dados do risco', 'Coberturas e preferências', 'Fontes e envio'];

export function QuoteNew() {
  const { meta, branchLabel } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const [step, setStep] = useState(0);
  const [client, setClient] = useState(null);
  const [branch, setBranch] = useState(sp.get('branch') || '');
  const [title, setTitle] = useState('');
  const [risk, setRisk] = useState({});
  const [covs, setCovs] = useState([]);
  const [prefs, setPrefs] = useState({});
  const [start, setStart] = useState(ymd());
  const [end, setEnd] = useState(addDaysYmd(365));
  const [scenarios, setScenarios] = useState(['minima']);
  const [sources, setSources] = useState('all');
  const [eligibleCount, setEligibleCount] = useState(null);
  const [sharing, setSharing] = useState('');
  const [err, setErr] = useState(null);
  const [highlight, setHighlight] = useState([]);
  const opportunity = sp.get('opportunity');
  const renewal = sp.get('renewal');

  useEffect(() => {
    const id = sp.get('client');
    if (id) api.get(`/v1/clients/${id}`).then((c) => setClient(c?.client || c)).catch(() => {});
    if (renewal) {
      api.get(`/v1/policies/${renewal}`).then((p) => {
        const pol = p?.policy || p;
        if (pol?.end_date) { setStart(String(pol.end_date).slice(0, 10)); setEnd(addDaysYmd(365, new Date(`${String(pol.end_date).slice(0, 10)}T12:00:00`))); }
        if (pol?.branch && !sp.get('branch')) setBranch(pol.branch);
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ao trocar o ramo, o formulário e as coberturas recomeçam (campos diferentes por ramo)
  const lastBranch = useRef(branch);
  useEffect(() => { if (lastBranch.current !== branch) { setRisk({}); setCovs([]); setSources('all'); lastBranch.current = branch; } }, [branch]);
  // já no passo 1: há seguradora que possa receber esta cotação? (evita descobrir só no fim)
  useEffect(() => {
    setEligibleCount(null);
    if (!branch) return;
    let alive = true;
    api.get(`/v1/catalog/eligible?branch=${encodeURIComponent(branch)}`).then((d) => { if (alive) setEligibleCount(d.eligible.length); }).catch(() => {});
    return () => { alive = false; };
  }, [branch]);

  const schema = branch ? meta?.risk_schemas?.[branch] : null;
  const catalog = branch ? meta?.coverage_catalog?.[branch] || [] : [];
  const missing = missingRisk(schema, risk);

  const fieldLabel = (k) => (schema?.fields || []).find((f) => f.key === k)?.label || k;
  const stepProblems = [
    [
      !client && { text: 'Escolha o cliente.', field: 'Cliente' },
      !branch && { text: 'Escolha o ramo do seguro.', field: 'Ramo' },
      branch && eligibleCount === 0 && { text: 'Nenhuma seguradora habilitada para este ramo — cadastre em Seguradoras e integrações.' },
    ],
    missing.map((k) => ({ text: `Preencha “${fieldLabel(k)}”.`, field: fieldLabel(k) })),
    [start && end && end <= start && { text: 'O fim da vigência deve ser posterior ao início.', field: 'Fim' }],
    [
      sources === 'all' ? eligibleCount === 0 && { text: 'Nenhuma seguradora elegível para este ramo.' } : !sources.length && { text: 'Marque ao menos uma seguradora.' },
      sharing.trim().length < 3 && { text: 'Informe a base para compartilhar os dados com as seguradoras.', field: 'Base para compartilhar' },
      start && end && end <= start && { text: 'O fim da vigência deve ser posterior ao início.' },
    ],
  ].map((l) => l.filter(Boolean));

  const goNext = () => {
    setHighlight([]);
    setStep((s) => Math.min(3, s + 1));
  };

  const submit = async () => {
    setErr(null);
    const body = {
      client_id: client.id, branch, opportunity_id: opportunity || null, renewal_of_policy_id: renewal || null, title: title.trim() || undefined,
      risk, min_coverages: covs, preferences: prefsPayload(prefs), start_date: start || null, end_date: end || null,
      sources: sources === 'all' ? [] : sources, scenarios, sharing_basis: sharing.trim(),
    };
    const r = await run(() => api.post('/v1/quote-requests', body), 'Cotação criada. As tarefas foram distribuídas às fontes.', (e) => {
      setErr(e);
      if (e.code === 'INSUFFICIENT_DATA') { setHighlight(e.data?.missing || []); setStep(1); }
      return HANDLED.includes(e.code);
    });
    if (r !== FAIL) nav(`/cotacoes/${r.request.id}`);
  };

  return (
    <>
      <PageHeader title="Nova cotação" subtitle="Uma rodada imutável é criada com o questionário, coberturas, preferências e fontes escolhidas."
        actions={<Link to="/cotacoes" className="btn-ghost"><ChevronLeft className="h-4 w-4" />Cotações</Link>} />
      {(opportunity || renewal) && <Notice className="mb-4">{renewal ? 'Cotação de renovação: vinculada à apólice atual.' : 'Cotação vinculada à oportunidade.'}</Notice>}

      <ol className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}
              className={cx('flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm', i === step ? 'border-primary bg-primary text-primary-fg' : i < step ? 'border-primary/40 text-primary' : 'border-line text-ink-faint')}
              aria-current={i === step ? 'step' : undefined}>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-black/10 text-xs">{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        <RoundErrorNotice err={err} clientId={client?.id} />

        {step === 0 && (
          <Section title="Cliente e ramo">
            <div className="grid gap-4 sm:grid-cols-2">
              <ClientPicker value={client} onChange={setClient} required />
              <Select label="Ramo *" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">Selecione…</option>
                {Object.entries(meta?.branches || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Input label="Título (opcional)" className="sm:col-span-2" value={title} placeholder={branch ? branchLabel(branch) : 'ex.: Auto — carro novo'} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {branch && eligibleCount === 0 && (
              <Notice tone="danger" className="mt-4">
                <b>Nenhuma seguradora pode receber cotações de {branchLabel(branch)} ainda.</b> Cadastre a seguradora com credenciamento confirmado e o produto deste ramo antes de continuar.{' '}
                <Link to="/integracoes" className="font-medium underline">Cadastrar seguradora</Link>
              </Notice>
            )}
            {branch && eligibleCount > 0 && <p className="mt-3 text-xs text-ink-faint">{eligibleCount} seguradora(s) habilitada(s) para este ramo.</p>}
            {schema?.sensitive && <Notice tone="warn" className="mt-4">Este ramo envolve dados sensíveis: é preciso ter a autorização específica do cliente registrada antes de cotar. Questionários clínicos não são preenchidos aqui.</Notice>}
          </Section>
        )}

        {step === 1 && (
          <Section title={`Dados do risco — ${branchLabel(branch)}`} subtitle={schema ? `Questionário versão ${schema.version}. Campos com * são obrigatórios.` : ''}>
            <Notice className="mb-4">Responda só o que o cliente informou. Deixe em branco o que não se sabe: o sistema <b>nunca preenche respostas desconhecidas</b> — elas seguem como “não informado” para as seguradoras.</Notice>
            <RiskFields schema={schema} value={risk} onChange={setRisk} highlight={highlight} />
            {highlight.length > 0 && missing.length > 0 && <Notice tone="warn" className="mt-4">Faltam campos obrigatórios: {missing.join(', ')}.</Notice>}
          </Section>
        )}

        {step === 2 && (
          <>
            <Section title="Coberturas mínimas" subtitle="As ofertas são classificadas primeiro contra estes requisitos; só depois vem a pontuação.">
              <CoveragePicker catalog={catalog} value={covs} onChange={setCovs} />
              {!covs.length && <p className="mt-2 text-xs text-ink-faint">Sem coberturas mínimas, todas as ofertas contam como “atende ao mínimo”.</p>}
            </Section>
            <Section title="Preferências"><PreferencesFields value={prefs} onChange={setPrefs} /></Section>
            <Section title="Vigência pretendida e cenários">
              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <Input label="Início" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                <Input label="Fim" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              {start && end && end <= start && <Notice tone="warn" className="mb-4">O fim da vigência deve ser posterior ao início.</Notice>}
              <ScenarioPicker value={scenarios} onChange={setScenarios} />
              <p className="mt-2 text-xs text-ink-faint">Cada cenário gera uma consulta por fonte. Use variantes só quando necessárias.</p>
            </Section>
          </>
        )}

        {step === 3 && (
          <>
            <Section title="Fontes elegíveis" subtitle="Seguradoras com credenciamento e conexão para este ramo; as demais aparecem com o motivo da exclusão.">
              <SourcesPicker branch={branch} value={sources} onChange={setSources} scenarios={scenarios} onLoaded={(d) => setEligibleCount(d.eligible.length)} />
            </Section>
            <Section title="Compartilhamento de dados"><SharingBasis value={sharing} onChange={setSharing} /></Section>
            <Section title="Resumo">
              <KV items={[
                ['Cliente', client?.name], ['Ramo', branchLabel(branch)], ['Vigência', start && end ? `${fmt(start)} a ${fmt(end)}` : 'não informada'],
                ['Cenários', scenarios.map((s) => SCENARIOS[s].label).join(', ')],
                ['Coberturas mínimas', covs.length ? covs.map((c) => `${c.name}${c.required === false ? ' (desejável)' : ''}`).join('; ') : 'nenhuma'],
                ['Respostas não informadas', `${(schema?.fields || []).filter((f) => risk[f.key] == null || risk[f.key] === '').length} campo(s) seguem vazios`],
              ]} />
            </Section>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn-ghost mr-auto" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft className="h-4 w-4" />Voltar</button>
          {step < 3
            ? <SubmitButton problems={stepProblems[step]} onClick={goNext} onMouseDown={() => step === 1 && missing.length && setHighlight(missing)}>Avançar<ChevronRight className="h-4 w-4" /></SubmitButton>
            : <SubmitButton busy={busy} problems={stepProblems[3]} onClick={submit}>{busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}Criar cotação e distribuir</SubmitButton>}
        </div>
      </div>
    </>
  );
}

// ================= Detalhe da cotação =================
const MANUAL_STATUS = ['pendente_assistida', 'analise_subscricao', 'recusa_informada', 'dados_insuficientes', 'fonte_indisponivel', 'tempo_excedido', 'incompativel', 'cancelada'];
const AUTO_MANUAL_STATUS = ['analise_subscricao', 'recusa_informada', 'cancelada', 'pendente_assistida'];
const RUNNING = ['aguardando', 'executando'];

export function QuoteDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const roundParam = sp.get('round');
  const { company, can, branchLabel } = useAuth();
  const { confirm } = useUI();
  const nav = useNavigate();
  const [run] = useAction();
  const { data, setData, loading, reload } = useFetch(() => api.get(`/v1/quote-requests/${id}${qs({ round: roundParam })}`), [id, roundParam]);
  const [selected, setSelected] = useState([]);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [offerTask, setOfferTask] = useState(null);
  const [statusTask, setStatusTask] = useState(null);
  const [withdraw, setWithdraw] = useState(null);
  const [newRound, setNewRound] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const manage = can('quotes_manage');
  const round = data?.round;
  const soonDays = company?.settings?.quotes?.expiringDays ?? 3;

  // execução retomável das fontes automáticas: chama /run a cada 4 s enquanto houver tarefa automática em curso
  const inFlight = useRef(false);
  const runAuto = useCallback(async (silent) => {
    if (!round || inFlight.current) return;
    inFlight.current = true; setRunning(true);
    try {
      const view = await api.post(`/v1/quote-requests/${id}/rounds/${round.id}/run`);
      setData((d) => (d && d.round?.id === view.id ? { ...d, round: { ...d.round, ...view } } : d));
    } catch (e) { if (!silent) throw e; } finally { inFlight.current = false; setRunning(false); }
  }, [id, round?.id, setData]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoPending = !!round && round.status !== 'cancelada' && round.tasks.some((t) => t.mode === 'automatica' && RUNNING.includes(t.status));
  useEffect(() => {
    if (!autoPending || !manage) return undefined;
    const h = setInterval(() => { runAuto(true); }, 4000);
    return () => clearInterval(h);
  }, [autoPending, manage, runAuto]);

  useEffect(() => { setSelected([]); }, [round?.id]);

  if (loading && !data) return <Loading />;
  if (!data) return <Empty title="Cotação não encontrada" action={<Link to="/cotacoes" className="btn-outline">Voltar</Link>} />;

  const s = round?.summary;
  const offers = (round?.offers || []).filter((o) => showWithdrawn || o.status === 'ativa');
  const withdrawnCount = (round?.offers || []).filter((o) => o.status !== 'ativa').length;
  const cancelled = round?.status === 'cancelada';
  const hasAutoQueued = round?.tasks.some((t) => t.mode === 'automatica' && ['aguardando', 'executando', 'fonte_indisponivel'].includes(t.status));

  const cancelRound = async () => {
    if (!(await confirm({ title: `Cancelar a rodada ${round.round_no}?`, message: 'Tarefas ainda não iniciadas são canceladas. Resultados já recebidos permanecem no histórico desta rodada.', confirmText: 'Cancelar rodada' }))) return;
    const r = await run(() => api.post(`/v1/quote-requests/${id}/rounds/${round.id}/cancel`), 'Rodada cancelada.');
    if (r !== FAIL) reload();
  };

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{data.number_label}<StatusChip map={QUOTE_REQUEST_STATUS} value={data.status} /></span>}
        subtitle={<>{data.title} · <Link to={`/clientes/${data.client_id}`} className="hover:underline">{data.client_name}</Link> · {branchLabel(data.branch)}</>}
        actions={<>
          <Link to="/cotacoes" className="btn-ghost"><ChevronLeft className="h-4 w-4" />Cotações</Link>
          {manage && data.status !== 'cancelada' && <button className="btn-outline" onClick={() => setNewRound(true)}><RefreshCw className="h-4 w-4" />Nova rodada (recalcular)</button>}
          {manage && round && !cancelled && <button className="btn-ghost text-red-600" onClick={cancelRound}><Ban className="h-4 w-4" />Cancelar rodada</button>}
        </>} />

      {!round ? <div className="card"><Empty title="Sem rodadas" text="Crie uma nova rodada para consultar as fontes." /></div> : (
        <div className="space-y-5">
          {data.rounds.length > 1 && (
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Rodada" className="w-full sm:w-80" value={round.id} onChange={(e) => setSp(e.target.value === data.rounds[0].id ? {} : { round: e.target.value })}>
                {data.rounds.map((r) => <option key={r.id} value={r.id}>Rodada {r.round_no} — {humanize(r.status)} — {fmtDateTime(r.created_at)}</option>)}
              </Select>
              {round.id !== data.rounds[0].id && <Notice tone="warn" className="flex-1">Você está vendo uma rodada anterior. Resultados tardios ficam presos à rodada de origem.</Notice>}
            </div>
          )}

          <Section title={`Rodada ${round.round_no} — abrangência da pesquisa`} subtitle={`Criada em ${fmtDateTime(round.created_at)} · questionário ${round.risk_schema_version}`}
            actions={<StatusChip map={QUOTE_REQUEST_STATUS} value={round.status} />}>
            <p className="text-sm">{s?.text}</p>
            {s?.partial && !cancelled && (
              <Notice tone="warn" className="mt-3"><b>Comparação parcial.</b> Há fontes sem resposta ou em consulta assistida. A comparação abaixo mostra apenas o que chegou até agora{autoPending ? '; a tela se atualiza sozinha enquanto as fontes automáticas respondem.' : '.'}</Notice>
            )}
            {cancelled && <Notice tone="danger" className="mt-3">Rodada cancelada em {fmtDateTime(round.cancelled_at)}. Para seguir, crie uma nova rodada.</Notice>}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Seguradoras elegíveis" value={s?.eligible ?? 0} hint={`${s?.consulted_automatically ?? 0} consultada(s) automaticamente`} />
              <Stat label="Cotações válidas" value={s?.valid_quotes ?? 0} hint={`${s?.indicative ?? 0} com valor indicativo`} />
              <Stat label="Análise / recusa" value={`${s?.underwriting ?? 0} / ${s?.refused ?? 0}`} hint="análise de subscrição / recusa informada" />
              <Stat label="Sem resposta / assistidas" value={`${s?.no_answer ?? 0} / ${s?.assisted_pending ?? 0}`} hint="sem resposta não é recusa" />
            </div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink-soft">Parâmetros da rodada</summary>
              <div className="mt-3"><KV cols={2} items={[
                ['Vigência pretendida', round.start_date ? `${fmt(round.start_date)} a ${fmt(round.end_date)}` : 'não informada'],
                ['Base de compartilhamento', round.preferences?.sharing_basis],
                ['Coberturas mínimas', round.min_coverages?.length ? round.min_coverages.map((m) => `${m.name}${m.required === false ? ' (desejável)' : ''}${m.min_limit_cents != null ? ` ≥ ${money(m.min_limit_cents)}` : ''}`).join('; ') : 'nenhuma'],
                ['Assistências desejadas', round.preferences?.assistances?.join(', ') || '—'],
                ['Preferências', [round.preferences?.deductible, round.preferences?.payment, round.preferences?.notes].filter(Boolean).join(' · ') || '—'],
                ['Pesos da pontuação', Object.entries(round.scoring || {}).map(([k, v]) => `${WEIGHT_LABEL[k] || k} ${v}%`).join(', ')],
              ]} /></div>
            </details>
          </Section>

          <Section title="Consultas por seguradora" subtitle="Uma tarefa por fonte e cenário."
            actions={manage && hasAutoQueued && !cancelled && (
              <button className="btn-outline" disabled={running} onClick={() => run(() => runAuto(false), 'Fontes automáticas executadas.')}>
                {running ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />}Executar fontes automáticas
              </button>
            )} bodyClass="p-0">
            <div className="px-4 pt-3"><Notice>Falha técnica, tempo excedido ou ausência de resposta <b>não são recusa</b> da seguradora. Recusa só com resposta expressa, motivo e protocolo.</Notice></div>
            <div className="overflow-x-auto p-4">
              <table className="table-clean">
                <thead><tr><th>Seguradora</th><th>Cenário</th><th>Modo</th><th>Situação</th><th>Motivo / protocolo</th><th>Responsável</th><th>Ações</th></tr></thead>
                <tbody>
                  {round.tasks.map((t) => {
                    const hasOffer = ['cotacao_valida', 'valor_indicativo'].includes(t.status);
                    const assisted = t.mode === 'assistida' || t.status === 'pendente_assistida';
                    const open = !hasOffer && t.status !== 'cancelada' && !cancelled;
                    return (
                      <tr key={t.id}>
                        <td className="font-medium">{t.institution_name}</td>
                        <td>{SCENARIOS[t.scenario]?.label || t.scenario}</td>
                        <td>{MODE[t.mode] || t.mode}</td>
                        <td><span className="inline-flex items-center gap-1.5"><StatusChip map={TASK_STATUS} value={t.status} />{t.status === 'executando' && <Spinner className="h-3.5 w-3.5" />}</span></td>
                        <td className="max-w-xs text-xs">{t.reason || '—'}{t.protocol && <span className="block text-ink-faint">Protocolo: {t.protocol}</span>}</td>
                        <td className="text-xs">{t.assignee_name || '—'}{t.due_at && t.status === 'pendente_assistida' && <span className="block text-ink-faint">prazo {fmtDateTime(t.due_at)}</span>}</td>
                        <td>
                          {manage && open ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {assisted && <button className="btn-primary h-8 px-2.5 text-xs" onClick={() => setOfferTask(t)}><FileUp className="h-3.5 w-3.5" />Registrar resposta</button>}
                              <button className="btn-outline h-8 px-2.5 text-xs" onClick={() => setStatusTask(t)}>Atualizar situação</button>
                            </div>
                          ) : <span className="text-xs text-ink-faint">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Comparação das ofertas" subtitle="Requisitos mínimos primeiro; pontuação só para ofertas que atendem e estão na validade."
            actions={<>
              {withdrawnCount > 0 && <Toggle checked={showWithdrawn} onChange={setShowWithdrawn} label={`Mostrar retiradas (${withdrawnCount})`} />}
              {manage && <SubmitButton problems={!selected.length ? ['Marque, na comparação abaixo, as ofertas que vão ao cliente (caixa ao lado do nome da seguradora).'] : []} onClick={() => setCompOpen(true)}><Send className="h-4 w-4" />Enviar ao cliente ({selected.length})</SubmitButton>}
            </>}>
            {!offers.length ? (
              <Empty title="Nenhuma oferta ainda" text={round.tasks.some((t) => t.status === 'pendente_assistida') ? 'Registre as respostas das consultas assistidas acima para comparar.' : 'Aguarde o retorno das fontes.'} />
            ) : (
              <>
                {manage && <p className="mb-2 text-xs text-ink-faint">Marque as ofertas que vão ao cliente. Ofertas vencidas ou retiradas não podem ser enviadas.</p>}
                <CompareGrid offers={offers} minCoverages={round.min_coverages || []} badges={round.badges} internal soonDays={soonDays}
                  showCommission={can('commissions_view')} selectable={manage} selected={selected}
                  onToggle={(oid) => setSelected((l) => (l.includes(oid) ? l.filter((x) => x !== oid) : [...l, oid]))}
                  actions={manage ? (o) => (o.status === 'ativa'
                    ? <button className="btn-ghost h-8 px-2 text-xs text-red-600" onClick={() => setWithdraw(o)}><Undo2 className="h-3.5 w-3.5" />Retirar oferta</button>
                    : <span className="text-xs text-ink-faint">{o.notes || 'Retirada'}</span>) : null} />
                <div className="mt-3 rounded-app-sm bg-muted px-3 py-2.5 text-xs text-ink-soft">
                  <p className="flex items-start gap-1.5"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span><b>Como a pontuação funciona:</b> regra interna da corretora (não é índice oficial), aplicada somente depois dos requisitos mínimos.
                      Pesos desta rodada: {Object.entries(round.scoring || {}).map(([k, v]) => `${WEIGHT_LABEL[k] || k} ${v}%`).join(' · ')}.
                      Campos não informados ficam fora do cálculo (com aviso) e o peso é redistribuído. Comissão nunca entra na pontuação nem nos destaques.
                      Destaques (Menor custo, Melhor aderência, Maior proteção) só aparecem com evidência suficiente.</span></p>
                </div>
              </>
            )}
          </Section>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Comparativos desta cotação" bodyClass="p-0">
          {data.comparisons?.length ? (
            <ul className="divide-y divide-line">
              {data.comparisons.map((c) => (
                <li key={c.id}><Link to={`/comparativos/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60">
                  <span><span className="font-medium">{docNumber(company?.settings, 'comparison', c.number)}</span>
                    <span className="block text-xs text-ink-faint">{c.offer_ids.length} oferta(s) · {fmtDateTime(c.created_at)}{c.round_id !== round?.id ? ' · outra rodada' : ''}</span></span>
                  <span className="flex items-center gap-2"><StatusChip map={COMPARISON_STATUS} value={c.status} /><ChevronRight className="h-4 w-4 text-ink-faint" /></span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-ink-faint">Nenhum comparativo gerado.</p>}
        </Section>
        <Section title="Propostas desta cotação" bodyClass="p-0">
          {data.proposals?.length ? (
            <ul className="divide-y divide-line">
              {data.proposals.map((p) => (
                <li key={p.id}><Link to={`/propostas/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60">
                  <span><span className="font-medium">{docNumber(company?.settings, 'proposal', p.number)}</span><span className="block text-xs text-ink-faint">{fmtDateTime(p.created_at)}</span></span>
                  <span className="flex items-center gap-2"><StatusChip map={PROPOSAL_STATUS} value={p.status} /><ChevronRight className="h-4 w-4 text-ink-faint" /></span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-ink-faint">Nenhuma proposta criada.</p>}
        </Section>
      </div>

      {offerTask && <RegisterOfferModal task={offerTask} request={data} round={round} onClose={() => setOfferTask(null)} onDone={() => { setOfferTask(null); reload(); }} />}
      {statusTask && <TaskStatusModal task={statusTask} onClose={() => setStatusTask(null)} onDone={() => { setStatusTask(null); reload(); }} />}
      <PromptModal open={!!withdraw} danger title="Retirar oferta" confirmText="Retirar oferta"
        subtitle={withdraw ? `${withdraw.institution_name} — ${withdraw.product_name}. A oferta sai da comparação e fica no histórico.` : ''}
        onClose={() => setWithdraw(null)}
        onSubmit={async (v) => { const r = await run(() => api.post(`/v1/quote-requests/offers/${withdraw.id}/withdraw`, { reason: v.reason }), 'Oferta retirada.'); if (r !== FAIL) { setWithdraw(null); reload(); } }} />
      {compOpen && <NewComparisonModal round={round} offerIds={selected} client={{ id: data.client_id, name: data.client_name }} branchName={branchLabel(data.branch)}
        onClose={() => setCompOpen(false)} onDone={(c) => nav(`/comparativos/${c.id}`)} />}
      {newRound && <NewRoundModal request={data} round={round} onClose={() => setNewRound(false)} onDone={() => { setNewRound(false); setSp({}); if (!roundParam) reload(); }} />}
    </>
  );
}

function NewComparisonModal({ round, offerIds, client, branchName, onClose, onDone }) {
  const { can, company } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const offers = round.offers.filter((o) => offerIds.includes(o.id));
  const first = (client?.name || '').split(' ')[0];
  const [message, setMessage] = useState(() => `Olá${first ? `, ${first}` : ''}! Separei ${offers.length > 1 ? `${offers.length} opções` : 'uma opção'} de seguro para você comparar com calma. Escolha a que preferir direto pelo link — qualquer dúvida, é só me chamar.`);
  const [err, setErr] = useState(null);
  const [created, setCreated] = useState(null);
  const [link, setLink] = useState(null);
  const [phone, setPhone] = useState(null);
  useEffect(() => { if (client?.id) api.get(`/v1/clients/${client.id}`).then((x) => setPhone((x?.client || x)?.phone || null)).catch(() => {}); }, [client?.id]);
  const incompatible = offers.filter((o) => o.comparison?.klass === 'incompativel');
  const indicative = offers.filter((o) => o.quote_kind === 'valor_indicativo');
  const canSend = can('comparisons_send');
  const submit = async () => {
    setErr(null);
    const r = await run(() => api.post('/v1/comparisons', { round_id: round.id, offer_ids: offerIds, message: message.trim() || null }), null,
      (e) => { if (e.code === 'QUOTE_EXPIRED') { setErr(e.message); return true; } return false; });
    if (r === FAIL) return;
    // aprovado e com permissão de envio: o link sai no mesmo passo
    if (r.status !== 'rascunho' && canSend) {
      const l = await run(() => api.post(`/v1/comparisons/${r.id}/link`), 'Comparativo e link gerados.');
      if (l !== FAIL) { setCreated(r); setLink(l); return; }
    } else toast(r.status === 'rascunho' ? 'Comparativo gerado. Ele precisa ser aprovado antes do envio.' : 'Comparativo gerado.');
    onDone(r);
  };
  if (link) {
    return <LinkModal link={link} view={{ client: { name: client?.name }, branch: branchName }} phone={phone} settings={company?.settings} toast={toast} onClose={() => onDone(created)} />;
  }
  return (
    <Modal open onClose={onClose} title={canSend ? 'Enviar comparativo ao cliente' : 'Gerar comparativo para o cliente'} subtitle={`${offers.length} oferta(s) selecionada(s)`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? <Spinner className="h-4 w-4" /> : canSend ? <Send className="h-4 w-4" /> : <FileText className="h-4 w-4" />}{canSend ? 'Gerar link para enviar' : 'Gerar comparativo'}</button></>}>
      <div className="space-y-3">
        <ul className="text-sm">{offers.map((o) => <li key={o.id} className="flex justify-between gap-2 border-b border-line py-1.5"><span>{o.institution_name} — {o.product_name}</span><b className="tabular-nums">{money(o.total_premium_cents)}</b></li>)}</ul>
        {incompatible.length > 0 && <Notice tone="warn">{incompatible.length} oferta(s) não atendem ao mínimo pedido. Elas aparecerão ao cliente identificadas como tal, com as diferenças.</Notice>}
        {indicative.length > 0 && (
          <Notice tone="warn">
            <b>{indicative.length === 1 ? '1 opção tem' : `${indicative.length} opções têm`} valor indicativo</b> ({indicative.map((o) => o.institution_name).join(', ')}): o cliente vê a opção, mas <b>não consegue escolhê-la</b> até a seguradora confirmar o preço. Registre a cotação válida e gere um novo comparativo quando chegar.
          </Notice>
        )}
        {err && <Notice tone="danger">{err} Crie uma nova rodada (recalcular) para obter valores na validade.</Notice>}
        <Textarea label="Mensagem que aparece no topo do link (pode editar)" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        <p className="text-xs text-ink-faint">{canSend ? 'Ao gerar, você recebe o link e a mensagem prontos para enviar pelo WhatsApp. ' : ''}O cliente não vê comissão, notas internas nem dados de credenciais.</p>
      </div>
    </Modal>
  );
}

function TaskStatusModal({ task, onClose, onDone }) {
  const [run, busy] = useAction();
  const allowed = task.mode === 'automatica' ? AUTO_MANUAL_STATUS : MANUAL_STATUS;
  const [status, setStatus] = useState(allowed.find((x) => x !== task.status) || allowed[0]);
  const [reason, setReason] = useState('');
  const [protocol, setProtocol] = useState('');
  const refusal = status === 'recusa_informada';
  const technical = ['fonte_indisponivel', 'tempo_excedido'].includes(status);
  const submit = async () => {
    const r = await run(() => api.put(`/v1/quote-requests/tasks/${task.id}`, { status, reason: reason.trim() || null, protocol: protocol.trim() || null }), 'Situação atualizada.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Atualizar situação da consulta" subtitle={`${task.institution_name} · ${SCENARIOS[task.scenario]?.label || task.scenario} · ${MODE[task.mode]}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit}
        problems={refusal ? [reason.trim().length < 3 && { text: 'Recusa exige o motivo informado pela seguradora.', field: 'Motivo' }, !protocol.trim() && { text: 'Recusa exige o protocolo da resposta.', field: 'Protocolo' }] : []}>Salvar</SubmitButton></>}>
      <div className="space-y-3">
        <Select label="Nova situação" value={status} onChange={(e) => setStatus(e.target.value)}>
          {allowed.map((k) => <option key={k} value={k}>{TASK_STATUS[k]?.label || k}</option>)}
        </Select>
        {refusal && <Notice tone="warn">Recusa só com <b>resposta expressa da seguradora</b>: informe o motivo dado por ela e o protocolo da resposta.</Notice>}
        {technical && <Notice>Problema técnico ou falta de resposta <b>não é recusa</b>: a cotação fica como pesquisa parcial e pode ser repetida ou acompanhada.</Notice>}
        {status === 'analise_subscricao' && <Notice>Uma tarefa de acompanhamento será aberta para a equipe.</Notice>}
        {status === 'pendente_assistida' && task.mode === 'automatica' && <Notice>A consulta passa a ser assistida: a equipe consulta pelo canal oficial e registra a resposta formal.</Notice>}
        <Textarea label={refusal ? 'Motivo informado pela seguradora *' : 'Motivo / observação'} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Input label={refusal ? 'Protocolo da resposta *' : 'Protocolo (opcional)'} value={protocol} onChange={(e) => setProtocol(e.target.value)} />
      </div>
    </Modal>
  );
}

// ---------- Registro de resposta formal (consulta assistida) ----------
const emptyPay = (total = null) => ({ method: 'boleto', installments: 1, first_cents: null, installment_cents: null, total_cents: total, note: '', autoTotal: true });

function RegisterOfferModal({ task, request, round, onClose, onDone }) {
  const { can, meta } = useAuth();
  const [run, busy] = useAction();
  const catalog = meta?.coverage_catalog?.[request.branch] || [];
  const [f, setF] = useState({
    product_name: '', quote_kind: 'cotacao_valida', origin: 'documento_formal', external_id: '', valid_until: addDaysYmd(7),
    premium_net_cents: null, taxes_cents: null, fees_cents: null, total_premium_cents: null, fields_definition: '',
    requirements: '', conditions: '', commission_rate: '', commission_source: 'nao_informada', notes: '',
  });
  const [covs, setCovs] = useState(() => (round.min_coverages || []).map((m) => ({ code: m.code, name: m.name, included: false, limit_cents: null, deductible_text: '', deductible_cents: null, min: m })));
  const [assist, setAssist] = useState('');
  const [pays, setPays] = useState([emptyPay()]);
  const [doc, setDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // à vista (1x) sem total digitado: o total da opção acompanha o prêmio total informado
  useEffect(() => {
    setPays((l) => l.map((p) => (p.autoTotal && Number(p.installments) === 1 && !p.installment_cents ? { ...p, total_cents: f.total_premium_cents } : p)));
  }, [f.total_premium_cents]);
  const patchCov = (i, p) => setCovs((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const patchPay = (i, p) => setPays((l) => l.map((c, j) => {
    if (j !== i) return c;
    const n = { ...c, ...p, ...('total_cents' in p ? { autoTotal: false } : {}) };
    // sugere o total da opção a partir de entrada + parcelas (o usuário pode corrigir)
    if (('first_cents' in p || 'installment_cents' in p || 'installments' in p) && n.installment_cents) {
      n.total_cents = (n.first_cents ?? n.installment_cents) + n.installment_cents * Math.max(0, n.installments - 1);
    }
    return n;
  }));
  const sumParts = f.premium_net_cents != null && f.taxes_cents != null && f.fees_cents != null ? f.premium_net_cents + f.taxes_cents + f.fees_cents : null;
  const sumMismatch = sumParts != null && f.total_premium_cents != null && sumParts !== f.total_premium_cents;

  const upload = async (file) => {
    setUploading(true);
    const r = await run(async () => api.post('/v1/documents', { entity: 'quote_request', entity_id: request.id, client_id: request.client_id, kind: 'cotacao_formal',
      description: `Cotação ${task.institution_name}`, ...(await fileToPayload(file)) }), 'Documento anexado.');
    setUploading(false);
    if (r !== FAIL) setDoc(r);
  };

  const problems = [];
  if (f.product_name.trim().length < 2) problems.push({ text: 'Informe o produto.', field: 'Produto' });
  if (!f.total_premium_cents) problems.push({ text: 'Informe o prêmio total.', field: 'Prêmio total' });
  if (f.quote_kind === 'cotacao_valida') {
    if (f.origin === 'documento_formal' && !doc) problems.push({ text: 'Anexe o documento da cotação (exigido para cotação válida por documento formal).', field: 'Cotação formal' });
    if (f.origin === 'informada_pela_seguradora' && !f.external_id.trim()) problems.push({ text: 'Informe o nº/protocolo da cotação na seguradora.', field: 'Nº / protocolo' });
    if (!f.valid_until) problems.push({ text: 'Informe a validade da cotação.', field: 'Validade' });
  }
  if (f.valid_until && f.valid_until < ymd()) problems.push({ text: 'A validade informada já passou.', field: 'Validade' });
  pays.forEach((p, i) => { if (!p.total_cents) problems.push({ text: `Forma de pagamento ${i + 1}: informe o total da opção (ou remova a linha).`, field: `#pay-total-${i}` }); });

  const submit = async () => {
    const body = {
      product_name: f.product_name.trim(), quote_kind: f.quote_kind, origin: f.origin, external_id: f.external_id.trim() || null, valid_until: f.valid_until || null,
      premium_net_cents: f.premium_net_cents, taxes_cents: f.taxes_cents, fees_cents: f.fees_cents, total_premium_cents: f.total_premium_cents,
      fields_definition: f.fields_definition.trim() || null,
      coverages: covs.filter((c) => c.included && c.code).map((c) => ({ code: c.code, name: c.name, limit_cents: c.limit_cents, deductible_text: c.deductible_text?.trim() || null, deductible_cents: c.deductible_cents })),
      assistances: assist.split(/\n|;/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
      payment_options: pays.map((p) => ({ method: p.method, installments: Number(p.installments) || 1, first_cents: p.first_cents, installment_cents: p.installment_cents, total_cents: p.total_cents, note: p.note?.trim() || null })),
      requirements: f.requirements.trim() || null, conditions: f.conditions.trim() || null, document_id: doc?.id || null, notes: f.notes.trim() || null,
      ...(can('commissions_view') ? { commission_rate: f.commission_rate === '' ? null : Number(f.commission_rate), commission_source: f.commission_source } : {}),
    };
    const r = await run(() => api.post(`/v1/quote-requests/tasks/${task.id}/offers`, body), 'Resposta registrada.');
    if (r !== FAIL) onDone();
  };

  return (
    <Modal open size="xl" onClose={onClose} title="Registrar resposta da seguradora" subtitle={`${task.institution_name} · ${SCENARIOS[task.scenario]?.label || task.scenario} · consulta assistida`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} problems={problems} onClick={submit}>Registrar resposta</SubmitButton>
      </>}>
      <div className="space-y-5">
        <Notice>Transcreva somente o que consta na resposta formal da seguradora. Campo não informado fica em branco — <b>nunca use zero</b> para o que a fonte não informou.</Notice>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Produto *" value={f.product_name} onChange={(e) => set('product_name', e.target.value)} />
          <Input label="Nº / protocolo da cotação na seguradora" value={f.external_id} onChange={(e) => set('external_id', e.target.value)} />
          <Select label="Tipo *" value={f.quote_kind} onChange={(e) => set('quote_kind', e.target.value)}>
            <option value="cotacao_valida">Cotação válida (retorno formal utilizável)</option>
            <option value="valor_indicativo">Valor indicativo (simulação/tabela/estimativa)</option>
          </Select>
          <Select label="Origem *" value={f.origin} onChange={(e) => set('origin', e.target.value)}>
            <option value="documento_formal">Documento formal da seguradora</option>
            <option value="informada_pela_seguradora">Informada pela seguradora (portal/e-mail/telefone)</option>
          </Select>
          <Input label={`Validade${f.quote_kind === 'cotacao_valida' ? ' *' : ''}`} type="date" min={ymd()} value={f.valid_until} onChange={(e) => set('valid_until', e.target.value)} />
          <div>
            <span className="label">Cotação formal (PDF/imagem){f.quote_kind === 'cotacao_valida' && f.origin === 'documento_formal' ? ' *' : ''}</span>
            {doc ? (
              <div className="flex items-center justify-between gap-2 rounded-app-sm border border-line px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-ink-faint" /><span className="truncate">{doc.filename}</span></span>
                <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setDoc(null)}><X className="h-3.5 w-3.5" />Trocar</button>
              </div>
            ) : (
              <FileButton accept="application/pdf,image/png,image/jpeg,image/webp" onFile={upload} disabled={uploading}>
                {uploading ? <Spinner className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}Anexar documento
              </FileButton>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Prêmio</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <CentsInput label="Prêmio total *" value={f.total_premium_cents} onChange={(v) => set('total_premium_cents', v)} />
            <CentsInput label="Prêmio líquido" value={f.premium_net_cents} onChange={(v) => set('premium_net_cents', v)} />
            <CentsInput label="Tributos (IOF)" value={f.taxes_cents} onChange={(v) => set('taxes_cents', v)} />
            <CentsInput label="Custos / adicional" value={f.fees_cents} onChange={(v) => set('fees_cents', v)} />
          </div>
          {sumMismatch && <Notice tone="warn" className="mt-2">Líquido + tributos + custos ({money(sumParts)}) não fecha com o total ({money(f.total_premium_cents)}). Confira os campos da fonte ou deixe em branco o que não foi informado.</Notice>}
          <Input className="mt-3" label="Como a seguradora define esses campos (opcional)" value={f.fields_definition} onChange={(e) => set('fields_definition', e.target.value)} />
        </div>

        <div>
          <h3 className="mb-1 text-sm font-semibold">Coberturas da oferta</h3>
          <p className="mb-2 text-xs text-ink-faint">Linhas sugeridas a partir das coberturas mínimas da rodada. Marque somente o que consta no documento da seguradora.</p>
          <div className="space-y-2">
            {covs.map((c, i) => (
              <div key={i} className={cx('rounded-app-sm border px-3 py-2', c.included ? 'border-primary/40 bg-primary/5' : 'border-line')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={c.included} onChange={(e) => patchCov(i, { included: e.target.checked })} />
                    {c.min ? c.name : (
                      <select className="input h-8 w-60 py-0 text-sm" value={c.code} onChange={(e) => { const cat = catalog.find((x) => x.code === e.target.value); patchCov(i, { code: e.target.value, name: cat?.name || e.target.value, included: true }); }}>
                        <option value="">Escolha a cobertura…</option>
                        {catalog.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                      </select>
                    )}
                    {c.min && <span className="text-xs font-normal text-ink-faint">({c.min.required === false ? 'desejável' : 'exigida'}{c.min.min_limit_cents != null ? `, mín. ${money(c.min.min_limit_cents)}` : ''})</span>}
                  </label>
                  {!c.min && <button className="btn-ghost btn-icon h-7 w-7" aria-label="Remover cobertura" onClick={() => setCovs((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
                {c.included && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <CentsInput label="Limite" value={c.limit_cents} onChange={(v) => patchCov(i, { limit_cents: v })} />
                    <Input label="Franquia (texto da seguradora)" value={c.deductible_text} placeholder="ex.: Franquia normal" onChange={(e) => patchCov(i, { deductible_text: e.target.value })} />
                    <CentsInput label="Franquia (valor)" value={c.deductible_cents} onChange={(v) => patchCov(i, { deductible_cents: v })} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 text-sm" onClick={() => setCovs((l) => [...l, { code: '', name: '', included: true, limit_cents: null, deductible_text: '', deductible_cents: null, min: null }])}><Plus className="h-4 w-4" />Outra cobertura</button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Formas de pagamento</h3>
            <button className="btn-ghost text-sm" onClick={() => setPays((l) => [...l, emptyPay()])}><Plus className="h-4 w-4" />Adicionar opção</button></div>
          <div className="space-y-2">
            {pays.map((p, i) => (
              <div key={i} className="grid items-end gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-[1fr_6rem_1fr_1fr_1fr_auto]">
                <Select label="Meio" value={p.method} onChange={(e) => patchPay(i, { method: e.target.value })}>
                  {Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Input label="Parcelas" type="number" min={1} max={24} value={p.installments} onChange={(e) => patchPay(i, { installments: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })} />
                <CentsInput label="1ª parcela" value={p.first_cents} onChange={(v) => patchPay(i, { first_cents: v })} />
                <CentsInput label="Demais parcelas" value={p.installment_cents} onChange={(v) => patchPay(i, { installment_cents: v })} />
                <CentsInput id={`pay-total-${i}`} label="Total da opção *" hint={p.autoTotal && Number(p.installments) === 1 && f.total_premium_cents ? 'igual ao prêmio total' : undefined} value={p.total_cents} onChange={(v) => patchPay(i, { total_cents: v })} />
                <button className="btn-ghost btn-icon mb-0.5" aria-label="Remover opção" onClick={() => setPays((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {!pays.length && <p className="text-xs text-ink-faint">Nenhuma forma de pagamento informada.</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Textarea label="Assistências (uma por linha)" rows={3} value={assist} onChange={(e) => setAssist(e.target.value)} />
          <Textarea label="Exigências (vistoria, documentos, análise)" rows={3} value={f.requirements} onChange={(e) => set('requirements', e.target.value)} />
          <Textarea label="Condições relevantes" rows={3} value={f.conditions} onChange={(e) => set('conditions', e.target.value)} />
          <Textarea label="Observações internas" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {can('commissions_view') && (
          <div className="rounded-app-sm border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="mb-2 text-sm font-semibold">Comissão — informação interna</p>
            <p className="mb-3 text-xs text-ink-faint">Nunca aparece ao cliente e não entra na pontuação nem nos destaques.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Percentual (%)" type="number" min={0} max={100} step="0.01" value={f.commission_rate} placeholder="não informada" onChange={(e) => set('commission_rate', e.target.value)} />
              <Select label="Fonte" value={f.commission_source} onChange={(e) => set('commission_source', e.target.value)}>
                <option value="nao_informada">Não informada</option><option value="retornada">Retornada pela seguradora</option><option value="condicao_interna">Condição comercial interna</option>
              </Select>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Nova rodada (recalcular) ----------
function NewRoundModal({ request, round, onClose, onDone }) {
  const { meta } = useAuth();
  const [run, busy] = useAction();
  const schema = meta?.risk_schemas?.[request.branch] || request.schema;
  const prevRisk = round?.risk_data || null;
  const [risk, setRisk] = useState(() => (prevRisk ? { ...prevRisk } : {}));
  const [covs, setCovs] = useState(() => (round?.min_coverages || []).map((m) => ({ ...m })));
  const [prefs, setPrefs] = useState(() => ({ assistancesText: (round?.preferences?.assistances || []).join('\n'), notes: round?.preferences?.notes || '', deductible: round?.preferences?.deductible || '', payment: round?.preferences?.payment || '' }));
  const [start, setStart] = useState(round?.start_date ? String(round.start_date).slice(0, 10) : ymd());
  const [end, setEnd] = useState(round?.end_date ? String(round.end_date).slice(0, 10) : addDaysYmd(365));
  const [scenarios, setScenarios] = useState(() => {
    const s = [...new Set((round?.tasks || []).map((t) => t.scenario))].filter((x) => SCENARIOS[x]);
    return s.length ? s : ['minima'];
  });
  const [sources, setSources] = useState('all');
  const [sharing, setSharing] = useState(round?.preferences?.sharing_basis || '');
  const [err, setErr] = useState(null);
  const missing = missingRisk(schema, risk);
  const submit = async () => {
    setErr(null);
    const body = { risk, min_coverages: covs, preferences: prefsPayload(prefs), start_date: start || null, end_date: end || null, sources: sources === 'all' ? [] : sources, scenarios, sharing_basis: sharing.trim() };
    const r = await run(() => api.post(`/v1/quote-requests/${request.id}/rounds`, body), 'Nova rodada criada.', (e) => { setErr(e); return HANDLED.includes(e.code); });
    if (r !== FAIL) onDone(r.round?.id);
  };
  return (
    <Modal open size="xl" onClose={onClose} title="Nova rodada (recalcular)" subtitle="A rodada atual fica preservada; resultados tardios continuam nela."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} onClick={submit} problems={[
          ...missing.map((k) => { const l = (schema?.fields || []).find((x) => x.key === k)?.label || k; return { text: `Preencha “${l}”.`, field: l }; }),
          sharing.trim().length < 3 && { text: 'Informe a base para compartilhar os dados com as seguradoras.', field: 'Base para compartilhar' },
          sources !== 'all' && !sources.length && { text: 'Marque ao menos uma seguradora.' },
          start && end && end <= start && { text: 'O fim da vigência deve ser posterior ao início.', field: 'Fim da vigência' },
        ]}>{busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}Criar rodada</SubmitButton>
      </>}>
      <div className="space-y-5">
        <RoundErrorNotice err={err} clientId={request.client_id} />
        <Notice>{prevRisk
          ? 'Dados do risco, coberturas e preferências vieram da rodada selecionada. Revise tudo antes de recalcular — respostas desconhecidas devem continuar em branco.'
          : 'Os dados do risco da rodada anterior não estão disponíveis aqui: preencha-os novamente. Coberturas e preferências vieram da rodada selecionada.'}</Notice>
        <div><h3 className="mb-3 text-sm font-semibold">Dados do risco</h3><RiskFields schema={schema} value={risk} onChange={setRisk} highlight={err?.code === 'INSUFFICIENT_DATA' ? err.data?.missing || [] : []} /></div>
        <div><h3 className="mb-3 text-sm font-semibold">Coberturas mínimas</h3><CoveragePicker catalog={meta?.coverage_catalog?.[request.branch] || []} value={covs} onChange={setCovs} /></div>
        <div><h3 className="mb-3 text-sm font-semibold">Preferências</h3><PreferencesFields value={prefs} onChange={setPrefs} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Início da vigência" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="Fim da vigência" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div><h3 className="mb-3 text-sm font-semibold">Cenários</h3><ScenarioPicker value={scenarios} onChange={setScenarios} /></div>
        <div><h3 className="mb-3 text-sm font-semibold">Fontes</h3><SourcesPicker branch={request.branch} value={sources} onChange={setSources} scenarios={scenarios} /></div>
        <SharingBasis value={sharing} onChange={setSharing} />
      </div>
    </Modal>
  );
}

// ================= Comparativo =================

/** Visão do comparativo exatamente como o cliente vê (sem comissão). */
export function ClientComparisonView({ view, printMode }) {
  const chosen = view.offers.find((o) => o.id === view.chosen_offer_id);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="block text-xs text-ink-faint">Corretora</span><b>{view.broker?.name}</b>{view.broker?.susep_code && <span className="block text-xs text-ink-faint">SUSEP {view.broker.susep_code}</span>}</div>
        <div><span className="block text-xs text-ink-faint">Cliente</span>{view.client?.name}</div>
        <div><span className="block text-xs text-ink-faint">Ramo</span>{view.branch || '—'}</div>
        <div><span className="block text-xs text-ink-faint">Vigência pretendida</span>{view.period?.start ? `${fmt(view.period.start)} a ${fmt(view.period.end)}` : 'não informada'}</div>
      </div>
      {view.message && <div className="whitespace-pre-line rounded-app-sm bg-muted px-3 py-2.5 text-sm">{view.message}</div>}
      {chosen && (
        <Notice tone="ok"><b>Opção escolhida:</b> {chosen.institution_name} — {chosen.product_name}{view.chosen_at && ` em ${fmtDateTime(view.chosen_at)}`}.
          {' '}A escolha ainda não é aceitação da seguradora.</Notice>
      )}
      <CompareGrid offers={view.offers} minCoverages={view.min_coverages || []} badges={view.badges} chosenId={view.chosen_offer_id} chosenPayment={view.chosen_payment_option} printMode={printMode} />
      <p className="text-xs text-ink-faint">{view.notice}</p>
    </div>
  );
}

export function ComparisonDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { company, can, branchLabel } = useAuth();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const { data: c, loading, reload } = useFetch(() => api.get(`/v1/comparisons/${id}`), [id]);
  const [link, setLink] = useState(null);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [phone, setPhone] = useState(null);
  const [propErr, setPropErr] = useState(null);
  useEffect(() => { if (c?.client_id) api.get(`/v1/clients/${c.client_id}`).then((x) => setPhone((x?.client || x)?.phone || null)).catch(() => {}); }, [c?.client_id]);

  if (loading && !c) return <Loading />;
  if (!c) return <Empty title="Comparativo não encontrado" />;
  const view = c.view;
  const canSend = can('comparisons_send');
  const open = ['aprovado', 'enviado'].includes(c.status);
  const activeLinks = (c.links || []).filter((l) => !l.revoked_at && new Date(l.expires_at) > new Date());

  const approve = async () => { const r = await run(() => api.post(`/v1/comparisons/${id}/approve`), 'Comparativo aprovado para envio.'); if (r !== FAIL) reload(); };
  const genLink = async () => {
    const r = await run(() => api.post(`/v1/comparisons/${id}/link`), 'Link gerado.');
    if (r !== FAIL) { setLink(r); reload(); }
  };
  const revoke = async (l) => {
    if (!(await confirm({ title: 'Revogar link?', message: 'O cliente não conseguirá mais abrir o comparativo por este link.', confirmText: 'Revogar' }))) return;
    const r = await run(() => api.post(`/v1/comparisons/${id}/links/${l.id}/revoke`), 'Link revogado.');
    if (r !== FAIL) reload();
  };
  const createProposal = async () => {
    setPropErr(null);
    const r = await run(() => api.post('/v1/proposals', { offer_id: c.chosen_offer_id, comparison_id: c.id }), 'Proposta criada.',
      (e) => { if (e.code === 'QUOTE_EXPIRED') { setPropErr(e.message); return true; } return false; });
    if (r !== FAIL) nav(`/propostas/${r.id}`);
  };

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">Comparativo {view.number}<StatusChip map={COMPARISON_STATUS} value={c.status} /></span>}
        subtitle={<>{view.client?.name} · {view.branch || branchLabel(c.branch)} · criado em {fmtDateTime(c.created_at)}</>}
        actions={<>
          <Link to={`/cotacoes/${c.request_id}?round=${c.round_id}`} className="btn-ghost"><ChevronLeft className="h-4 w-4" />Cotação</Link>
          <button className="btn-outline" onClick={() => window.open(appUrl(`/imprimir/comparativo/${id}`), '_blank', 'noopener')}><Printer className="h-4 w-4" />Imprimir / PDF</button>
          {c.status === 'rascunho' && canSend && <button className="btn-primary" disabled={busy} onClick={approve}><Check className="h-4 w-4" />Aprovar para envio</button>}
          {open && canSend && <button className="btn-primary" disabled={busy} onClick={genLink}><Link2 className="h-4 w-4" />Gerar link para o cliente</button>}
          {open && can('quotes_manage') && <button className="btn-outline" onClick={() => setChooseOpen(true)}><Check className="h-4 w-4" />Registrar escolha do cliente</button>}
        </>} />

      <div className="space-y-5">
        {c.status === 'rascunho' && <Notice tone="warn">A política da corretora exige aprovação antes do envio ao cliente.</Notice>}
        {c.status === 'escolhido' && (
          <Section title="Escolha do cliente">
            <KV cols={4} items={[
              ['Opção', (() => { const o = view.offers.find((x) => x.id === c.chosen_offer_id); return o ? `${o.institution_name} — ${o.product_name}` : '—'; })()],
              ['Forma de pagamento', (() => { const o = view.offers.find((x) => x.id === c.chosen_offer_id); const p = o?.payment_options?.find((x) => x.id === c.chosen_payment_option); return p ? `${payLabel(p.method)} ${p.installments}x — ${money(p.total_cents)}` : 'não indicada'; })()],
              ['Registrada por', `${c.chosen_by_name || '—'} (${VIA[c.chosen_via] || c.chosen_via || '—'})`],
              ['Quando', fmtDateTime(c.chosen_at)],
            ]} />
            <Notice className="mt-3">A escolha do cliente não é aceitação da seguradora: o próximo passo é a proposta, com autorização para esta opção exata e transmissão.</Notice>
            {propErr && <Notice tone="danger" className="mt-3">{propErr} <Link to={`/cotacoes/${c.request_id}`} className="font-medium underline">Abrir a cotação para recalcular</Link></Notice>}
            {can('proposals_manage') && <div className="mt-3"><button className="btn-primary" disabled={busy} onClick={createProposal}><Send className="h-4 w-4" />Criar proposta</button></div>}
          </Section>
        )}

        <Section title="Como o cliente vê" subtitle="Projeção sem comissão, notas internas ou dados de credenciais.">
          <ClientComparisonView view={view} />
        </Section>

        {can('commissions_view') && c.internal_offers?.some((o) => o.commission_rate != null) && (
          <Section title="Informação interna (não aparece ao cliente)" className="border-amber-500/30">
            <ul className="space-y-1 text-sm">{c.internal_offers.map((o) => <li key={o.id}>{o.institution_name} — {o.product_name}: comissão {o.commission_rate == null ? 'não informada' : pct(o.commission_rate)}{COMMISSION_SOURCE[o.commission_source] ? ` (${COMMISSION_SOURCE[o.commission_source]})` : ''}</li>)}</ul>
          </Section>
        )}

        <Section title="Links enviados ao cliente" subtitle="Temporários, revogáveis e de finalidade única. O endereço só é exibido no momento da geração." bodyClass="p-0">
          {c.links?.length ? (
            <div className="overflow-x-auto p-4">
              <table className="table-clean">
                <thead><tr><th>Gerado em</th><th>Expira em</th><th>Situação</th><th>Acessos</th><th>Último acesso</th><th></th></tr></thead>
                <tbody>
                  {c.links.map((l) => {
                    const st = l.revoked_at ? 'Revogado' : new Date(l.expires_at) < new Date() ? 'Expirado' : 'Ativo';
                    return (
                      <tr key={l.id}>
                        <td>{fmtDateTime(l.created_at)}</td><td>{fmtDateTime(l.expires_at)}</td>
                        <td><span className={cx('chip', st === 'Ativo' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300')}>{st}</span></td>
                        <td className="tabular-nums">{l.access_count}</td><td>{l.last_access_at ? fmtDateTime(l.last_access_at) : '—'}</td>
                        <td>{st === 'Ativo' && canSend && <button className="btn-ghost h-8 px-2 text-xs text-red-600" onClick={() => revoke(l)}><Ban className="h-3.5 w-3.5" />Revogar</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="px-4 py-6 text-sm text-ink-faint">Nenhum link gerado.{activeLinks.length ? '' : ''}</p>}
        </Section>
      </div>

      {link && <LinkModal link={link} view={view} phone={phone} settings={company?.settings} onClose={() => setLink(null)} toast={toast} />}
      {chooseOpen && <ChooseModal comparison={c} onClose={() => setChooseOpen(false)} onDone={() => { setChooseOpen(false); reload(); }} />}
    </>
  );
}

function LinkModal({ link, view, phone, settings, onClose, toast }) {
  const url = appUrl(link.path);
  const text = fillTemplate(settings?.whatsapp?.comparison || 'Olá {cliente}! Segue o comparativo do seu seguro ({ramo}): {link}', { cliente: view.client?.name?.split(' ')[0] || '', ramo: view.branch || '', link: url });
  const wa = waLink(phone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
  const copy = async (v) => { try { await navigator.clipboard.writeText(v); toast('Copiado.'); } catch { toast('Não foi possível copiar. Selecione e copie manualmente.', 'error'); } };
  return (
    <Modal open onClose={onClose} title="Link do comparativo" subtitle={`Válido por ${link.expires_days} dia(s). Guarde agora: por segurança ele não é exibido de novo.`}
      footer={<button className="btn-primary" onClick={onClose}>Concluir</button>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input flex-1 font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Endereço do link" />
          <button className="btn-outline" onClick={() => copy(url)}><Copy className="h-4 w-4" />Copiar</button>
        </div>
        <Textarea label="Mensagem" rows={4} readOnly value={text} />
        <div className="flex flex-wrap gap-2">
          <a className="btn-primary" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" />Enviar pelo WhatsApp</a>
          <button className="btn-outline" onClick={() => copy(text)}><Copy className="h-4 w-4" />Copiar mensagem</button>
          <a className="btn-ghost" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Abrir</a>
        </div>
        {!phone && <p className="text-xs text-ink-faint">Cliente sem telefone cadastrado: o WhatsApp abrirá para você escolher o contato.</p>}
      </div>
    </Modal>
  );
}

function ChooseModal({ comparison, onClose, onDone }) {
  const [run, busy] = useAction();
  // valor indicativo não pode ser escolhido (a seguradora precisa confirmar o preço antes)
  const offers = comparison.view.offers.filter((o) => !o.expired && (!o.quote_kind || o.quote_kind === 'cotacao_valida'));
  const blocked = comparison.view.offers.filter((o) => !o.expired && o.quote_kind && o.quote_kind !== 'cotacao_valida');
  const [offerId, setOfferId] = useState(offers[0]?.id || '');
  const offer = offers.find((o) => o.id === offerId);
  const [pay, setPay] = useState('');
  const [via, setVia] = useState('whatsapp');
  const [name, setName] = useState(comparison.view.client?.name || '');
  useEffect(() => { setPay(offer?.payment_options?.[0]?.id || ''); }, [offerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const r = await run(() => api.post(`/v1/comparisons/${comparison.id}/choose`, { offer_id: offerId, payment_option: pay || null, via, by_name: name.trim() }), 'Escolha registrada.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Registrar escolha do cliente" subtitle="Manifestação do cliente — não é aceitação da seguradora."
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit}
        problems={[!offerId && { text: offers.length ? 'Escolha a opção.' : 'Não há opção com cotação válida para registrar.', field: 'Opção escolhida' }, name.trim().length < 2 && { text: 'Informe o nome de quem escolheu.', field: 'Nome de quem escolheu' }]}>Registrar escolha</SubmitButton></>}>
      {blocked.length > 0 && <Notice tone="warn" className="mb-3">{blocked.map((o) => o.institution_name).join(', ')}: valor indicativo — só pode ser escolhida depois que a seguradora confirmar o preço.</Notice>}
      <div className="space-y-3">
        {offers.length < comparison.view.offers.length && <Notice tone="warn">Opções vencidas não podem ser escolhidas: recalcule a cotação.</Notice>}
        <Select label="Opção escolhida" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
          {offers.map((o) => <option key={o.id} value={o.id}>{o.institution_name} — {o.product_name} — {money(o.total_premium_cents)}</option>)}
        </Select>
        {offer?.payment_options?.length > 0 && (
          <Select label="Forma de pagamento" value={pay} onChange={(e) => setPay(e.target.value)}>
            {offer.payment_options.map((p) => <option key={p.id} value={p.id}>{payLabel(p.method)} {p.installments}x — total {money(p.total_cents)}</option>)}
          </Select>
        )}
        <Select label="Canal" value={via} onChange={(e) => setVia(e.target.value)}>
          {['presencial', 'telefone', 'whatsapp', 'email'].map((k) => <option key={k} value={k}>{VIA[k]}</option>)}
        </Select>
        <Input label="Nome de quem escolheu" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
    </Modal>
  );
}
