// Sinistros (18.1/18.2) e solicitações de pós-venda (18.3). O sistema organiza e acompanha:
// não decide cobertura nem indenização. Estado informado pela seguradora ≠ estado de trabalho da corretora.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ShieldAlert, Phone, AlertTriangle, Upload, Download, Pencil, MessageSquarePlus, ArrowLeft, Clock, LifeBuoy, Search } from 'lucide-react';
import { api, qs, download, fileToPayload } from '../lib/api';
import { moneyOrNA, fmt, fmtDateTime, docNumber, CLAIM_STATUS, REQUEST_STATUS, PRIORITY } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { SubmitButton,
  PageHeader, Section, KV, Tabs, Modal, Input, Textarea, Select, Field, Toggle, CentsInput, FileButton, StatusChip, Notice, Empty, Loading, Spinner, cx, useFetch, useAction, FAIL,
} from '../components/ui';
import { ClientPicker } from './Policies';

const BANNER = 'O APOLVEN organiza e acompanha o atendimento: não decide cobertura nem indenização e não substitui a regulação da seguradora.';
const EVENT_KINDS = { nota: 'Nota', documento_solicitado: 'Documento solicitado', documento_entregue: 'Documento entregue', contato: 'Contato', recurso: 'Recurso / reconsideração', status: 'Atualização' };
const REQUEST_KINDS = {
  segunda_via: '2ª via (boleto/documento)', assistencia: 'Assistência (guincho, residencial…)', atualizacao_cadastral: 'Atualização cadastral', declaracao: 'Declaração / comprovante',
  duvida: 'Dúvida', reclamacao: 'Reclamação', endosso: 'Pedido de endosso', outro: 'Outro',
};
const CHANNELS = { whatsapp: 'WhatsApp', telefone: 'Telefone', email: 'E-mail', presencial: 'Presencial', portal: 'Portal', outro: 'Outro' };

const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

function useUsers() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get('/v1/company/users').then((r) => setList((r || []).filter((u) => u.active !== false))).catch(() => setList([])); }, []);
  return list;
}
function UserSelect({ label = 'Responsável', value, onChange, users, emptyLabel = 'Eu (padrão)' }) {
  return (
    <Select label={label} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </Select>
  );
}

