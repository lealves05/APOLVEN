// Seguradoras e Integrações (Anexo C): Minhas empresas, Adicionar empresa, Pendências, Histórico
// e o assistente de configuração em 5 etapas. Estados independentes (nunca um único "sinal verde"),
// credenciais nunca reexibidas e nenhuma integração simulada quando não há conector automático.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, PlugZap, PauseCircle, PlayCircle, KeyRound, ListChecks, LifeBuoy, ArrowLeft, ArrowRight, ExternalLink,
  FileText, Copy, ShieldCheck, ShieldAlert, Building2, History, Upload, Ban, Save, CheckCircle2, Circle, AlertTriangle, Info,
} from 'lucide-react';
import { api, fileToPayload, download, qs } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import {
  PageHeader, Section, KV, Tabs, Modal, PromptModal, Input, Textarea, Select, Toggle, StatusChip, Notice, Empty, Loading, Spinner, FileButton,
  useFetch, useAction, FAIL, cx,
} from '../components/ui';
import {
  CAPABILITY_STATE, TECH_STATE, COMMERCIAL_STATE, REQ_STATUS, ENV_LABEL, BRANCHES, fmt, fmtDateTime, ago, maskDoc,
} from '../lib/format';
import QuoteApiConfig from '../components/QuoteApiConfig';
import QuoteApiContract from '../components/QuoteApiContract';

// ---------------- Dicionários locais ----------------
const T = {
  gray: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300', blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  red: 'bg-red-500/10 text-red-700 dark:text-red-300', violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300', orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
};
const S = (label, t) => ({ label, cls: T[t] });

const KIND_LABEL = {
  seguradora: 'Seguradora', operadora: 'Operadora de saúde', administradora: 'Administradora de benefícios',
  previdencia: 'Entidade de previdência', parceiro_tecnologico: 'Parceiro tecnológico',
};
const CONNECTOR_STATUS = {
  disponivel: S('Disponível / configurável', 'green'), condicionado_contrato: S('Condicionado a contrato', 'amber'),
  em_homologacao: S('Em homologação', 'violet'), em_implementacao: S('Em implementação', 'blue'),
  indisponivel: S('Indisponível', 'gray'), operacao_assistida: S('Operação assistida', 'teal'),
};
const REG_STATE = { rascunho: S('Rascunho', 'gray'), completo: S('Completo', 'green'), pendente_evidencia: S('Pendente de evidência', 'amber'), divergente: S('Divergente', 'red') };
const HEALTH_STATE = { operando: S('Operando', 'green'), degradado: S('Degradado', 'amber'), indisponivel: S('Indisponível', 'red'), desconhecido: S('Sem dados', 'gray') };
const ENV_CHIP = { testes: S('Testes (sandbox)', 'violet'), producao: S('Produção', 'blue') };
const ACCREDITATION = { sim: 'Sim, já credenciada', em_analise: 'Em análise', nao: 'Ainda não' };
const PROVIDED_BY = { corretora: 'Corretora', seguradora: 'Seguradora / operadora', parceiro: 'Parceiro', plataforma: 'Equipe da plataforma' };
const RESOLVED_BY = { administrador: 'Administrador da corretora', responsavel_tecnico: 'Responsável técnico', contato_comercial: 'Contato comercial', suporte: 'Suporte da plataforma' };
const OWNER_LABEL = { corretora: 'Corretora', filial: 'Filial / unidade', produtor: 'Produtor', parceiro: 'Parceiro de multicálculo' };
const EVENT_LABEL = {
  criada: 'Cadastro', configuracao: 'Configuração', requisito: 'Requisito', solicitacao: 'Solicitação preparada', avaliacao: 'Avaliação solicitada',
  credencial: 'Credencial', teste: 'Teste de conexão', capacidade: 'Capacidade', ativacao: 'Ativação de funções', pausa: 'Pausa', retomada: 'Retomada', revogacao: 'Revogação',
};
// rótulos das capacidades (C.9) — usados quando o template não traz a lista
const CAP_LABEL = {
  cotacao: 'Incluir no multicálculo automático', proposta_status: 'Consultar situação de propostas', transmissao: 'Transmitir propostas autorizadas',
  documentos: 'Consultar documentos/apólices', parcelas: 'Atualizar parcelas e cobranças oficiais', extratos: 'Importar extratos de comissão',
  endosso_sinistro: 'Operar endossos/sinistros',
};
// resultados do teste (C.8)
const R_CADASTRO = { confirmado: S('Confirmado', 'green'), pendente: S('Pendente', 'amber'), vencido: S('Vencido', 'orange') };
const R_AUTH = { valida: S('Válida', 'green'), invalida: S('Inválida', 'red'), indisponivel: S('Indisponível', 'orange'), nao_verificada: S('Não verificada', 'gray') };
const R_VINCULO = { compativel: S('Compatível', 'green'), divergente: S('Divergente', 'red'), nao_consultavel: S('Não consultável', 'gray') };
const R_CAP = { autorizada: S('Autorizada', 'green'), nao_autorizada: S('Não autorizada', 'red'), nao_verificada: S('Não verificado automaticamente', 'amber'), na: S('Não se aplica a este conector', 'gray') };

/** Caminho com conector AUTOMÁTICO (assistida/arquivo nunca contam como API conectada). */
const isAutomatic = (p) => !!p?.adapter_available && !['assistida', 'arquivo'].includes(p.method);
const capLabel = (code, list = []) => list.find((x) => (x.code || x.capability) === code)?.label || CAP_LABEL[code] || code;
const branchList = (arr) => (arr?.length ? arr.map((b) => BRANCHES[b] || b).join(', ') : 'Não definidos');

const SECTIONS = [
  { value: 'minhas', label: 'Minhas empresas' },
  { value: 'adicionar', label: 'Adicionar empresa' },
  { value: 'pendencias', label: 'Pendências' },
  { value: 'historico', label: 'Histórico e sincronizações' },
  { value: 'contrato', label: 'Contrato da API' },
];

// =====================================================================================
// Página principal
// =====================================================================================
export default function Integrations() {
  const [sp, setSp] = useSearchParams();
  const tab = SECTIONS.some((s) => s.value === sp.get('tab')) ? sp.get('tab') : 'minhas';
  const { can } = useAuth();
  const manage = can('integrations_manage');
  const [help, setHelp] = useState(false);
  const go = (t, extra = {}) => setSp({ ...(t === 'minhas' ? {} : { tab: t }), ...extra });

  return (
    <>
      <PageHeader title="Seguradoras e Integrações"
        subtitle="Cadastro, credenciamento, conexão técnica e funções liberadas — cada um com seu próprio estado."
        actions={<>
          <button className="btn-ghost" onClick={() => setHelp(true)}><LifeBuoy className="h-4 w-4" /> Ajuda para credenciamento</button>
          <button className="btn-outline" onClick={() => go('pendencias')}><ListChecks className="h-4 w-4" /> Ver pendências</button>
          {manage && <button className="btn-primary" onClick={() => go('adicionar')}><Plus className="h-4 w-4" /> Adicionar empresa</button>}
        </>} />
      <Tabs tabs={SECTIONS} value={tab} onChange={(t) => go(t)} />
      {tab === 'minhas' && <MyCompanies onAdd={() => go('adicionar')} onHistory={(id) => go('historico', { connection_id: id })} />}
      {tab === 'adicionar' && <AddCompany />}
      {tab === 'pendencias' && <Pendencias />}
      {tab === 'contrato' && <QuoteApiContract />}
      {tab === 'historico' && <HistoryTab connectionId={sp.get('connection_id') || ''} onConnection={(id) => go('historico', id ? { connection_id: id } : {})} />}
      <Modal open={help} onClose={() => setHelp(false)} title="Ajuda para credenciamento" subtitle="Respostas rápidas para as dúvidas mais comuns" size="lg">
        <HelpPanel onNavigate={(t) => { setHelp(false); go(t); }} />
      </Modal>
    </>
  );
}

