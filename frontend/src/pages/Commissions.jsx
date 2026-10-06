// Comissões da corretora (14, 17.1): a receber, liquidações, extratos da seguradora, acordos e contestações.
// Previsão nunca é somada ao confirmado; liquidação aloca o valor BRUTO; retenção não vira saldo em aberto.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, CheckCircle2, Scale, MessageSquareWarning, Info, Undo2, Upload, FileSpreadsheet, Link2, Landmark, Clock, AlertTriangle, TrendingUp, Wallet, RotateCcw, FileText,
  MoreHorizontal, ChevronDown, Download, CheckSquare,
} from 'lucide-react';
import { api, idemKey, fileToText, qs } from '../lib/api';
import { money, fmt, fmtDateTime, ymd, pct, docNumber, COMMISSION_STATUS, LINE_STATUS, ACCRUAL_KIND, ACCRUAL_STATUS, BRANCHES } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  PageHeader, Section, KV, Tabs, Stat, Modal, PromptModal, Input, Textarea, Select, Toggle, CentsInput, FileButton, StatusChip, Notice, Empty, Loading, Spinner,
  useFetch, useAction, FAIL, cx, SubmitButton, Hint,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { STATEMENT_FIELDS, csvRows, xlsxRows, isSheet, isOldSheet, splitHeader, guessMapping, isNativeCsv, toCanonicalCsv, TEMPLATE_CSV } from '../lib/statement';

const TABS = [
  { value: 'a_receber', label: 'A receber' },
  { value: 'liquidacoes', label: 'Liquidações' },
  { value: 'extratos', label: 'Extratos da seguradora' },
  { value: 'acordos', label: 'Acordos e regras' },
  { value: 'contestacoes', label: 'Contestações' },
];