/** Busca de apólice (nº, placa/identificador ou cliente) e carrega o detalhe (itens, assistência). */
function PolicyPicker({ value, onChange, clientId, label = 'Apólice *', optional }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (clientId) { api.get(`/v1/policies${qs({ client_id: clientId })}`).then(setList).catch(() => setList([])); return undefined; }
    if (q.trim().length < 2) { setList([]); return undefined; }
    const t = setTimeout(() => api.get(`/v1/policies${qs({ q: q.trim() })}`).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q, clientId]);
  const pick = async (id) => {
    if (!id) { onChange(null); return; }
    try { onChange(await api.get(`/v1/policies/${id}`)); } catch { onChange(null); }
  };
  if (clientId) {
    return (
      <Select label={label} value={value?.id || ''} onChange={(e) => pick(e.target.value)}>
        <option value="">{optional ? 'Nenhuma' : 'Selecione…'}</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.policy_number || '(sem número)'} · {p.institution_name} · até {fmt(p.end_date)}</option>)}
      </Select>
    );
  }
  if (value) {
    return (
      <Field label={label}>
        <div className="input flex items-center justify-between gap-2">
          <span className="truncate">{value.policy_number || '(sem número)'} — {value.client_name}</span>
          <button type="button" className="text-xs font-medium text-primary" onClick={() => onChange(null)}>Trocar</button>
        </div>
      </Field>
    );
  }
  return (
    <div className="relative">
      <Input label={label} value={q} placeholder="Nº da apólice, placa ou nome do cliente" autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      <Search className="pointer-events-none absolute right-3 top-[2.1rem] h-4 w-4 text-ink-faint" />
      {open && list.length > 0 && (
        <ul className="card absolute left-0 right-0 top-[4.1rem] z-30 max-h-64 overflow-auto py-1" role="listbox">
          {list.slice(0, 12).map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); setQ(''); pick(p.id); }}>
                <span className="font-medium">{p.policy_number || '(sem número)'}</span> · {p.client_name}
                <span className="block text-xs text-ink-faint">{p.institution_name} · vigência até {fmt(p.end_date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistancePhone({ policy }) {
  if (!policy) return null;
  return (
    <Notice tone={policy.assistance_phone ? 'info' : 'warn'}>
      <Phone className="mr-1 inline h-4 w-4" />
      {policy.assistance_phone
        ? <>Assistência {policy.institution_name}: <a href={`tel:${policy.assistance_phone.replace(/[^\d+]/g, '')}`} className="font-semibold underline">{policy.assistance_phone}</a> (contato oficial cadastrado).</>
        : <>Telefone de assistência da {policy.institution_name} não cadastrado — consulte o documento da apólice ou o site oficial.</>}
      {' '}O APOLVEN não aciona a assistência: o pedido é feito pelo canal oficial da seguradora.
    </Notice>
  );
}

// =====================================================================================
// Lista (abas Sinistros / Solicitações)
// =====================================================================================
export default function Claims() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const canClaims = can('claims');
  const canReq = can('service_requests');
  const tab = params.get('tab') === 'solicitacoes' || !canClaims ? 'solicitacoes' : 'sinistros';
  const setTab = (v) => setParams(v === 'solicitacoes' ? { tab: v } : {}, { replace: true });
  const tabs = [canClaims && { value: 'sinistros', label: 'Sinistros' }, canReq && { value: 'solicitacoes', label: 'Solicitações' }].filter(Boolean);
  return (
    <div>
      <PageHeader title="Sinistros e solicitações" subtitle="Acompanhamento de sinistros, assistências e pedidos de pós-venda" />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'sinistros' && canClaims && <ClaimsList params={params} setParams={setParams} />}
      {tab === 'solicitacoes' && canReq && <RequestsList params={params} setParams={setParams} />}
    </div>
  );
}

function ClaimsList({ params, setParams }) {
  const settings = useSettings();
  const [all, setAll] = useState(false);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/claims${all ? '' : '?open=1'}`), [all]);
  const creating = params.get('nova') === '1';
  const closeCreate = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('nova'); n.delete('policy'); return n; }, { replace: true });
  const near = (data || []).filter((c) => c.deadline_near).length;
  return (
    <div className="space-y-4">
      <Notice tone="info"><ShieldAlert className="mr-1 inline h-4 w-4" />{BANNER}</Notice>
      {near > 0 && <Notice tone="warn"><AlertTriangle className="mr-1 inline h-4 w-4" />{near} sinistro(s) com prazo vencendo em até 3 dias.</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={all} onChange={setAll} label="Incluir encerrados" />
        <button className="btn-primary" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('nova', '1'); return n; }, { replace: true })}><Plus className="h-4 w-4" /> Novo sinistro</button>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? (
        <div className="card"><Empty icon={ShieldAlert} title="Nenhum sinistro em acompanhamento" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Número</th><th>Cliente / apólice</th><th>Ocorrência</th><th>Situação (corretora)</th><th>Informado pela seguradora</th><th>Prazo</th><th>Responsável</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/sinistros/${c.id}`} className="font-medium text-primary hover:underline">{docNumber(settings, 'claim', c.number)}</Link></td>
                <td>{c.client_name}<div className="text-xs text-ink-faint">{c.policy_number || '(sem número)'} · {c.institution_name}</div></td>
                <td className="whitespace-nowrap">{fmtDateTime(c.occurred_at)}<div className="max-w-[16rem] truncate text-xs text-ink-faint">{c.description}</div></td>
                <td><StatusChip map={CLAIM_STATUS} value={c.work_status} /></td>
                <td className="text-sm">{c.insurer_status || <span className="text-ink-faint">não informado</span>}{c.insurer_protocol && <div className="text-xs text-ink-faint">Prot. {c.insurer_protocol}</div>}</td>
                <td className="whitespace-nowrap">{c.deadline_at ? <span className={cx(c.deadline_near && 'font-medium text-red-600')}>{c.deadline_near && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{fmtDateTime(c.deadline_at)}</span> : '—'}</td>
                <td>{c.assignee_name || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <ClaimCreateModal policyId={params.get('policy')} onClose={closeCreate} onDone={() => { closeCreate(); reload(); }} />}
    </div>
  );
}

