// Oportunidades (5.2): funil por etapa (colunas com rolagem horizontal) ou lista, com próxima ação obrigatória na prática.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Target, Plus, LayoutGrid, List, Calculator, AlertTriangle, CalendarClock, User, Clock } from 'lucide-react';
import { api, qs } from '../lib/api';
import { STAGES, QUOTE_REQUEST_STATUS, money, fmt, fmtDateTime, docNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  PageHeader, Section, KV, Modal, Input, Textarea, Select, CentsInput, StatusChip, Notice, Empty, Loading, Toggle, useFetch, useAction, FAIL, cx,
} from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { ClientPicker } from './Clients';

const STAGE_KEYS = Object.keys(STAGES);
const OPEN_STAGES = STAGE_KEYS.filter((s) => !['ganho', 'perdido'].includes(s));
const DEFAULT_LOSS = ['Preço', 'Atendimento', 'Cobertura', 'Concorrente', 'Bem vendido', 'Cliente sem retorno', 'Outro'];

/** ISO → valor de <input type="datetime-local"> no fuso local. */
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const isLate = (iso) => iso && new Date(iso).getTime() < Date.now();

function NextAction({ o, compact }) {
  if (!o.next_action_at) {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Sem próxima ação</span>;
  }
  const late = isLate(o.next_action_at) && !['ganho', 'perdido'].includes(o.stage);
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs', late ? 'font-medium text-red-700 dark:text-red-300' : 'text-ink-soft')}>
      <CalendarClock className="h-3.5 w-3.5" />
      {late && 'Atrasada · '}{fmtDateTime(o.next_action_at)}{!compact && o.next_action ? ` — ${o.next_action}` : ''}
    </span>
  );
}

// ---------------- Formulário (criar / editar) ----------------
const emptyOpp = () => ({ client: null, branch: 'auto', title: '', need: '', stage: 'novo_contato', estimated_premium_cents: null, origin: '', owner_user_id: '', next_action: '', next_action_at: '' });

function OppForm({ v, set, users, isNew, canOwner }) {
  const { meta, branchLabel } = useAuth();
  const branches = Object.keys(meta?.branches || {});
  const up = (k) => (e) => set({ ...v, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {isNew && <div className="sm:col-span-2"><ClientPicker required value={v.client} onChange={(x) => set({ ...v, client: x })} /></div>}
      <Input label="Título *" value={v.title} onChange={up('title')} placeholder="Ex.: Seguro auto — carro novo" className="sm:col-span-2" />
      <Select label="Ramo" value={v.branch} onChange={up('branch')}>
        {(branches.length ? branches : [v.branch]).map((b) => <option key={b} value={b}>{branchLabel(b)}</option>)}
      </Select>
      {isNew ? (
        <Select label="Etapa inicial" value={v.stage} onChange={up('stage')}>
          {OPEN_STAGES.map((s) => <option key={s} value={s}>{STAGES[s].label}</option>)}
        </Select>
      ) : <div />}
      <CentsInput label="Prêmio estimado" value={v.estimated_premium_cents} onChange={(x) => set({ ...v, estimated_premium_cents: x })} hint="Estimativa comercial — não é cotação." />
      <Input label="Origem" value={v.origin} onChange={up('origin')} placeholder="indicação, site, carteira…" />
      {canOwner && (
        <Select label="Responsável" value={v.owner_user_id} onChange={up('owner_user_id')}>
          <option value="">{isNew ? 'Eu mesmo' : 'Manter atual'}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      )}
      <Textarea label="Necessidade do cliente" value={v.need} onChange={up('need')} className="sm:col-span-2" />
      <Input label="Próxima ação" value={v.next_action} onChange={up('next_action')} placeholder="Ex.: ligar para coletar dados do veículo" />
      <Input label="Quando" type="datetime-local" value={v.next_action_at} onChange={up('next_action_at')} />
      {!v.next_action_at && <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">Sem data de próxima ação a oportunidade aparece como pendente no painel.</p>}
    </div>
  );
}

function NewOppModal({ open, onClose, onCreated, users, initialClient }) {
  const { scope } = useAuth();
  const [v, setV] = useState(emptyOpp);
  const [run, busy] = useAction();
  useEffect(() => { if (open) setV({ ...emptyOpp(), client: initialClient || null }); }, [open, initialClient]);
  const save = async () => {
    const body = {
      client_id: v.client.id, branch: v.branch, title: v.title.trim(), need: v.need || null, stage: v.stage, estimated_premium_cents: v.estimated_premium_cents,
      origin: v.origin || null, owner_user_id: v.owner_user_id || null, next_action: v.next_action || null, next_action_at: fromLocalInput(v.next_action_at),
    };
    const r = await run(() => api.post('/v1/opportunities', body), 'Oportunidade criada.');
    if (r !== FAIL) onCreated(r);
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Nova oportunidade"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || !v.client || v.title.trim().length < 2} onClick={save}>{busy ? 'Salvando…' : 'Criar oportunidade'}</button></>}>
      <OppForm v={v} set={setV} users={users} isNew canOwner={scope('opportunities') === 'all'} />
    </Modal>
  );
}

// ---------------- Mudança de etapa (perdido exige motivo) ----------------
function LostModal({ open, onClose, onConfirm, reasons }) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setDetail(''); } }, [open]);
  const text = [reason, detail.trim()].filter(Boolean).join(' — ').slice(0, 200);
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Marcar como perdida" subtitle="O motivo da perda é obrigatório e alimenta os indicadores."
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn-danger" disabled={!reason || busy} onClick={async () => { setBusy(true); try { await onConfirm(text); } finally { setBusy(false); } }}>Confirmar perda</button></>}>
      <div className="space-y-3">
        <Select label="Motivo *" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Selecione…</option>
          {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Textarea label="Detalhe (opcional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </div>
    </Modal>
  );
}