const MATCH_STATUS = {
  conciliavel: { label: 'Conciliável', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  divergente: { label: 'Divergente', cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  pendente: { label: 'Pendente', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
};
const DISPUTE_STATUS = {
  aberta: { label: 'Aberta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  enviada: { label: 'Enviada', cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
  respondida: { label: 'Respondida', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  encerrada: { label: 'Encerrada', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
};
const BASE_DEF = { premio_liquido: 'Prêmio líquido', premio_total: 'Prêmio total', outra: 'Outra base documentada' };
const ADJ_KIND = { credito: 'Crédito', debito: 'Débito', estorno: 'Estorno' };
const LINE_KIND = { comissao: 'Comissão', estorno: 'Estorno', bonus: 'Bônus', adiantamento: 'Adiantamento', ajuste: 'Ajuste' };

const Num = ({ v, className }) => <span className={cx('tabular-nums', Number(v) < 0 && 'text-red-600 dark:text-red-400', className)}>{money(v)}</span>;
const smallBtn = 'btn-ghost h-8 px-2 text-xs';

function useInstitutions() {
  const { data } = useFetch(() => api.get('/v1/catalog/institutions'), []);
  return data || [];
}

export default function Commissions() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'a_receber';
  const { can } = useAuth();
  const setTab = (t) => setParams({ tab: t });
  return (
    <div>
      <PageHeader title="Comissões" subtitle="Comissão da corretora: previsão, confirmação, liquidação pela seguradora e conciliação. Prêmio do cliente e repasses ficam em telas próprias."
        actions={tab === 'liquidacoes' && can('commissions_settle') && (
          <button className="btn-primary" onClick={() => setParams({ tab: 'liquidacoes', nova: '1' })}><Plus className="h-4 w-4" /> Nova liquidação</button>
        )} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'a_receber' && <Receivables />}
      {tab === 'liquidacoes' && <Settlements />}
      {tab === 'extratos' && <Statements />}
      {tab === 'acordos' && <Agreements />}
      {tab === 'contestacoes' && <Disputes />}
    </div>
  );
}

// =====================================================================================
// A receber
// =====================================================================================
function Receivables() {
  const { can } = useAuth();
  const institutions = useInstitutions();
  const [status, setStatus] = useState('');
  const [inst, setInst] = useState('');
  const [open, setOpen] = useState(true);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/commissions/receivables${qs({ status, institution_id: inst, open: open ? 1 : '' })}`), [status, inst, open]);
  const items = data?.items || [];
  const t = useTable(items, { sort: 'due_date', get: { client: (r) => r.client_name, balance: (r) => r.balance_cents ?? -1 } });
  const [modal, setModal] = useState(null); // { kind, row }
  const close = () => setModal(null);
  const done = () => { close(); reload(); };
  const tot = data?.totals;
  const def = data?.definitions || {};

  const [allTotals, setAllTotals] = useState(false);
  const [sel, setSel] = useState([]);
  const [bulk, setBulk] = useState(false);
  const selectable = items.filter((r) => r.confirmed_cents == null);
  const toggleSel = (id) => setSel((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  useEffect(() => { setSel((l) => l.filter((id) => items.some((r) => r.id === id))); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      {tot && (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Saldo confirmado a receber" value={money(tot.open_confirmed_cents)} hint="O que a seguradora já confirmou e ainda não pagou." icon={Wallet} />
            <Stat label="Vencido (confirmado)" value={money(tot.overdue_cents)} hint={Number(tot.overdue_cents) ? 'Cobrar a seguradora.' : 'Nada vencido.'} icon={Clock} tone={Number(tot.overdue_cents) ? 'text-red-600' : undefined} />
            <Stat label="Previsão — ainda não confirmada" value={money(tot.projected_cents)} hint="Estimativa pela regra do acordo; pode mudar." icon={TrendingUp} />
          </div>
          <button type="button" className="btn-ghost h-8 px-2 text-xs" aria-expanded={allTotals} onClick={() => setAllTotals((v) => !v)}>
            <ChevronDown className={cx('h-3.5 w-3.5 transition', !allTotals && '-rotate-90')} /> {allTotals ? 'Ocultar' : 'Ver'} todos os totais
            {Number(tot.divergent) > 0 && <span className="chip bg-orange-500/15 text-orange-700 dark:text-orange-300">{tot.divergent} divergência(s)</span>}
          </button>
          {allTotals && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Confirmado (devido)" value={money(tot.confirmed_cents)} hint={def.confirmed} icon={CheckCircle2} tone="text-sky-600" />
              <Stat label="Liquidado (bruto)" value={money(tot.settled_cents)} hint={def.settled} icon={Landmark} tone="text-emerald-600" />
              <Stat label="Estornado" value={money(tot.reversed_cents)} hint="Estornos lançados como ajuste vinculado." icon={RotateCcw} />
              <Stat label="Divergências" value={tot.divergent} hint="Comissões com linha de extrato divergente." icon={AlertTriangle} tone={tot.divergent ? 'text-orange-600' : undefined} />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
          <option value="">Todas</option>
          {Object.entries(COMMISSION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select label="Seguradora" value={inst} onChange={(e) => setInst(e.target.value)} className="w-full sm:w-56">
          <option value="">Todas</option>
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <div className="w-full sm:w-56"><Toggle checked={open} onChange={setOpen} label="Somente com saldo em aberto" hint="Inclui previsões ainda não confirmadas" /></div>
        {can('commissions_settle') && selectable.length > 0 && (
          <button className="btn-outline sm:ml-auto" onClick={() => (sel.length ? setBulk(true) : setSel(selectable.map((r) => r.id)))}>
            <CheckSquare className="h-4 w-4" /> {sel.length ? `Confirmar selecionadas (${sel.length})` : 'Selecionar não confirmadas'}
          </button>
        )}
      </div>

      {loading && !data ? <Loading /> : !items.length ? (
        <div className="card"><Empty title="Nenhuma comissão encontrada" text="As comissões nascem do calendário de cada apólice, a partir da regra (snapshot) do acordo com a seguradora." /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <SortTh t={t} k="client">Apólice / cliente</SortTh>
                <SortTh t={t} k="due_date">Parcela e vencimento</SortTh>
                <th className="text-right">Previsto</th>
                <SortTh t={t} k="balance" className="text-right">Saldo confirmado</SortTh>
                <SortTh t={t} k="status">Situação</SortTh>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => {
                const canSel = r.confirmed_cents == null;
                return (
                  <tr key={r.id}>
                    <td data-label="Apólice">
                      <div className="flex items-start gap-2.5">
                        {can('commissions_settle') && (canSel
                          ? <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={sel.includes(r.id)} onChange={() => toggleSel(r.id)} aria-label={`Selecionar parcela ${r.installment_no} da apólice ${r.policy_number}`} />
                          : <span className="w-4 shrink-0" />)}
                        <div className="min-w-0">
                          <Link to={`/apolices/${r.policy_id}`} className="font-medium text-primary hover:underline">{r.policy_number || 'sem número'}</Link>
                          <div className="text-xs text-ink-faint">{r.client_name} · {r.institution_name}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Parcela" className="tabular-nums">{r.installment_no}/{r.installments_total} · {fmt(r.due_date)}</td>
                    <td data-label="Previsto" className="text-right text-ink-soft"><Num v={r.expected_cents} /></td>
                    <td data-label="Saldo confirmado" className="text-right font-medium">{r.balance_cents == null ? <span className="text-xs font-normal text-ink-faint">aguardando confirmação</span> : <Num v={r.balance_cents} />}</td>
                    <td data-label="Situação">
                      <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                        <StatusChip map={COMMISSION_STATUS} value={r.status} />
                        {r.adjusted && r.status !== 'ajustada' && <StatusChip map={COMMISSION_STATUS} value="ajustada" />}
                      </div>
                    </td>
                    <td data-label="">
                      <div className="flex items-center justify-end gap-1">
                        {can('commissions_settle') && <button className={smallBtn} onClick={() => setModal({ kind: 'confirm', row: r })}><CheckCircle2 className="h-3.5 w-3.5" /> Confirmar</button>}
                        <RowMenu items={[
                          { label: 'Detalhes e valores', icon: Info, onClick: () => setModal({ kind: 'info', row: r }) },
                          can('commissions_adjust') && { label: 'Ajuste ou estorno', icon: Scale, onClick: () => setModal({ kind: 'adjust', row: r }) },
                          can('commissions_adjust') && { label: 'Contestar com a seguradora', icon: MessageSquareWarning, onClick: () => setModal({ kind: 'contest', row: r }) },
                        ]} label={`Mais ações da parcela ${r.installment_no} da apólice ${r.policy_number}`} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}

      <ReceivableInfo row={modal?.kind === 'info' ? modal.row : null} onClose={close} />
      <ConfirmModal row={modal?.kind === 'confirm' ? modal.row : null} onClose={close} onDone={done} />
      <AdjustModal row={modal?.kind === 'adjust' ? modal.row : null} onClose={close} onDone={reload} />
      <ContestModal row={modal?.kind === 'contest' ? modal.row : null} onClose={close} onDone={done} />
      {bulk && <BulkConfirmModal rows={items.filter((r) => sel.includes(r.id))} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setSel([]); reload(); }} />}
    </div>
  );
}

/** Menu "mais ações" com rótulos (evita botões só com ícone). */
function RowMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const list = items.filter(Boolean);
  useEffect(() => {
    if (!open) return undefined;
    const h = () => setOpen(false);
    const k = (e) => e.key === 'Escape' && setOpen(false);
    setTimeout(() => document.addEventListener('click', h), 0);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('click', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="relative">
      <button type="button" className="btn-ghost btn-icon h-8" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <div role="menu" className="card animate-pop absolute right-0 top-full z-30 mt-1 w-60 p-1 text-left text-sm">
          {list.map((i) => (
            <button key={i.label} role="menuitem" type="button" className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 text-left hover:bg-muted" onClick={() => { setOpen(false); i.onClick(); }}>
              <i.icon className="h-4 w-4 text-ink-faint" />{i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Confirma várias comissões de uma vez pelo valor previsto (mesma fonte de confirmação). */
function BulkConfirmModal({ rows, onClose, onDone }) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const total = rows.reduce((a, r) => a + Number(r.expected_cents || 0), 0);
  const submit = async () => {
    setBusy(true);
    const errors = [];
    let okCount = 0;
    for (const r of rows) {
      try { await api.post(`/v1/commissions/receivables/${r.id}/confirm`, { confirmed_cents: r.expected_cents, source: source.trim() }); okCount += 1; }
      catch (e) { errors.push(`${r.policy_number} ${r.installment_no}/${r.installments_total}: ${e.message}`); }
    }
    setBusy(false);
    setResult({ okCount, errors });
  };
  return (
    <Modal open onClose={result ? onDone : onClose} title={result ? 'Confirmação concluída' : `Confirmar ${rows.length} comissão(ões)`}
      subtitle={result ? null : `Total previsto: ${money(total)}`}
      footer={result ? <button className="btn-primary" onClick={onDone}>Concluir</button> : <>
        <button className="btn-ghost" onClick={onClose}>Voltar</button>
        <SubmitButton busy={busy} problems={source.trim().length < 3 ? [{ text: 'Informe a fonte da confirmação (ex.: extrato de 09/2026).', field: 'Fonte da confirmação' }] : []} onClick={submit}>
          {busy ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar pelo valor previsto
        </SubmitButton></>}>
      {result ? (
        <div className="space-y-3">
          <Notice tone={result.errors.length ? 'warn' : 'ok'}>{result.okCount} confirmada(s){result.errors.length ? `; ${result.errors.length} não puderam ser confirmadas.` : '.'}</Notice>
          {result.errors.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-ink-soft">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      ) : (
        <div className="space-y-3">
          <Notice>Cada parcela será confirmada pelo <b>valor previsto</b> pela regra. Se a seguradora informou valor diferente, use “Confirmar” na linha (ou importe o extrato e concilie).</Notice>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-app-sm border border-line text-sm">
            {rows.map((r) => <li key={r.id} className="flex justify-between gap-3 px-3 py-1.5"><span>{r.policy_number} · {r.installment_no}/{r.installments_total} · {fmt(r.due_date)}</span><Num v={r.expected_cents} /></li>)}
          </ul>
          <Input label="Fonte da confirmação" placeholder="Ex.: extrato da seguradora de 09/2026" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

function ReceivableInfo({ row, onClose }) {
  const s = row?.rule_snapshot || {};
  return (
    <Modal open={!!row} onClose={onClose} size="lg" title={`Comissão — apólice ${row?.policy_number || ''}`} subtitle={row && `${row.client_name} · ${row.institution_name} · parcela ${row.installment_no}/${row.installments_total}`}>
      {row && (
        <div className="space-y-4">
          <KV cols={3} items={[
            ['Previsto (projeção)', money(row.expected_cents)],
            ['Confirmado', row.confirmed_cents == null ? 'não confirmado' : money(row.confirmed_cents)],
            ['Fonte da confirmação', row.confirmation_source],
            ['Créditos', money(row.credit_cents)],
            ['Débitos e estornos', money(row.debit_cents)],
            ['dos quais estornos', money(row.reversal_cents)],
            ['Liquidado (bruto alocado)', money(row.allocated_cents)],
            ['Devido confirmado', row.due_cents == null ? '—' : money(row.due_cents)],
            ['Saldo confirmado', row.balance_cents == null ? '—' : money(row.balance_cents)],
            ['Vencimento', fmt(row.due_date)],
            ['Categoria', row.category],
            ['Situação', <StatusChip key="s" map={COMMISSION_STATUS} value={row.status} />],
          ]} />
          <Section title="Regra aplicada (snapshot no contrato)" subtitle="Mudanças futuras no acordo não recalculam esta comissão.">
            <KV cols={3} items={[
              ['Acordo', s.agreement], ['Versão', s.version ? `v${s.version}` : '—'],
              ['Tipo', s.kind === 'fixo' ? `Valor fixo ${money(s.fixed_cents)}` : s.rate != null ? `${pct(s.rate)}` : '—'],
              ['Base', BASE_DEF[s.base_definition] || s.base_definition], ['Base comissionável', money(s.base_cents ?? row.base_cents)],
              ['Calendário', s.schedule === 'parcelada' ? `Parcelada em ${s.installments}x` : 'Única'],
            ]} />
          </Section>
          <p className="text-xs text-ink-faint">Saldo confirmado = confirmado + créditos − liquidações alocadas (bruto) − débitos/estornos. Retenções informadas na liquidação não geram saldo em aberto.</p>
        </div>
      )}
    </Modal>
  );
}

function ConfirmModal({ row, onClose, onDone }) {
  const [v, setV] = useState({});
  const [run, busy] = useAction();
  useEffect(() => { if (row) setV({ confirmed_cents: row.confirmed_cents ?? row.expected_cents, source: '', due_date: row.due_date || '' }); }, [row]);
  const submit = async () => {
    const r = await run(() => api.post(`/v1/commissions/receivables/${row.id}/confirm`, { confirmed_cents: v.confirmed_cents, source: v.source, ...(v.due_date ? { due_date: v.due_date } : {}) }), 'Valor confirmado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open={!!row} onClose={onClose} title="Confirmar valor da comissão" subtitle={row && `Apólice ${row.policy_number} · parcela ${row.installment_no}/${row.installments_total}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit}
        problems={[v.confirmed_cents == null && { text: 'Informe o valor confirmado.', field: 'Valor confirmado' }, String(v.source || '').trim().length < 3 && { text: 'Informe a fonte da confirmação (mín. 3 caracteres).', field: 'Fonte da confirmação' }]}>Confirmar valor</SubmitButton></>}>
      {row && (
        <div className="space-y-3">
          <Notice>Previsto pela regra: <b>{money(row.expected_cents)}</b>. Confirme o valor informado pela seguradora (extrato, portal, e-mail formal). Já liquidado: {money(row.allocated_cents)} — o confirmado não pode ficar abaixo disso.</Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            <CentsInput label="Valor confirmado" value={v.confirmed_cents} onChange={(c) => setV({ ...v, confirmed_cents: c })} allowEmpty={false} />
            <Input label="Vencimento" type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} />
          </div>
          <Input label="Fonte da confirmação" placeholder="Ex.: extrato da seguradora de 09/2026" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} />
        </div>
      )}
    </Modal>
  );
}