function ClaimCreateModal({ policyId, onClose, onDone }) {
  const nav = useNavigate();
  const users = useUsers();
  const [run, busy] = useAction();
  const [policy, setPolicy] = useState(null);
  const [f, setF] = useState({ item_id: '', occurred_at: toLocal(new Date().toISOString()), location: '', description: '', contact_name: '', contact_phone: '', insurer_protocol: '', deadline_at: '', deadline_rule: '', assignee_user_id: null });
  useEffect(() => { if (policyId) api.get(`/v1/policies/${policyId}`).then(setPolicy).catch(() => {}); }, [policyId]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const ok = policy && f.occurred_at && f.description.trim().length >= 5 && (!f.deadline_at || f.deadline_rule.trim().length >= 3);
  const save = async () => {
    const body = { policy_id: policy.id, item_id: f.item_id || null, occurred_at: fromLocal(f.occurred_at), location: f.location.trim() || null, description: f.description.trim(),
      contact_name: f.contact_name.trim() || null, contact_phone: f.contact_phone.trim() || null, insurer_protocol: f.insurer_protocol.trim() || null,
      deadline_at: fromLocal(f.deadline_at), deadline_rule: f.deadline_rule.trim() || null, assignee_user_id: f.assignee_user_id || null };
    const r = await run(() => api.post('/v1/claims', body), 'Sinistro registrado.');
    if (r !== FAIL) { onDone(); nav(`/sinistros/${r.id}`); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Novo sinistro" subtitle={BANNER}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[!policy && { text: 'Escolha a apólice do sinistro.', field: 'Apólice' }, !f.occurred_at && { text: 'Informe data e hora da ocorrência.', field: 'Data e hora da ocorrência' }, f.description.trim().length < 5 && { text: 'Descreva o ocorrido (mín. 5 caracteres).', field: 'Descrição do ocorrido' }, f.deadline_at && f.deadline_rule.trim().length < 3 && { text: 'Informe o fundamento do prazo.', field: 'Fundamento do prazo' }]}>Registrar sinistro</SubmitButton></>}>
      <div className="space-y-4">
        <PolicyPicker value={policy} onChange={(p) => { setPolicy(p); set('item_id', ''); }} />
        {policy && (
          <>
            <div className="text-xs text-ink-faint">Cliente: {policy.client_name} · {policy.institution_name} · vigência {fmt(policy.start_date)} – {fmt(policy.end_date)}</div>
            <AssistancePhone policy={policy} />
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {policy?.items?.length > 0 && (
            <Select label="Item / segurado envolvido" value={f.item_id} onChange={(e) => set('item_id', e.target.value)}>
              <option value="">Não especificado</option>{policy.items.map((i) => <option key={i.id} value={i.id}>{i.description}{i.identifier ? ` (${i.identifier})` : ''}</option>)}
            </Select>
          )}
          <Input label="Data e hora da ocorrência *" type="datetime-local" value={f.occurred_at} onChange={(e) => set('occurred_at', e.target.value)} />
          <Input label="Local" value={f.location} onChange={(e) => set('location', e.target.value)} />
          <Input label="Protocolo da seguradora" value={f.insurer_protocol} onChange={(e) => set('insurer_protocol', e.target.value)} />
          <Textarea className="sm:col-span-2" label="Descrição do ocorrido *" value={f.description} onChange={(e) => set('description', e.target.value)} />
          <Input label="Contato (nome)" value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
          <Input label="Contato (telefone)" value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} />
          <Input label="Prazo" type="datetime-local" value={f.deadline_at} onChange={(e) => set('deadline_at', e.target.value)} />
          <Input label={`Fundamento do prazo${f.deadline_at ? ' *' : ''}`} value={f.deadline_rule} onChange={(e) => set('deadline_rule', e.target.value)}
            hint="Regra aplicada: produto/condições gerais, norma, fato gerador ou prazo interno." />
          <UserSelect value={f.assignee_user_id} onChange={(v) => set('assignee_user_id', v)} users={users} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Solicitações ----------------
function RequestsList({ params, setParams }) {
  const settings = useSettings();
  const users = useUsers();
  const [all, setAll] = useState(false);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/service-requests${all ? '' : '?open=1'}`), [all]);
  const creating = params.get('nova') === '1';
  const setCreating = (v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set('nova', '1'); else n.delete('nova'); return n; }, { replace: true });
  const [edit, setEdit] = useState(null);
  const late = (r) => r.due_at && new Date(r.due_at) < new Date() && !['concluida', 'cancelada'].includes(r.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={all} onChange={setAll} label="Incluir concluídas e canceladas" />
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova solicitação</button>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? (
        <div className="card"><Empty icon={LifeBuoy} title="Nenhuma solicitação em aberto" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Número</th><th>Cliente</th><th>Tipo</th><th>Prioridade</th><th>Situação</th><th>Responsável</th><th>Prazo</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-medium">{docNumber(settings, 'request', r.number)}</td>
                <td>{r.client_name}{r.policy_number && <div className="text-xs text-ink-faint">Apólice {r.policy_number}</div>}</td>
                <td>{REQUEST_KINDS[r.kind] || r.kind}<div className="max-w-[18rem] truncate text-xs text-ink-faint">{r.description}</div></td>
                <td><span className={PRIORITY[r.priority]?.cls}>{PRIORITY[r.priority]?.label || r.priority}</span></td>
                <td><StatusChip map={REQUEST_STATUS} value={r.status} />{r.resolution && <div className="max-w-[14rem] truncate text-xs text-ink-faint">{r.resolution}</div>}</td>
                <td>{r.assignee_name || '—'}</td>
                <td className={cx('whitespace-nowrap', late(r) && 'font-medium text-red-600')}>{r.due_at ? fmtDateTime(r.due_at) : '—'}{late(r) && <div className="text-xs">atrasada</div>}</td>
                <td><button className="btn-outline" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /> Atualizar</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <RequestCreateModal users={users} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {edit && <RequestUpdateModal r={edit} users={users} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function RequestCreateModal({ users, onClose, onDone }) {
  const [run, busy] = useAction();
  const [client, setClient] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [f, setF] = useState({ kind: 'segunda_via', description: '', priority: 'normal', channel: 'whatsapp', assignee_user_id: null, due_at: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { setPolicy(null); }, [client?.id]);
  const ok = client && f.description.trim().length >= 3;
  const save = async () => {
    const r = await run(() => api.post('/v1/service-requests', { client_id: client.id, policy_id: policy?.id || null, kind: f.kind, description: f.description.trim(), priority: f.priority,
      channel: f.channel || null, assignee_user_id: f.assignee_user_id || null, due_at: fromLocal(f.due_at) }), 'Solicitação registrada.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Nova solicitação"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[!client && { text: 'Escolha o cliente.', field: 'Cliente' }, f.description.trim().length < 3 && { text: 'Descreva a solicitação.', field: 'Descrição' }]}>Registrar</SubmitButton></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ClientPicker label="Cliente *" value={client} onChange={setClient} />
        {client ? <PolicyPicker label="Apólice relacionada" optional clientId={client.id} value={policy} onChange={setPolicy} /> : <div />}
        <Select label="Tipo" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(REQUEST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select label="Prioridade" value={f.priority} onChange={(e) => set('priority', e.target.value)}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        {f.kind === 'assistencia' && (
          <div className="sm:col-span-2">{policy ? <AssistancePhone policy={policy} /> : <Notice tone="info">Escolha a apólice para ver o telefone oficial de assistência da seguradora. O APOLVEN não aciona a assistência.</Notice>}</div>
        )}
        <Textarea className="sm:col-span-2" label="Descrição *" value={f.description} onChange={(e) => set('description', e.target.value)} />
        <Select label="Canal de entrada" value={f.channel} onChange={(e) => set('channel', e.target.value)}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input label="Prazo" type="datetime-local" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} />
        <UserSelect value={f.assignee_user_id} onChange={(v) => set('assignee_user_id', v)} users={users} />
      </div>
    </Modal>
  );
}

function RequestUpdateModal({ r, users, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ status: r.status, priority: r.priority, assignee_user_id: r.assignee_user_id || null, resolution: r.resolution || '' });
  const concluding = f.status === 'concluida';
  const ok = !concluding || f.resolution.trim().length >= 3;
  const save = async () => {
    const body = {};
    if (f.status !== r.status) body.status = f.status;
    if (f.priority !== r.priority) body.priority = f.priority;
    if ((f.assignee_user_id || null) !== (r.assignee_user_id || null) && f.assignee_user_id) body.assignee_user_id = f.assignee_user_id;
    if (f.resolution.trim() && f.resolution.trim() !== (r.resolution || '')) body.resolution = f.resolution.trim();
    const x = await run(() => api.put(`/v1/service-requests/${r.id}`, body), 'Solicitação atualizada.');
    if (x !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Atualizar solicitação" subtitle={`${REQUEST_KINDS[r.kind] || r.kind} — ${r.client_name}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={!ok ? [{ text: 'Para concluir, descreva a resolução.', field: 'Resolução' }] : []}>Salvar</SubmitButton></>}>
      <div className="space-y-3">
        <p className="whitespace-pre-line rounded-app-sm bg-muted p-3 text-sm">{r.description}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Situação" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <Select label="Prioridade" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <UserSelect value={f.assignee_user_id} onChange={(v) => setF({ ...f, assignee_user_id: v })} users={users} emptyLabel="Manter" />
        </div>
        <Textarea label={`Resolução${concluding ? ' *' : ''}`} value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} hint="Obrigatória para concluir." />
      </div>
    </Modal>
  );
}

// =====================================================================================
// Detalhe do sinistro
// =====================================================================================
export function ClaimDetail() {
  const { id } = useParams();
  const settings = useSettings();
  const { toast } = useUI();
  const users = useUsers();
  const { data: s, loading, reload } = useFetch(() => api.get(`/v1/claims/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  if (loading && !s) return <Loading />;
  if (!s) return <Empty title="Sinistro não encontrado" action={<Link to="/sinistros" className="btn-outline">Voltar</Link>} />;
  const statuses = s.statuses ? Object.fromEntries(Object.keys(s.statuses).map((k) => [k, CLAIM_STATUS[k] || { label: s.statuses[k] }])) : CLAIM_STATUS;
  const deadlineNear = s.deadline_at && new Date(s.deadline_at) < new Date(Date.now() + 3 * 86400000) && !['encerrado', 'indenizado', 'negado'].includes(s.work_status);
  const dl = async (e) => { try { await download(`/v1/documents/${e.document_id}/download`, e.filename); } catch (er) { toast(er.message, 'error'); } };
  const assignee = users.find((u) => u.id === s.assignee_user_id)?.name;
  return (
    <div>
      <Link to="/sinistros" className="btn-ghost mb-2 -ml-2"><ArrowLeft className="h-4 w-4" /> Sinistros</Link>
      <PageHeader title={`Sinistro ${docNumber(settings, 'claim', s.number)}`}
        subtitle={<>{s.client_name} · <Link to={`/apolices/${s.policy_id}`} className="hover:underline">Apólice {s.policy_number || '(sem número)'}</Link> · {s.institution_name}</>}
        actions={<button className="btn-primary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Atualizar andamento</button>} />
      <Notice tone="info" className="mb-4"><ShieldAlert className="mr-1 inline h-4 w-4" />{BANNER}</Notice>
      {deadlineNear && <Notice tone="warn" className="mb-4"><AlertTriangle className="mr-1 inline h-4 w-4" />Prazo em {fmtDateTime(s.deadline_at)} ({s.deadline_rule}).</Notice>}

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Situação do trabalho da corretora</div>
          <div className="mt-2"><StatusChip map={statuses} value={s.work_status} /></div>
          <div className="mt-1.5 text-xs text-ink-faint">Responsável: {assignee || '—'}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-ink-faint">Situação informada pela seguradora</div>
          <div className="mt-2 text-sm font-medium">{s.insurer_status || 'Não informada'}</div>
          <div className="mt-1.5 text-xs text-ink-faint">{s.insurer_status_at ? `Atualizada em ${fmtDateTime(s.insurer_status_at)}` : 'Sem data de atualização'}{s.insurer_protocol ? ` · Protocolo ${s.insurer_protocol}` : ''}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Ocorrência">
            <KV items={[
              ['Data e hora', fmtDateTime(s.occurred_at)], ['Local', s.location || '—'], ['Item / segurado', s.item_description || 'Não especificado'],
              ['Contato', [s.contact_name, s.contact_phone].filter(Boolean).join(' · ') || '—'], ['Telefone do cliente', s.client_phone || '—'],
              ['Prazo', s.deadline_at ? `${fmtDateTime(s.deadline_at)} — ${s.deadline_rule || 'sem fundamento'}` : '—'],
            ]} />
            <p className="mt-4 whitespace-pre-line rounded-app-sm bg-muted p-3 text-sm">{s.description}</p>
          </Section>
          <Section title="Decisão informada pela seguradora" subtitle="Registro da decisão e da evidência — o sistema não decide cobertura">
            <KV items={[
              ['Decisão sobre cobertura', s.coverage_decision || 'Não informada'], ['Evidência', s.decision_evidence || '—'],
              ['Valor pago (informado)', moneyOrNA(s.amount_paid_cents)],
            ]} />
          </Section>
          <Timeline s={s} reload={reload} onDownload={dl} />
        </div>
        <div className="space-y-4">
          <Section title="Assistência"><AssistancePhone policy={{ assistance_phone: s.assistance_phone, institution_name: s.institution_name }} /></Section>
          <Section title="Atalhos">
            <div className="flex flex-col gap-2">
              <Link to={`/apolices/${s.policy_id}`} className="btn-outline justify-start">Abrir apólice</Link>
              <Link to={`/clientes/${s.client_id}`} className="btn-outline justify-start">Abrir cliente</Link>
            </div>
          </Section>
        </div>
      </div>
      {editing && <ClaimUpdateModal s={s} users={users} statuses={statuses} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

function Timeline({ s, reload, onDownload }) {
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState({ kind: 'nota', summary: '', occurred_at: '' });
  const [doc, setDoc] = useState(null);
  const [up, setUp] = useState(false);
  const upload = async (file) => {
    setUp(true);
    try {
      const payload = await fileToPayload(file);
      const r = await run(() => api.post('/v1/documents', { entity: 'claim', entity_id: s.id, client_id: s.client_id, kind: 'sinistro', ...payload }), 'Documento anexado.');
      if (r !== FAIL) setDoc(r);
    } catch (e) { toast(e.message, 'error'); } finally { setUp(false); }
  };
  const add = async () => {
    const r = await run(() => api.post(`/v1/claims/${s.id}/events`, { kind: f.kind, summary: f.summary.trim(), occurred_at: fromLocal(f.occurred_at), document_id: doc?.id || null }), 'Registro incluído.');
    if (r !== FAIL) { setF({ kind: f.kind, summary: '', occurred_at: '' }); setDoc(null); reload(); }
  };
  const events = [...(s.events || [])].reverse();
  return (
    <Section title="Histórico" subtitle="Comunicações, documentos solicitados e entregues, recursos">
      <div className="mb-5 grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-3">
        <Select label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(EVENT_KINDS).filter(([k]) => k !== 'status').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input label="Quando (opcional)" type="datetime-local" value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
        <div className="flex items-end">
          <FileButton accept="application/pdf,image/*" onFile={upload} disabled={up}>{up ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {doc ? 'Trocar arquivo' : 'Anexar'}</FileButton>
        </div>
        <Textarea className="sm:col-span-3" label="Resumo *" rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        <div className="flex items-center justify-between gap-2 sm:col-span-3">
          <span className="text-xs text-ink-faint">{doc ? `Anexo: ${doc.filename}` : ''}</span>
          <button className="btn-primary" disabled={busy || f.summary.trim().length < 2} onClick={add}><MessageSquarePlus className="h-4 w-4" /> Registrar</button>
        </div>
      </div>
      {!events.length ? <p className="text-sm text-ink-faint">Sem registros.</p> : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className={cx('absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-surface', e.kind === 'status' ? 'bg-indigo-500' : e.kind === 'recurso' ? 'bg-orange-500' : e.kind.startsWith('documento') ? 'bg-amber-500' : 'bg-primary')} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <span className="chip bg-muted text-ink-soft">{EVENT_KINDS[e.kind] || e.kind}</span>
                <span><Clock className="mr-0.5 inline h-3 w-3" />{fmtDateTime(e.occurred_at)}</span>
                {e.user_name && <span>· {e.user_name}</span>}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{e.summary}</p>
              {e.document_id && <button className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => onDownload(e)}><Download className="h-3 w-3" /> {e.filename || 'documento'}</button>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function ClaimUpdateModal({ s, users, statuses, onClose, onDone }) {
  const [run, busy] = useAction();
  const init = {
    work_status: s.work_status, insurer_protocol: s.insurer_protocol || '', insurer_status: s.insurer_status || '', coverage_decision: s.coverage_decision || '',
    decision_evidence: s.decision_evidence || '', amount_paid_cents: s.amount_paid_cents ?? null, deadline_at: toLocal(s.deadline_at), deadline_rule: s.deadline_rule || '',
    assignee_user_id: s.assignee_user_id || null,
  };
  const [f, setF] = useState(init);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const decisionNeeded = ['indenizado', 'negado'].includes(f.work_status) || (f.coverage_decision.trim() && f.coverage_decision !== init.coverage_decision);
  const problems = [];
  if (decisionNeeded && f.decision_evidence.trim().length < 3) problems.push('evidência da decisão da seguradora');
  if (f.deadline_at && f.deadline_rule.trim().length < 3) problems.push('fundamento do prazo');
  const body = {};
  const txt = (k) => { const v = f[k].trim(); if (v !== (init[k] || '')) body[k] = v || null; };
  if (f.work_status !== init.work_status) body.work_status = f.work_status;
  ['insurer_protocol', 'insurer_status', 'coverage_decision', 'decision_evidence', 'deadline_rule'].forEach(txt);
  if (f.amount_paid_cents !== init.amount_paid_cents) body.amount_paid_cents = f.amount_paid_cents;
  if (f.deadline_at !== init.deadline_at) body.deadline_at = fromLocal(f.deadline_at);
  if ((f.assignee_user_id || null) !== (init.assignee_user_id || null) && f.assignee_user_id) body.assignee_user_id = f.assignee_user_id;
  // a API exige a evidência junto da decisão e o fundamento junto do prazo
  if (body.coverage_decision && !body.decision_evidence) body.decision_evidence = f.decision_evidence.trim() || null;
  if (body.deadline_at && !('deadline_rule' in body)) body.deadline_rule = f.deadline_rule.trim() || null;
  const n = Object.keys(body).length;
  const save = async () => { const r = await run(() => api.put(`/v1/claims/${s.id}`, body), 'Sinistro atualizado.'); if (r !== FAIL) onDone(); };
  return (
    <Modal open onClose={onClose} size="lg" title="Atualizar andamento do sinistro" subtitle="Cada alteração fica registrada no histórico"
      footer={<><span className="mr-auto text-xs text-ink-faint">{problems.length ? `Falta: ${problems.join(', ')}.` : `${n} alteração(ões)`}</span>
        <button className="btn-ghost" onClick={onClose}>Voltar</button><SubmitButton busy={busy} onClick={save} problems={[...problems.map((x) => `Falta: ${x}.`), !n && 'Nenhuma alteração para salvar.']}>Salvar</SubmitButton></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Situação do trabalho da corretora" value={f.work_status} onChange={(e) => set('work_status', e.target.value)}>
            {Object.entries(statuses).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <UserSelect value={f.assignee_user_id} onChange={(v) => set('assignee_user_id', v)} users={users} emptyLabel="Manter" />
          <Input label="Protocolo da seguradora" value={f.insurer_protocol} onChange={(e) => set('insurer_protocol', e.target.value)} />
          <Input label="Situação informada pela seguradora" value={f.insurer_status} onChange={(e) => set('insurer_status', e.target.value)} placeholder="Como a seguradora informou (texto)" />
        </div>
        <div className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-2">
          <p className="text-xs text-ink-faint sm:col-span-2">Indenizado/negado e decisão sobre cobertura exigem a evidência da seguradora (carta, e-mail, portal). O sistema apenas registra.</p>
          <Textarea className="sm:col-span-2" label="Decisão sobre cobertura (informada)" rows={2} value={f.coverage_decision} onChange={(e) => set('coverage_decision', e.target.value)} />
          <Textarea className="sm:col-span-2" label={`Evidência da decisão${decisionNeeded ? ' *' : ''}`} rows={2} value={f.decision_evidence} onChange={(e) => set('decision_evidence', e.target.value)} />
          <CentsInput label="Valor pago (informado)" value={f.amount_paid_cents} onChange={(v) => set('amount_paid_cents', v)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Prazo" type="datetime-local" value={f.deadline_at} onChange={(e) => set('deadline_at', e.target.value)} />
          <Input label={`Fundamento do prazo${f.deadline_at ? ' *' : ''}`} value={f.deadline_rule} onChange={(e) => set('deadline_rule', e.target.value)}
            hint="Produto/condições gerais, norma, fato gerador ou prazo interno. Reconhecimento de cobertura ≠ liquidação." />
        </div>
      </div>
    </Modal>
  );
}
