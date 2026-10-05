// Agenda e tarefas (5.3): atrasadas, hoje e próximas; criação, conclusão e cancelamento.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Plus, Check, X, RotateCcw, AlertTriangle, Clock, User, ExternalLink } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmt, fmtDateTime, PRIORITY } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Section, Tabs, Modal, Input, Textarea, Select, Empty, Loading, useFetch, useAction, FAIL, cx } from '../components/ui';
import { ClientPicker } from './Clients';

export const TASK_KIND = {
  tarefa: 'Tarefa', ligacao: 'Ligação', visita: 'Visita / reunião', cotacao: 'Cotação', renovacao: 'Renovação', parcela: 'Parcela', sinistro: 'Sinistro',
  documento: 'Documento', cobranca: 'Cobrança', pos_venda: 'Pós-venda',
};
const ENTITY_LINK = {
  policy: (id) => ({ to: `/apolices/${id}`, label: 'Abrir apólice' }),
  quote_request: (id) => ({ to: `/cotacoes/${id}`, label: 'Abrir cotação' }),
  premium_installment: () => ({ to: '/parcelas', label: 'Ver parcelas' }),
  comparison: (id) => ({ to: `/comparativos/${id}`, label: 'Abrir comparativo' }),
  claim: (id) => ({ to: `/sinistros/${id}`, label: 'Abrir sinistro' }),
  proposal: (id) => ({ to: `/propostas/${id}`, label: 'Abrir proposta' }),
  opportunity: (id) => ({ to: `/oportunidades?abrir=${id}`, label: 'Abrir oportunidade' }),
};
export const taskEntityLink = (t) => (t.entity && ENTITY_LINK[t.entity] ? ENTITY_LINK[t.entity](t.entity_id) : null);

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** 'atrasada' | 'hoje' | 'proxima' | 'sem_data' */
export function taskBucket(t, now = new Date()) {
  if (!t.due_at) return 'sem_data';
  const d = new Date(t.due_at);
  if (d < now) return 'atrasada';
  if (sameDay(d, now)) return 'hoje';
  return 'proxima';
}

const emptyTask = (userId) => ({ title: '', description: '', kind: 'tarefa', priority: 'normal', due_at: '', assignee_user_id: userId || '', client: null });
const localNowPlus = (h) => {
  const d = new Date(Date.now() + h * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
};

function NewTaskModal({ open, onClose, onCreated, users }) {
  const { user, can } = useAuth();
  const [v, setV] = useState(() => emptyTask(user?.id));
  const [run, busy] = useAction();
  useEffect(() => { if (open) setV({ ...emptyTask(user?.id), due_at: localNowPlus(2) }); }, [open, user?.id]);
  const up = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const body = {
      title: v.title.trim(), description: v.description.trim() || null, kind: v.kind, priority: v.priority,
      due_at: v.due_at ? new Date(v.due_at).toISOString() : null, assignee_user_id: v.assignee_user_id || null, client_id: v.client?.id || null,
    };
    const r = await run(() => api.post('/v1/tasks', body), 'Tarefa criada.');
    if (r !== FAIL) onCreated(r);
  };
  return (
    <Modal open={open} onClose={onClose} title="Nova tarefa" size="md"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || v.title.trim().length < 2} onClick={save}>{busy ? 'Salvando…' : 'Criar tarefa'}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Título *" value={v.title} onChange={up('title')} className="sm:col-span-2" placeholder="Ex.: Ligar para confirmar dados do veículo" />
        <Select label="Tipo" value={v.kind} onChange={up('kind')}>
          {Object.entries(TASK_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label="Prioridade" value={v.priority} onChange={up('priority')}>
          {Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </Select>
        <Input label="Prazo" type="datetime-local" value={v.due_at} onChange={up('due_at')} />
        {can('tasks') ? (
          <Select label="Responsável" value={v.assignee_user_id} onChange={up('assignee_user_id')}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user?.id ? ' (eu)' : ''}</option>)}
          </Select>
        ) : <div><span className="label">Responsável</span><div className="input bg-muted text-ink-soft">{user?.name} (eu)</div></div>}
        <div className="sm:col-span-2"><ClientPicker label="Cliente (opcional)" value={v.client} onChange={(x) => setV({ ...v, client: x })} /></div>
        <Textarea label="Descrição" value={v.description} onChange={up('description')} className="sm:col-span-2" />
      </div>
    </Modal>
  );
}