function AdjustModal({ row, onClose, onDone }) {
  const [v, setV] = useState({});
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (row) { setV({ kind: 'estorno', amount_cents: null, reason: '', evidence: '' }); setResult(null); } }, [row]);
  const submit = async () => {
    const r = await run(() => api.post(`/v1/commissions/receivables/${row.id}/adjustments`, v), `${ADJ_KIND[v.kind]} registrado.`);
    if (r === FAIL) return;
    onDone();
    if (v.kind === 'estorno') setResult(r); else onClose();
  };
  const ok = v.amount_cents > 0 && String(v.reason || '').trim().length >= 3 && String(v.evidence || '').trim().length >= 3;
  const fx = result?.split_effects || [];
  const reduce = fx.filter((x) => x.kind === 'reducao').reduce((a, x) => a + Number(x.amount_cents), 0);
  const recover = fx.filter((x) => x.kind === 'recuperacao').reduce((a, x) => a + Number(x.amount_cents), 0);
  return (
    <Modal open={!!row} onClose={onClose} size={result ? 'lg' : 'md'} title={result ? 'Estorno registrado — efeito nos repasses' : 'Ajuste ou estorno da comissão'}
      subtitle={row && `Apólice ${row.policy_number} · parcela ${row.installment_no}/${row.installments_total}`}
      footer={result ? <button className="btn-primary" onClick={onClose}>Concluir</button>
        : <><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton className={v.kind === 'estorno' ? 'btn-danger' : 'btn-primary'} busy={busy} onClick={submit} problems={[!(v.amount_cents > 0) && { text: 'Informe o valor.', field: 'Valor' }, String(v.reason || '').trim().length < 3 && { text: 'Informe o motivo.', field: 'Motivo' }, String(v.evidence || '').trim().length < 3 && { text: 'Informe a evidência.', field: 'Evidência' }]}>Registrar {ADJ_KIND[v.kind]?.toLowerCase()}</SubmitButton></>}>
      {row && !result && (
        <div className="space-y-3">
          <Notice tone="info">Ajustes são lançamentos vinculados — os recebimentos anteriores são preservados. {row.confirmed_cents == null && 'Esta comissão ainda não foi confirmada: crédito/débito exigem confirmação; um estorno confirma a previsão pelo valor original para manter o rastro.'}</Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Tipo" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              <option value="estorno">Estorno (seguradora)</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
            </Select>
            <CentsInput label="Valor" value={v.amount_cents} onChange={(c) => setV({ ...v, amount_cents: c })} />
          </div>
          <Textarea label="Motivo" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} rows={2} />
          <Input label="Evidência" placeholder="Documento, extrato, protocolo" value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} />
          {v.kind === 'estorno' && <p className="text-xs text-ink-faint">O estorno reduz o repasse ainda não pago ao produtor/parceiro; se o repasse já foi pago, gera um valor recuperável separado (o pagamento original é preservado e nada é debitado automaticamente do parceiro).</p>}
        </div>
      )}
      {result && (
        <div className="space-y-4">
          <KV cols={3} items={[['Estorno', money(result.adjustment?.amount_cents)], ['Redução do repasse não pago', <Num key="a" v={reduce} />], ['Recuperável (repasse já pago)', <Num key="b" v={recover} />]]} />
          {!fx.length ? <Notice tone="ok">Nenhum repasse afetado (sem rateio na apólice ou regra sem reversão).</Notice> : (
            <div className="card overflow-x-auto">
              <table className="table-clean">
                <thead><tr><th>Efeito</th><th className="text-right">Valor</th><th>Situação</th><th>Observação</th></tr></thead>
                <tbody>
                  {fx.map((x) => (
                    <tr key={x.id}>
                      <td>{ACCRUAL_KIND[x.kind] || x.kind}</td>
                      <td className="text-right"><Num v={x.amount_cents} /></td>
                      <td><StatusChip map={ACCRUAL_STATUS} value={x.status} /></td>
                      <td className="text-xs text-ink-soft">{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {recover < 0 && <Notice tone="warn">Há valor recuperável: a compensação ou contestação é decidida em Repasses › Liberações, com autorização.</Notice>}
        </div>
      )}
    </Modal>
  );
}

function ContestModal({ row, onClose, onDone }) {
  const [v, setV] = useState({});
  const [run, busy] = useAction();
  useEffect(() => { if (row) setV({ reason: '', amount_cents: null }); }, [row]);
  const submit = async () => {
    const r = await run(() => api.post(`/v1/commissions/receivables/${row.id}/contest`, { reason: v.reason, amount_cents: v.amount_cents }), 'Contestação aberta.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open={!!row} onClose={onClose} title="Contestar comissão" subtitle={row && `Apólice ${row.policy_number} · parcela ${row.installment_no}/${row.installments_total}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={String(v.reason || '').trim().length < 3 || busy} onClick={submit}>Abrir contestação</button></>}>
      <div className="space-y-3">
        <Textarea label="Fundamento da contestação" rows={4} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        <CentsInput label="Valor contestado (opcional)" value={v.amount_cents} onChange={(c) => setV({ ...v, amount_cents: c })} />
        <p className="text-xs text-ink-faint">A contestação fica registrada para revisão e envio pela equipe (aba Contestações). Ela não altera valores até haver ajuste.</p>
      </div>
    </Modal>
  );
}

// =====================================================================================
// Liquidações
// =====================================================================================
function Settlements() {
  const [params, setParams] = useSearchParams();
  const { company } = useAuth();
  const { data, loading, reload } = useFetch(() => api.get('/v1/commissions/settlements'), []);
  const t = useTable(data || [], { sort: 'settled_date', dir: 'desc' });
  const [detail, setDetail] = useState(null);
  const isNew = params.get('nova') === '1';
  const closeNew = () => setParams({ tab: 'liquidacoes' });
  return (
    <div className="space-y-4">
      <Notice>Uma liquidação registra o valor <b>bruto</b> quitado pela seguradora e o aloca em uma ou mais comissões. Retenções e deduções reduzem o líquido recebido, não o saldo da comissão.</Notice>
      {loading && !data ? <Loading /> : !data?.length ? (
        <div className="card"><Empty icon={Landmark} title="Nenhuma liquidação registrada" text="Registre a liquidação informada pela seguradora ou concilie as linhas de um extrato importado." /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <SortTh t={t} k="number">Nº</SortTh>
                <SortTh t={t} k="institution_name">Seguradora</SortTh>
                <SortTh t={t} k="settled_date">Data</SortTh>
                <th className="text-right">Bruto</th>
                <th className="text-right">Retenção</th>
                <th className="text-right">Deduções</th>
                <th className="text-right">Líquido</th>
                <th className="text-right">Comissões</th>
                <th>Banco</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => setDetail(s.id)}>
                  <td><button className="font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setDetail(s.id); }}>{docNumber(company?.settings, 'settlement', s.number)}</button>
                    {s.reference && <div className="text-xs text-ink-faint">{s.reference}</div>}</td>
                  <td>{s.institution_name}</td>
                  <td className="tabular-nums">{fmt(s.settled_date)}</td>
                  <td className="text-right"><Num v={s.gross_cents} /></td>
                  <td className="text-right"><Num v={s.retention_cents} /></td>
                  <td className="text-right"><Num v={s.deductions_cents} /></td>
                  <td className="text-right font-medium"><Num v={s.net_cents} /></td>
                  <td className="text-right tabular-nums">{s.allocations}</td>
                  <td>{s.reconciled ? <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Conciliada</span> : <span className="chip bg-muted text-ink-soft">Não conciliada</span>}</td>
                  <td>{s.reversed_at ? <span className="chip bg-red-500/10 text-red-700 dark:text-red-300">Desfeita</span> : <span className="chip bg-sky-500/10 text-sky-700 dark:text-sky-300">Ativa</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      <SettlementDetail id={detail} onClose={() => setDetail(null)} onChanged={reload} />
      {isNew && <NewSettlement onClose={closeNew} onCreated={(id) => { reload(); closeNew(); setDetail(id); }} />}
    </div>
  );
}

function SettlementDetail({ id, onClose, onChanged }) {
  const { can, company } = useAuth();
  const { data: s, loading, reload } = useFetch(() => (id ? api.get(`/v1/commissions/settlements/${id}`) : Promise.resolve(null)), [id]);
  const [rev, setRev] = useState(false);
  const [run] = useAction();
  const reverse = async ({ reason }) => {
    const r = await run(() => api.post(`/v1/commissions/settlements/${id}/reverse`, { reason }), 'Liquidação desfeita. A trilha foi preservada.');
    if (r !== FAIL) { setRev(false); reload(); onChanged(); }
  };
  return (
    <Modal open={!!id} onClose={onClose} size="xl" title={s ? `Liquidação ${docNumber(company?.settings, 'settlement', s.number)}` : 'Liquidação'}
      subtitle={s && `${fmt(s.settled_date)} · origem: ${s.source === 'extrato' ? 'extrato importado' : 'lançamento manual'}${s.reference ? ` · ${s.reference}` : ''}`}
      footer={s && !s.reversed_at && can('commissions_adjust') && <button className="btn-danger" onClick={() => setRev(true)}><Undo2 className="h-4 w-4" /> Desfazer liquidação</button>}>
      {loading || !s ? <Loading /> : (
        <div className="space-y-4">
          {s.reversed_at && <Notice tone="danger">Desfeita em {fmtDateTime(s.reversed_at)}: {s.reversed_reason}</Notice>}
          <KV cols={4} items={[
            ['Bruto liquidado', money(s.gross_cents)], ['Retenção', money(s.retention_cents)], ['Natureza da retenção', s.retention_nature],
            ['Deduções', money(s.deductions_cents)], ['Líquido recebido', <b key="n">{money(s.net_cents)}</b>], ['Observações', s.notes],
          ]} />
          <Section title="Alocações (valor bruto por comissão)" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr><th>Apólice</th><th>Cliente</th><th>Parcela</th><th className="text-right">Alocado</th><th>Situação</th></tr></thead>
                <tbody>
                  {s.allocations.map((a) => (
                    <tr key={a.id}><td className="font-medium">{a.policy_number}</td><td>{a.client_name}</td><td className="tabular-nums">{a.installment_no}</td>
                      <td className="text-right"><Num v={a.amount_cents} /></td><td>{a.reversed_at ? 'Desfeita' : 'Ativa'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <SplitAccrualsTable rows={s.split_accruals} />
        </div>
      )}
      <PromptModal open={rev} onClose={() => setRev(false)} danger confirmText="Desfazer" title="Desfazer liquidação"
        subtitle="Só é possível em período aberto, sem conciliação bancária e sem repasse em lote ou pago. Os repasses liberados por ela são compensados e o lançamento de receita é cancelado."
        fields={[{ key: 'reason', label: 'Motivo', required: true, textarea: true, min: 5 }]} onSubmit={reverse} />
    </Modal>
  );
}

function SplitAccrualsTable({ rows }) {
  if (!rows?.length) return <Notice>Nenhum repasse liberado por esta liquidação (apólice sem rateio ou regra de repasse antecipado).</Notice>;
  return (
    <Section title="Repasses liberados" subtitle="Calculados pela regra de repasse congelada em cada apólice." bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead><tr><th>Parceiro</th><th>Tipo</th><th className="text-right">Base</th><th className="text-right">Valor</th><th>Situação</th><th>Cálculo</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}><td>{a.partner_name || '—'}</td><td>{ACCRUAL_KIND[a.kind] || a.kind}</td><td className="text-right"><Num v={a.base_cents} /></td>
                <td className="text-right font-medium"><Num v={a.amount_cents} /></td><td><StatusChip map={ACCRUAL_STATUS} value={a.status} /></td><td className="text-xs text-ink-soft">{a.note}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function NewSettlement({ onClose, onCreated }) {
  const institutions = useInstitutions();
  const [key] = useState(() => idemKey('liq'));
  const [f, setF] = useState({ institution_id: '', settled_date: ymd(), gross_cents: null, retention_cents: 0, retention_nature: '', deductions_cents: 0, reference: '', notes: '', confirm_missing: false });
  const [recs, setRecs] = useState(null);
  const [alloc, setAlloc] = useState({}); // receivable_id -> cents (presença = selecionada)
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    setAlloc({});
    if (!f.institution_id) { setRecs(null); return; }
    let live = true;
    setRecs(undefined);
    api.get(`/v1/commissions/receivables${qs({ institution_id: f.institution_id, open: 1 })}`).then((r) => live && setRecs(r.items)).catch(() => live && setRecs([]));
    return () => { live = false; };
  }, [f.institution_id]);

  const selected = Object.entries(alloc);
  const sum = selected.reduce((a, [, c]) => a + (Number(c) || 0), 0);
  const gross = f.gross_cents || 0;
  const diff = gross - sum;
  const net = gross - (f.retention_cents || 0) - (f.deductions_cents || 0);
  const unconfirmed = (recs || []).filter((r) => alloc[r.id] != null && r.confirmed_cents == null);
  const over = (recs || []).filter((r) => alloc[r.id] != null && (r.balance_cents ?? r.expected_cents) < alloc[r.id]);
  const valid = f.institution_id && f.settled_date && gross > 0 && selected.length > 0 && diff === 0 && net >= 0 && selected.every(([, c]) => c > 0)
    && (!unconfirmed.length || f.confirm_missing) && (f.retention_cents === 0 || String(f.retention_nature).trim());

  const toggle = (r) => setAlloc((a) => {
    const n = { ...a };
    if (n[r.id] != null) delete n[r.id]; else n[r.id] = r.balance_cents ?? r.expected_cents;
    return n;
  });

  const submit = async () => {
    const body = { ...f, retention_cents: f.retention_cents || 0, deductions_cents: f.deductions_cents || 0, retention_nature: f.retention_nature || null, reference: f.reference || null, notes: f.notes || null,
      allocations: selected.map(([receivable_id, amount_cents]) => ({ receivable_id, amount_cents })) };
    const r = await run(() => api.post('/v1/commissions/settlements', body, { 'Idempotency-Key': key }), 'Liquidação registrada.');
    if (r !== FAIL) setResult(r);
  };

  if (result) {
    return (
      <Modal open onClose={() => onCreated(result.settlement.id)} size="lg" title="Liquidação registrada" subtitle={result.replayed ? 'Operação já processada anteriormente — resultado reapresentado (idempotência).' : undefined}
        footer={<button className="btn-primary" onClick={() => onCreated(result.settlement.id)}>Ver liquidação</button>}>
        <div className="space-y-4">
          <KV cols={4} items={[['Bruto', money(result.settlement.gross_cents)], ['Retenção', money(result.settlement.retention_cents)], ['Deduções', money(result.settlement.deductions_cents)], ['Líquido', money(result.settlement.net_cents)]]} />
          <p className="text-sm text-ink-soft">{result.allocations?.length} comissão(ões) alocada(s). A receita líquida foi lançada no financeiro; concilie com o depósito em Financeiro › Contas e extratos.</p>
          <SplitAccrualsTable rows={result.accruals} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} size="xl" title="Nova liquidação de comissão" subtitle="Informe o que a seguradora quitou e aloque o valor bruto nas comissões."
      footer={<>
        <span className={cx('mr-auto text-sm tabular-nums', diff === 0 && selected.length ? 'text-emerald-600' : 'text-ink-soft')}>
          Alocado {money(sum)} de {money(gross)}{diff !== 0 && gross ? ` · diferença ${money(diff)}` : ''}
        </span>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <SubmitButton busy={busy} onClick={submit} problems={[!f.institution_id && { text: 'Escolha a seguradora.', field: 'Seguradora' }, !f.settled_date && 'Informe a data da liquidação.', !(gross > 0) && 'Informe o valor bruto recebido.', !selected.length && 'Marque as comissões que este pagamento quita.', selected.length > 0 && diff !== 0 && `O valor alocado precisa fechar com o bruto (diferença de ${money(diff)}).`, net < 0 && 'Retenções e deduções passam do bruto.', selected.some(([, c]) => !(c > 0)) && 'Há comissão marcada sem valor alocado.', unconfirmed.length > 0 && !f.confirm_missing && 'Há comissões ainda não confirmadas: marque a opção de confirmá-las pelo valor alocado.', f.retention_cents !== 0 && !String(f.retention_nature).trim() && 'Informe a natureza da retenção.']}>{busy ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Registrar liquidação</SubmitButton>
      </>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Seguradora" value={f.institution_id} onChange={(e) => set('institution_id', e.target.value)}>
            <option value="">Selecione…</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Input label="Data da liquidação" type="date" max={ymd()} value={f.settled_date} onChange={(e) => set('settled_date', e.target.value)} />
          <Input label="Referência" placeholder="Ex.: extrato 09/2026, aviso de crédito" value={f.reference} onChange={(e) => set('reference', e.target.value)} />
          <CentsInput label="Valor bruto liquidado" value={f.gross_cents} onChange={(c) => set('gross_cents', c)} />
          <CentsInput label="Retenção informada" value={f.retention_cents} allowEmpty={false} onChange={(c) => set('retention_cents', c ?? 0)} />
          <Input label="Natureza da retenção" placeholder="Ex.: IRRF informado pela fonte" value={f.retention_nature} disabled={!f.retention_cents} onChange={(e) => set('retention_nature', e.target.value)}
            hint={f.retention_cents ? 'Obrigatório quando há retenção. O tratamento fiscal segue a orientação contábil.' : undefined} />
          <CentsInput label="Outras deduções" value={f.deductions_cents} allowEmpty={false} onChange={(c) => set('deductions_cents', c ?? 0)} />
          <div className="sm:col-span-2 grid grid-cols-3 gap-2 self-end rounded-app-sm bg-muted p-3 text-sm">
            <div><div className="text-xs text-ink-faint">Bruto</div><div className="tabular-nums font-medium">{money(gross)}</div></div>
            <div><div className="text-xs text-ink-faint">− Retenção − deduções</div><div className="tabular-nums">{money((f.retention_cents || 0) + (f.deductions_cents || 0))}</div></div>
            <div><div className="text-xs text-ink-faint">Líquido esperado no banco</div><div className={cx('tabular-nums font-semibold', net < 0 && 'text-red-600')}>{money(net)}</div></div>
          </div>
        </div>

        {!f.institution_id ? <Notice>Escolha a seguradora para listar as comissões em aberto.</Notice> : recs === undefined ? <Loading /> : !recs?.length ? (
          <Notice tone="warn">Nenhuma comissão em aberto para esta seguradora.</Notice>
        ) : (
          <Section title="Comissões em aberto" subtitle="Marque as comissões quitadas e ajuste o valor alocado (padrão: saldo confirmado, ou o previsto se ainda não confirmado)."
            actions={selected.length > 0 && gross === 0 && <button className="btn-outline h-8 text-xs" onClick={() => set('gross_cents', sum)}>Usar soma como bruto</button>} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr><th><span className="sr-only">Selecionar</span></th><th>Apólice / cliente</th><th>Parcela</th><th>Vencimento</th><th className="text-right">Previsto</th><th className="text-right">Saldo confirmado</th><th>Situação</th><th className="w-44">Alocar (bruto)</th></tr></thead>
                <tbody>
                  {recs.map((r) => {
                    const on = alloc[r.id] != null;
                    const ref = r.balance_cents ?? r.expected_cents;
                    return (
                      <tr key={r.id} className={cx(on && 'bg-primary/5')}>
                        <td><input type="checkbox" className="h-4 w-4" checked={on} onChange={() => toggle(r)} aria-label={`Selecionar ${r.policy_number} parcela ${r.installment_no}`} /></td>
                        <td><span className="font-medium">{r.policy_number}</span><div className="text-xs text-ink-faint">{r.client_name}</div></td>
                        <td className="tabular-nums">{r.installment_no}/{r.installments_total}</td>
                        <td className="tabular-nums">{fmt(r.due_date)}</td>
                        <td className="text-right text-ink-soft"><Num v={r.expected_cents} /></td>
                        <td className="text-right">{r.balance_cents == null ? <span className="text-xs text-ink-faint">não confirmada</span> : <Num v={r.balance_cents} />}</td>
                        <td><StatusChip map={COMMISSION_STATUS} value={r.status} /></td>
                        <td>{on ? <CentsInput value={alloc[r.id]} allowEmpty={false} onChange={(c) => setAlloc((a) => ({ ...a, [r.id]: c ?? 0 }))} aria-label="Valor alocado" />
                          : <span className="text-xs text-ink-faint">{money(ref)}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {unconfirmed.length > 0 && (
          <div className="space-y-2">
            <Notice tone="warn">{unconfirmed.length} comissão(ões) selecionada(s) ainda não confirmada(s). Confirme o valor antes ou autorize a confirmação pelo valor previsto.</Notice>
            <Toggle checked={f.confirm_missing} onChange={(v) => set('confirm_missing', v)} label="Confirmar as não confirmadas pelo valor previsto"
              hint="A liquidação da seguradora passa a ser a fonte da confirmação." />
          </div>
        )}
        {over.length > 0 && <Notice tone="danger">Alocação acima do saldo em {over.length} comissão(ões). A diferença não pode virar saldo: registre ajuste com fundamento ou contestação antes.</Notice>}
        {gross > 0 && selected.length > 0 && diff !== 0 && <Notice tone="warn">A soma das alocações precisa fechar exatamente o bruto liquidado. Diferença: <b>{money(diff)}</b>.</Notice>}
        <Textarea label="Observações" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Modal>
  );
}

// =====================================================================================
// Extratos da seguradora
// =====================================================================================
function Statements() {
  const { can } = useAuth();
  const institutions = useInstitutions();
  const files = useFetch(() => api.get('/v1/commissions/statements/files'), []);
  const [fileId, setFileId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [ver, setVer] = useState(0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">Importe o extrato de comissões da seguradora, revise a correspondência linha a linha e concilie: as comissões viram uma liquidação agrupada e os estornos viram ajustes vinculados.</p>
        {can('commissions_settle') && <button className="btn-primary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Importar extrato</button>}
      </div>
      <Section title="Arquivos importados" subtitle="O arquivo original fica guardado com hash; reimportar o mesmo arquivo é recusado e linhas repetidas não duplicam." bodyClass="p-0">
        {files.loading && !files.data ? <Loading /> : !files.data?.length ? <Empty icon={FileSpreadsheet} title="Nenhum extrato importado" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Arquivo</th><th>Seguradora</th><th>Importado em</th><th className="text-right">Pendentes</th><th className="text-right">Divergentes</th><th className="text-right">Conciliadas</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {files.data.map((x) => (
                  <tr key={x.id} className={cx(fileId === x.id && 'bg-primary/5')}>
                    <td className="font-medium">{x.filename}</td><td>{x.institution_name}</td><td className="tabular-nums">{fmtDateTime(x.created_at)}</td>
                    <td className="text-right tabular-nums">{x.pending}</td><td className={cx('text-right tabular-nums', x.divergent > 0 && 'text-orange-600')}>{x.divergent}</td><td className="text-right tabular-nums">{x.reconciled}</td>
                    <td className="text-right"><button className={smallBtn} onClick={() => setFileId(fileId === x.id ? '' : x.id)}>{fileId === x.id ? 'Mostrar todas' : 'Ver linhas'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <StatementLines key={ver} fileId={fileId} files={files.data || []} onChanged={files.reload} />
      {importOpen && <ImportStatement institutions={institutions} onClose={() => setImportOpen(false)} onDone={() => { files.reload(); setVer((v) => v + 1); }} />}
    </div>
  );
}

function downloadText(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImportStatement({ institutions, onClose, onDone }) {
  const [inst, setInst] = useState('');
  const [raw, setRaw] = useState(null); // { filename, text?, headers, data, sheet }
  const [mapping, setMapping] = useState({});
  const [saved, setSaved] = useState({});
  const [readErr, setReadErr] = useState(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { api.get('/v1/commissions/statements/mappings').then(setSaved).catch(() => setSaved({})); }, []);
  const load = async (fl) => {
    setReadErr(null); setPreview(null); setSummary(null); setReading(true);
    try {
      if (isOldSheet(fl.name)) throw new Error('Este formato de planilha (.xls/.ods) não é lido aqui. No Excel, use “Salvar como” → Pasta de Trabalho do Excel (.xlsx) ou CSV.');
      const sheet = isSheet(fl.name);
      const text = sheet ? null : await fileToText(fl);
      const rows = sheet ? await xlsxRows(fl) : csvRows(text);
      const { headers, data } = splitHeader(rows);
      if (!headers.length) throw new Error('Não encontramos o cabeçalho (nomes das colunas) no arquivo.');
      setRaw({ filename: fl.name, text, headers, data, sheet });
    } catch (e) { setRaw(null); setReadErr(e.message); } finally { setReading(false); }
  };
  // sugestão de colunas: mapeamento salvo desta seguradora > nomes conhecidos
  useEffect(() => { if (raw) setMapping(guessMapping(raw.headers, saved[inst] || {})); }, [raw, inst, saved]);
  const missing = STATEMENT_FIELDS.filter((f) => f.required && !mapping[f.key]);
  const native = raw && !raw.sheet && isNativeCsv(raw.headers, mapping);
  const payload = useMemo(() => {
    if (!raw || missing.length) return null;
    return native ? { filename: raw.filename, content: raw.text }
      : { filename: raw.sheet ? raw.filename.replace(/\.[^.]+$/, '.csv') : raw.filename, content: toCanonicalCsv(raw.headers, raw.data, mapping) };
  }, [raw, mapping, native, missing.length]);
  useEffect(() => {
    setPreview(null);
    if (!inst || !payload) return undefined;
    const t = setTimeout(() => {
      run(() => api.post('/v1/commissions/statements/preview', { institution_id: inst, ...payload })).then((r) => { if (r !== FAIL) setPreview(r); });
    }, 300);
    return () => clearTimeout(t);
  }, [inst, payload]); // eslint-disable-line
  const doImport = async () => {
    const r = await run(() => api.post('/v1/commissions/statements/import', { institution_id: inst, ...payload }), 'Extrato importado.');
    if (r === FAIL) return;
    setSummary(r.summary); onDone();
    // lembra as colunas desta seguradora para a próxima importação
    const prev = saved[inst] || {};
    if (!native && JSON.stringify(prev) !== JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)))) {
      api.put(`/v1/commissions/statements/mappings/${inst}`, { columns: mapping }).catch(() => {});
    }
  };
  const counts = useMemo(() => (preview?.lines || []).reduce((a, l) => ({ ...a, [l.match_status]: (a[l.match_status] || 0) + 1 }), {}), [preview]);
  const problems = [
    !inst && { text: 'Escolha a seguradora do extrato.', field: 'Seguradora' },
    !raw && { text: 'Escolha o arquivo do extrato (CSV ou planilha).', field: 'Arquivo do extrato' },
    ...missing.map((f) => ({ text: `Indique a coluna de “${f.label}”.`, field: f.label })),
    preview?.duplicate_file && { text: 'Este arquivo já foi importado.' },
    preview && !preview.lines.length && { text: 'Nenhuma linha nova para importar.' },
    raw && inst && !missing.length && !preview && { text: 'Aguarde a prévia terminar.' },
  ].filter(Boolean);
  return (
    <Modal open onClose={onClose} size="xl" title="Importar extrato de comissões" subtitle="Prévia antes de gravar: nada é conciliado na importação."
      footer={summary ? <button className="btn-primary" onClick={onClose}>Concluir</button> : <>
        <button className="btn-ghost mr-auto" onClick={() => downloadText('modelo-extrato-comissoes.csv', TEMPLATE_CSV)}><Download className="h-4 w-4" /> Baixar modelo</button>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <SubmitButton busy={busy} problems={problems} onClick={doImport}><Upload className="h-4 w-4" /> Importar {preview?.lines.length || 0} linha(s)</SubmitButton>
      </>}>
      <div className="space-y-4">
        {summary ? (
          <Notice tone="ok">
            Importação concluída: <b>{summary.inserted}</b> linha(s) gravada(s), {summary.duplicates_skipped} duplicada(s) ignorada(s), {summary.errors?.length || 0} rejeitada(s).
            Revise e concilie as linhas pendentes na lista abaixo. As colunas escolhidas ficam lembradas para esta seguradora.
          </Notice>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Seguradora" value={inst} onChange={(e) => setInst(e.target.value)}>
                <option value="">Selecione…</option>
                {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}{saved[i.id] ? ' · colunas lembradas' : ''}</option>)}
              </Select>
              <div>
                <span className="label">Arquivo do extrato</span>
                <FileButton accept=".csv,.txt,text/csv,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onFile={load}>
                  {reading ? <Spinner className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />} {raw ? raw.filename : 'Escolher CSV ou planilha (XLSX)'}
                </FileButton>
                <span className="mt-1 block text-xs text-ink-faint">Aceita o arquivo como a seguradora envia: CSV (; ou ,) ou Excel (.xlsx).</span>
              </div>
            </div>
            {readErr && <Notice tone="danger">{readErr}</Notice>}
            {raw && (
              <Section title="Colunas do arquivo" subtitle={`${raw.data.length} linha(s) de dados · diga qual coluna corresponde a cada informação`}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {STATEMENT_FIELDS.map((f) => (
                    <Select key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help} value={mapping[f.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                      <option value="">{f.required ? 'Selecione…' : '— não tem —'}</option>
                      {raw.headers.filter(Boolean).map((h, i) => <option key={`${h}-${i}`} value={h}>{h}</option>)}
                    </Select>
                  ))}
                </div>
                {raw.data[0] && (
                  <p className="mt-3 text-xs text-ink-faint">1ª linha: {STATEMENT_FIELDS.filter((f) => mapping[f.key]).map((f) => `${f.label}: ${raw.data[0][raw.headers.indexOf(mapping[f.key])] || '—'}`).join(' · ')}</p>
                )}
              </Section>
            )}
            {!raw && (
              <details className="rounded-app-sm border border-line p-3 text-sm">
                <summary className="cursor-pointer font-medium">Como deve ser o arquivo?</summary>
                <div className="mt-2 space-y-1 text-ink-soft">
                  <p>Qualquer CSV ou planilha com cabeçalho na primeira linha. Depois de escolher o arquivo você indica qual coluna é qual. O modelo pronto usa:</p>
                  <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">data;apolice;parcela;valor_bruto;retencao;tipo;id_externo;descricao</code>
                  <ul className="list-disc pl-5 text-xs">
                    <li><b>valor bruto</b> é obrigatório; valor negativo em linha de comissão é tratado como estorno.</li>
                    <li><b>tipo</b>: comissao, estorno, bonus, adiantamento ou ajuste (padrão: comissao).</li>
                    <li><b>apólice</b> e <b>parcela</b> são a chave de correspondência; valor e data são apenas apoio.</li>
                    <li><b>identificador</b> evita duplicidade; linhas idênticas legítimas são preservadas.</li>
                  </ul>
                </div>
              </details>
            )}
            {busy && !preview && <Loading />}
            {preview && (
              <div className="space-y-3">
                {preview.duplicate_file && <Notice tone="danger">Este arquivo já foi importado em {fmtDateTime(preview.duplicate_file.created_at)} ({preview.duplicate_file.filename}). A importação será recusada.</Notice>}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Stat label="Linhas novas" value={preview.lines.length} />
                  <Stat label="Conciliáveis" value={counts.conciliavel || 0} tone="text-emerald-600" icon={CheckCircle2} />
                  <Stat label="Divergentes" value={counts.divergente || 0} tone="text-orange-600" icon={AlertTriangle} />
                  <Stat label="Já importadas (duplicadas)" value={preview.duplicates} />
                  <Stat label="Bruto / retenção" value={money(preview.totals?.gross_cents)} hint={`Retenção ${money(preview.totals?.retention_cents)}`} />
                </div>
                {preview.errors?.length > 0 && (
                  <Notice tone="warn"><b>{preview.errors.length} linha(s) rejeitada(s):</b> {preview.errors.slice(0, 12).map((e) => `linha ${e.line}: ${e.error}`).join(' · ')}{preview.errors.length > 12 ? '…' : ''}</Notice>
                )}
                {preview.lines.length > 0 && (
                  <div className="card max-h-[40vh] overflow-auto">
                    <table className="table-clean">
                      <thead><tr><th>Linha</th><th>Data</th><th>Apólice</th><th>Parcela</th><th>Tipo</th><th className="text-right">Bruto</th><th className="text-right">Retenção</th><th>Correspondência</th><th className="text-right">Diferença</th><th>Observação</th></tr></thead>
                      <tbody>
                        {preview.lines.map((l) => (
                          <tr key={`${l.line_no}-${l.ordinal}`}>
                            <td className="tabular-nums">{l.line_no}</td><td className="tabular-nums">{fmt(l.line_date)}</td><td>{l.policy_number || '—'}</td><td className="tabular-nums">{l.installment_no || '—'}</td>
                            <td>{LINE_KIND[l.kind] || l.kind}</td><td className="text-right"><Num v={l.gross_cents} /></td><td className="text-right"><Num v={l.retention_cents} /></td>
                            <td><StatusChip map={MATCH_STATUS} value={l.match_status} /></td>
                            <td className="text-right">{l.diff_cents ? <Num v={l.diff_cents} /> : '—'}</td>
                            <td className="text-xs text-ink-soft">{l.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function StatementLines({ fileId, files, onChanged }) {
  const { can, company } = useAuth();
  const [status, setStatus] = useState('pendente');
  const { data, loading, reload } = useFetch(() => api.get(`/v1/commissions/statements/lines${qs({ file_id: fileId, status })}`), [fileId, status]);
  const [sel, setSel] = useState([]);
  const [recOpen, setRecOpen] = useState(false);
  const [recResult, setRecResult] = useState(null);
  const [resolve, setResolve] = useState(null);
  const [run, busy] = useAction();
  const [rf, setRf] = useState({ settled_date: ymd(), reference: '', retention_nature: '' });
  useEffect(() => setSel([]), [fileId, status, data]);
  const lines = data || [];
  const selectable = (l) => l.status === 'pendente' && l.receivable_id;
  const selLines = lines.filter((l) => sel.includes(l.id));
  const selInst = new Set(selLines.map((l) => l.institution_id));
  const selGross = selLines.filter((l) => l.kind !== 'estorno').reduce((a, l) => a + Number(l.gross_cents), 0);
  const selRet = selLines.filter((l) => l.kind !== 'estorno').reduce((a, l) => a + Number(l.retention_cents), 0);
  const selRev = selLines.filter((l) => l.kind === 'estorno').reduce((a, l) => a + Number(l.gross_cents), 0);
  const fileName = files.find((x) => x.id === fileId)?.filename;
  const reconcile = async () => {
    const r = await run(() => api.post('/v1/commissions/statements/reconcile', { line_ids: sel, settled_date: rf.settled_date, reference: rf.reference || null, retention_nature: rf.retention_nature || null, confirm_missing: true }), 'Linhas conciliadas.');
    if (r !== FAIL) { setRecOpen(false); setRecResult(r); reload(); onChanged(); }
  };
  return (
    <Section title={fileName ? `Linhas de ${fileName}` : 'Linhas de extrato (todos os arquivos)'}
      actions={<>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação da linha" className="w-44">
          <option value="">Todas as situações</option>
          {Object.entries(LINE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        {can('commissions_settle') && <SubmitButton problems={[!sel.length && 'Marque as linhas pendentes (com comissão vinculada) que quer conciliar.', selInst.size > 1 && 'Selecione linhas de uma única seguradora.']} onClick={() => setRecOpen(true)}><CheckCircle2 className="h-4 w-4" /> Conciliar selecionadas ({sel.length})</SubmitButton>}
      </>} bodyClass="p-0">
      {selInst.size > 1 && <div className="p-3"><Notice tone="warn">Selecione linhas de uma única seguradora.</Notice></div>}
      {loading && !data ? <Loading /> : !lines.length ? <Empty title="Nenhuma linha nesta situação" /> : (
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <th><input type="checkbox" className="h-4 w-4" aria-label="Selecionar todas as pendentes vinculadas"
                checked={lines.filter(selectable).length > 0 && lines.filter(selectable).every((l) => sel.includes(l.id))}
                onChange={(e) => setSel(e.target.checked ? lines.filter(selectable).map((l) => l.id) : [])} /></th>
              <th>Linha</th><th>Data</th><th>Apólice</th><th>Parcela</th><th>Tipo</th><th className="text-right">Bruto</th><th className="text-right">Retenção</th><th>Comissão vinculada</th><th className="text-right">Diferença</th><th>Situação</th><th>Observação</th><th><span className="sr-only">Ações</span></th>
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={cx(sel.includes(l.id) && 'bg-primary/5')}>
                  <td>{selectable(l) ? <input type="checkbox" className="h-4 w-4" checked={sel.includes(l.id)} aria-label={`Selecionar linha ${l.line_no}`}
                    onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /> : null}</td>
                  <td className="tabular-nums">{l.line_no}</td><td className="tabular-nums">{fmt(l.line_date)}</td><td>{l.policy_number || '—'}</td><td className="tabular-nums">{l.installment_no || '—'}</td>
                  <td>{LINE_KIND[l.kind] || l.kind}</td><td className="text-right"><Num v={l.gross_cents} /></td><td className="text-right"><Num v={l.retention_cents} /></td>
                  <td>{l.receivable_id ? <span>{l.matched_policy}<div className="text-xs text-ink-faint">{l.client_name}</div></span> : <span className="text-xs text-orange-600">sem vínculo</span>}</td>
                  <td className="text-right">{l.diff_cents ? <Num v={l.diff_cents} /> : '—'}</td>
                  <td><StatusChip map={LINE_STATUS} value={l.status} /></td>
                  <td className="max-w-xs text-xs text-ink-soft">{l.note}</td>
                  <td className="text-right">{can('commissions_settle') && l.status !== 'conciliada' && <button className={smallBtn} onClick={() => setResolve(l)}><Link2 className="h-3.5 w-3.5" /> Resolver</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={recOpen} onClose={() => setRecOpen(false)} title="Conciliar linhas selecionadas" subtitle={`${sel.length} linha(s)`}
        footer={<><button className="btn-ghost" onClick={() => setRecOpen(false)}>Voltar</button><SubmitButton busy={busy} onClick={reconcile} problems={[!rf.settled_date && { text: 'Informe a data da liquidação.', field: 'Data da liquidação' }]}>Conciliar</SubmitButton></>}>
        <div className="space-y-3">
          <KV cols={3} items={[['Comissões (bruto)', money(selGross)], ['Retenção informada', money(selRet)], ['Estornos', money(selRev)]]} />
          <Notice>As linhas de comissão viram <b>uma</b> liquidação agrupada (um depósito para várias comissões). Comissões ainda não confirmadas são confirmadas pelo valor previsto. Estornos viram ajustes vinculados, com efeito nos repasses.</Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Data da liquidação" type="date" max={ymd()} value={rf.settled_date} onChange={(e) => setRf({ ...rf, settled_date: e.target.value })} />
            <Input label="Referência (opcional)" value={rf.reference} onChange={(e) => setRf({ ...rf, reference: e.target.value })} />
          </div>
          {selRet > 0 && <Input label="Natureza da retenção" placeholder="Ex.: IRRF informado pela fonte" value={rf.retention_nature} onChange={(e) => setRf({ ...rf, retention_nature: e.target.value })} />}
        </div>
      </Modal>
      <Modal open={!!recResult} onClose={() => setRecResult(null)} size="lg" title="Conciliação concluída" footer={<button className="btn-primary" onClick={() => setRecResult(null)}>Fechar</button>}>
        {recResult && (
          <div className="space-y-3">
            {recResult.settlement ? (
              <KV cols={4} items={[['Liquidação criada', docNumber(company?.settings, 'settlement', recResult.settlement.number)], ['Bruto', money(recResult.settlement.gross_cents)],
                ['Retenção', money(recResult.settlement.retention_cents)], ['Líquido', money(recResult.settlement.net_cents)]]} />
            ) : <p className="text-sm text-ink-soft">Nenhuma linha de comissão: nenhuma liquidação criada.</p>}
            {recResult.adjustments?.length > 0 && (
              <Notice tone="warn">{recResult.adjustments.length} estorno(s) lançado(s) como ajuste, total {money(recResult.adjustments.reduce((a, x) => a + Number(x.amount_cents), 0))}. Veja o efeito nos repasses em Repasses › Liberações.</Notice>
            )}
          </div>
        )}
      </Modal>
      {resolve && <ResolveLine line={resolve} onClose={() => setResolve(null)} onDone={() => { setResolve(null); reload(); onChanged(); }} />}
    </Section>
  );
}

function ResolveLine({ line, onClose, onDone }) {
  const [v, setV] = useState({ action: line.receivable_id ? 'aceitar' : 'vincular', receivable_id: '', note: '' });
  const [recs, setRecs] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (v.action !== 'vincular' || recs) return;
    api.get(`/v1/commissions/receivables${qs({ institution_id: line.institution_id })}`).then((r) => setRecs(r.items)).catch(() => setRecs([]));
  }, [v.action]); // eslint-disable-line
  const submit = async () => {
    const r = await run(() => api.post(`/v1/commissions/statements/lines/${line.id}/resolve`, { action: v.action, note: v.note, receivable_id: v.action === 'vincular' ? v.receivable_id : null }), 'Linha atualizada.');
    if (r !== FAIL) onDone();
  };
  const ok = String(v.note).trim().length >= 3 && (v.action !== 'vincular' || v.receivable_id);
  const help = {
    vincular: 'Associa a linha a uma comissão desta seguradora. Se o valor diferir do saldo, a linha fica divergente.',
    aceitar: 'Aceita o valor da linha (inclusive parcial): ela volta a pendente e pode ser conciliada; o saldo restante da comissão continua em aberto.',
    contestar: 'Mantém a linha divergente e abre uma contestação para a equipe revisar e enviar à seguradora.',
    ignorar: 'Retira a linha da conciliação (ex.: informativa). Fica registrada com o motivo.',
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Resolver linha ${line.line_no}`} subtitle={`${line.policy_number || 'sem apólice'} · ${LINE_KIND[line.kind] || line.kind} · ${money(line.gross_cents)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit} problems={[v.action === 'vincular' && !v.receivable_id && 'Escolha a comissão para vincular.', String(v.note).trim().length < 3 && 'Escreva uma observação (mín. 3 caracteres).']}>Aplicar</SubmitButton></>}>
      <div className="space-y-3">
        {line.note && <Notice tone={line.status === 'divergente' ? 'warn' : 'info'}>{line.note}</Notice>}
        <Select label="Ação" value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })}>
          <option value="vincular">Vincular a uma comissão</option>
          <option value="aceitar" disabled={!line.receivable_id}>Aceitar valor (parcial ou divergente)</option>
          <option value="contestar">Contestar</option>
          <option value="ignorar">Ignorar</option>
        </Select>
        <p className="text-xs text-ink-faint">{help[v.action]}</p>
        {v.action === 'vincular' && (recs === null ? <Loading /> : (
          <Select label="Comissão" value={v.receivable_id} onChange={(e) => setV({ ...v, receivable_id: e.target.value })}>
            <option value="">Selecione…</option>
            {recs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.policy_number} · {r.client_name} · parc. {r.installment_no}/{r.installments_total} · {r.balance_cents == null ? `previsto ${money(r.expected_cents)}` : `saldo ${money(r.balance_cents)}`} · {COMMISSION_STATUS[r.status]?.label || r.status}
              </option>
            ))}
          </Select>
        ))}
        <Textarea label="Justificativa" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </div>
    </Modal>
  );
}

// =====================================================================================
// Acordos e regras
// =====================================================================================
function Agreements() {
  const { can, meta } = useAuth();
  const branches = meta?.branches || BRANCHES;
  const institutions = useInstitutions();
  const { data, loading, reload } = useFetch(() => api.get('/v1/commissions/agreements'), []);
  const [newOpen, setNewOpen] = useState(false);
  const [versionFor, setVersionFor] = useState(null);
  const [na, setNa] = useState({});
  const [run, busy] = useAction();
  const createAgreement = async () => {
    const r = await run(() => api.post('/v1/commissions/agreements', { institution_id: na.institution_id, name: na.name, branch: na.branch || null }), 'Acordo cadastrado. Agora registre a primeira versão da regra.');
    if (r !== FAIL) { setNewOpen(false); reload(); setVersionFor({ ...r, institution_name: institutions.find((i) => i.id === r.institution_id)?.name }); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Notice className="max-w-3xl">Regras são <b>versionadas e somente de acréscimo</b>: uma nova versão vale para contratos novos a partir da vigência. Cada apólice guarda o snapshot da regra usada — mudar um percentual nunca recalcula contratos ou períodos anteriores.</Notice>
        {can('commissions_rules') && <button className="btn-primary" onClick={() => { setNa({ institution_id: '', name: '', branch: '' }); setNewOpen(true); }}><Plus className="h-4 w-4" /> Novo acordo</button>}
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={FileText} title="Nenhum acordo cadastrado" text="Cadastre os acordos comerciais por seguradora, ramo e produto. Não existe comissão única para toda a seguradora." /></div> : (
        data.map((a) => (
          <Section key={a.id} title={a.name} subtitle={`${a.institution_name}${a.branch ? ` · ${branches[a.branch] || a.branch}` : ' · todos os ramos'}${a.active ? '' : ' · inativo'}`}
            actions={can('commissions_rules') && <button className="btn-outline h-8 text-xs" onClick={() => setVersionFor(a)}><Plus className="h-3.5 w-3.5" /> Nova versão</button>} bodyClass="p-0">
            {!a.versions?.length ? <div className="p-4"><Notice tone="warn">Sem versão de regra: apólices deste acordo não terão comissão prevista.</Notice></div> : (
              <div className="overflow-x-auto">
                <table className="table-clean">
                  <thead><tr><th>Versão</th><th>Comissão</th><th>Base</th><th>Calendário</th><th>Evento do direito</th><th>Vigência</th><th>Observações</th></tr></thead>
                  <tbody>
                    {a.versions.map((v, i) => (
                      <tr key={v.id} className={cx(i > 0 && 'text-ink-soft')}>
                        <td><span className="font-medium">v{v.version}</span>{i === 0 && <span className="chip ml-2 bg-primary/10 text-primary">mais recente</span>}</td>
                        <td className="tabular-nums">{v.kind === 'fixo' ? `Fixo ${money(v.fixed_cents)}` : pct(v.rate)}</td>
                        <td>{BASE_DEF[v.base_definition] || v.base_definition}{v.base_notes && <div className="text-xs text-ink-faint">{v.base_notes}</div>}</td>
                        <td>{v.schedule === 'parcelada' ? `Parcelada (${v.installments}x)` : 'Única'}</td>
                        <td>{v.right_event || '—'}</td>
                        <td className="tabular-nums">{fmt(v.valid_from)} → {v.valid_to ? fmt(v.valid_to) : 'sem término'}</td>
                        <td className="text-xs">{v.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        ))
      )}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Novo acordo de comissão"
        footer={<><button className="btn-ghost" onClick={() => setNewOpen(false)}>Voltar</button><SubmitButton busy={busy} onClick={createAgreement} problems={[!na.institution_id && { text: 'Escolha a seguradora.', field: 'Seguradora' }, String(na.name || '').trim().length < 2 && { text: 'Dê um nome ao acordo.', field: 'Nome' }]}>Cadastrar</SubmitButton></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Seguradora" value={na.institution_id || ''} onChange={(e) => setNa({ ...na, institution_id: e.target.value })}>
            <option value="">Selecione…</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Select label="Ramo" value={na.branch || ''} onChange={(e) => setNa({ ...na, branch: e.target.value })}>
            <option value="">Todos os ramos</option>
            {Object.entries(branches).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input className="sm:col-span-2" label="Nome do acordo" placeholder="Ex.: Porto — Auto individual 2026" value={na.name || ''} onChange={(e) => setNa({ ...na, name: e.target.value })} />
        </div>
      </Modal>
      {versionFor && <VersionModal agreement={versionFor} onClose={() => setVersionFor(null)} onDone={() => { setVersionFor(null); reload(); }} />}
    </div>
  );
}

function VersionModal({ agreement, onClose, onDone }) {
  const [v, setV] = useState({ kind: 'percentual', rate: '', fixed_cents: null, base_definition: 'premio_liquido', base_notes: '', schedule: 'unica', installments: 1, right_event: '', valid_from: ymd(), valid_to: '', notes: '' });
  const [run, busy] = useAction();
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const rate = v.rate === '' ? null : Number(String(v.rate).replace(',', '.'));
  const ok = (v.kind === 'percentual' ? rate != null && rate >= 0 && rate <= 100 : v.fixed_cents != null) && v.valid_from && (v.base_definition !== 'outra' || String(v.base_notes).trim());
  const submit = async () => {
    const body = { kind: v.kind, rate: v.kind === 'percentual' ? rate : null, fixed_cents: v.kind === 'fixo' ? v.fixed_cents : null, base_definition: v.base_definition, base_notes: v.base_notes || null,
      schedule: v.schedule, installments: v.schedule === 'parcelada' ? Number(v.installments) || 1 : 1, right_event: v.right_event || null, valid_from: v.valid_from, valid_to: v.valid_to || null, notes: v.notes || null };
    const r = await run(() => api.post(`/v1/commissions/agreements/${agreement.id}/versions`, body), `Versão v${(agreement.versions?.[0]?.version || 0) + 1} registrada.`);
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Nova versão da regra" subtitle={`${agreement.name} · ${agreement.institution_name || ''}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={submit} problems={[!(v.kind === 'percentual' ? rate != null && rate >= 0 && rate <= 100 : v.fixed_cents != null) && (v.kind === 'percentual' ? 'Informe o percentual (0 a 100).' : 'Informe o valor fixo.'), !v.valid_from && 'Informe o início da vigência da regra.', v.base_definition === 'outra' && !String(v.base_notes).trim() && 'Descreva a base comissionável.']}>Registrar versão</SubmitButton></>}>
      <div className="space-y-4">
        <Notice tone="warn">As versões anteriores continuam valendo para os contratos já firmados. Esta versão não altera comissões já previstas.</Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Tipo de comissão" value={v.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="percentual">Percentual sobre a base</option>
            <option value="fixo">Valor fixo</option>
          </Select>
          {v.kind === 'percentual'
            ? <Input label="Percentual (%)" inputMode="decimal" placeholder="Ex.: 20" value={v.rate} onChange={(e) => set('rate', e.target.value.replace(/[^\d.,]/g, ''))} />
            : <CentsInput label="Valor fixo" value={v.fixed_cents} onChange={(c) => set('fixed_cents', c)} />}
          <Select label="Base de cálculo" value={v.base_definition} onChange={(e) => set('base_definition', e.target.value)}>
            {Object.entries(BASE_DEF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input label={v.base_definition === 'outra' ? 'Descrição da base (obrigatória)' : 'Notas da base'} placeholder="Componentes incluídos/excluídos conforme acordo" value={v.base_notes} onChange={(e) => set('base_notes', e.target.value)} />
          <Select label="Calendário" value={v.schedule} onChange={(e) => set('schedule', e.target.value)}>
            <option value="unica">Parcela única</option>
            <option value="parcelada">Parcelada</option>
          </Select>
          {v.schedule === 'parcelada' && <Input label="Número de parcelas" type="number" min={1} max={120} value={v.installments} onChange={(e) => set('installments', e.target.value)} />}
          <Input label="Evento que gera o direito" placeholder="Ex.: pagamento do segurado, emissão" value={v.right_event} onChange={(e) => set('right_event', e.target.value)} />
          <Input label="Vigência a partir de" type="date" value={v.valid_from} onChange={(e) => set('valid_from', e.target.value)} />
          <Input label="Vigência até (opcional)" type="date" value={v.valid_to} onChange={(e) => set('valid_to', e.target.value)} />
        </div>
        <Textarea label="Observações (documento fonte, aprovação, condições)" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Modal>
  );
}

// =====================================================================================
// Contestações
// =====================================================================================
function Disputes() {
  const { can } = useAuth();
  const { data, loading, reload } = useFetch(() => api.get('/v1/commissions/disputes'), []);
  const [edit, setEdit] = useState(null);
  const [v, setV] = useState({});
  const [run, busy] = useAction();
  const t = useTable(data || [], { sort: 'created_at', dir: 'desc' });
  const save = async () => {
    const r = await run(() => api.put(`/v1/commissions/disputes/${edit.id}`, { status: v.status, response: v.response || null }), 'Contestação atualizada.');
    if (r !== FAIL) { setEdit(null); reload(); }
  };
  return (
    <div className="space-y-4">
      <Notice>Contestações abertas em comissões ou linhas de extrato. O envio à seguradora é feito pela equipe; registre aqui o andamento e a resposta.</Notice>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={MessageSquareWarning} title="Nenhuma contestação" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><SortTh t={t} k="created_at">Aberta em</SortTh><th>Origem</th><th className="text-right">Valor</th><th>Fundamento</th><th>Resposta</th><SortTh t={t} k="status">Situação</SortTh><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {t.rows.map((d) => (
                <tr key={d.id}>
                  <td className="tabular-nums">{fmtDateTime(d.created_at)}</td>
                  <td>{d.entity === 'statement_line' ? 'Linha de extrato' : d.entity === 'commission_receivable' ? 'Comissão' : d.entity}</td>
                  <td className="text-right">{d.amount_cents == null ? '—' : <Num v={d.amount_cents} />}</td>
                  <td className="max-w-sm text-sm">{d.reason}</td>
                  <td className="max-w-sm text-sm text-ink-soft">{d.response || '—'}{d.closed_at && <div className="text-xs text-ink-faint">Encerrada em {fmtDateTime(d.closed_at)}</div>}</td>
                  <td><StatusChip map={DISPUTE_STATUS} value={d.status || 'aberta'} /></td>
                  <td className="text-right">{can('commissions_adjust') && d.status !== 'encerrada' && <button className={smallBtn} onClick={() => { setV({ status: d.status === 'aberta' || !d.status ? 'enviada' : d.status, response: d.response || '' }); setEdit(d); }}>Atualizar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Atualizar contestação"
        footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Voltar</button><button className="btn-primary" disabled={busy} onClick={save}>Salvar</button></>}>
        <div className="space-y-3">
          {edit && <Notice>{edit.reason}</Notice>}
          <Select label="Situação" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            <option value="enviada">Enviada à seguradora</option>
            <option value="respondida">Respondida</option>
            <option value="encerrada">Encerrada</option>
          </Select>
          <Textarea label="Resposta / andamento" rows={4} value={v.response} onChange={(e) => setV({ ...v, response: e.target.value })} />
          {v.status === 'encerrada' && <p className="text-xs text-ink-faint">Encerrar não altera valores: se a seguradora reconheceu a diferença, registre o ajuste na comissão.</p>}
        </div>
      </Modal>
    </div>
  );
}