function useStageMove(onDone) {
  const [run, busy] = useAction();
  const [lost, setLost] = useState(null);
  const move = async (o, stage) => {
    if (stage === o.stage) return;
    if (stage === 'perdido') { setLost(o); return; }
    const r = await run(() => api.put(`/v1/opportunities/${o.id}`, { stage }), `Etapa: ${STAGES[stage].label}.`);
    if (r !== FAIL) onDone(r);
  };
  const confirmLost = async (reason) => {
    const r = await run(() => api.put(`/v1/opportunities/${lost.id}`, { stage: 'perdido', lost_reason: reason }), 'Oportunidade marcada como perdida.');
    if (r !== FAIL) { setLost(null); onDone(r); }
  };
  return { move, busy, lost, setLost, confirmLost };
}

function StageSelect({ o, onMove, disabled, showClosed = true }) {
  const keys = showClosed ? STAGE_KEYS : OPEN_STAGES;
  return (
    <label className="block">
      <span className="sr-only">Mover etapa de {o.title}</span>
      <select className="input h-8 py-0 text-xs" value={o.stage} disabled={disabled} onClick={(e) => e.stopPropagation()} onChange={(e) => onMove(o, e.target.value)}>
        {keys.map((s) => <option key={s} value={s}>{STAGES[s].label}</option>)}
      </select>
    </label>
  );
}

