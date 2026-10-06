// Financeiro da corretora (17.2–17.4): contas e extrato bancário com conciliação rastreável, contas a pagar/receber
// próprias, projeção (confirmado ≠ previsto), resultado gerencial e fechamento de período.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Upload, Landmark, Link2, Undo2, FileSpreadsheet, CheckCircle2, XCircle, Lock, Unlock, ArrowDownCircle, ArrowUpCircle, Wallet, Clock, Users, Receipt } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { api, fileToText, qs } from '../lib/api';
import { money, fmt, fmtDateTime, ymd, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { SubmitButton,
  PageHeader, Section, KV, Tabs, Stat, Modal, PromptModal, Input, Textarea, Select, CentsInput, FileButton, StatusChip, Notice, Empty, Loading, useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';

const TABS = [
  { value: 'contas', label: 'Contas e extratos' },
  { value: 'lancamentos', label: 'Contas a pagar e receber' },
  { value: 'projecao', label: 'Projeção de caixa' },
  { value: 'resultado', label: 'Resultado gerencial' },
  { value: 'periodos', label: 'Períodos' },
];
const c = (label, cls) => ({ label, cls });
const TX_STATUS = {
  pendente: c('Pendente', 'bg-sky-500/10 text-sky-700 dark:text-sky-300'),
  conciliada: c('Conciliada', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'),
  ignorada: c('Ignorada', 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300'),
};
const ENTRY_STATUS = {
  aberto: c('Em aberto', 'bg-sky-500/10 text-sky-700 dark:text-sky-300'),
  pago: c('Pago', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'),
  cancelado: c('Cancelado', 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300'),
};
const SOURCE = { manual: 'Manual', comissao: 'Comissão', repasse: 'Repasse' };
const MATCH_KIND = { commission_settlement: 'Liquidação de comissão', cash_entry: 'Lançamento', split_batch: 'Lote de repasse' };
const COLORS = { in: '#059669', out: '#dc2626', forecast: '#d97706' };

const Num = ({ v, className }) => <span className={cx('tabular-nums', Number(v) < 0 && 'text-red-600 dark:text-red-400', className)}>{money(v)}</span>;
const smallBtn = 'btn-ghost h-8 px-2 text-xs';
const brlShort = (cents) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'contas';
  return (
    <div>
      <PageHeader title="Financeiro da corretora" subtitle="Gestão operacional do caixa próprio. Prêmios de seguro pertencem às seguradoras e não entram aqui. Não substitui a escrituração contábil." />
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'contas' && <Accounts />}
      {tab === 'lancamentos' && <Entries />}
      {tab === 'projecao' && <Projection />}
      {tab === 'resultado' && <Result />}
      {tab === 'periodos' && <Periods />}
    </div>
  );
}

// =====================================================================================
// Contas e extratos
// =====================================================================================
function Accounts() {
  const accounts = useFetch(() => api.get('/v1/finance/accounts'), []);
  const [acc, setAcc] = useState('');
  const [status, setStatus] = useState('pendente');
  const txs = useFetch(() => api.get(`/v1/finance/bank/transactions${qs({ account_id: acc, status })}`), [acc, status]);
  const [newAcc, setNewAcc] = useState(null);
  const [imp, setImp] = useState(false);
  const [rec, setRec] = useState(null);
  const [run, busy] = useAction();
  const t = useTable(txs.data || [], { sort: 'tx_date', dir: 'desc' });
  const reloadAll = () => { accounts.reload(); txs.reload(); };
  const createAcc = async () => {
    const v = newAcc;
    const r = await run(() => api.post('/v1/finance/accounts', { name: v.name, bank: v.bank || null, agency: v.agency || null, account: v.account || null, opening_balance_cents: v.opening_balance_cents || 0, opening_date: v.opening_date || null }), 'Conta cadastrada.');
    if (r !== FAIL) { setNewAcc(null); accounts.reload(); }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">Saldo bancário = saldo inicial + lançamentos importados do extrato. Valores de terceiros (prêmios) não transitam por aqui.</p>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setNewAcc({ name: '', bank: '', agency: '', account: '', opening_balance_cents: 0, opening_date: ymd() })}><Plus className="h-4 w-4" /> Nova conta</button>
          <button className="btn-primary" disabled={!accounts.data?.length} onClick={() => setImp(true)}><Upload className="h-4 w-4" /> Importar extrato (OFX/CSV)</button>
        </div>
      </div>
      {accounts.loading && !accounts.data ? <Loading /> : !accounts.data?.length ? (
        <div className="card"><Empty icon={Landmark} title="Nenhuma conta bancária" text="Cadastre a conta da corretora para importar extratos e conciliar recebimentos e pagamentos." /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.data.map((a) => (
            <button key={a.id} onClick={() => setAcc(acc === a.id ? '' : a.id)} aria-pressed={acc === a.id}
              className={cx('card p-4 text-left transition hover:border-primary/50', acc === a.id && 'border-primary ring-1 ring-primary/30', !a.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-medium">{a.name}</div><div className="text-xs text-ink-faint">{[a.bank, a.agency && `ag. ${a.agency}`, a.account && `c/c ${a.account}`].filter(Boolean).join(' · ')}</div></div>
                <Landmark className="h-4 w-4 text-ink-faint" />
              </div>
              <div className="mt-3 text-xl font-semibold tabular-nums">{money(a.balance_cents)}</div>
              <div className="mt-0.5 text-xs text-ink-faint">Saldo pelo extrato importado · {a.pending ? <span className="text-amber-600">{a.pending} lançamento(s) a conciliar</span> : 'tudo conciliado'}</div>
            </button>
          ))}
        </div>
      )}

      <Section title={`Lançamentos do extrato${acc ? ` — ${accounts.data?.find((a) => a.id === acc)?.name || ''}` : ''}`}
        actions={<Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">Todas as situações</option>
          {Object.entries(TX_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>} bodyClass="p-0">
        {txs.loading && !txs.data ? <Loading /> : !txs.data?.length ? <Empty title="Nenhum lançamento nesta situação" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><SortTh t={t} k="tx_date">Data</SortTh><th>Conta</th><th>Descrição</th><SortTh t={t} k="amount_cents" className="text-right">Valor</SortTh><th className="text-right">Vinculado</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {t.rows.map((x) => (
                  <tr key={x.id}>
                    <td className="tabular-nums">{fmt(x.tx_date)}</td>
                    <td className="text-xs">{x.account_name}</td>
                    <td className="max-w-sm">{x.description || '—'}{x.matches?.length > 0 && <div className="text-xs text-ink-faint">{x.matches.map((m) => `${MATCH_KIND[m.kind] || m.kind} ${money(m.amount_cents)}`).join(' · ')}</div>}</td>
                    <td className="text-right font-medium"><Num v={x.amount_cents} /></td>
                    <td className="text-right text-xs tabular-nums">{Number(x.matched_cents) ? `${money(x.matched_cents)} de ${money(Math.abs(x.amount_cents))}` : '—'}</td>
                    <td><StatusChip map={TX_STATUS} value={x.status} />{x.status === 'pendente' && Number(x.matched_cents) > 0 && <span className="chip ml-1 bg-amber-500/15 text-amber-700 dark:text-amber-300">parcial</span>}</td>
                    <td className="text-right"><button className={smallBtn} onClick={() => setRec(x)}><Link2 className="h-3.5 w-3.5" /> {x.status === 'pendente' ? 'Conciliar' : 'Vínculos'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager t={t} />
          </div>
        )}
      </Section>

      <Modal open={!!newAcc} onClose={() => setNewAcc(null)} title="Nova conta bancária"
        footer={<><button className="btn-ghost" onClick={() => setNewAcc(null)}>Voltar</button><button className="btn-primary" disabled={busy || String(newAcc?.name || '').trim().length < 2} onClick={createAcc}>Cadastrar</button></>}>
        {newAcc && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input className="sm:col-span-2" label="Nome da conta" placeholder="Ex.: Conta movimento" value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} />
            <Input label="Banco" value={newAcc.bank} onChange={(e) => setNewAcc({ ...newAcc, bank: e.target.value })} />
            <Input label="Agência" value={newAcc.agency} onChange={(e) => setNewAcc({ ...newAcc, agency: e.target.value })} />
            <Input label="Conta" value={newAcc.account} onChange={(e) => setNewAcc({ ...newAcc, account: e.target.value })} />
            <Input label="Data do saldo inicial" type="date" value={newAcc.opening_date} onChange={(e) => setNewAcc({ ...newAcc, opening_date: e.target.value })} />
            <CentsInput label="Saldo inicial" allowEmpty={false} value={newAcc.opening_balance_cents} onChange={(v) => setNewAcc({ ...newAcc, opening_balance_cents: v ?? 0 })} />
          </div>
        )}
      </Modal>
      {imp && <BankImport accounts={accounts.data || []} defaultAccount={acc} onClose={() => setImp(false)} onDone={reloadAll} />}
      {rec && <ReconcileTx tx={rec} onClose={() => setRec(null)} onChanged={reloadAll} />}
    </div>
  );
}

function BankImport({ accounts, defaultAccount, onClose, onDone }) {
  const [acc, setAcc] = useState(defaultAccount || accounts[0]?.id || '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (!acc || !file) return;
    setPreview(null);
    run(() => api.post('/v1/finance/bank/import', { account_id: acc, ...file, preview: true })).then((r) => { if (r !== FAIL) setPreview(r); });
  }, [acc, file]); // eslint-disable-line
  const doImport = async () => {
    const r = await run(() => api.post('/v1/finance/bank/import', { account_id: acc, ...file, preview: false }), 'Extrato importado.');
    if (r !== FAIL) { setSummary(r.summary); onDone(); }
  };
  const ins = (preview?.lines || []).filter((l) => l.amount_cents > 0).reduce((a, l) => a + l.amount_cents, 0);
  const outs = (preview?.lines || []).filter((l) => l.amount_cents < 0).reduce((a, l) => a + l.amount_cents, 0);
  return (
    <Modal open onClose={onClose} size="xl" title="Importar extrato bancário" subtitle="OFX ou CSV. Arquivo repetido é recusado; lançamentos já importados não duplicam."
      footer={summary ? <button className="btn-primary" onClick={onClose}>Concluir</button> : <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <SubmitButton busy={busy} onClick={doImport} problems={[!preview && 'Escolha a conta e o arquivo do extrato para ver a prévia.', preview?.duplicate_file && 'Este arquivo já foi importado.', preview && !preview.lines.length && 'Nenhum lançamento novo para importar.']}><Upload className="h-4 w-4" /> Importar {preview?.lines.length || 0} lançamento(s)</SubmitButton>
      </>}>
      <div className="space-y-4">
        {summary ? (
          <Notice tone="ok">Importação concluída: <b>{summary.inserted}</b> lançamento(s) novo(s), {summary.duplicates} já existente(s), {summary.errors?.length || 0} rejeitado(s). Concilie os pendentes na lista.</Notice>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Conta" value={acc} onChange={(e) => setAcc(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <div>
                <span className="label">Arquivo</span>
                <FileButton accept=".ofx,.csv,.txt" onFile={async (f) => setFile({ filename: f.name, content: await fileToText(f) })}><FileSpreadsheet className="h-4 w-4" /> {file ? file.filename : 'Escolher arquivo'}</FileButton>
              </div>
            </div>
            <p className="text-xs text-ink-faint">CSV: separador <code>;</code> com colunas <code>data;valor;descricao;id</code> (valor negativo = saída). OFX: lido diretamente (FITID evita duplicidade).</p>
            {busy && !preview && <Loading />}
            {preview && (
              <div className="space-y-3">
                {preview.duplicate_file && <Notice tone="danger">Este arquivo já foi importado. A importação será recusada.</Notice>}
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label="Lançamentos novos" value={preview.lines.length} />
                  <Stat label="Entradas" value={money(ins)} icon={ArrowDownCircle} tone="text-emerald-600" />
                  <Stat label="Saídas" value={<Num v={outs} />} icon={ArrowUpCircle} tone="text-red-600" />
                  <Stat label="Já importados" value={preview.duplicates} />
                </div>
                {preview.errors?.length > 0 && <Notice tone="warn"><b>{preview.errors.length} linha(s) rejeitada(s):</b> {preview.errors.slice(0, 12).map((e) => `linha ${e.line ?? '?'}: ${e.error}`).join(' · ')}</Notice>}
                {preview.lines.length > 0 && (
                  <div className="card max-h-[40vh] overflow-auto">
                    <table className="table-clean">
                      <thead><tr><th>Data</th><th>Descrição</th><th>Identificador</th><th className="text-right">Valor</th></tr></thead>
                      <tbody>{preview.lines.map((l, i) => <tr key={`${l.fingerprint}-${l.ordinal}-${i}`}><td className="tabular-nums">{fmt(l.date)}</td><td>{l.description}</td><td className="text-xs text-ink-faint">{l.fitid || '—'}</td><td className="text-right"><Num v={l.amount_cents} /></td></tr>)}</tbody>
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

function ReconcileTx({ tx, onClose, onChanged }) {
  const settings = useSettings();
  const isIn = Number(tx.amount_cents) > 0;
  const [cur, setCur] = useState(tx);
  const { data: sug, loading, reload } = useFetch(() => (cur.status === 'pendente' ? api.get(`/v1/finance/bank/transactions/${tx.id}/suggestions`) : Promise.resolve(null)), [cur.status, cur.matched_cents]);
  const [entry, setEntry] = useState({ category: '', description: tx.description || '' });
  const [undo, setUndo] = useState(null);
  const [run, busy] = useAction();
  const cats = (isIn ? settings.incomeCategories : settings.expenseCategories) || [];
  const remaining = Math.abs(Number(tx.amount_cents)) - Number(cur.matched_cents || 0);
  const refresh = async () => {
    onChanged();
    const list = await api.get(`/v1/finance/bank/transactions${qs({ account_id: tx.account_id })}`).catch(() => null);
    const n = list?.find((x) => x.id === tx.id);
    if (n) setCur(n); else reload();
  };
  const link = async (kind, id) => {
    const r = await run(() => api.post('/v1/finance/bank/reconcile', { transaction_id: tx.id, target_kind: kind, target_id: id }));
    if (r !== FAIL) { refresh(); }
  };
  const direct = async () => {
    const r = await run(() => api.post(`/v1/finance/bank/transactions/${tx.id}/entry`, entry), 'Lançamento criado e conciliado.');
    if (r !== FAIL) refresh();
  };
  const doUndo = async ({ reason }) => {
    const r = await run(() => api.post(`/v1/finance/bank/matches/${undo.id}/undo`, { reason }), 'Conciliação desfeita. A pendência foi reaberta; a operação original foi preservada.');
    if (r !== FAIL) { setUndo(null); refresh(); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={`${isIn ? 'Entrada' : 'Saída'} de ${money(Math.abs(tx.amount_cents))} em ${fmt(tx.tx_date)}`}
      subtitle={`${tx.account_name} · ${tx.description || 'sem descrição'}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip map={TX_STATUS} value={cur.status} />
          <span className="text-sm tabular-nums text-ink-soft">Vinculado {money(cur.matched_cents || 0)} · restante {money(remaining)}</span>
        </div>
        {cur.matches?.length > 0 && (
          <Section title="Vínculos atuais" bodyClass="p-0">
            <table className="table-clean">
              <thead><tr><th>Destino</th><th className="text-right">Valor</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {cur.matches.map((m) => (
                  <tr key={m.id}><td>{MATCH_KIND[m.kind] || m.kind}</td><td className="text-right"><Num v={m.amount_cents} /></td>
                    <td className="text-right">{m.kind === 'split_batch' ? <span className="text-xs text-ink-faint">pagamento de lote não se desfaz aqui</span>
                      : <button className={smallBtn} onClick={() => setUndo(m)}><Undo2 className="h-3.5 w-3.5" /> Desfazer</button>}</td></tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        {cur.status === 'pendente' && (loading && !sug ? <Loading /> : sug && (
          <>
            {isIn && (
              <Section title="Liquidações de comissão não conciliadas" subtitle="Um depósito agrupado da seguradora pode cobrir várias liquidações: vincule uma de cada vez (conciliação parcial é permitida)." bodyClass="p-0">
                {!sug.settlements?.length ? <div className="p-4 text-sm text-ink-faint">Nenhuma liquidação próxima desta data (±10 dias).</div> : (
                  <table className="table-clean">
                    <thead><tr><th>Liquidação</th><th>Seguradora</th><th>Data</th><th className="text-right">Líquido</th><th><span className="sr-only">Ações</span></th></tr></thead>
                    <tbody>
                      {sug.settlements.map((s) => (
                        <tr key={s.id}><td className="font-medium">{docNumber(settings, 'settlement', s.number)}</td><td>{s.institution_name}</td><td className="tabular-nums">{fmt(s.settled_date)}</td>
                          <td className={cx('text-right', Number(s.net_cents) === remaining && 'font-semibold text-emerald-600')}><Num v={s.net_cents} /></td>
                          <td className="text-right"><button className={smallBtn} disabled={busy || Number(s.net_cents) > remaining} onClick={() => link('commission_settlement', s.id)}><Link2 className="h-3.5 w-3.5" /> Vincular</button></td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            )}
            {!isIn && sug.batches?.length > 0 && (
              <Notice>Há {sug.batches.length} lote(s) de repasse aprovado(s) aguardando pagamento ({sug.batches.map((b) => `${docNumber(settings, 'batch', b.number)}: ${money(b.total_cents)}`).join(', ')}). O pagamento de lote é registrado em <Link className="font-medium underline" to="/repasses?tab=lotes">Repasses › Lotes</Link>, vinculando este débito.</Notice>
            )}
            <Section title={isIn ? 'Contas a receber em aberto' : 'Contas a pagar em aberto'} bodyClass="p-0">
              {!sug.entries?.length ? <div className="p-4 text-sm text-ink-faint">Nenhum lançamento em aberto compatível.</div> : (
                <table className="table-clean">
                  <thead><tr><th>Descrição</th><th>Vencimento</th><th className="text-right">Valor</th><th><span className="sr-only">Ações</span></th></tr></thead>
                  <tbody>
                    {sug.entries.map((e) => (
                      <tr key={e.id}><td>{e.description}</td><td className="tabular-nums">{fmt(e.due_date)}</td><td className="text-right"><Num v={e.amount_cents} /></td>
                        <td className="text-right"><button className={smallBtn} disabled={busy || Number(e.amount_cents) > remaining} onClick={() => link('cash_entry', e.id)}><Link2 className="h-3.5 w-3.5" /> Vincular</button></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            {Number(cur.matched_cents || 0) === 0 && (
              <Section title="Lançamento direto" subtitle="Para tarifas, despesas ou receitas sem lançamento prévio: cria o lançamento pago e já o concilia com esta linha.">
                <div className="grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
                  <Select label="Categoria" value={entry.category} onChange={(e) => setEntry({ ...entry, category: e.target.value })}>
                    <option value="">Selecione…</option>
                    {cats.map((x) => <option key={x} value={x}>{x}</option>)}
                  </Select>
                  <Input label="Descrição" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} />
                  <SubmitButton busy={busy} onClick={direct} problems={[!entry.category && 'Escolha a categoria.', entry.description.trim().length < 2 && 'Escreva uma descrição.']}><CheckCircle2 className="h-4 w-4" /> Lançar e conciliar</SubmitButton>
                </div>
              </Section>
            )}
          </>
        ))}
      </div>
      <PromptModal open={!!undo} onClose={() => setUndo(null)} onSubmit={doUndo} danger confirmText="Desfazer conciliação" title="Desfazer conciliação"
        subtitle="A trilha é preservada, a pendência reabre e a operação original (liquidação ou lançamento) continua intacta. Período fechado não permite desfazer."
        fields={[{ key: 'reason', label: 'Motivo', required: true, textarea: true, min: 5 }]} />
    </Modal>
  );
}

// =====================================================================================
// Contas a pagar e receber
// =====================================================================================
function Entries() {
  const settings = useSettings();
  const [f, setF] = useState({ kind: '', status: 'aberto', from: '', to: '' });
  const { data, loading, reload } = useFetch(() => api.get(`/v1/finance/entries${qs(f)}`), [f.kind, f.status, f.from, f.to]);
  const t = useTable(data || [], { sort: 'due_date', dir: f.status === 'aberto' ? 'asc' : 'desc' });
  const [form, setForm] = useState(null);
  const [settle, setSettle] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [run, busy] = useAction();
  const today = ymd();
  const sums = useMemo(() => {
    const s = { rec: 0, pay: 0, overRec: 0, overPay: 0 };
    for (const e of data || []) {
      if (e.status !== 'aberto') continue;
      if (e.kind === 'receber') { s.rec += Number(e.amount_cents); if (e.due_date < today) s.overRec += Number(e.amount_cents); } else { s.pay += Number(e.amount_cents); if (e.due_date < today) s.overPay += Number(e.amount_cents); }
    }
    return s;
  }, [data, today]);
  const save = async () => {
    const v = form;
    const r = await run(() => api.post('/v1/finance/entries', { kind: v.kind, category: v.category, description: v.description, amount_cents: v.amount_cents, competence: v.competence, due_date: v.due_date, cost_center: v.cost_center || null, notes: v.notes || null }), 'Lançamento criado.');
    if (r !== FAIL) { setForm(null); reload(); }
  };
  const doSettle = async ({ paid_date, evidence }) => {
    const r = await run(() => api.post(`/v1/finance/entries/${settle.id}/settle`, { paid_date, evidence }), 'Baixa registrada.');
    if (r !== FAIL) { setSettle(null); reload(); }
  };
  const doCancel = async ({ reason }) => {
    const r = await run(() => api.post(`/v1/finance/entries/${cancel.id}/cancel`, { reason }), 'Lançamento cancelado.');
    if (r !== FAIL) { setCancel(null); reload(); }
  };
  const cats = form ? (form.kind === 'receber' ? settings.incomeCategories : settings.expenseCategories) || [] : [];
  const okForm = form && form.category && String(form.description).trim().length >= 2 && form.amount_cents > 0 && form.competence && form.due_date;
  return (
    <div className="space-y-5">
      {f.status === 'aberto' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="A receber em aberto" value={money(sums.rec)} icon={ArrowDownCircle} tone="text-emerald-600" />
          <Stat label="A receber vencido" value={money(sums.overRec)} icon={Clock} tone={sums.overRec ? 'text-red-600' : undefined} />
          <Stat label="A pagar em aberto" value={money(sums.pay)} icon={ArrowUpCircle} tone="text-red-600" />
          <Stat label="A pagar vencido" value={money(sums.overPay)} icon={Clock} tone={sums.overPay ? 'text-red-600' : undefined} />
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="w-40">
            <option value="">Todos</option><option value="receber">A receber</option><option value="pagar">A pagar</option>
          </Select>
          <Select label="Situação" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-40">
            <option value="">Todas</option>
            {Object.entries(ENTRY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Input label="Vencimento de" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-40" />
          <Input label="até" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-40" />
        </div>
        <button className="btn-primary" onClick={() => setForm({ kind: 'pagar', category: '', description: '', amount_cents: null, competence: ymd(), due_date: ymd(), cost_center: '', notes: '' })}><Plus className="h-4 w-4" /> Novo lançamento</button>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={Receipt} title="Nenhum lançamento" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="due_date">Vencimento</SortTh><SortTh t={t} k="kind">Tipo</SortTh><SortTh t={t} k="category">Categoria</SortTh><th>Descrição</th><SortTh t={t} k="amount_cents" className="text-right">Valor</SortTh>
              <th>Competência</th><th>Pago em</th><th>Origem</th><th>Situação</th><th><span className="sr-only">Ações</span></th>
            </tr></thead>
            <tbody>
              {t.rows.map((e) => (
                <tr key={e.id}>
                  <td className={cx('tabular-nums', e.status === 'aberto' && e.due_date < today && 'font-medium text-red-600')}>{fmt(e.due_date)}</td>
                  <td>{e.kind === 'receber' ? <span className="text-emerald-700 dark:text-emerald-300">A receber</span> : <span className="text-red-700 dark:text-red-300">A pagar</span>}</td>
                  <td>{e.category}{e.cost_center && <div className="text-xs text-ink-faint">{e.cost_center}</div>}</td>
                  <td className="max-w-xs">{e.description}{e.notes && <div className="text-xs text-ink-faint">{e.notes}</div>}</td>
                  <td className="text-right font-medium"><Num v={e.kind === 'pagar' ? -Number(e.amount_cents) : e.amount_cents} /></td>
                  <td className="tabular-nums text-xs">{fmt(e.competence, 'MM/yyyy')}</td>
                  <td className="tabular-nums text-xs">{fmt(e.paid_date)}</td>
                  <td className="text-xs">{SOURCE[e.source] || e.source}</td>
                  <td><div className="flex flex-wrap gap-1"><StatusChip map={ENTRY_STATUS} value={e.status} />{e.reconciled && <span className="chip bg-teal-500/15 text-teal-700 dark:text-teal-300">Conciliado</span>}</div></td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {e.status === 'aberto' && <button className={smallBtn} onClick={() => setSettle(e)}><CheckCircle2 className="h-3.5 w-3.5" /> Baixar</button>}
                      {e.source === 'manual' && e.status !== 'cancelado' && !e.reconciled && <button className={smallBtn} onClick={() => setCancel(e)}><XCircle className="h-3.5 w-3.5" /> Cancelar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      <p className="text-xs text-ink-faint">Lançamentos de origem "Comissão" e "Repasse" são gerados pelas liquidações e lotes; para corrigi-los, desfaça na origem. Prefira conciliar com o extrato a dar baixa manual.</p>

      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title="Novo lançamento"
        footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[!form?.category && 'Escolha a categoria.', String(form?.description || '').trim().length < 2 && 'Escreva uma descrição.', !(form?.amount_cents > 0) && 'Informe o valor.', !form?.competence && 'Informe a competência.', !form?.due_date && 'Informe o vencimento.']}>Salvar</SubmitButton></>}>
        {form && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Tipo" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, category: '' })}>
                <option value="pagar">Conta a pagar (despesa)</option>
                <option value="receber">Conta a receber (receita própria)</option>
              </Select>
              <Select label="Categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Selecione…</option>
                {cats.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
              <Input className="sm:col-span-2" label="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <CentsInput label="Valor" value={form.amount_cents} onChange={(v) => setForm({ ...form, amount_cents: v })} />
              <Input label="Centro de custo (opcional)" value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} />
              <Input label="Competência" type="date" value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} />
              <Input label="Vencimento" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <Textarea label="Observações" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            {form.kind === 'receber' && <Notice tone="warn">Prêmio do seguro não é receita da corretora (pertence à seguradora) e será recusado aqui. Comissões entram pelas liquidações.</Notice>}
          </div>
        )}
      </Modal>
      <PromptModal open={!!settle} onClose={() => setSettle(null)} onSubmit={doSettle} confirmText="Registrar baixa" title="Baixa manual"
        subtitle={settle && `${settle.description} · ${money(settle.amount_cents)}. Baixa manual exige evidência (comprovante, recibo). Se o valor está no extrato, prefira conciliar.`}
        fields={[{ key: 'paid_date', label: 'Data do pagamento', type: 'date', required: true, min: 10 }, { key: 'evidence', label: 'Evidência', required: true, placeholder: 'Ex.: comprovante PIX 123' }]} />
      <PromptModal open={!!cancel} onClose={() => setCancel(null)} onSubmit={doCancel} danger confirmText="Cancelar lançamento" title="Cancelar lançamento"
        subtitle={cancel && `${cancel.description} · ${money(cancel.amount_cents)}. O registro é mantido como cancelado (só em período aberto e sem conciliação).`} />
    </div>
  );
}

// =====================================================================================
// Projeção
// =====================================================================================
function Projection() {
  const [days, setDays] = useState(60);
  const { data, loading } = useFetch(() => api.get(`/v1/finance/projection?days=${days}`), [days]);
  const rows = useMemo(() => {
    if (!data) return [];
    let bal = data.bank_balance_cents;
    return data.weeks.map((w) => { bal += w.confirmed_in - w.confirmed_out; return { ...w, balance: bal, label: `${fmt(w.start, 'dd/MM')}–${fmt(w.end, 'dd/MM')}` }; });
  }, [data]);
  const totForecast = rows.reduce((a, w) => a + w.forecast_in, 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select label="Horizonte" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40">
          {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} dias</option>)}
        </Select>
        <p className="max-w-xl text-xs text-ink-faint">Confirmado e previsto são mostrados em colunas e séries separadas e nunca somados num mesmo saldo.</p>
      </div>
      {loading && !data ? <Loading /> : !data ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Saldo bancário atual" value={money(data.bank_balance_cents)} hint="Contas ativas, pelo extrato importado." icon={Landmark} />
            <Stat label="Contas vencidas" value={<span className="text-base"><span className="text-emerald-600">+{money(data.overdue_in_cents)}</span> / <span className="text-red-600">−{money(data.overdue_out_cents)}</span></span>} hint="A receber / a pagar já vencidos e em aberto (fora das semanas)." icon={Clock} />
            <Stat label="Repasses a pagar" value={money(data.splits_payable_cents)} hint="Liberados ou em lote (sem recuperáveis). Não distribuídos nas semanas." icon={Users} tone="text-orange-600" />
            <Stat label="Previsão de comissões" value={money(totForecast)} hint="Comissões a liquidar no horizonte — previsão, não caixa." icon={Wallet} tone="text-amber-600" />
          </div>
          <Section title="Fluxo semanal">
            <div className="h-72" role="img" aria-label="Gráfico de barras com entradas confirmadas, saídas confirmadas e previsão de comissões por semana">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={brlShort} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip formatter={(v, n) => [money(v), n]} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="confirmed_in" name="Entradas confirmadas" fill={COLORS.in} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="confirmed_out" name="Saídas confirmadas" fill={COLORS.out} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="forecast_in" name="Previsão de comissões (não confirmada)" fill={COLORS.forecast} fillOpacity={0.45} stroke={COLORS.forecast} strokeDasharray="4 2" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Semana</th><th className="text-right">Entradas confirmadas</th><th className="text-right">Saídas confirmadas</th><th className="text-right">Saldo projetado (só confirmado)</th><th className="text-right">Previsão de comissões (à parte)</th></tr></thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.start}>
                    <td className="tabular-nums">{fmt(w.start)} a {fmt(w.end)}</td>
                    <td className="text-right text-emerald-700 dark:text-emerald-300"><Num v={w.confirmed_in} /></td>
                    <td className="text-right text-red-700 dark:text-red-300">{w.confirmed_out ? <Num v={-w.confirmed_out} /> : money(0)}</td>
                    <td className="text-right font-medium"><Num v={w.balance} /></td>
                    <td className="text-right text-amber-700 dark:text-amber-300">{money(w.forecast_in)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notice><b>Método:</b> {data.method} O saldo projetado não inclui vencidos, repasses a pagar nem a previsão de comissões.</Notice>
        </>
      )}
    </div>
  );
}

// =====================================================================================
// Resultado gerencial
// =====================================================================================
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function Result() {
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const { data, loading } = useFetch(() => api.get(`/v1/finance/result?year=${year}`), [year]);
  const model = useMemo(() => {
    if (!data) return null;
    const months = MONTHS.map((m, i) => ({ period: `${year}-${String(i + 1).padStart(2, '0')}`, label: m, rec: 0, pay: 0, gross: 0, retention: 0 }));
    const cats = {};
    for (const r of data.rows) {
      const m = months.find((x) => x.period === r.period);
      const v = Number(r.total);
      if (m) { if (r.kind === 'receber') m.rec += v; else m.pay += v; }
      const k = `${r.kind}|${r.category}`;
      cats[k] = cats[k] || { kind: r.kind, category: r.category, total: 0 };
      cats[k].total += v;
    }
    for (const s of data.settlements) { const m = months.find((x) => x.period === s.period); if (m) { m.gross += Number(s.gross); m.retention += Number(s.retention); } }
    const tot = months.reduce((a, m) => ({ rec: a.rec + m.rec, pay: a.pay + m.pay, gross: a.gross + m.gross, retention: a.retention + m.retention }), { rec: 0, pay: 0, gross: 0, retention: 0 });
    return { months, tot, cats: Object.values(cats).sort((a, b) => a.kind.localeCompare(b.kind) || b.total - a.total) };
  }, [data, year]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
          {[now + 1, now, now - 1, now - 2, now - 3].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
      {loading && !data ? <Loading /> : !model ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Receitas (pagas)" value={money(model.tot.rec)} icon={ArrowDownCircle} tone="text-emerald-600" />
            <Stat label="Despesas (pagas)" value={money(model.tot.pay)} icon={ArrowUpCircle} tone="text-red-600" />
            <Stat label="Resultado gerencial" value={<Num v={model.tot.rec - model.tot.pay} />} hint="Não é lucro contábil." />
            <Stat label="Comissão bruta liquidada" value={money(model.tot.gross)} hint={`Retenções informadas: ${money(model.tot.retention)}`} icon={Landmark} />
          </div>
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Mês</th><th className="text-right">Receitas</th><th className="text-right">Despesas</th><th className="text-right">Resultado</th><th className="text-right">Comissão bruta liquidada</th><th className="text-right">Retenções</th></tr></thead>
              <tbody>
                {model.months.map((m) => {
                  const empty = !m.rec && !m.pay && !m.gross;
                  return (
                    <tr key={m.period} className={cx(empty && 'text-ink-faint')}>
                      <td>{m.label}/{year}</td>
                      <td className="text-right"><Num v={m.rec} /></td>
                      <td className="text-right">{m.pay ? <Num v={-m.pay} /> : money(0)}</td>
                      <td className="text-right font-medium"><Num v={m.rec - m.pay} /></td>
                      <td className="text-right text-ink-soft"><Num v={m.gross} /></td>
                      <td className="text-right text-ink-soft"><Num v={m.retention} /></td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td>Total</td><td className="text-right"><Num v={model.tot.rec} /></td><td className="text-right"><Num v={-model.tot.pay} /></td>
                  <td className="text-right"><Num v={model.tot.rec - model.tot.pay} /></td><td className="text-right"><Num v={model.tot.gross} /></td><td className="text-right"><Num v={model.tot.retention} /></td>
                </tr>
              </tbody>
            </table>
          </div>
          {model.cats.length > 0 && (
            <Section title="Por categoria" bodyClass="p-0">
              <table className="table-clean">
                <thead><tr><th>Tipo</th><th>Categoria</th><th className="text-right">Total no ano</th></tr></thead>
                <tbody>{model.cats.map((x) => <tr key={`${x.kind}${x.category}`}><td>{x.kind === 'receber' ? 'Receita' : 'Despesa'}</td><td>{x.category}</td><td className="text-right"><Num v={x.kind === 'pagar' ? -x.total : x.total} /></td></tr>)}</tbody>
              </table>
            </Section>
          )}
          <Notice><b>Método:</b> {data.method} As colunas de comissão bruta e retenções são informativas e não somam ao resultado (a receita de comissão já entra pelo líquido).</Notice>
        </>
      )}
    </div>
  );
}

// =====================================================================================
// Períodos
// =====================================================================================
function Periods() {
  const { can, user } = useAuth();
  const { data, loading, reload } = useFetch(() => api.get('/v1/finance/periods'), []);
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7); })();
  const [period, setPeriod] = useState(lastMonth);
  const [reopen, setReopen] = useState(null);
  const [run, busy] = useAction();
  const admin = ['owner', 'admin'].includes(user?.role);
  const close = async () => {
    const r = await run(() => api.post('/v1/finance/periods/close', { period }), `Período ${period} fechado.`);
    if (r !== FAIL) reload();
  };
  const doReopen = async ({ reason }) => {
    const r = await run(() => api.post(`/v1/finance/periods/${reopen.id}/reopen`, { reason }), 'Período reaberto.');
    if (r !== FAIL) { setReopen(null); reload(); }
  };
  return (
    <div className="space-y-5">
      <Notice>Fechar um período bloqueia lançamentos, baixas, liquidações e conciliações com data nele. Ajustes posteriores vão para um período aberto, vinculados à origem. Reabertura exige proprietário ou administrador, com motivo.</Notice>
      {can('finance_close') && (
        <Section title="Fechar período">
          <div className="flex flex-wrap items-end gap-3">
            <Input label="Mês" type="month" max={lastMonth} value={period} onChange={(e) => setPeriod(e.target.value)} className="w-48" />
            <button className="btn-primary" disabled={busy || !/^\d{4}-\d{2}$/.test(period)} onClick={close}><Lock className="h-4 w-4" /> Fechar {period}</button>
            <span className="text-xs text-ink-faint">Só meses já encerrados.</span>
          </div>
        </Section>
      )}
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={Lock} title="Nenhum período fechado" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Período</th><th>Fechado por</th><th>Reabertura</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium tabular-nums">{p.period}</td>
                  <td className="text-xs">{p.closed_by_name || '—'}<div className="text-ink-faint">{fmtDateTime(p.closed_at)}</div></td>
                  <td className="text-xs">{p.reopened_at ? <>{p.reopened_by_name} · {fmtDateTime(p.reopened_at)}<div className="text-ink-faint">{p.reopen_reason}</div></> : '—'}</td>
                  <td>{p.reopened_at ? <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300"><Unlock className="h-3 w-3" /> Reaberto</span> : <span className="chip bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"><Lock className="h-3 w-3" /> Fechado</span>}</td>
                  <td className="text-right">{!p.reopened_at && can('finance_close') && admin && <button className={smallBtn} onClick={() => setReopen(p)}><Unlock className="h-3.5 w-3.5" /> Reabrir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PromptModal open={!!reopen} onClose={() => setReopen(null)} onSubmit={doReopen} danger confirmText="Reabrir período" title={`Reabrir ${reopen?.period || ''}`}
        subtitle="A reabertura fica registrada em auditoria. Feche novamente após os ajustes." fields={[{ key: 'reason', label: 'Motivo', required: true, textarea: true, min: 5 }]} />
    </div>
  );
}
