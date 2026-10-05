// Auditoria de atos (25.4) e eventos de negócio: quem, quando, o quê, motivo e dados; eventos com data efetiva e de recebimento.
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ShieldCheck, Activity, Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { PageHeader, Tabs, Input, Empty, Loading, useFetch, cx } from '../components/ui';

const TABS = [{ value: 'auditoria', label: 'Auditoria' }, { value: 'eventos', label: 'Eventos de negócio' }];
const ENTITY = {
  client: 'Cliente', policy: 'Apólice', proposal: 'Proposta', commission_receivable: 'Comissão', commission_settlement: 'Liquidação', commission_agreement: 'Acordo de comissão',
  commission_rule: 'Regra de comissão', statement_line: 'Linha de extrato', import_file: 'Importação', partner: 'Parceiro', split_rule: 'Regra de repasse', split_batch: 'Lote de repasse',
  split_accrual: 'Repasse', bank_account: 'Conta bancária', bank_transaction: 'Extrato bancário', cash_entry: 'Lançamento', period: 'Período', export: 'Exportação', dispute: 'Contestação',
  user: 'Usuário', company: 'Corretora', claim: 'Sinistro', quote_request: 'Cotação', comparison: 'Comparativo', document: 'Documento', import: 'Importação',
};

function useDebounced(v, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

const Json = ({ value }) => (
  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-app-sm bg-muted p-3 text-xs leading-5">{JSON.stringify(value, null, 2)}</pre>
);

export default function Audit() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'eventos' ? 'eventos' : 'auditoria';
  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Registro imutável de quem fez o quê, quando, com qual motivo — e dos eventos de negócio recebidos." />
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'auditoria' ? <AuditLog /> : <Events />}
    </div>
  );
}

function AuditLog() {
  const [entity, setEntity] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading } = useFetch(() => api.get(`/v1/reports/audit${qs({ entity, q: dq })}`), [entity, dq]);
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-56">
          <span className="label">Entidade</span>
          <select className="input pr-8" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(ENTITY).sort((a, b) => a[1].localeCompare(b[1])).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <div className="relative w-72">
          <Input label="Buscar" placeholder="Resumo ou nome do usuário" value={q} onChange={(e) => setQ(e.target.value)} />
          <Search className="pointer-events-none absolute right-3 top-[34px] h-4 w-4 text-ink-faint" />
        </div>
        <span className="text-xs text-ink-faint">Últimos 500 registros.</span>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={ShieldCheck} title="Nenhum registro encontrado" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th><span className="sr-only">Expandir</span></th><th>Data</th><th>Usuário</th><th>Entidade</th><th>Ação</th><th>Resumo</th><th>Motivo</th><th>IP</th></tr></thead>
            <tbody>
              {data.map((a) => {
                const isOpen = open === a.id;
                const hasData = a.data && Object.keys(a.data).length > 0;
                return (
                  <Fragment key={a.id}>
                    <tr className={cx(hasData && 'cursor-pointer')} onClick={() => hasData && setOpen(isOpen ? null : a.id)}>
                      <td>{hasData && (
                        <button className="btn-ghost btn-icon h-7 w-7" aria-expanded={isOpen} aria-label={isOpen ? 'Recolher dados' : 'Ver dados'} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : a.id); }}>
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}</td>
                      <td className="whitespace-nowrap tabular-nums text-xs">{fmtDateTime(a.created_at)}</td>
                      <td>{a.user_name || <span className="text-ink-faint">sistema</span>}</td>
                      <td className="text-xs">{ENTITY[a.entity] || a.entity}{a.entity_id && <div className="font-mono text-[10px] text-ink-faint">{String(a.entity_id).slice(0, 8)}</div>}</td>
                      <td className="font-mono text-xs">{a.action}</td>
                      <td className="max-w-md">{a.summary}</td>
                      <td className="max-w-xs text-xs text-ink-soft">{a.reason || '—'}</td>
                      <td className="font-mono text-xs text-ink-faint">{a.ip || '—'}</td>
                    </tr>
                    {isOpen && <tr className="hover:bg-transparent"><td colSpan={8}><Json value={a.data} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Events() {
  const { data, loading } = useFetch(() => api.get('/v1/reports/events'), []);
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">Eventos de negócio emitidos pelo sistema e por integrações, com versão, origem, data efetiva e data de recebimento. Últimos 300.</p>
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={Activity} title="Nenhum evento registrado" /></div> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th><span className="sr-only">Expandir</span></th><th>Tipo</th><th>Entidade</th><th>Versão</th><th>Origem</th><th>Ocorrido em</th><th>Recebido em</th></tr></thead>
            <tbody>
              {data.map((e) => {
                const isOpen = open === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : e.id)}>
                      <td><button className="btn-ghost btn-icon h-7 w-7" aria-expanded={isOpen} aria-label={isOpen ? 'Recolher dados' : 'Ver dados'} onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : e.id); }}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                      <td className="font-mono text-xs font-medium">{e.type}</td>
                      <td className="text-xs">{ENTITY[e.entity] || e.entity}{e.entity_id && <div className="font-mono text-[10px] text-ink-faint">{String(e.entity_id).slice(0, 8)}</div>}</td>
                      <td className="tabular-nums">{e.version ?? '—'}</td>
                      <td className="text-xs">{e.source || '—'}</td>
                      <td className="whitespace-nowrap tabular-nums text-xs">{fmtDateTime(e.occurred_at)}</td>
                      <td className="whitespace-nowrap tabular-nums text-xs">{fmtDateTime(e.received_at)}</td>
                    </tr>
                    {isOpen && <tr className="hover:bg-transparent"><td colSpan={7}><Json value={e.data} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
