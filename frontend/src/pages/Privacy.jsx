// Solicitações de titulares (LGPD, art. 18): registro, prazo, andamento e resposta.
import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Plus, AlertTriangle, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { fmt, fmtDateTime, addDaysYmd, ymd } from '../lib/format';
import { PageHeader, Section, Tabs, Modal, Textarea, Select, Input, StatusChip, Notice, Empty, Loading, KV, useFetch, useAction, FAIL, cx } from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import { ClientPicker } from './Clients';

const KIND = {
  acesso: 'Acesso aos dados', correcao: 'Correção de dados', exportacao: 'Portabilidade / exportação', eliminacao: 'Eliminação de dados',
  revogacao: 'Revogação de consentimento', informacao: 'Informação sobre compartilhamento',
};
const STATUS = {
  aberta: { label: 'Aberta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  em_andamento: { label: 'Em andamento', cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
  respondida: { label: 'Respondida', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  encerrada: { label: 'Encerrada', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
};
const isOpen = (r) => ['aberta', 'em_andamento'].includes(r.status);
const isLate = (r) => isOpen(r) && r.due_at && String(r.due_at).slice(0, 10) < ymd();

function NewModal({ open, onClose, onCreated }) {
  const [v, setV] = useState({ client: null, kind: 'acesso', description: '', due_at: addDaysYmd(15) });
  const [run, busy] = useAction();
  useEffect(() => { if (open) setV({ client: null, kind: 'acesso', description: '', due_at: addDaysYmd(15) }); }, [open]);
  const save = async () => {
    const r = await run(() => api.post('/v1/privacy-requests', { client_id: v.client?.id || null, kind: v.kind, description: v.description.trim() || undefined, due_at: v.due_at || undefined }), 'Solicitação registrada.');
    if (r !== FAIL) onCreated(r);
  };
  return (
    <Modal open={open} onClose={onClose} title="Nova solicitação de titular" subtitle="Registre pedidos recebidos por qualquer canal (e-mail, telefone, presencial)."
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Registrar'}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><ClientPicker label="Titular (cliente)" value={v.client} onChange={(x) => setV({ ...v, client: x })}
          hint="Opcional: deixe em branco se o titular não for cliente cadastrado e identifique-o na descrição." /></div>
        <Select label="Tipo de pedido" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Input label="Prazo de resposta" type="date" value={v.due_at} onChange={(e) => setV({ ...v, due_at: e.target.value })} hint="Sugestão: 15 dias para resposta completa." />
        <Textarea label="Descrição do pedido" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className="sm:col-span-2"
          placeholder="Como o pedido chegou, o que foi solicitado e como a identidade do titular foi confirmada." />
      </div>
    </Modal>
  );
}

function UpdateModal({ req, onClose, onSaved }) {
  const [status, setStatus] = useState('em_andamento');
  const [response, setResponse] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (req) { setStatus(req.status === 'aberta' ? 'em_andamento' : req.status); setResponse(req.response || ''); } }, [req]);
  const closing = ['respondida', 'encerrada'].includes(status);
  const save = async () => {
    const r = await run(() => api.put(`/v1/privacy-requests/${req.id}`, { status, response: response.trim() || undefined }), 'Solicitação atualizada.');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open={!!req} onClose={onClose} size="lg" title={req ? KIND[req.kind] || req.kind : ''} subtitle={req ? `Registrada em ${fmtDateTime(req.created_at)}` : ''}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || (status === 'respondida' && response.trim().length < 3)} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button></>}>
      {req && (
        <div className="space-y-4">
          <KV items={[
            ['Titular', req.client_id ? <Link key="c" to={`/clientes/${req.client_id}`} className="text-primary hover:underline">{req.client_name}</Link> : 'Não vinculado a cliente'],
            ['Prazo', req.due_at ? <span key="d" className={cx(isLate(req) && 'font-medium text-red-700 dark:text-red-300')}>{fmt(String(req.due_at).slice(0, 10))}{isLate(req) ? ' — prazo vencido' : ''}</span> : '—'],
            ['Situação atual', <StatusChip key="s" map={STATUS} value={req.status} />],
            ['Encerrada em', req.closed_at ? fmtDateTime(req.closed_at) : '—'],
          ]} />
          {req.description && <div><div className="text-xs text-ink-faint">Pedido</div><p className="mt-0.5 whitespace-pre-wrap text-sm">{req.description}</p></div>}
          <Select label="Nova situação" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
          <Textarea label={status === 'respondida' ? 'Resposta enviada ao titular *' : 'Resposta / andamento'} rows={5} value={response} onChange={(e) => setResponse(e.target.value)}
            placeholder="O que foi feito, o que foi entregue ao titular e por qual canal." />
          {req.kind === 'eliminacao' && <Notice tone="warn">Dados necessários para cumprir obrigação legal ou regulatória (contratos de seguro, registros fiscais e de auditoria) devem ser mantidos. Informe ao titular o que foi eliminado e o que precisa ser conservado e por quê.</Notice>}
          {req.kind === 'revogacao' && <Notice>Para revogar uma autorização específica, use a aba “Autorizações” na ficha do cliente — a revogação fica registrada na auditoria.</Notice>}
          {closing && <p className="text-xs text-ink-faint">Ao marcar como respondida ou encerrada, a data de encerramento é registrada.</p>}
        </div>
      )}
    </Modal>
  );
}