function TaskRow({ t, bucket, onStatus, busy, showAssignee }) {
  const link = taskEntityLink(t);
  const pr = PRIORITY[t.priority] || PRIORITY.normal;
  const late = bucket === 'atrasada' && t.status === 'aberta';
  return (
    <li className={cx('flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between', late && 'border-l-4 border-red-500 pl-3')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {late && <span className="chip bg-red-500/10 text-red-700 dark:text-red-300"><AlertTriangle className="mr-1 h-3.5 w-3.5" />Atrasada</span>}
          {t.status === 'concluida' && <span className="chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Concluída</span>}
          {t.status === 'cancelada' && <span className="chip bg-muted text-ink-soft">Cancelada</span>}
          <span className={cx('font-medium', t.status !== 'aberta' && 'text-ink-soft line-through decoration-ink-faint/50')}>{t.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{t.due_at ? fmtDateTime(t.due_at) : 'Sem prazo'}</span>
          <span>{TASK_KIND[t.kind] || t.kind}</span>
          <span className={pr.cls}>Prioridade {pr.label.toLowerCase()}</span>
          {showAssignee && <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{t.assignee_name || 'Sem responsável'}</span>}
          {t.client_id && <Link to={`/clientes/${t.client_id}`} className="text-primary hover:underline">{t.client_name || 'Cliente'}</Link>}
          {link && <Link to={link.to} className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" />{link.label}</Link>}
          {t.done_at && <span>Concluída em {fmtDateTime(t.done_at)}</span>}
        </div>
        {t.description && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{t.description}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {t.status === 'aberta' ? (
          <>
            <button className="btn-outline h-8" disabled={busy} onClick={() => onStatus(t, 'concluida')} aria-label={`Concluir ${t.title}`}><Check className="h-4 w-4" /> Concluir</button>
            <button className="btn-ghost h-8" disabled={busy} onClick={() => onStatus(t, 'cancelada')} aria-label={`Cancelar ${t.title}`}><X className="h-4 w-4" /> Cancelar</button>
          </>
        ) : (
          <button className="btn-ghost h-8" disabled={busy} onClick={() => onStatus(t, 'aberta')}><RotateCcw className="h-4 w-4" /> Reabrir</button>
        )}
      </div>
    </li>
  );
}

const GROUPS = [
  { key: 'atrasada', title: 'Atrasadas', subtitle: 'Prazo já passou' },
  { key: 'hoje', title: 'Hoje', subtitle: null },
  { key: 'proxima', title: 'Próximas', subtitle: null },
  { key: 'sem_data', title: 'Sem prazo', subtitle: 'Defina uma data para não esquecer' },
];

export default function Agenda() {
  const { can, user } = useAuth();
  const { confirm } = useUI();
  const canAll = can('tasks');
  const [status, setStatus] = useState('aberta');
  const [who, setWho] = useState('mine');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const mine = !canAll || who === 'mine';
  const { data, loading, reload } = useFetch(() => api.get(`/v1/tasks${qs({ status, mine: mine ? '1' : '', from, to })}`), [status, mine, from, to]);
  const [run, busy] = useAction();
  useEffect(() => { api.get('/v1/company/users').then((r) => setUsers((r || []).filter((u) => u.active !== false))).catch(() => setUsers([])); }, []);

  const groups = useMemo(() => {
    const now = new Date();
    const g = { atrasada: [], hoje: [], proxima: [], sem_data: [] };
    (data || []).forEach((t) => g[taskBucket(t, now)].push(t));
    return g;
  }, [data]);

  const onStatus = async (t, s) => {
    if (s === 'cancelada' && !(await confirm({ title: 'Cancelar tarefa?', message: `“${t.title}” sairá da lista de pendentes.`, confirmText: 'Cancelar tarefa' }))) return;
    const msg = { concluida: 'Tarefa concluída.', cancelada: 'Tarefa cancelada.', aberta: 'Tarefa reaberta.' }[s];
    if ((await run(() => api.put(`/v1/tasks/${t.id}`, { status: s }), msg)) !== FAIL) reload();
  };

  const counts = status === 'aberta' ? `${groups.atrasada.length} atrasada(s) · ${groups.hoje.length} para hoje` : null;

  return (
    <>
      <PageHeader title="Agenda" subtitle={counts || 'Tarefas, retornos e compromissos.'}
        actions={<button className="btn-primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Nova tarefa</button>} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs tabs={[{ value: 'aberta', label: 'Abertas' }, { value: 'concluida', label: 'Concluídas' }, { value: 'cancelada', label: 'Canceladas' }]} value={status} onChange={setStatus} />
        {canAll && (
          <Tabs tabs={[{ value: 'mine', label: 'Minhas' }, { value: 'all', label: 'Todas da equipe' }]} value={who} onChange={setWho} />
        )}
        <div className="mb-5 flex flex-wrap items-end gap-2">
          <Input label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && <button className="btn-ghost" onClick={() => { setFrom(''); setTo(''); }}>Limpar datas</button>}
        </div>
      </div>
      {(from || to) && <p className="-mt-3 mb-4 text-xs text-ink-faint">Com filtro de datas, tarefas sem prazo não aparecem. Período: {from ? fmt(from) : 'início'} a {to ? fmt(to) : 'sem fim'}.</p>}

      {loading && !data ? <Loading /> : !data ? (
        <Section><Empty icon={AlertTriangle} title="Não foi possível carregar a agenda" action={<button className="btn-outline" onClick={reload}>Tentar de novo</button>} /></Section>
      ) : !data.length ? (
        <Section><Empty icon={CalendarDays} title={status === 'aberta' ? 'Nenhuma tarefa pendente' : 'Nenhuma tarefa neste filtro'}
          text={status === 'aberta' ? 'Tudo em dia. Crie tarefas para retornos e compromissos.' : undefined}
          action={status === 'aberta' && <button className="btn-primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Nova tarefa</button>} /></Section>
      ) : status === 'aberta' ? (
        <div className={cx('space-y-4', loading && 'opacity-60')}>
          {GROUPS.filter((g) => groups[g.key].length).map((g) => (
            <Section key={g.key} title={`${g.title} (${groups[g.key].length})`} subtitle={g.subtitle}
              className={g.key === 'atrasada' ? 'border-red-500/40' : undefined}>
              <ul className="divide-y divide-line">
                {groups[g.key].map((t) => <TaskRow key={t.id} t={t} bucket={g.key} onStatus={onStatus} busy={busy} showAssignee={!mine || t.assignee_user_id !== user?.id} />)}
              </ul>
            </Section>
          ))}
        </div>
      ) : (
        <Section title={status === 'concluida' ? 'Concluídas' : 'Canceladas'} className={loading ? 'opacity-60' : undefined}>
          <ul className="divide-y divide-line">
            {data.map((t) => <TaskRow key={t.id} t={t} bucket={taskBucket(t)} onStatus={onStatus} busy={busy} showAssignee={!mine} />)}
          </ul>
        </Section>
      )}

      <NewTaskModal open={newOpen} users={users} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); reload(); }} />
    </>
  );
}