// ---------------- Detalhe ----------------
function DetailModal({ id, onClose, onChanged, users, reasons }) {
  const nav = useNavigate();
  const { branchLabel, can, scope, company } = useAuth();
  const { data: o, loading, reload, setData } = useFetch(() => (id ? api.get(`/v1/opportunities/${id}`) : Promise.resolve(null)), [id]);
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const sm = useStageMove(() => { reload(); onChanged(); });
  useEffect(() => { setEdit(null); }, [id]);
  const startEdit = () => setEdit({
    client: { id: o.client_id, name: o.client_name }, branch: o.branch, title: o.title, need: o.need || '', stage: o.stage, estimated_premium_cents: o.estimated_premium_cents,
    origin: o.origin || '', owner_user_id: '', next_action: o.next_action || '', next_action_at: toLocalInput(o.next_action_at),
  });
  const save = async () => {
    const body = { branch: edit.branch, title: edit.title.trim(), need: edit.need || null, estimated_premium_cents: edit.estimated_premium_cents, origin: edit.origin || null,
      next_action: edit.next_action || null, next_action_at: fromLocalInput(edit.next_action_at) };
    if (edit.owner_user_id) body.owner_user_id = edit.owner_user_id;
    const r = await run(() => api.put(`/v1/opportunities/${o.id}`, body), 'Oportunidade atualizada.');
    if (r !== FAIL) { setEdit(null); setData({ ...o, ...r }); reload(); onChanged(); }
  };
  const closed = o && ['ganho', 'perdido'].includes(o.stage);
  const owner = o && (users.find((u) => u.id === o.owner_user_id)?.name || o.owner_name);
  return (
    <Modal open={!!id} onClose={onClose} size="lg"
      title={o ? o.title : 'Oportunidade'}
      subtitle={o ? `${docNumber(company?.settings, 'opportunity', o.number)} · ${o.client_name}` : ''}
      footer={o && !edit && (
        <>
          {!closed && <button className="btn-outline" disabled={sm.busy} onClick={() => sm.move(o, 'perdido')}>Marcar como perdida</button>}
          {!closed && <button className="btn-outline" disabled={sm.busy} onClick={() => sm.move(o, 'ganho')}>Marcar como ganha</button>}
          <button className="btn-outline" onClick={startEdit}>Editar</button>
          {can('quotes_manage') && !closed && (
            <button className="btn-primary" onClick={() => nav(`/cotacoes/nova?client=${o.client_id}&branch=${o.branch}&opportunity=${o.id}`)}>
              <Calculator className="h-4 w-4" /> Cotar
            </button>
          )}
        </>
      )}>
      {loading && !o ? <Loading /> : !o ? <Empty icon={AlertTriangle} title="Oportunidade não encontrada" /> : edit ? (
        <div className="space-y-4">
          <OppForm v={edit} set={setEdit} users={users} canOwner={scope('opportunities') === 'all'} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
            <button className="btn-primary" disabled={busy || edit.title.trim().length < 2} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip map={STAGES} value={o.stage} />
            <div className="w-56"><StageSelect o={o} onMove={sm.move} disabled={sm.busy} /></div>
            <NextAction o={o} />
          </div>
          {o.stage === 'perdido' && o.lost_reason && <Notice tone="danger">Motivo da perda: {o.lost_reason}</Notice>}
          <KV cols={2} items={[
            ['Cliente', <Link key="c" to={`/clientes/${o.client_id}`} className="text-primary hover:underline">{o.client_name}</Link>],
            ['Ramo', branchLabel(o.branch)],
            ['Prêmio estimado (comercial)', money(o.estimated_premium_cents, 'não informado')],
            ['Responsável', owner || '—'],
            ['Origem', o.origin],
            ['Criada em', fmtDateTime(o.created_at)],
            ['Próxima ação', o.next_action || '—'],
            ['Necessidade', o.need || '—'],
          ]} />
          <div>
            <h3 className="mb-2 text-sm font-semibold">Cotações vinculadas</h3>
            {!o.quote_requests.length ? <p className="text-sm text-ink-faint">Nenhuma cotação iniciada a partir desta oportunidade.</p> : (
              <ul className="divide-y divide-line rounded-app-sm border border-line">
                {o.quote_requests.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <Link to={`/cotacoes/${q.id}`} className="font-medium hover:text-primary">{docNumber(company?.settings, 'quote', q.number)} · {branchLabel(q.branch)}</Link>
                    <span className="flex items-center gap-2"><span className="text-xs text-ink-faint">{fmt(q.created_at)}</span><StatusChip map={QUOTE_REQUEST_STATUS} value={q.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Linha do tempo</h3>
            {!o.activities.length ? <p className="text-sm text-ink-faint">Sem registros.</p> : (
              <ol className="relative space-y-3 border-l border-line pl-5">
                {o.activities.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                    <div className="text-xs text-ink-faint">{fmtDateTime(a.created_at)} · {a.created_by_name || 'Sistema'}</div>
                    <p className="text-sm">{a.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
      <LostModal open={!!sm.lost} reasons={reasons} onClose={() => sm.setLost(null)} onConfirm={sm.confirmLost} />
    </Modal>
  );
}

// ---------------- Cartão do quadro ----------------
function OppCard({ o, onOpen, onMove, busy, branchLabel }) {
  return (
    <div className="card cursor-pointer p-3 text-sm transition hover:shadow-soft focus-within:ring-2 focus-within:ring-primary" onClick={() => onOpen(o.id)}>
      <button type="button" className="block w-full text-left font-medium leading-snug hover:text-primary" onClick={(e) => { e.stopPropagation(); onOpen(o.id); }}>{o.title}</button>
      <div className="mt-0.5 truncate text-xs text-ink-soft">{o.client_name}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="chip bg-muted text-ink-soft">{branchLabel(o.branch)}</span>
        <span className="tabular-nums text-ink-soft">{money(o.estimated_premium_cents, 'prêmio não informado')}</span>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-ink-faint"><User className="h-3.5 w-3.5" /> {o.owner_name || 'Sem responsável'}</div>
      <div className="mt-1"><NextAction o={o} compact /></div>
      <div className="mt-2"><StageSelect o={o} onMove={onMove} disabled={busy} /></div>
    </div>
  );
}

export default function Opportunities() {
  const { branchLabel, company } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState(() => { try { return localStorage.getItem('apolven.opp.view') || 'board'; } catch { return 'board'; } });
  const [showClosed, setShowClosed] = useState(false);
  const [users, setUsers] = useState([]);
  const [initialClient, setInitialClient] = useState(null);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/opportunities${qs({ open: showClosed ? '' : '1' })}`), [showClosed]);
  const reasons = company?.settings?.lossReasons?.length ? company.settings.lossReasons : DEFAULT_LOSS;
  const sm = useStageMove(() => reload());
  const openId = sp.get('abrir');
  const newOpen = sp.get('novo') === '1';
  const clientParam = sp.get('client');

  useEffect(() => { api.get('/v1/company/users').then((r) => setUsers((r || []).filter((u) => u.active !== false))).catch(() => setUsers([])); }, []);
  useEffect(() => {
    if (!newOpen || !clientParam) { setInitialClient(null); return; }
    api.get(`/v1/clients/${clientParam}`).then((c) => setInitialClient({ id: c.id, name: c.name })).catch(() => setInitialClient(null));
  }, [newOpen, clientParam]);
  useEffect(() => { try { localStorage.setItem('apolven.opp.view', view); } catch { /* sem armazenamento */ } }, [view]);

  const setParam = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === 'novo' && !v) n.delete('client'); setSp(n, { replace: true }); };
  const stages = showClosed ? STAGE_KEYS : OPEN_STAGES;
  const byStage = useMemo(() => Object.fromEntries(stages.map((s) => [s, (data || []).filter((o) => o.stage === s)])), [data, stages]);
  const noAction = (data || []).filter((o) => !['ganho', 'perdido'].includes(o.stage) && !o.next_action_at).length;
  const t = useTable(data, { sort: 'next_action_at', get: { stage: (r) => STAGE_KEYS.indexOf(r.stage), client: (r) => r.client_name, owner: (r) => r.owner_name } });

  return (
    <>
      <PageHeader title="Oportunidades" subtitle="Funil comercial por etapa. Cada oportunidade deve ter uma próxima ação com data."
        actions={<>
          <div className="flex rounded-app-sm bg-muted p-1" role="group" aria-label="Modo de exibição">
            <button className={cx('btn-ghost h-8 px-2.5', view === 'board' && 'bg-surface shadow-soft')} aria-pressed={view === 'board'} onClick={() => setView('board')}><LayoutGrid className="h-4 w-4" /> Funil</button>
            <button className={cx('btn-ghost h-8 px-2.5', view === 'list' && 'bg-surface shadow-soft')} aria-pressed={view === 'list'} onClick={() => setView('list')}><List className="h-4 w-4" /> Lista</button>
          </div>
          <button className="btn-primary" onClick={() => setParam('novo', '1')}><Plus className="h-4 w-4" /> Nova oportunidade</button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="chip bg-muted text-ink-soft">{(data || []).filter((o) => !['ganho', 'perdido'].includes(o.stage)).length} abertas</span>
          {noAction > 0 && <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300"><AlertTriangle className="mr-1 h-3.5 w-3.5" />{noAction} sem próxima ação</span>}
        </div>
        <div className="w-64"><Toggle checked={showClosed} onChange={setShowClosed} label="Mostrar ganhas e perdidas" /></div>
      </div>

      {loading && !data ? <Loading /> : !data ? (
        <Section><Empty icon={AlertTriangle} title="Não foi possível carregar" action={<button className="btn-outline" onClick={reload}>Tentar de novo</button>} /></Section>
      ) : !data.length ? (
        <Section><Empty icon={Target} title="Nenhuma oportunidade" text="Registre pedidos de cotação, indicações e renovações para acompanhar o funil."
          action={<button className="btn-primary" onClick={() => setParam('novo', '1')}><Plus className="h-4 w-4" /> Nova oportunidade</button>} /></Section>
      ) : view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" role="region" aria-label="Funil de oportunidades" tabIndex={0}>
          <div className="flex gap-3">
            {stages.map((s) => {
              const list = byStage[s] || [];
              const total = list.reduce((a, o) => a + (o.estimated_premium_cents || 0), 0);
              const unknown = list.some((o) => o.estimated_premium_cents == null);
              return (
                <section key={s} className="flex w-72 shrink-0 flex-col rounded-app bg-muted/60 p-2" aria-label={STAGES[s].label}>
                  <header className="mb-2 flex items-center justify-between gap-2 px-1">
                    <StatusChip map={STAGES} value={s} />
                    <span className="text-xs text-ink-faint">{list.length}</span>
                  </header>
                  {list.length > 0 && <div className="mb-2 px-1 text-xs text-ink-faint">Estimado: {money(total)}{unknown ? ' (há itens sem estimativa)' : ''}</div>}
                  <div className="flex flex-col gap-2">
                    {list.length ? list.map((o) => <OppCard key={o.id} o={o} branchLabel={branchLabel} busy={sm.busy} onMove={sm.move} onOpen={(id) => setParam('abrir', id)} />)
                      : <p className="px-1 py-6 text-center text-xs text-ink-faint">Nenhuma oportunidade</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="title">Oportunidade</SortTh>
              <SortTh t={t} k="client">Cliente</SortTh>
              <th>Ramo</th>
              <SortTh t={t} k="stage">Etapa</SortTh>
              <SortTh t={t} k="estimated_premium_cents">Prêmio estimado</SortTh>
              <SortTh t={t} k="owner">Responsável</SortTh>
              <SortTh t={t} k="next_action_at">Próxima ação</SortTh>
            </tr></thead>
            <tbody>
              {t.rows.map((o) => (
                <tr key={o.id}>
                  <td><button className="text-left font-medium hover:text-primary" onClick={() => setParam('abrir', o.id)}>{o.title}</button>
                    <div className="text-xs text-ink-faint">{docNumber(company?.settings, 'opportunity', o.number)}</div></td>
                  <td><Link to={`/clientes/${o.client_id}`} className="hover:text-primary">{o.client_name}</Link></td>
                  <td>{branchLabel(o.branch)}</td>
                  <td><div className="w-48"><StageSelect o={o} onMove={sm.move} disabled={sm.busy} /></div></td>
                  <td className="tabular-nums">{money(o.estimated_premium_cents, 'não informado')}</td>
                  <td>{o.owner_name || '—'}</td>
                  <td><NextAction o={o} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      <p className="mt-3 flex items-center gap-1 text-xs text-ink-faint"><Clock className="h-3.5 w-3.5" /> Prêmio estimado é uma previsão comercial; valores de cotação aparecem apenas nas cotações.</p>

      <NewOppModal open={newOpen} users={users} initialClient={initialClient} onClose={() => setParam('novo', null)}
        onCreated={(o) => { const n = new URLSearchParams(sp); n.delete('novo'); n.delete('client'); n.set('abrir', o.id); setSp(n, { replace: true }); reload(); }} />
      <DetailModal id={openId} users={users} reasons={reasons} onClose={() => setParam('abrir', null)} onChanged={reload} />
      <LostModal open={!!sm.lost} reasons={reasons} onClose={() => sm.setLost(null)} onConfirm={sm.confirmLost} />
    </>
  );
}