// ---------------- Indicadores separados (C.2 / C.10) ----------------
function StateIndicators({ c }) {
  const items = [
    ['Cadastro', <StatusChip key="r" map={REG_STATE} value={c.reg_state || 'rascunho'} />],
    ['Comercial', <StatusChip key="c" map={COMMERCIAL_STATE} value={c.commercial_state} />],
    ['Técnico', <StatusChip key="t" map={TECH_STATE} value={c.technical_state} />],
    ['Ambiente', <StatusChip key="e" map={ENV_CHIP} value={c.environment} />],
    ['Saúde do serviço', <StatusChip key="h" map={HEALTH_STATE} value={c.health_state || 'desconhecido'} />],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-app-sm border border-line px-2.5 py-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{k}</dt>
          <dd className="mt-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CapabilityChips({ caps, automatic }) {
  if (!caps?.length) {
    return <p className="text-xs text-ink-faint">{automatic ? 'Nenhuma função validada ainda.' : 'Sem funções automáticas: cotações e consultas seguem em operação assistida.'}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {caps.map((x) => (
        <li key={x.capability} title={x.reason || undefined}
          className={cx('chip', CAPABILITY_STATE[x.state]?.cls || T.gray)}>
          {capLabel(x.capability)}: {CAPABILITY_STATE[x.state]?.label || x.state}
          {x.environment === 'testes' && ['validada', 'ativa'].includes(x.state) ? ' (somente testes)' : ''}
        </li>
      ))}
    </ul>
  );
}

// =====================================================================================
// Minhas empresas
// =====================================================================================
function MyCompanies({ onAdd, onHistory }) {
  const { can } = useAuth();
  const manage = can('integrations_manage');
  const { data, loading, reload } = useFetch(() => api.get('/v1/integrations/connections'), []);
  const [f, setF] = useState({ q: '', method: '', environment: '', status: '', pending: false });
  const [run, busy] = useAction();
  const { toast } = useUI();
  const [pauseFor, setPauseFor] = useState(null);

  const methods = useMemo(() => Object.fromEntries((data || []).map((c) => [c.method, c.method_label])), [data]);
  const list = useMemo(() => (data || []).filter((c) => {
    if (f.q && !`${c.institution_name} ${c.template_name}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.method && c.method !== f.method) return false;
    if (f.environment && c.environment !== f.environment) return false;
    if (f.status === 'pausada' && !c.paused) return false;
    if (f.status === 'revogada' && !c.revoked_at) return false;
    if (f.status === 'ativa' && !(c.capabilities || []).some((x) => x.state === 'ativa')) return false;
    if (TECH_STATE[f.status] && c.technical_state !== f.status) return false;
    if (f.pending && !(c.pending_requirements > 0)) return false;
    return true;
  }), [data, f]);

  const test = async (c) => {
    const r = await run(() => api.post(`/v1/integrations/connections/${c.id}/connection-tests`, {}));
    if (r === FAIL) return;
    toast(r.message ? `${r.message[0]} Próximo passo: ${r.message[1]}.` : 'Teste concluído. Veja o resultado detalhado na etapa 4.', r.status === 'erro' ? 'error' : 'success');
    reload();
  };
  const resume = async (c) => {
    if (await run(() => api.post(`/v1/integrations/connections/${c.id}/pause`, { paused: false }), 'Integração retomada.') !== FAIL) reload();
  };

  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-end">
        <Input label="Empresa" placeholder="Pesquisar pelo nome" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select label="Método" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
          <option value="">Todos</option>
          {Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Ambiente" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
          <option value="">Todos</option>
          {Object.entries(ENV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Todos</option>
          <option value="ativa">Com função ativa</option>
          {Object.entries(TECH_STATE).map(([k, v]) => <option key={k} value={k}>Técnico: {v.label}</option>)}
          <option value="pausada">Pausada</option>
          <option value="revogada">Revogada</option>
        </Select>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={f.pending} onChange={(e) => setF({ ...f, pending: e.target.checked })} /> Com pendência
        </label>
      </div>

      {!data?.length ? (
        <div className="card"><Empty icon={Building2} title="Nenhuma empresa cadastrada"
          text="Adicione as seguradoras, operadoras e parceiros com que a corretora trabalha. Empresas sem integração automática funcionam em operação assistida."
          action={manage && <button className="btn-primary" onClick={onAdd}><Plus className="h-4 w-4" /> Adicionar empresa</button>} /></div>
      ) : !list.length ? (
        <div className="card"><Empty icon={Search} title="Nada encontrado com esses filtros" /></div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((c) => {
            const cred = c.credential;
            return (
              <article key={c.id} className={cx('card flex flex-col p-4', (c.revoked_at || c.paused) && 'opacity-80')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{c.institution_name}</h3>
                    <p className="text-xs text-ink-faint">{KIND_LABEL[c.institution_kind] || c.institution_kind} · {c.method_label} · {c.template_name}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.revoked_at && <span className={cx('chip', T.red)}>Revogada</span>}
                    {c.paused && <span className={cx('chip', T.gray)}>Pausada</span>}
                    <span className={cx('chip', c.adapter_available ? T.blue : T.teal)}>{c.adapter_available ? 'Conector automático' : 'Operação assistida'}</span>
                  </div>
                </div>
                <div className="mt-3"><StateIndicators c={c} /></div>
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-ink-faint">Capacidades (por função)</p>
                  <CapabilityChips caps={c.capabilities} automatic={c.adapter_available} />
                </div>
                <div className="mt-3">
                  <KV cols={2} items={[
                    ['Unidade / credenciamento', `${c.unit_name || 'Corretora (todas)'} · ${ACCREDITATION[c.accreditation] || c.accreditation}`],
                    ['Produtos selecionados', branchList(c.products)],
                    ['Último teste', c.last_test_at ? `${fmtDateTime(c.last_test_at)} (${ago(c.last_test_at)})` : 'Não executado'],
                    ['Credencial', !c.adapter_available ? 'Não se aplica' : cred ? `Configurada · versão ${cred.version}${cred.expires_at ? ` · vence em ${fmt(cred.expires_at)}` : ' · validade não informada'}` : 'Não cadastrada'],
                  ]} />
                </div>
                <Notice tone={c.revoked_at ? 'danger' : c.pending_requirements > 0 || c.technical_state === 'erro' ? 'warn' : 'info'} className="mt-3">
                  {c.pending_requirements > 0 && <b>{c.pending_requirements} pendência(s) obrigatória(s). </b>}
                  {c.next_step}
                </Notice>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  <Link to={`/integracoes/${c.id}`} className="btn-primary"><ArrowRight className="h-4 w-4" /> Continuar configuração</Link>
                  {c.adapter_available && manage && !c.revoked_at && <button className="btn-outline" disabled={busy} onClick={() => test(c)}><PlugZap className="h-4 w-4" /> Testar conexão</button>}
                  {c.adapter_available && can('credentials_manage') && !c.revoked_at && <Link to={`/integracoes/${c.id}?etapa=3`} className="btn-outline"><KeyRound className="h-4 w-4" /> Atualizar credenciais</Link>}
                  {manage && !c.revoked_at && (c.paused
                    ? <button className="btn-ghost" disabled={busy} onClick={() => resume(c)}><PlayCircle className="h-4 w-4" /> Retomar integração</button>
                    : <button className="btn-ghost" onClick={() => setPauseFor(c)}><PauseCircle className="h-4 w-4" /> Pausar integração</button>)}
                  <button className="btn-ghost" onClick={() => onHistory(c.id)}><History className="h-4 w-4" /> Histórico</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <PauseModal conn={pauseFor} onClose={() => setPauseFor(null)} onDone={() => { setPauseFor(null); reload(); }} />
    </div>
  );
}

function PauseModal({ conn, onClose, onDone }) {
  const [run] = useAction();
  return (
    <PromptModal open={!!conn} title={`Pausar integração — ${conn?.institution_name || ''}`}
      subtitle="Pausar suspende automações novas desta conexão. Apólices, documentos e histórico são preservados; tarefas ainda não iniciadas não executam."
      fields={[{ key: 'reason', label: 'Motivo (opcional)', textarea: true }]} confirmText="Pausar integração" onClose={onClose}
      onSubmit={async (v) => {
        const r = await run(() => api.post(`/v1/integrations/connections/${conn.id}/pause`, { paused: true, reason: v.reason?.trim() || undefined }), 'Integração pausada.');
        if (r !== FAIL) onDone();
      }} />
  );
}

// =====================================================================================
// Adicionar empresa (catálogo)
// =====================================================================================
function AddCompany() {
  const { can } = useAuth();
  const manage = can('integrations_manage');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 300); return () => clearTimeout(t); }, [term]);
  const { data, loading, reload } = useFetch(() => api.get(`/v1/integrations/catalog${qs({ q })}`), [q]);
  const [pick, setPick] = useState(null); // { inst, path }
  const [newInst, setNewInst] = useState(false);
  const [created, setCreated] = useState(null);

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Pesquise a empresa e veja os caminhos de integração disponíveis antes de fornecer qualquer credencial.
        Cadastrar uma empresa <b>não</b> cria aprovação comercial nem conecta uma API: quando não houver conector automático, o cadastro segue em operação assistida.
      </Notice>
      <div className="flex flex-wrap items-end gap-2">
        <Input className="min-w-[240px] flex-1" label="Pesquisar empresa" placeholder="Nome, marca, razão social ou CNPJ" value={term}
          type="search" onChange={(e) => setTerm(e.target.value)} />
        {manage && <button className="btn-outline" onClick={() => setNewInst(true)}><Plus className="h-4 w-4" /> Cadastrar empresa não encontrada</button>}
      </div>
      {created && (
        <Notice tone="ok">
          <b>{created.name}</b> foi cadastrada pela corretora como <b>cadastro comercial/assistido</b>. Nenhuma API foi conectada e os dados não foram validados pela plataforma.
          Escolha abaixo o caminho “Operação assistida” — ou “API de cotação — padrão APOLVEN”, se ela oferecer uma API nesse padrão.
        </Notice>
      )}
      {loading && !data ? <Loading /> : !data?.institutions?.length ? (
        <div className="card"><Empty icon={Building2} title="Nenhuma empresa encontrada"
          text="Se a empresa com que você trabalha não aparece, cadastre-a para operação assistida e solicite avaliação de integração."
          action={manage && <button className="btn-primary" onClick={() => setNewInst(true)}>Cadastrar empresa não encontrada</button>} /></div>
      ) : (
        <div className="space-y-4">
          {data.institutions.map((inst) => (
            <section key={inst.id} className="card">
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div>
                  <h3 className="font-semibold">{inst.name}</h3>
                  <p className="text-xs text-ink-faint">
                    {KIND_LABEL[inst.kind] || inst.kind}
                    {inst.cnpj ? ` · CNPJ ${maskDoc(inst.cnpj)}` : ' · CNPJ não informado'}
                    {inst.official_code ? ` · código oficial ${inst.official_code}` : ''}
                  </p>
                </div>
                <span className={cx('chip', inst.scope === 'corretora' ? T.amber : T.gray)}>
                  {inst.scope === 'corretora' ? 'Cadastrada pela corretora (não validada pela plataforma)' : 'Catálogo da plataforma'}
                </span>
              </header>
              {inst.notes && <p className="px-4 pt-3 text-xs text-ink-soft">{inst.notes}</p>}
              <ul className="divide-y divide-line">
                {inst.paths.map((p) => {
                  const auto = isAutomatic(p);
                  return (
                    <li key={p.code} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            <StatusChip map={CONNECTOR_STATUS} value={p.status} />
                            <span className={cx('chip', auto ? T.blue : T.gray)}>{auto ? 'Conector automático disponível' : 'Sem conector automático'}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-faint">
                            {p.method_label} · Produtos: {p.products?.length ? branchList(p.products) : 'conforme cadastro'}
                            {p.capabilities?.length ? ` · Funções previstas: ${p.capabilities.map((x) => x.label).join(', ')}` : ''}
                          </p>
                          {p.connections > 0 && <p className="mt-1 text-xs text-ink-soft">Você já tem {p.connections} conexão(ões) por este caminho.</p>}
                          <details className="mt-2 text-sm">
                            <summary className="cursor-pointer text-xs font-medium text-primary">Ver orientação, requisitos e fontes</summary>
                            <PathDetails p={p} />
                          </details>
                        </div>
                        {manage && (
                          <button className="btn-outline shrink-0" disabled={p.status === 'indisponivel'} title={p.status === 'indisponivel' ? 'Caminho indisponível no momento' : undefined}
                            onClick={() => setPick({ inst, path: p })}>
                            {p.connections > 0 ? 'Adicionar outro vínculo' : 'Escolher este caminho'}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {pick && <AddWizard inst={pick.inst} initialPath={pick.path} onClose={() => { setPick(null); reload(); }} />}
      <NewInstitutionModal open={newInst} onClose={() => setNewInst(false)}
        onDone={async (i, opts) => {
          setNewInst(false); setCreated(i); setTerm(i.name);
          if (opts?.api) {
            // "tem API de cotação": abre direto o caminho da API no padrão APOLVEN
            try {
              const cat = await api.get(`/v1/integrations/catalog${qs({ q: i.name })}`);
              const inst = cat.institutions.find((x) => x.id === i.id);
              const path = inst?.paths.find((x) => x.api_config);
              if (inst && path) setPick({ inst, path });
            } catch { /* a lista abaixo continua disponível */ }
          }
        }} />
    </div>
  );
}

function PathDetails({ p }) {
  return (
    <div className="mt-2 space-y-2 rounded-app-sm bg-muted/60 p-3 text-xs">
      {p.help && <p className="text-ink-soft">{p.help}</p>}
      <p><b>Titular da credencial:</b> {p.credential_owner || '—'}</p>
      {p.requirements?.length > 0 && (
        <div>
          <b>Requisitos deste caminho:</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {p.requirements.map((r) => (
              <li key={r.code}>{r.label} {r.required ? '' : '(opcional)'} — <span className="text-ink-faint">{r.why}</span>
                {r.link && <> · <a className="text-primary underline" href={r.link} target="_blank" rel="noreferrer noopener">link oficial</a></>}</li>
            ))}
          </ul>
        </div>
      )}
      {p.sources?.length > 0 && (
        <div>
          <b>Fontes consultadas:</b>
          <ul className="mt-1 list-disc pl-5">{p.sources.map((s) => <li key={s.ref}>[{s.ref}] {s.title} — verificado em {fmt(s.verified_at)}</li>)}</ul>
        </div>
      )}
      {!isAutomatic(p) && <p className="text-ink-faint">Este caminho não pede senha, token nem chave de API.</p>}
    </div>
  );
}

/** Assistente — etapa 1 (C.5): caminho, unidade, produtos, credenciamento, ambiente, código e parceiro. */
function AddWizard({ inst, initialPath, onClose }) {
  const navigate = useNavigate();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const paths = inst.paths.filter((p) => p.status !== 'indisponivel');
  const [code, setCode] = useState(initialPath.code);
  const path = paths.find((p) => p.code === code) || initialPath;
  const auto = isAutomatic(path);
  const { data: units } = useFetch(() => api.get('/v1/company/units'), []);
  const needsPartner = path.method === 'multicalculo_parceiro' && inst.kind !== 'parceiro_tecnologico';
  const { data: conns } = useFetch(() => (needsPartner ? api.get('/v1/integrations/connections') : Promise.resolve([])), [needsPartner]);
  const partners = (conns || []).filter((c) => c.institution_kind === 'parceiro_tecnologico' && !c.revoked_at && c.method === 'multicalculo_parceiro');
  const [v, setV] = useState({ unit_id: '', products: [], accreditation: initialPath.api_config ? 'sim' : 'nao', environment: initialPath.api_config ? 'producao' : 'testes', broker_code: '', partner_connection_id: '', notes: '' });
  const [exists, setExists] = useState(null);
  const allowed = path.products?.length ? path.products : Object.keys(BRANCHES);
  useEffect(() => { setV((x) => ({ ...x, products: x.products.filter((p) => allowed.includes(p)) })); setExists(null); }, [code]); // eslint-disable-line

  const toggleProduct = (b) => setV((x) => ({ ...x, products: x.products.includes(b) ? x.products.filter((y) => y !== b) : [...x.products, b] }));
  const submit = async () => {
    setExists(null);
    const body = {
      institution_id: inst.id, template_code: path.code, unit_id: v.unit_id || null, products: v.products, accreditation: v.accreditation,
      environment: v.environment, broker_code: v.broker_code.trim() || null, notes: v.notes.trim() || null,
      ...(needsPartner ? { partner_connection_id: v.partner_connection_id || null } : {}),
    };
    const r = await run(() => api.post('/v1/integrations/connections', body), null, (e) => {
      if (e.code === 'CONNECTION_EXISTS') { setExists({ id: e.data?.id, message: e.message }); return true; }
      return false;
    });
    if (r === FAIL) return;
    toast(r.message || (path.api_config ? 'Empresa adicionada. Configure a API de cotação.' : 'Empresa adicionada. Continue pelos requisitos.'));
    navigate(`/integracoes/${r.id}${path.api_config ? '?etapa=3' : ''}`);
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`Adicionar empresa — ${inst.name}`} subtitle="Etapa 1 de 5 · Escolher empresa e caminho"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || (needsPartner && !v.partner_connection_id)} onClick={submit}>
          {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Salvar e continuar
        </button>
      </>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="label">Como deseja integrar?</legend>
          <div className="grid gap-2">
            {paths.map((p) => (
              <label key={p.code} className={cx('flex cursor-pointer items-start gap-3 rounded-app-sm border p-3', p.code === code ? 'border-primary bg-primary/5' : 'border-line')}>
                <input type="radio" name="path" className="mt-1" checked={p.code === code} onChange={() => setCode(p.code)} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{p.name} <StatusChip map={CONNECTOR_STATUS} value={p.status} /></span>
                  <span className="block text-xs text-ink-faint">{p.method_label} · {isAutomatic(p) ? 'conector automático disponível' : 'sem conector automático'}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {path.api_config && (
          <Notice tone="info">
            <b>API de cotação no padrão APOLVEN.</b> Na próxima etapa você informa o endereço https da API, a autenticação e as credenciais e testa a conexão.
            Com credenciamento confirmado e ambiente de produção, a seguradora passa a ser consultada automaticamente nas cotações.
          </Notice>
        )}
        {!auto && (
          <Notice tone="warn">
            <b>Esta empresa ainda não possui integração automática disponível neste sistema por este caminho.</b> O cadastro será salvo para
            operação assistida: a equipe consulta pelo canal oficial e registra a resposta formal. Nenhuma senha, token ou chave será pedida.
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Unidade / filial" value={v.unit_id} onChange={(e) => setV({ ...v, unit_id: e.target.value })}
            hint="Vínculos distintos por filial são conexões separadas.">
            <option value="">Corretora (sem unidade específica)</option>
            {(units || []).filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Select label="Ambiente" value={v.environment} onChange={(e) => setV({ ...v, environment: e.target.value })}
            hint="Teste em sandbox não libera produção; cada ambiente é validado separadamente.">
            {Object.entries(ENV_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input label="Código da corretora no fornecedor" value={v.broker_code} maxLength={60} autoComplete="off"
            onChange={(e) => setV({ ...v, broker_code: e.target.value })}
            hint="Identificação comercial na seguradora/parceiro. Não é o código SUSEP nem login do portal." />
          <fieldset>
            <legend className="label">Já possui credenciamento nessa empresa?</legend>
            <div className="flex flex-wrap gap-3 pt-1 text-sm">
              {Object.entries(ACCREDITATION).map(([k, l]) => (
                <label key={k} className="flex items-center gap-1.5"><input type="radio" name="acc" checked={v.accreditation === k} onChange={() => setV({ ...v, accreditation: k })} /> {l}</label>
              ))}
            </div>
          </fieldset>
        </div>

        {needsPartner && (
          partners.length ? (
            <Select label="Parceiro de multicálculo usado para esta companhia" value={v.partner_connection_id}
              onChange={(e) => setV({ ...v, partner_connection_id: e.target.value })}
              hint="O vínculo da companhia fica preso à conexão com o parceiro; os requisitos são os do parceiro.">
              <option value="">Selecione…</option>
              {partners.map((c) => <option key={c.id} value={c.id}>{c.institution_name} · {ENV_LABEL[c.environment]}{c.unit_name ? ` · ${c.unit_name}` : ''}</option>)}
            </Select>
          ) : (
            <Notice tone="warn">Para usar este caminho, cadastre antes a conexão com o seu parceiro de multicálculo (pesquise o parceiro tecnológico neste catálogo).</Notice>
          )
        )}

        <fieldset>
          <legend className="label">Produtos desejados {path.products?.length ? '(suportados por este caminho)' : ''}</legend>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {allowed.map((b) => (
              <label key={b} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={v.products.includes(b)} onChange={() => toggleProduct(b)} /> {BRANCHES[b] || b}
              </label>
            ))}
          </div>
        </fieldset>
        <Textarea label="Observações (opcional)" value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })}
          hint="Motivo desta conexão (ex.: vínculo da filial, conexão via parceiro). Não escreva senhas aqui." />

        {exists && (
          <Notice tone="warn">
            {exists.message}
            {exists.id && <div className="mt-2"><button className="btn-primary" onClick={() => navigate(`/integracoes/${exists.id}`)}><ArrowRight className="h-4 w-4" /> Continuar configuração</button></div>}
          </Notice>
        )}
      </div>
    </Modal>
  );
}

function NewInstitutionModal({ open, onClose, onDone }) {
  const [run, busy] = useAction();
  const blank = { kind: 'seguradora', name: '', legal_name: '', cnpj: '', official_code: '', assistance_phone: '', contact: '', branches: [], has_api: false };
  const [v, setV] = useState(blank);
  useEffect(() => { if (open) setV(blank); }, [open]); // eslint-disable-line
  const submit = async () => {
    const body = {
      kind: v.kind, name: v.name.trim(), legal_name: v.legal_name.trim() || null, cnpj: v.cnpj.trim() || null, official_code: v.official_code.trim() || null,
      assistance_phone: v.assistance_phone.trim() || null, contact: v.contact.trim() || null, branches: v.branches,
    };
    const r = await run(() => api.post('/v1/integrations/institutions', body), v.has_api ? 'Empresa cadastrada. Agora configure a API de cotação.' : 'Cadastro assistido salvo. Nenhuma API foi conectada.');
    if (r !== FAIL) onDone(r, { api: v.has_api && v.kind !== 'parceiro_tecnologico' });
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Cadastrar empresa não encontrada"
      subtitle="Cria um cadastro comercial/assistido. Não cria código de integração nem comprova acesso comercial."
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || v.name.trim().length < 2} onClick={submit}>Salvar cadastro assistido</button></>}>
      <div className="space-y-4">
        <Notice tone="info">Informe só o que você sabe com segurança. Não preencha CNPJ ou código oficial por suposição — deixe em branco se não tiver o documento.</Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Tipo" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input label="Nome comercial *" value={v.name} maxLength={160} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <Input label="Razão social" value={v.legal_name} maxLength={200} onChange={(e) => setV({ ...v, legal_name: e.target.value })} />
          <Input label="CNPJ (quando conhecido)" value={v.cnpj} inputMode="numeric" onChange={(e) => setV({ ...v, cnpj: maskDoc(e.target.value) })} />
          <Input label="Código oficial (SUSEP/ANS), se conhecido" value={v.official_code} maxLength={40} onChange={(e) => setV({ ...v, official_code: e.target.value })} />
          <Input label="Telefone de assistência" value={v.assistance_phone} maxLength={40} onChange={(e) => setV({ ...v, assistance_phone: e.target.value })} />
        </div>
        <Textarea label="Contato oficial" value={v.contact} maxLength={300} onChange={(e) => setV({ ...v, contact: e.target.value })}
          hint="Canal comercial ou e-mail oficial para credenciamento." />
        <fieldset>
          <legend className="label">Ramos de interesse</legend>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {Object.entries(BRANCHES).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={v.branches.includes(k)}
                  onChange={() => setV({ ...v, branches: v.branches.includes(k) ? v.branches.filter((x) => x !== k) : [...v.branches, k] })} /> {l}
              </label>
            ))}
          </div>
        </fieldset>
        {v.kind !== 'parceiro_tecnologico' && (
          <Toggle checked={v.has_api} onChange={(x) => setV({ ...v, has_api: x })} label="Esta empresa tem API de cotação (padrão APOLVEN)"
            hint="Ao salvar, abre a configuração da API: endereço https, autenticação e teste. Sem API, as cotações seguem assistidas." />
        )}
      </div>
    </Modal>
  );
}

// =====================================================================================
// Pendências (C.11)
// =====================================================================================
function Pendencias() {
  const { data, loading } = useFetch(() => api.get('/v1/integrations/pendencias'), []);
  const [sp, setSp] = useSearchParams();
  if (loading && !data) return <Loading />;
  const reqs = data?.requirements || [];
  const exp = data?.expiring_credentials || [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {exp.length > 0 && (
          <Section title="Credenciais vencendo ou vencidas" subtitle="Validade informada no cadastro da credencial (próximos 30 dias)">
            <ul className="space-y-2 text-sm">
              {exp.map((x) => (
                <li key={`${x.connection_id}-${x.expires_at}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{x.institution_name}</b> — {new Date(x.expires_at) < new Date() ? 'venceu' : 'vence'} em {fmt(x.expires_at)}</span>
                  <Link className="btn-outline" to={`/integracoes/${x.connection_id}?etapa=3`}><KeyRound className="h-4 w-4" /> Atualizar credenciais</Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {!reqs.length ? (
          <div className="card"><Empty icon={CheckCircle2} title="Nenhuma pendência em aberto" text="Todos os requisitos cadastrados estão confirmados." /></div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>O que falta</th><th>Quem resolve</th><th>Onde resolver</th><th>Desde quando</th><th>Depois fica disponível</th></tr></thead>
              <tbody>
                {reqs.map((x) => (
                  <tr key={x.id || `${x.connection_id}-${x.code}`}>
                    <td data-label="O que falta">
                      <div className="font-medium">{x.institution_name}</div>
                      <div>{x.label} {!x.required && <span className="text-xs text-ink-faint">(opcional)</span>}</div>
                      <div className="text-xs text-ink-faint">{x.why}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5"><StatusChip map={REQ_STATUS} value={x.status} />{x.protocol && <span className="chip bg-muted text-ink-soft">Protocolo {x.protocol}</span>}</div>
                    </td>
                    <td data-label="Quem resolve" className="text-sm">
                      <div>{RESOLVED_BY[x.resolved_by] || x.resolved_by}</div>
                      <div className="text-xs text-ink-faint">Fornecido por: {PROVIDED_BY[x.provided_by] || x.provided_by}</div>
                    </td>
                    <td data-label="Onde resolver">
                      <div className="flex flex-col gap-1">
                        {x.link && <a className="inline-flex items-center gap-1 text-sm text-primary underline" href={x.link} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" /> Abrir cadastro oficial</a>}
                        <Link className="text-sm text-primary underline" to={`/integracoes/${x.connection_id}?etapa=2`}>Checklist da conexão</Link>
                      </div>
                    </td>
                    <td data-label="Desde quando" className="whitespace-nowrap text-sm">{fmt(x.updated_at)}<div className="text-xs text-ink-faint">{ago(x.updated_at)}</div></td>
                    <td data-label="Depois fica disponível" className="text-sm">{x.unlocks?.length ? x.unlocks.join(', ') : <span className="text-ink-faint">Não bloqueia funções</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Section title="Ajuda contextual" className="h-fit">
        <HelpPanel compact onNavigate={(t) => setSp(t === 'minhas' ? {} : { tab: t })} />
      </Section>
    </div>
  );
}

/** Ajuda (C.11). Com `conn`, as respostas usam o caminho selecionado. */
function HelpPanel({ conn, compact, onNavigate }) {
  const t = conn?.template;
  const links = (conn?.requirements || []).filter((r) => r.link);
  const items = [
    ['Não tenho essas credenciais', (
      <>
        <p>As credenciais de API são emitidas pela seguradora ou pelo parceiro <b>depois</b> do credenciamento comercial e da aprovação do acesso. Elas não são a senha do portal do corretor.</p>
        {t?.help ? <p className="mt-1">{t.help}</p> : <p className="mt-1">Abra a conexão e veja a orientação do caminho escolhido na etapa 2, com o link oficial de cada requisito.</p>}
        {links.length > 0 && <ul className="mt-1 list-disc pl-5">{links.map((r) => <li key={r.code}><a className="text-primary underline" href={r.link} target="_blank" rel="noreferrer noopener">{r.label}</a></li>)}</ul>}
        <p className="mt-1">Use “Preparar solicitação de acesso” para gerar um texto revisável (sem senhas) e enviar pelo canal oficial.</p>
      </>
    )],
    ['Tenho somente login do portal', (
      <p>A conta do portal permite acesso manual. Para usar uma API, é preciso solicitar a liberação do aplicativo ao fornecedor. O login pessoal do portal não é usado como Client Secret e não é pedido aqui. Enquanto isso, a empresa pode operar em consulta assistida.</p>
    )],
    ['Minha empresa não aparece', (
      <>
        <p>Em “Adicionar empresa”, use <b>Cadastrar empresa não encontrada</b>. O resultado é um cadastro comercial/assistido — nunca uma API conectada. Depois, você pode solicitar avaliação de integração.</p>
        {onNavigate && <button className="btn-outline mt-2" onClick={() => onNavigate('adicionar')}>Ir para Adicionar empresa</button>}
      </>
    )],
    ['Já uso multicálculo', (
      <p>Cadastre primeiro a conexão com o parceiro tecnológico (caminho “Parceiro de multicálculo”). Depois, para cada seguradora, escolha o mesmo caminho e selecione a conexão do parceiro. Uma assinatura comum de multicálculo não comprova direito a API — confirme licença de integração externa no contrato. Os requisitos desse caminho são do parceiro, não da seguradora diretamente.</p>
    )],
    ['A conexão funcionou, mas não consigo cotar', (
      <p>Autenticação válida não significa autorização para tudo. Confira, na etapa 5, o estado da função “Incluir no multicálculo automático”: ela exige credenciamento aprovado, requisitos bloqueadores confirmados, validação na credencial atual e ambiente de produção. Validações no ambiente de testes não liberam cotações reais.</p>
    )],
    ['Preciso de ajuda técnica', (
      <p>Informe ao suporte o nome da empresa, a etapa e o <b>código de correlação</b> do teste (etapa 4). Nunca envie senha, Client Secret, token ou chave privada — a equipe não precisa deles para investigar.</p>
    )],
  ];
  return (
    <div className={cx('space-y-2', compact && 'text-sm')}>
      {items.map(([q, a]) => (
        <details key={q} className="rounded-app-sm border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">{q}</summary>
          <div className="mt-2 text-sm text-ink-soft">{a}</div>
        </details>
      ))}
    </div>
  );
}

// =====================================================================================
// Histórico e sincronizações
// =====================================================================================
function HistoryTab({ connectionId, onConnection }) {
  const { data: conns } = useFetch(() => api.get('/v1/integrations/connections'), []);
  const { data, loading } = useFetch(() => api.get(`/v1/integrations/history${qs({ connection_id: connectionId })}`), [connectionId]);
  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <Select label="Conexão" value={connectionId} onChange={(e) => onConnection(e.target.value)}>
          <option value="">Todas as conexões</option>
          {(conns || []).map((c) => <option key={c.id} value={c.id}>{c.institution_name} — {c.template_name}{c.revoked_at ? ' (revogada)' : ''}</option>)}
        </Select>
      </div>
      {loading && !data ? <Loading /> : <EventsTable events={data || []} showInstitution />}
    </div>
  );
}

function EventsTable({ events, showInstitution }) {
  if (!events.length) return <div className="card"><Empty icon={History} title="Sem eventos registrados" /></div>;
  return (
    <div className="card overflow-x-auto">
      <table className="table-clean">
        <thead><tr><th>Data</th>{showInstitution && <th>Empresa</th>}<th>Evento</th><th>Resumo</th><th>Usuário</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td data-label="Data" className="whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
              {showInstitution && <td data-label="Empresa">{e.institution_name}</td>}
              <td data-label="Evento"><span className="chip bg-muted text-ink-soft">{EVENT_LABEL[e.kind] || e.kind}</span></td>
              <td data-label="Resumo" className="text-sm">{e.summary}{e.data?.correlation && <div className="font-mono text-[11px] text-ink-faint">correlação {e.data.correlation}</div>}</td>
              <td data-label="Usuário">{e.user_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =====================================================================================
// Detalhe da conexão — assistente em 5 etapas (C.4)
// =====================================================================================
const STEPS = [
  { n: 1, label: 'Escolher empresa e caminho' },
  { n: 2, label: 'Requisitos e credenciamento' },
  { n: 3, label: 'Credenciais e acesso' },
  { n: 4, label: 'Testar conexão' },
  { n: 5, label: 'Ativar funções' },
];

function stepStatus(c) {
  const req = (c.requirements || []).filter((r) => r.required);
  const ok = req.filter((r) => r.status === 'confirmado').length;
  const cred = (c.credentials || []).find((x) => !x.revoked_at);
  const last = c.tests?.[0];
  const active = (c.capability_list || []).filter((x) => x.state === 'ativa');
  const validated = (c.capability_list || []).filter((x) => x.state === 'validada');
  return {
    1: { done: true, text: 'Cadastro salvo' },
    2: { done: req.length > 0 ? ok === req.length : true, text: req.length ? `${ok} de ${req.length} obrigatório(s) confirmado(s)` : 'Sem requisitos obrigatórios' },
    3: !c.adapter_available ? { done: null, text: 'Não se aplica (assistida)' }
      : c.template?.api_config ? { done: !!(cred && c.api_config), text: cred && c.api_config ? 'API de cotação configurada' : 'Configurar API de cotação' }
        : { done: !!cred, text: cred ? `Configurada · versão ${cred.version}` : 'Aguardando credencial' },
    4: !c.adapter_available ? { done: null, text: 'Não se aplica (assistida)' } : { done: last?.results?.autenticacao === 'valida', text: last ? `Último: ${R_AUTH[last.results?.autenticacao]?.label || last.status} (${fmt(last.created_at)})` : 'Não executado' },
    5: !c.adapter_available ? { done: null, text: 'Sem funções automáticas' } : { done: active.length > 0, text: active.length ? `${active.length} ativa(s)` : validated.length ? `${validated.length} validada(s), nenhuma ativa` : 'Nenhuma ativa' },
  };
}

export function ConnectionDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const manage = can('integrations_manage');
  const { toast } = useUI();
  const { data: c, loading, reload } = useFetch(() => api.get(`/v1/integrations/connections/${id}`), [id]);
  const [run, busy] = useAction();
  const [pause, setPause] = useState(false);
  const [revoke, setRevoke] = useState(false);
  const [help, setHelp] = useState(false);
  const urlStep = Number(sp.get('etapa'));
  const step = urlStep >= 1 && urlStep <= 5 ? urlStep : Math.min(Math.max(c?.step || 1, 1), 5);
  const setStep = (n) => setSp({ etapa: String(n) }, { replace: true });

  if (loading && !c) return <Loading />;
  if (!c) return <Empty title="Conexão não encontrada" action={<Link className="btn-outline" to="/integracoes">Voltar</Link>} />;

  const status = stepStatus(c);
  const readOnly = !manage || !!c.revoked_at;
  const saveLater = async () => {
    if (readOnly) { navigate('/integracoes'); return; }
    const r = await run(() => api.patch(`/v1/integrations/connections/${c.id}`, { version: c.version, step }), 'Progresso salvo. Você pode continuar depois.',
      (e) => { if (e.code === 'VERSION_CONFLICT') { reload(); } return false; });
    if (r !== FAIL) navigate('/integracoes');
  };
  const test = async () => {
    const r = await run(() => api.post(`/v1/integrations/connections/${c.id}/connection-tests`, {}));
    if (r === FAIL) return;
    if (r.auto_activated) toast(c.environment === 'producao' ? 'Conexão aprovada: a cotação automática desta seguradora está ativa.' : 'Conexão aprovada (ambiente de testes: não entra no multicálculo real).');
    else if (r.results?.autenticacao === 'valida' && r.activation_blockers?.length) toast(`Conexão aprovada. Falta para ativar: ${r.activation_blockers.join('; ')}.`, 'error');
    await reload();
    setStep(4);
  };
  const resume = async () => {
    if (await run(() => api.post(`/v1/integrations/connections/${c.id}/pause`, { paused: false }), 'Integração retomada.') !== FAIL) reload();
  };

  return (
    <>
      <Link to="/integracoes" className="btn-ghost -ml-2 mb-2"><ArrowLeft className="h-4 w-4" /> Seguradoras e Integrações</Link>
      <PageHeader title={c.institution_name}
        subtitle={`${KIND_LABEL[c.institution_kind] || c.institution_kind} · ${c.template?.name || c.template_code} · ${c.template?.method_label || c.method}`}
        actions={<>
          <button className="btn-ghost" onClick={() => setHelp(true)}><LifeBuoy className="h-4 w-4" /> Ajuda para credenciamento</button>
          {c.adapter_available && manage && !c.revoked_at && <button className="btn-outline" disabled={busy} onClick={test}><PlugZap className="h-4 w-4" /> Testar conexão</button>}
          {manage && !c.revoked_at && (c.paused
            ? <button className="btn-outline" disabled={busy} onClick={resume}><PlayCircle className="h-4 w-4" /> Retomar integração</button>
            : <button className="btn-outline" onClick={() => setPause(true)}><PauseCircle className="h-4 w-4" /> Pausar integração</button>)}
          {can('credentials_manage') && !c.revoked_at && <button className="btn-ghost text-red-600" onClick={() => setRevoke(true)}><Ban className="h-4 w-4" /> Revogar</button>}
        </>} />

      {c.revoked_at && <Notice tone="danger" className="mb-4">Integração revogada em {fmtDateTime(c.revoked_at)}. Apólices, documentos e histórico foram preservados. Para voltar a usar, adicione a empresa novamente.</Notice>}
      {c.paused && !c.revoked_at && <Notice tone="warn" className="mb-4">Integração pausada{c.paused_reason ? `: ${c.paused_reason}` : ''}. Automações novas estão suspensas; nada foi apagado.</Notice>}

      <div className="card mb-4 space-y-3 p-4">
        <StateIndicators c={c} />
        <Notice tone={c.technical_state === 'erro' || c.pending_requirements > 0 ? 'warn' : 'info'}><b>Próximo passo:</b> {c.next_step}</Notice>
      </div>

      <nav aria-label="Etapas do assistente" className="mb-4">
        <ol className="grid gap-2 sm:grid-cols-5">
          {STEPS.map((s) => {
            const st = status[s.n];
            const Icon = st.done === true ? CheckCircle2 : st.done === null ? Info : Circle;
            return (
              <li key={s.n}>
                <button type="button" onClick={() => setStep(s.n)} aria-current={step === s.n ? 'step' : undefined}
                  className={cx('flex h-full w-full items-start gap-2 rounded-app-sm border p-2.5 text-left transition',
                    step === s.n ? 'border-primary bg-primary/5' : 'border-line hover:bg-muted')}>
                  <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', st.done === true ? 'text-emerald-600' : 'text-ink-faint')} />
                  <span className="min-w-0">
                    <span className="block text-xs text-ink-faint">Etapa {s.n}</span>
                    <span className="block text-sm font-medium leading-tight">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{st.text}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-1.5 text-xs text-ink-faint">O progresso mostra o que já foi preenchido em cada etapa. Ele não representa aprovação comercial nem técnica.</p>
      </nav>

      <div className="mb-4">
        {step === 1 && <Step1 c={c} reload={reload} readOnly={readOnly} />}
        {step === 2 && <Step2 c={c} reload={reload} readOnly={readOnly} />}
        {step === 3 && (c.template?.api_config
          ? <QuoteApiConfig c={c} reload={reload} readOnly={readOnly || !can('credentials_manage')} onTest={manage && !readOnly ? test : null} testing={busy} />
          : <Step3 c={c} reload={reload} readOnly={readOnly || !can('credentials_manage')} onDone={() => setStep(4)} />)}
        {step === 4 && <Step4 c={c} reload={reload} readOnly={readOnly} onTest={test} busy={busy} />}
        {step === 5 && <Step5 c={c} reload={reload} readOnly={readOnly} />}
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-ghost" disabled={step === 1} onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" /> Etapa anterior</button>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" disabled={busy} onClick={saveLater}><Save className="h-4 w-4" /> Salvar e continuar depois</button>
          {step < 5 && <button className="btn-primary" onClick={() => setStep(step + 1)}>Próxima etapa <ArrowRight className="h-4 w-4" /></button>}
        </div>
      </div>

      <Section title="Histórico desta conexão" subtitle="Eventos autorizados, testes e alterações (sem conteúdo de credenciais)"
        actions={<Link className="btn-ghost" to={`/integracoes?tab=historico&connection_id=${c.id}`}>Ver tudo</Link>} bodyClass="p-0">
        {c.events?.length ? (
          <ul className="divide-y divide-line">
            {c.events.slice(0, 15).map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                <span className="w-36 shrink-0 text-xs text-ink-faint">{fmtDateTime(e.created_at)}</span>
                <span className="chip bg-muted text-ink-soft">{EVENT_LABEL[e.kind] || e.kind}</span>
                <span className="min-w-0 flex-1">{e.summary}</span>
                <span className="text-xs text-ink-faint">{e.user_name}</span>
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-sm text-ink-faint">Sem eventos.</p>}
      </Section>

      <PauseModal conn={pause ? c : null} onClose={() => setPause(false)} onDone={() => { setPause(false); reload(); }} />
      <RevokeModal open={revoke} c={c} onClose={() => setRevoke(false)} onDone={() => { setRevoke(false); reload(); }} />
      <Modal open={help} onClose={() => setHelp(false)} title="Ajuda para credenciamento" subtitle={`${c.institution_name} · ${c.template?.name || ''}`} size="lg">
        <HelpPanel conn={c} onNavigate={(t) => navigate(`/integracoes?tab=${t}`)} />
      </Modal>
    </>
  );
}

// ---------------- Etapa 1 ----------------
function Step1({ c, reload, readOnly }) {
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const { data: units } = useFetch(() => api.get('/v1/company/units'), []);
  const init = () => ({
    broker_code: c.broker_code || '', branch_code: c.branch_code || '', producer_code: c.producer_code || '', unit_id: c.unit_id || '',
    products: c.products || [], accreditation: c.accreditation, commercial_state: c.commercial_state, commercial_evidence: '', environment: c.environment, notes: c.notes || '',
  });
  const [v, setV] = useState(init);
  useEffect(() => { setV(init()); }, [c.version]); // eslint-disable-line
  const t = c.template || {};
  const allowed = t.products?.length ? t.products : Object.keys(BRANCHES);
  const nul = (s) => (String(s ?? '').trim() || null);

  const save = async () => {
    const body = { version: c.version };
    for (const k of ['broker_code', 'branch_code', 'producer_code', 'notes']) if (nul(v[k]) !== (c[k] ?? null)) body[k] = nul(v[k]);
    if ((v.unit_id || null) !== (c.unit_id || null)) body.unit_id = v.unit_id || null;
    if ([...v.products].sort().join() !== [...(c.products || [])].sort().join()) body.products = v.products;
    if (v.accreditation !== c.accreditation) body.accreditation = v.accreditation;
    if (v.commercial_state !== c.commercial_state) {
      body.commercial_state = v.commercial_state;
      if (v.commercial_state === 'aprovado') body.commercial_evidence = v.commercial_evidence.trim();
    }
    if (v.environment !== c.environment) body.environment = v.environment;
    if (Object.keys(body).length === 1) return;
    const scope = body.environment || 'broker_code' in body || 'unit_id' in body;
    if (scope && !(await confirm({ title: 'Alterar escopo da conexão?', message: 'Trocar ambiente, unidade ou código comercial faz testes e funções voltarem a pendente. Evidências anteriores ficam no histórico.', confirmText: 'Salvar alterações', danger: false }))) return;
    const r = await run(() => api.patch(`/v1/integrations/connections/${c.id}`, body), 'Configuração salva.', (e) => {
      if (e.code === 'VERSION_CONFLICT') { reload(); }
      return false;
    });
    if (r !== FAIL) reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <Section title="Empresa e caminho escolhidos">
        <KV cols={1} items={[
          ['Empresa', `${c.institution_name} (${KIND_LABEL[c.institution_kind] || c.institution_kind})`],
          ['Caminho', `${t.name || c.template_code} · ${t.method_label || c.method}`],
          ['Situação do conector', <StatusChip key="s" map={CONNECTOR_STATUS} value={t.status} />],
          ['Integração automática', c.adapter_available ? 'Conector automático disponível' : 'Não disponível neste sistema — operação assistida'],
          ['Titular da credencial', t.credential_owner || '—'],
          ['Cadastrada em', fmtDateTime(c.created_at)],
        ]} />
        {t.help && <p className="mt-3 text-sm text-ink-soft">{t.help}</p>}
      </Section>
      <Section title="Configuração não secreta" subtitle="Códigos comerciais, unidade, produtos e ambiente — nenhuma senha aqui"
        actions={!readOnly && <button className="btn-primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Salvar</button>}>
        <fieldset disabled={readOnly} className="space-y-4">
          <Notice tone="warn">Alterar ambiente, unidade ou código da corretora invalida testes e funções desse escopo (voltam a pendente). As evidências anteriores são mantidas.</Notice>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Código da corretora no fornecedor" value={v.broker_code} maxLength={60} autoComplete="off" onChange={(e) => setV({ ...v, broker_code: e.target.value })}
              hint="Identificação comercial — não é o código SUSEP." />
            <Input label="Código da sucursal" value={v.branch_code} maxLength={60} autoComplete="off" onChange={(e) => setV({ ...v, branch_code: e.target.value })} />
            <Input label="Código do produtor" value={v.producer_code} maxLength={60} autoComplete="off" onChange={(e) => setV({ ...v, producer_code: e.target.value })} />
            <Select label="Unidade / filial" value={v.unit_id} onChange={(e) => setV({ ...v, unit_id: e.target.value })}>
              <option value="">Corretora (sem unidade específica)</option>
              {(units || []).map((u) => <option key={u.id} value={u.id}>{u.name}{u.active === false ? ' (inativa)' : ''}</option>)}
            </Select>
            <Select label="Credenciamento nesta empresa" value={v.accreditation} onChange={(e) => setV({ ...v, accreditation: e.target.value })}>
              {Object.entries(ACCREDITATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Select label="Situação comercial (informação formal)" value={v.commercial_state} onChange={(e) => setV({ ...v, commercial_state: e.target.value })}>
              {Object.entries(COMMERCIAL_STATE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </Select>
            {v.commercial_state === 'aprovado' && c.commercial_state !== 'aprovado' && (
              <Textarea className="sm:col-span-2" label="Evidência formal da aprovação comercial *" value={v.commercial_evidence} maxLength={1000}
                onChange={(e) => setV({ ...v, commercial_evidence: e.target.value })} hint="Protocolo, e-mail ou contrato que comprova a aprovação." />
            )}
            <Select label="Ambiente" value={v.environment} onChange={(e) => setV({ ...v, environment: e.target.value })}
              hint="Cada ambiente tem configuração e validação independentes.">
              {Object.entries(ENV_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </div>
          <fieldset>
            <legend className="label">Produtos</legend>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {allowed.map((b) => (
                <label key={b} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={v.products.includes(b)}
                    onChange={() => setV({ ...v, products: v.products.includes(b) ? v.products.filter((x) => x !== b) : [...v.products, b] })} /> {BRANCHES[b] || b}
                </label>
              ))}
            </div>
          </fieldset>
          <Textarea label="Observações" value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </fieldset>
      </Section>
    </div>
  );
}

// ---------------- Etapa 2 ----------------
function Step2({ c, reload, readOnly }) {
  const [run, busy] = useAction();
  const { toast } = useUI();
  const [edit, setEdit] = useState(null); // { req, preset }
  const [text, setText] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const co = c.company || {};
  const caps = c.template?.capabilities || [];

  const prepare = async () => {
    const r = await run(() => api.post(`/v1/integrations/connections/${c.id}/request-text`, {}));
    if (r !== FAIL) setText(r.text);
  };

  return (
    <div className="space-y-4">
      <Section title="Cadastro reaproveitado" subtitle="Dados da corretora usados no credenciamento — confira; só corrija se necessário"
        actions={<Link to="/configuracoes" className="btn-ghost">Corrigir em Configurações</Link>}>
        <KV cols={3} items={[
          ['Razão social', co.name], ['CNPJ', co.document ? maskDoc(co.document) : 'Não informado'], ['Registro SUSEP', co.susep_code || 'Não informado'],
          ['Responsável técnico', co.tech_responsible_name || 'Não informado'], ['Contato', [co.email, co.phone].filter(Boolean).join(' · ') || 'Não informado'],
          ['Cidade/UF', co.city ? `${co.city}/${co.uf || ''}` : '—'], ['Unidade desta conexão', c.unit_name || 'Corretora (todas)'],
        ]} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Conferi os dados acima</label>
        </div>
        <Notice tone="info" className="mt-3">
          Para serviços de registro da SUSEP, siga o procedimento oficial. <b>A plataforma não solicita sua senha gov.br nem acessa em seu nome.</b> Registre aqui a certidão/evidência, a origem e a data da consulta.
        </Notice>
      </Section>

      <Section title="Checklist do caminho" subtitle="Itens condicionados a este fornecedor e caminho — nem todos são obrigatórios"
        actions={!readOnly && <>
          <button className="btn-outline" disabled={busy} onClick={prepare}><FileText className="h-4 w-4" /> Preparar solicitação de acesso</button>
        </>} bodyClass="p-0">
        {!c.requirements?.length ? <p className="p-4 text-sm text-ink-faint">Este caminho não tem requisitos cadastrados.</p> : (
          <ul className="divide-y divide-line">
            {c.requirements.map((r) => (
              <li key={r.code} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.label}</span>
                      <span className={cx('chip', r.required ? T.orange : T.gray)}>{r.required ? 'Obrigatório' : 'Opcional'}</span>
                      <StatusChip map={REQ_STATUS} value={r.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{r.why}</p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <div><dt className="inline text-ink-faint">Quem fornece: </dt><dd className="inline">{PROVIDED_BY[r.provided_by] || r.provided_by}</dd></div>
                      <div><dt className="inline text-ink-faint">Quem resolve: </dt><dd className="inline">{RESOLVED_BY[r.resolved_by] || r.resolved_by}</dd></div>
                      <div className="sm:col-span-2"><dt className="inline text-ink-faint">Bloqueia: </dt><dd className="inline">{r.blocks?.length ? r.blocks.map((b) => capLabel(b, caps)).join(', ') : 'nenhuma função'}</dd></div>
                      {r.protocol && <div><dt className="inline text-ink-faint">Protocolo: </dt><dd className="inline">{r.protocol}</dd></div>}
                      {r.valid_until && <div><dt className="inline text-ink-faint">Validade: </dt><dd className="inline">{fmt(r.valid_until)}</dd></div>}
                      {r.evidence_document_id && (
                        <div><dt className="inline text-ink-faint">Evidência: </dt><dd className="inline">
                          <button className="text-primary underline" onClick={() => download(`/v1/documents/${r.evidence_document_id}/download`, r.evidence_filename || 'evidencia').catch((e) => toast(e.message, 'error'))}>
                            {r.evidence_filename || 'baixar'}
                          </button></dd></div>
                      )}
                      {r.notes && <div className="sm:col-span-2"><dt className="inline text-ink-faint">Observações: </dt><dd className="inline">{r.notes}</dd></div>}
                      <div><dt className="inline text-ink-faint">Última atualização: </dt><dd className="inline">{fmtDateTime(r.updated_at)}</dd></div>
                    </dl>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {r.link && <a className="btn-outline" href={r.link} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" /> Abrir cadastro oficial</a>}
                    {!readOnly && <button className="btn-ghost" onClick={() => setEdit({ req: r, preset: { status: 'enviado' } })}>Registrar protocolo</button>}
                    {!readOnly && <button className="btn-outline" onClick={() => setEdit({ req: r, preset: {} })}>Atualizar situação</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {c.template?.sources?.length > 0 && (
        <Section title="Documentos necessários e fontes" subtitle="Requisitos vêm de documentação pública com data de verificação; confirme no contrato">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {c.template.sources.map((s) => <li key={s.ref}>[{s.ref}] {s.title} — verificado em {fmt(s.verified_at)}</li>)}
          </ul>
        </Section>
      )}

      {edit && <RequirementModal c={c} req={edit.req} preset={edit.preset} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      <Modal open={text !== null} onClose={() => setText(null)} size="lg" title="Solicitação de acesso (rascunho)"
        subtitle="Revise e envie você mesmo pelo canal oficial. Nada é enviado automaticamente."
        footer={<><button className="btn-ghost" onClick={() => setText(null)}>Fechar</button>
          <button className="btn-primary" onClick={() => { navigator.clipboard?.writeText(text || ''); toast('Texto copiado.'); }}><Copy className="h-4 w-4" /> Copiar texto</button></>}>
        <Notice tone="warn" className="mb-3">Não inclua senhas, tokens, Client Secret nem chave privada nesta mensagem.</Notice>
        <Textarea label="Texto" rows={14} value={text || ''} onChange={(e) => setText(e.target.value)} />
      </Modal>
    </div>
  );
}

function RequirementModal({ c, req, preset, onClose, onDone }) {
  const [run, busy] = useAction();
  const [v, setV] = useState({ status: preset.status || req.status, protocol: req.protocol || '', valid_until: req.valid_until ? String(req.valid_until).slice(0, 10) : '', notes: req.notes || '' });
  const [file, setFile] = useState(null);
  const hasEvidence = !!file || !!req.evidence_document_id || !!v.protocol.trim();
  const invalid = v.status === 'confirmado' && !hasEvidence;
  const submit = async () => {
    const r = await run(async () => {
      let docId;
      if (file) {
        const payload = await fileToPayload(file);
        const doc = await api.post('/v1/documents', { entity: 'provider_connection', entity_id: c.id, kind: 'evidencia', description: `Evidência: ${req.label}`, ...payload });
        docId = doc.id;
      }
      return api.put(`/v1/integrations/connections/${c.id}/requirements/${encodeURIComponent(req.code)}`, {
        status: v.status, protocol: v.protocol.trim() || null, evidence_document_id: docId || null, valid_until: v.valid_until || null, notes: v.notes.trim() || null,
      });
    }, 'Requisito atualizado.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title={req.label} subtitle="Situação, protocolo e evidência do requisito"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || invalid} onClick={submit}>Salvar</button></>}>
      <div className="space-y-3">
        <Select label="Situação" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
          {Object.entries(REQ_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </Select>
        <Input label="Protocolo" value={v.protocol} maxLength={120} onChange={(e) => setV({ ...v, protocol: e.target.value })} />
        <Input label="Válido até" type="date" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} />
        <div>
          <span className="label">Evidência (PDF, imagem)</span>
          <div className="flex flex-wrap items-center gap-2">
            <FileButton accept=".pdf,image/png,image/jpeg,image/webp" onFile={setFile}><Upload className="h-4 w-4" /> {file ? 'Trocar arquivo' : 'Anexar arquivo'}</FileButton>
            <span className="text-xs text-ink-faint">{file ? file.name : req.evidence_filename ? `Atual: ${req.evidence_filename}` : 'Nenhum arquivo'}</span>
          </div>
          <p className="mt-1 text-xs text-ink-faint">Arquivos com chave privada são segredos e não devem ser anexados como evidência.</p>
        </div>
        <Textarea label="Observações" value={v.notes} maxLength={1000} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        {invalid && <Notice tone="warn">Para marcar como confirmado, anexe a evidência ou informe o protocolo.</Notice>}
      </div>
    </Modal>
  );
}

// ---------------- Etapa 3 ----------------
const DONT_CONFUSE = [
  ['Código SUSEP', 'Registro/habilitação da corretora no órgão regulador.'],
  ['Código da corretora/produtor/sucursal', 'Identificação comercial dentro de cada seguradora ou parceiro.'],
  ['Login do portal', 'Conta de usuário em uma interface web. Não é pedido aqui.'],
  ['Client ID / Client Secret', 'Identificação e segredo de uma aplicação aprovada, quando esse protocolo é usado.'],
  ['Token de acesso', 'Credencial operacional com validade e escopo próprios — gerada no servidor.'],
  ['Certificado', 'Identidade técnica de conexão (ex.: mTLS), somente quando o conector exige.'],
];

function Step3({ c, reload, readOnly, onDone }) {
  const { user } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const t = c.template || {};
  const fields = t.fields || [];
  const active = (c.credentials || []).find((x) => !x.revoked_at);
  const [values, setValues] = useState({});
  const [owner, setOwner] = useState(active?.owner || 'corretora');
  const [expires, setExpires] = useState('');
  const [reauth, setReauth] = useState('');
  const [mfaMissing, setMfaMissing] = useState(false);
  const clear = () => { setValues({}); setReauth(''); };
  useEffect(() => clear, []); // limpa segredos ao sair da etapa

  if (!c.adapter_available) {
    const evaluate = async () => {
      const r = await run(() => api.post(`/v1/integrations/connections/${c.id}/request-evaluation`, {}));
      if (r === FAIL) return;
      toast(r.message || 'Pedido de avaliação registrado.');
      reload();
    };
    const saveAssisted = async () => {
      const r = await run(() => api.patch(`/v1/integrations/connections/${c.id}`, { version: c.version, step: Math.max(c.step || 1, 3) }),
        'Salvo para operação assistida: cotações desta empresa seguem em consulta assistida.', (e) => { if (e.code === 'VERSION_CONFLICT') reload(); return false; });
      if (r !== FAIL) reload();
    };
    return (
      <Section title="Credenciais e acesso">
        <Notice tone="warn">
          <b>{c.errors?.CONNECTOR_NOT_AVAILABLE?.[0] || 'Esta empresa ainda não possui integração automática disponível neste sistema.'}</b>
          <span className="block">Próximo passo: {c.errors?.CONNECTOR_NOT_AVAILABLE?.[1] || 'Usar consulta assistida ou solicitar avaliação'}.</span>
        </Notice>
        <p className="mt-3 text-sm text-ink-soft">
          Por isso nenhuma senha, token ou chave é pedida. A empresa continua utilizável: a equipe solicita cotações pelo canal oficial e registra a resposta formal com origem e validade.
        </p>
        {c.evaluation_requested_at && <p className="mt-2 text-sm">Avaliação de integração solicitada em {fmtDateTime(c.evaluation_requested_at)}.</p>}
        {!readOnly && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={saveAssisted}><Save className="h-4 w-4" /> Salvar para operação assistida</button>
            <button className="btn-outline" disabled={busy} onClick={evaluate}>Solicitar avaliação de integração</button>
          </div>
        )}
      </Section>
    );
  }

  const missing = fields.filter((f) => !String(values[f.key] || '').trim());
  const save = async () => {
    setMfaMissing(false);
    const body = { values, owner, expires_at: expires || null, ...(user?.mfa_enabled ? { mfa_code: reauth } : { password: reauth }) };
    const r = await run(() => api.put(`/v1/integrations/connections/${c.id}/credentials`, body), null, (e) => {
      if (e.code === 'MFA_REQUIRED') { setMfaMissing(true); return true; }
      if (e.code === 'REAUTH_REQUIRED') setReauth('');
      return false;
    });
    clear();
    if (r === FAIL) return;
    await reload();
    onDone?.();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <Section title="Credencial atual">
          {active ? (
            <KV cols={2} items={[
              ['Situação', <span key="s" className={cx('chip', T.green)}>Configurada · versão {active.version}</span>],
              ['Titular', OWNER_LABEL[active.owner] || active.owner],
              ['Identificação não secreta', Object.entries(active.public_info || {}).map(([k, val]) => `${fields.find((f) => f.key === k)?.label || k}: ${val}`).join(' · ') || '—'],
              ['Ambiente', ENV_LABEL[active.environment] || active.environment],
              ['Cadastrada em', fmtDateTime(active.created_at)],
              ['Validade', active.expires_at ? fmt(active.expires_at) : 'Não informada'],
            ]} />
          ) : <p className="text-sm text-ink-faint">Nenhuma credencial cadastrada.</p>}
          {(c.credentials || []).filter((x) => x.revoked_at).length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-primary">Versões anteriores</summary>
              <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                {c.credentials.filter((x) => x.revoked_at).map((x) => <li key={x.version}>Versão {x.version} · criada {fmt(x.created_at)} · revogada {fmt(x.revoked_at)}{x.revoked_reason ? ` (${x.revoked_reason})` : ''}</li>)}
              </ul>
            </details>
          )}
        </Section>

        <Section title={active ? 'Atualizar credenciais' : 'Cadastrar credenciais'} subtitle="Somente os campos exigidos por este conector">
          {readOnly ? <Notice tone="info">Seu perfil não administra credenciais desta conexão.</Notice> : !fields.length ? (
            <Notice tone="info">Este conector ainda não define campos de credencial. Siga a orientação do fornecedor.</Notice>
          ) : (
            <form className="space-y-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
              {!user?.mfa_enabled && (
                <Notice tone="info">Administrar credenciais exige verificação em duas etapas ativa. <Link to="/conta" className="underline">Ativar em Minha conta</Link>.</Notice>
              )}
              {mfaMissing && <Notice tone="danger">Ative a verificação em duas etapas para administrar credenciais. <Link to="/conta" className="underline">Ir para Minha conta</Link>.</Notice>}
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="block">
                    <span className="label">{f.label} <span className="font-mono text-[11px] font-normal text-ink-faint">({f.technical})</span></span>
                    <input className="input font-mono" type={f.secret ? 'password' : 'text'} autoComplete={f.secret ? 'new-password' : 'off'}
                      spellCheck={false} autoCapitalize="off" data-lpignore="true" data-1p-ignore="true" name={`apv-${f.key}`}
                      value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  </label>
                  <p className="mt-1 text-xs text-ink-faint">Onde obter: {f.where}{f.secret ? ' · campo secreto: não será exibido novamente' : ''}</p>
                </div>
              ))}
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="A quem pertence esta credencial" value={owner} onChange={(e) => setOwner(e.target.value)} hint={`Contrato: ${t.credential_owner || '—'}`}>
                  {Object.entries(OWNER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Input label="Validade (quando conhecida)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </div>
              {user?.mfa_enabled ? (
                <Input label="Código do autenticador (6 dígitos)" inputMode="numeric" autoComplete="one-time-code" value={reauth}
                  onChange={(e) => setReauth(e.target.value.replace(/\D/g, '').slice(0, 6))} hint="Confirmação de identidade para esta operação." />
              ) : (
                <Input label="Sua senha de acesso ao APOLVEN" type="password" autoComplete="current-password" value={reauth}
                  onChange={(e) => setReauth(e.target.value)} hint="Confirmação de identidade para esta operação." />
              )}
              <Notice tone="info">Ao salvar, a versão anterior é revogada e testes/funções voltam a pendente até um novo teste.</Notice>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={busy || missing.length > 0 || (user?.mfa_enabled ? reauth.length !== 6 : !reauth)}>
                  <ShieldCheck className="h-4 w-4" /> {active ? 'Atualizar credenciais' : 'Salvar credenciais'}
                </button>
              </div>
            </form>
          )}
        </Section>
      </div>
      <Section title="Dados que não se confundem" className="h-fit">
        <dl className="space-y-2 text-sm">
          {DONT_CONFUSE.map(([k, v]) => <div key={k}><dt className="font-medium">{k}</dt><dd className="text-ink-soft">{v}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-ink-faint">Credenciais são enviadas somente ao servidor, guardadas de forma protegida e nunca exibidas de volta, exportadas ou incluídas em pedidos de suporte.</p>
      </Section>
    </div>
  );
}

// ---------------- Etapa 4 ----------------
function resultRows(c, test) {
  const res = test?.results || {};
  const capsTpl = (c.template?.capabilities || []).map((x) => x.code);
  const capRes = (code) => (capsTpl.includes(code) ? res.capacidades?.[code] || 'nao_verificada' : 'na');
  const hasCert = (c.template?.fields || []).some((f) => /mtls|certificad/i.test(`${f.technical} ${f.label}`));
  const multi = (codes) => codes.filter((k) => capsTpl.includes(k));
  return [
    ['Cadastro e evidências', <StatusChip key="a" map={R_CADASTRO} value={res.cadastro} />, 'Bloqueia funções que dependem de requisito pendente'],
    ['Autenticação', <StatusChip key="b" map={R_AUTH} value={res.autenticacao} />, 'Acesso técnico — não presume autorização comercial'],
    ['Vínculo da corretora', <StatusChip key="c" map={R_VINCULO} value={res.vinculo} />, 'Divergência impede ativação'],
    ['Ambiente', <StatusChip key="d" map={ENV_CHIP} value={res.ambiente || test?.environment} />, 'Teste em sandbox não libera produção'],
    ['Cotação', <StatusChip key="e" map={R_CAP} value={capRes('cotacao')} />, 'Ativar apenas com validação adequada'],
    ['Proposta/emissão', (
      <span key="f" className="flex flex-wrap gap-1">{multi(['transmissao', 'proposta_status']).length
        ? multi(['transmissao', 'proposta_status']).map((k) => <span key={k} className={cx('chip', R_CAP[capRes(k)]?.cls)}>{capLabel(k)}: {R_CAP[capRes(k)]?.label}</span>)
        : <StatusChip map={R_CAP} value="na" />}</span>
    ), 'Independente da cotação'],
    ['Parcelas/documentos/extratos', (
      <span key="g" className="flex flex-wrap gap-1">{multi(['parcelas', 'documentos', 'extratos', 'endosso_sinistro']).length
        ? multi(['parcelas', 'documentos', 'extratos', 'endosso_sinistro']).map((k) => <span key={k} className={cx('chip', R_CAP[capRes(k)]?.cls)}>{capLabel(k)}: {R_CAP[capRes(k)]?.label}</span>)
        : <StatusChip map={R_CAP} value="na" />}</span>
    ), 'Ativar sincronização por capacidade'],
    ['Certificado', hasCert ? <span key="h" className={cx('chip', T.amber)}>Não verificado automaticamente</span> : <span key="h" className={cx('chip', T.gray)}>Não aplicável</span>, 'Conforme requisito deste conector'],
  ];
}

function summarySentence(c, test) {
  const res = test?.results || {};
  if (res.autenticacao !== 'valida') return null;
  const parts = ['Acesso autenticado.'];
  const cot = res.capacidades?.cotacao;
  if (cot === 'autorizada') parts.push('Cotação autorizada para este acesso.');
  else if (cot === 'nao_autorizada') parts.push('Cotação não autorizada para este acesso.');
  else if (cot) parts.push('Cotação não verificada automaticamente.');
  const tr = res.capacidades?.transmissao;
  if (tr && tr !== 'autorizada') parts.push('Transmissão ainda depende da liberação do fornecedor.');
  if ((res.ambiente || test.environment) === 'testes') parts.push('Validado somente no ambiente de testes.');
  return parts.join(' ');
}

function Step4({ c, readOnly, onTest, busy }) {
  const { toast } = useUI();
  const last = c.tests?.[0];
  const msg = last?.code ? c.errors?.[last.code] : null;
  const sentence = last && summarySentence(c, last);
  return (
    <div className="space-y-4">
      <Notice tone="info">
        <b>O teste executa somente verificações seguras.</b> Ele não transmite proposta, não cobra, não cancela, não abre sinistro e não gera pagamento.
      </Notice>
      <Section title="Resultado do último teste"
        actions={!readOnly && <button className="btn-primary" disabled={busy} onClick={onTest}>{busy ? <Spinner className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />} Testar conexão</button>}>
        {!last ? (
          <p className="text-sm text-ink-faint">{c.adapter_available ? 'Nenhum teste executado. Cadastre a credencial (etapa 3) e teste a conexão.' : 'Sem conector automático: não há conexão técnica a testar. A empresa segue em operação assistida.'}</p>
        ) : (
          <div className="space-y-3">
            {sentence && <Notice tone="ok">{sentence}</Notice>}
            {msg && <Notice tone={last.status === 'erro' ? 'danger' : 'warn'}><b>{msg[0]}</b> <span className="block">Próximo passo: {msg[1]}.</span></Notice>}
            <div className="overflow-x-auto rounded-app-sm border border-line">
              <table className="table-clean">
                <thead><tr><th>Verificação</th><th>Resultado</th><th>Efeito</th></tr></thead>
                <tbody>
                  {resultRows(c, last).map(([k, v, eff]) => (
                    <tr key={k}><td data-label="Verificação" className="font-medium">{k}</td><td data-label="Resultado">{v}</td><td data-label="Efeito" className="text-xs text-ink-soft">{eff}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {last.results?.limitacoes?.length > 0 && (
              <div className="text-sm"><b>Limitações informadas:</b>
                <ul className="mt-1 list-disc pl-5 text-ink-soft">{last.results.limitacoes.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            <KV cols={4} items={[
              ['Executado em', fmtDateTime(last.created_at)], ['Duração', last.duration_ms != null ? `${last.duration_ms} ms` : '—'],
              ['Situação', last.status === 'erro' ? 'Com erro' : 'Concluído'],
              ['Correlação (para suporte)', (
                <button key="cid" className="inline-flex items-center gap-1 font-mono text-xs text-primary" title="Copiar"
                  onClick={() => { navigator.clipboard?.writeText(last.correlation_id); toast('Código de correlação copiado.'); }}>
                  {last.correlation_id?.slice(0, 13)}… <Copy className="h-3 w-3" />
                </button>
              )],
            ]} />
          </div>
        )}
      </Section>
      {c.tests?.length > 1 && (
        <Section title="Testes anteriores" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Data</th><th>Ambiente</th><th>Autenticação</th><th>Vínculo</th><th>Código</th><th>Correlação</th></tr></thead>
              <tbody>
                {c.tests.slice(1).map((x) => (
                  <tr key={x.id || x.correlation_id}>
                    <td data-label="Data" className="whitespace-nowrap">{fmtDateTime(x.created_at)}</td>
                    <td data-label="Ambiente">{ENV_LABEL[x.environment] || x.environment}</td>
                    <td data-label="Autenticação"><StatusChip map={R_AUTH} value={x.results?.autenticacao} /></td>
                    <td data-label="Vínculo"><StatusChip map={R_VINCULO} value={x.results?.vinculo} /></td>
                    <td data-label="Código" className="text-xs">{x.code ? c.errors?.[x.code]?.[0] || x.code : '—'}</td>
                    <td data-label="Correlação" className="font-mono text-[11px]">{x.correlation_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

// ---------------- Etapa 5 ----------------
function Step5({ c, reload, readOnly }) {
  const [run, busy] = useAction();
  const caps = c.capability_list || [];
  const initial = useMemo(() => Object.fromEntries(caps.map((x) => [x.capability, x.state === 'ativa'])), [c]); // eslint-disable-line
  const [on, setOn] = useState(initial);
  useEffect(() => setOn(initial), [initial]);
  const [result, setResult] = useState(null);
  const [evidenceFor, setEvidenceFor] = useState(null);
  const pending = (c.requirements || []).filter((r) => r.required && r.status !== 'confirmado');
  const canToggle = (x) => !readOnly && c.adapter_available && !c.paused && ['validada', 'ativa'].includes(x.state);
  const testes = c.environment === 'testes';

  const changed = caps.filter((x) => !!on[x.capability] !== !!initial[x.capability]);
  const save = async () => {
    const activate = caps.filter((x) => on[x.capability] && !initial[x.capability]).map((x) => x.capability);
    const deactivate = caps.filter((x) => !on[x.capability] && initial[x.capability]).map((x) => x.capability);
    // a rota exige ao menos uma capacidade em `capabilities`; quando só há desativação, repete-se a mesma
    // capacidade (ativar e em seguida desativar resulta em desativada)
    const body = { capabilities: activate.length ? activate : deactivate, ...(deactivate.length ? { deactivate } : {}) };
    const r = await run(() => api.post(`/v1/integrations/connections/${c.id}/capabilities/activate`, body));
    if (r === FAIL) return;
    setResult(r);
    reload();
  };

  return (
    <div className="space-y-4">
      <Section title="Resumo da configuração">
        <KV cols={3} items={[
          ['Empresa e caminho', `${c.institution_name} · ${c.template?.name || ''}`],
          ['Unidade / credenciamento', `${c.unit_name || 'Corretora'} · ${ACCREDITATION[c.accreditation] || c.accreditation} · comercial: ${COMMERCIAL_STATE[c.commercial_state]?.label || c.commercial_state}`],
          ['Ambiente e produtos', `${ENV_LABEL[c.environment]} · ${branchList(c.products)}`],
          ['Pendências obrigatórias', pending.length ? pending.map((r) => r.label).join('; ') : 'Nenhuma'],
          ['Capacidades validadas', caps.filter((x) => ['validada', 'ativa'].includes(x.state)).map((x) => x.label).join(', ') || 'Nenhuma'],
          ['Sincronização', 'Calculada conforme capacidade e contrato; sem promessa de sincronização contínua quando só houver arquivo periódico.'],
        ]} />
      </Section>
      {testes && <Notice tone="warn">Esta conexão está no ambiente de <b>testes</b>. Funções validadas aqui valem somente para testes: nada aparece como ativo em produção e nenhuma cotação real usa esta conexão.</Notice>}
      {!c.adapter_available && <Notice tone="info">Sem conector automático: não há funções automáticas a ativar. As operações com esta empresa seguem em modo assistido.</Notice>}
      {c.paused && <Notice tone="warn">Integração pausada: retome-a para ativar funções.</Notice>}

      <Section title="Funções por capacidade" subtitle="A preferência da tela não autoriza nada: o servidor confere os mesmos requisitos ao ativar">
        {!caps.length ? <p className="text-sm text-ink-faint">Nenhuma capacidade prevista para este caminho.</p> : (
          <ul className="divide-y divide-line">
            {caps.map((x) => {
              const enabled = canToggle(x);
              return (
                <li key={x.capability} className="py-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {enabled ? (
                        <Toggle checked={!!on[x.capability]} onChange={(val) => setOn({ ...on, [x.capability]: val })} label={x.label}
                          hint={x.environment === 'testes' ? 'Validada somente no ambiente de testes' : x.reason || undefined} />
                      ) : (
                        <div className="py-1">
                          <div className="flex items-center gap-3">
                            <button type="button" role="switch" aria-checked={x.state === 'ativa'} disabled aria-label={x.label}
                              className={cx('relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full opacity-50', x.state === 'ativa' ? 'bg-primary' : 'bg-line')}>
                              <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', x.state === 'ativa' ? 'left-[22px]' : 'left-0.5')} />
                            </button>
                            <span className="text-sm font-medium">{x.label}</span>
                          </div>
                          <p className="mt-1 text-xs text-ink-faint">
                            <AlertTriangle className="mr-1 inline h-3 w-3" />
                            {c.paused ? 'Integração pausada.' : x.reason || (x.state === 'pendente' ? 'Aguardando teste e validação.' : CAPABILITY_STATE[x.state]?.label)}
                          </p>
                        </div>
                      )}
                      {x.evidence && <p className="mt-1 text-xs text-ink-soft">Evidência: {x.evidence}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <StatusChip map={CAPABILITY_STATE} value={x.state} />
                      <span className="chip bg-muted text-ink-soft">{ENV_LABEL[x.environment] || x.environment}</span>
                      {!readOnly && c.adapter_available && x.state === 'pendente' && (
                        <button className="btn-ghost text-xs" onClick={() => setEvidenceFor(x)} title="Não verificado automaticamente">
                          <ShieldAlert className="h-4 w-4" /> Registrar evidência
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!readOnly && c.adapter_available && caps.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={busy || !changed.length} onClick={save}><CheckCircle2 className="h-4 w-4" /> Salvar e ativar funções liberadas</button>
          </div>
        )}
      </Section>

      {result && (
        <Section title="Resultado da ativação">
          <ul className="space-y-2 text-sm">
            {Object.entries(result).map(([cap, x]) => (
              <li key={cap} className="flex flex-wrap items-start gap-2">
                <span className={cx('chip', x.ok ? (x.deactivated ? T.gray : T.green) : T.red)}>{x.ok ? (x.deactivated ? 'Desativada' : 'Ativada') : 'Não ativada'}</span>
                <span className="font-medium">{capLabel(cap, caps)}</span>
                {x.note && <span className="text-ink-soft">— {x.note}</span>}
                {!x.ok && <ul className="w-full list-disc pl-6 text-xs text-ink-soft">{(x.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {evidenceFor && <CapabilityEvidenceModal c={c} cap={evidenceFor} onClose={() => setEvidenceFor(null)} onDone={() => { setEvidenceFor(null); reload(); }} />}
    </div>
  );
}

function CapabilityEvidenceModal({ c, cap, onClose, onDone }) {
  const [run, busy] = useAction();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const submit = async () => {
    const r = await run(async () => {
      let docId = null;
      if (file) {
        const doc = await api.post('/v1/documents', { entity: 'provider_connection', entity_id: c.id, kind: 'evidencia', description: `Aprovação: ${cap.label}`, ...(await fileToPayload(file)) });
        docId = doc.id;
      }
      return api.post(`/v1/integrations/connections/${c.id}/capabilities/${encodeURIComponent(cap.capability)}/evidence`, { evidence: text.trim(), evidence_document_id: docId });
    }, 'Capacidade validada por evidência formal.');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Evidência — ${cap.label}`} subtitle="Não verificado automaticamente: registre a aprovação formal do fornecedor"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || text.trim().length < 5} onClick={submit}>Registrar evidência</button></>}>
      <div className="space-y-3">
        <Notice tone="info">Use quando o fornecedor confirmou a liberação desta operação por e-mail, contrato ou portal, mas a API não informa capacidades. Exige teste de conexão bem-sucedido.</Notice>
        <Textarea label="Descrição da evidência *" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ex.: e-mail do gerente comercial de 01/10 liberando cotação de auto" />
        <div className="flex flex-wrap items-center gap-2">
          <FileButton accept=".pdf,image/png,image/jpeg,image/webp" onFile={setFile}><Upload className="h-4 w-4" /> {file ? 'Trocar arquivo' : 'Anexar comprovante'}</FileButton>
          <span className="text-xs text-ink-faint">{file?.name || 'Opcional'}</span>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Revogação ----------------
function RevokeModal({ open, c, onClose, onDone }) {
  const { user } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [reauth, setReauth] = useState('');
  useEffect(() => { if (open) { setReason(''); setTyped(''); setReauth(''); } }, [open]);
  const ok = reason.trim().length >= 3 && typed.trim().toUpperCase() === 'REVOGAR' && (user?.mfa_enabled ? reauth.length === 6 : !!reauth);
  const submit = async () => {
    const r = await run(() => api.post(`/v1/integrations/connections/${c.id}/revoke`, { reason: reason.trim(), ...(user?.mfa_enabled ? { mfa_code: reauth } : { password: reauth }) }),
      null, (e) => { if (e.code === 'REAUTH_REQUIRED') setReauth(''); return false; });
    setReauth('');
    if (r === FAIL) return;
    toast(r.message || 'Integração revogada.');
    onDone();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Revogar integração — ${c.institution_name}`} subtitle="Ação definitiva para esta conexão"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn-danger" disabled={!ok || busy} onClick={submit}><Ban className="h-4 w-4" /> Revogar integração</button></>}>
      <div className="space-y-3">
        <Notice tone="danger">
          Revogar invalida as credenciais guardadas aqui, bloqueia todas as funções e impede tarefas ainda não iniciadas.
          <b> Apólices, documentos e histórico são preservados.</b> Se o fornecedor não permitir revogação remota, conclua a revogação no portal dele.
        </Notice>
        <Textarea label="Motivo *" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        <Input label='Digite "REVOGAR" para confirmar' value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        {user?.mfa_enabled ? (
          <Input label="Código do autenticador (6 dígitos)" inputMode="numeric" autoComplete="one-time-code" value={reauth}
            onChange={(e) => setReauth(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        ) : (
          <Input label="Sua senha de acesso ao APOLVEN" type="password" autoComplete="current-password" value={reauth} onChange={(e) => setReauth(e.target.value)} />
        )}
      </div>
    </Modal>
  );
}