export default function Privacy() {
  const { data, loading, reload } = useFetch(() => api.get('/v1/privacy-requests'), []);
  const [tab, setTab] = useState('abertas');
  const [newOpen, setNewOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const rows = useMemo(() => (data || []).filter((r) => (tab === 'abertas' ? isOpen(r) : tab === 'encerradas' ? !isOpen(r) : true)), [data, tab]);
  const late = (data || []).filter(isLate).length;
  const t = useTable(rows, { sort: 'due_at', get: { client: (r) => r.client_name } });
  return (
    <>
      <PageHeader title="Privacidade (LGPD)" subtitle="Pedidos de titulares de dados: acesso, correção, portabilidade, eliminação, revogação e informação."
        actions={<button className="btn-primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Nova solicitação</button>} />
      {late > 0 && <Notice tone="danger" className="mb-4"><AlertTriangle className="mr-1 inline h-4 w-4" />{late} solicitação(ões) com prazo vencido.</Notice>}
      <Tabs tabs={[{ value: 'abertas', label: 'Em aberto' }, { value: 'encerradas', label: 'Respondidas / encerradas' }, { value: 'todas', label: 'Todas' }]} value={tab} onChange={setTab} />
      {loading && !data ? <Loading /> : !data ? (
        <Section><Empty icon={AlertTriangle} title="Não foi possível carregar" action={<button className="btn-outline" onClick={reload}>Tentar de novo</button>} /></Section>
      ) : !rows.length ? (
        <Section><Empty icon={ShieldCheck} title={tab === 'abertas' ? 'Nenhuma solicitação em aberto' : 'Nenhuma solicitação'} text="Registre aqui cada pedido recebido para controlar prazo e resposta." /></Section>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr>
              <SortTh t={t} k="kind">Pedido</SortTh>
              <SortTh t={t} k="client">Titular</SortTh>
              <SortTh t={t} k="status">Situação</SortTh>
              <SortTh t={t} k="due_at">Prazo</SortTh>
              <SortTh t={t} k="created_at">Registro</SortTh>
              <th />
            </tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="font-medium">{KIND[r.kind] || r.kind}</div>{r.description && <div className="line-clamp-1 max-w-xs text-xs text-ink-faint">{r.description}</div>}</td>
                  <td>{r.client_id ? <Link to={`/clientes/${r.client_id}`} className="hover:text-primary">{r.client_name}</Link> : <span className="text-ink-faint">Não vinculado</span>}</td>
                  <td><StatusChip map={STATUS} value={r.status} /></td>
                  <td className="whitespace-nowrap">{r.due_at ? fmt(String(r.due_at).slice(0, 10)) : '—'}
                    {isLate(r) && <span className="chip ml-2 bg-red-500/10 text-red-700 dark:text-red-300"><Clock className="mr-1 h-3 w-3" />Vencido</span>}</td>
                  <td className="whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="text-right"><button className="btn-outline" onClick={() => setSel(r)}>{isOpen(r) ? 'Atender' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager t={t} />
        </div>
      )}
      <NewModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); reload(); }} />
      <UpdateModal req={sel} onClose={() => setSel(null)} onSaved={() => { setSel(null); reload(); }} />
    </>
  );
}
