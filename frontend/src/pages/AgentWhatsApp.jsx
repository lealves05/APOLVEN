// Agente do WhatsApp Business: conexão com a API oficial (Meta), avisos automáticos aos clientes, lembretes da
// equipe, conversas (atendimento humano), simulador e modelos para aprovar na Meta.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MessageCircle, PlugZap, Send, History, Copy, RefreshCw, Play, Eye, ShieldCheck, Hand, Undo2, XCircle, Trash2, Smartphone, Clock, Info,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Section, Tabs, Modal, PromptModal, Input, Select, Toggle, StatusChip, Notice, Empty, Loading, Spinner, useFetch, useAction, FAIL, cx } from '../components/ui';
import { fmtDateTime, ago } from '../lib/format';
import { ClientPicker } from './Clients';

const C = {
  gray: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300', blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  red: 'bg-red-500/10 text-red-700 dark:text-red-300', violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
};
const CONN = {
  nao_configurado: { label: 'Não configurado', cls: C.gray }, configurado: { label: 'Credenciais salvas — teste pendente', cls: C.amber },
  verificado: { label: 'Webhook verificado — teste pendente', cls: C.blue }, conectado: { label: 'Conectado', cls: C.green }, erro: { label: 'Erro na conexão', cls: C.red },
};
const CONV = { agente: { label: 'Assistente', cls: C.violet }, humano: { label: 'Com a equipe', cls: C.amber }, encerrada: { label: 'Encerrada', cls: C.gray } };
const MSG = { recebida: 'recebida', enviada: 'enviada', entregue: 'entregue', lida: 'lida', falhou: 'falhou', simulada: 'simulada' };
const ROUTINE_LABEL = { manual: 'Resposta da equipe', autoatendimento: 'Assistente', equipe: 'Lembretes da equipe', parcela_a_vencer: 'Parcela a vencer',
  parcela_vencida: 'Parcela vencida', renovacao: 'Renovação', cotacao_vencendo: 'Cotação perto de vencer', aniversario: 'Aniversário' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const TABS_ALL = [
  { value: 'visao', label: 'Conexão', manage: true },
  { value: 'rotinas', label: 'Avisos aos clientes', manage: true },
  { value: 'equipe', label: 'Lembretes da equipe', manage: true },
  { value: 'conversas', label: 'Conversas' },
  { value: 'simulador', label: 'Testar o assistente' },
  { value: 'modelos', label: 'Modelos da Meta', manage: true },
  { value: 'historico', label: 'Histórico', manage: true },
];

export default function AgentWhatsApp() {
  const { can } = useAuth();
  const manage = can('agent_manage');
  const [params, setParams] = useSearchParams();
  const tabs = TABS_ALL.filter((t) => !t.manage || manage);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  const { data, setData, loading, reload } = useFetch(() => api.get('/v1/agent'), []);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <>
      <PageHeader title="Agente do WhatsApp"
        subtitle="Avisos automáticos aos clientes, lembretes da equipe e atendimento pelo WhatsApp Business (API oficial da Meta)."
        actions={<StatusBadge a={data} />} />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'visao' && <Connection a={data} setA={setData} reload={reload} />}
      {tab === 'rotinas' && <Routines a={data} setA={setData} />}
      {tab === 'equipe' && <Team a={data} setA={setData} />}
      {tab === 'conversas' && <Conversations a={data} />}
      {tab === 'simulador' && <Simulator a={data} />}
      {tab === 'modelos' && <Templates a={data} />}
      {tab === 'historico' && <Runs />}
    </>
  );
}

function StatusBadge({ a }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip map={CONN} value={a.connection_status} />
      <span className={cx('chip', a.enabled ? C.green : C.gray)}>{a.enabled ? 'Envios ligados' : 'Envios desligados'}</span>
    </div>
  );
}

/** Salva configuração (com controle de versão). */
function useSave(a, setA) {
  const [run, busy] = useAction();
  const save = async (patch, msg = 'Configuração salva.') => {
    const r = await run(() => api.put('/v1/agent/settings', { version: a.version, ...patch }), msg);
    if (r !== FAIL) setA((x) => ({ ...x, ...r }));
    return r;
  };
  return [save, busy];
}

// ---------------- Conexão ----------------
function Connection({ a, setA }) {
  const { user } = useAuth();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [save, saving] = useSave(a, setA);
  const [f, setF] = useState({ phone_number_id: a.phone_number_id || '', waba_id: a.waba_id || '', access_token: '', app_secret: '' });
  const [reauthOpen, setReauthOpen] = useState(false);
  const webhook = `${window.location.origin}${a.webhook_path}`;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copiado.')).catch(() => {});
  const doSave = async (values) => {
    const body = { ...f, ...(values ? (user?.mfa_enabled ? { mfa_code: values.code } : { password: values.code }) : {}) };
    const r = await run(() => api.put('/v1/agent/connection', body), 'Conexão salva. Agora teste a conexão.');
    if (r !== FAIL) { setA((x) => ({ ...x, ...r })); setF((x) => ({ ...x, access_token: '', app_secret: '' })); setReauthOpen(false); }
  };
  const submit = () => ((f.access_token || f.app_secret) && !a.is_demo ? setReauthOpen(true) : doSave(null));
  const test = async () => {
    const r = await run(() => api.post('/v1/agent/connection/test', {}));
    if (r !== FAIL) { setA((x) => ({ ...x, ...r.agent })); toast(r.ok ? `Conectado: ${r.display_phone_number || ''} ${r.verified_name ? `(${r.verified_name})` : ''}` : `Falhou: ${r.error}`, r.ok ? 'success' : 'error'); }
  };
  const toggle = async (enabled) => {
    if (enabled && !(await confirm({ title: 'Ligar os envios reais?', message: 'O assistente passa a responder as mensagens recebidas e as rotinas ligadas enviam avisos aos clientes que autorizaram, nos horários configurados.', confirmText: 'Ligar' }))) return;
    await save({ enabled }, enabled ? 'Agente ligado.' : 'Agente desligado.');
  };
  const steps = [
    ['Conta no WhatsApp Business Platform', 'No Meta Business (business.facebook.com), crie um app do tipo "Empresa" com o produto WhatsApp e adicione o número da corretora (não pode estar em uso no aplicativo comum do WhatsApp).'],
    ['Token permanente', 'Em Configurações do negócio › Usuários do sistema, crie um usuário do sistema com acesso ao app e gere um token com as permissões whatsapp_business_messaging e whatsapp_business_management.'],
    ['Dados do número e segredo do app', 'Copie o "ID do número de telefone" (Configuração da API) e o "Chave secreta do app" (Configurações do app › Básico) e informe aqui.'],
    ['Webhook', 'No app, em WhatsApp › Configuração, informe a URL de retorno e o token de verificação abaixo e assine o campo "messages".'],
    ['Modelos', 'Cadastre os modelos sugeridos na aba "Modelos da Meta" e aguarde a aprovação. Sem modelo aprovado, os avisos automáticos não são enviados.'],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        {a.is_demo && <Notice tone="warn">Demonstração: não há conexão real com o WhatsApp. Use <Link className="font-medium underline" to="?tab=simulador">Testar o assistente</Link> para ver as respostas e a aba Avisos aos clientes para a prévia dos destinatários.</Notice>}
        <Section title="Número do WhatsApp Business" subtitle="API oficial (Cloud API da Meta). As credenciais ficam cifradas e nunca voltam para a tela.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="ID do número de telefone *" inputMode="numeric" value={f.phone_number_id} onChange={(e) => setF({ ...f, phone_number_id: e.target.value.replace(/\D/g, '') })} />
            <Input label="ID da conta do WhatsApp Business (WABA)" inputMode="numeric" value={f.waba_id} onChange={(e) => setF({ ...f, waba_id: e.target.value.replace(/\D/g, '') })} />
            <Input label="Token de acesso permanente" type="password" autoComplete="off" placeholder={a.has_access_token ? `salvo (${a.access_token_hint}) — deixe em branco para manter` : 'EAAG…'}
              value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value })} />
            <Input label="Chave secreta do app" type="password" autoComplete="off" placeholder={a.has_app_secret ? 'salva — deixe em branco para manter' : 'usada para conferir as mensagens recebidas'}
              value={f.app_secret} onChange={(e) => setF({ ...f, app_secret: e.target.value })} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !f.phone_number_id} onClick={submit}><ShieldCheck className="h-4 w-4" />Salvar conexão</button>
            <button className="btn-outline" disabled={busy || !a.ready} onClick={test}>{busy ? <Spinner className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}Testar conexão</button>
            {a.ready && <button className="btn-ghost text-red-600" disabled={busy} onClick={async () => {
              if (!(await confirm({ title: 'Desconectar o WhatsApp?', message: 'As credenciais são apagadas e os envios param. O histórico de conversas é mantido.', confirmText: 'Desconectar', danger: true }))) return;
              const r = await run(() => api.post('/v1/agent/connection/disconnect', {}), 'WhatsApp desconectado.');
              if (r !== FAIL) setA((x) => ({ ...x, ...r }));
            }}><XCircle className="h-4 w-4" />Desconectar</button>}
          </div>
          {a.display_phone && <p className="mt-3 text-sm text-ink-soft"><Smartphone className="mr-1 inline h-4 w-4" />{a.display_phone}{a.verified_name ? ` · ${a.verified_name}` : ''}{a.quality_rating ? ` · qualidade ${a.quality_rating}` : ''}{a.connection_checked_at ? ` · testado ${ago(a.connection_checked_at)}` : ''}</p>}
          {a.last_error && <Notice tone="danger" className="mt-3">Último erro do WhatsApp: {a.last_error}</Notice>}
        </Section>
        <Section title="Webhook (mensagens recebidas)" subtitle="Informe estes dados no app da Meta, em WhatsApp › Configuração.">
          <div className="space-y-3 text-sm">
            <CopyRow label="URL de retorno" value={webhook} onCopy={copy} />
            <CopyRow label="Token de verificação" value={a.verify_token || '—'} onCopy={copy} />
            <p className="text-ink-soft">Assine o campo <b>messages</b>. {a.webhook_verified_at ? <span className="text-emerald-700 dark:text-emerald-300">Verificado {ago(a.webhook_verified_at)}.</span> : 'Ainda não verificado pela Meta.'}
              {a.last_webhook_at ? ` Última notificação ${ago(a.last_webhook_at)}.` : ''}</p>
          </div>
        </Section>
        <Section title="Funcionamento">
          <Toggle checked={a.enabled} onChange={toggle} label="Envios reais ligados"
            hint={a.enabled ? 'O assistente responde e as rotinas ligadas enviam avisos.' : 'Desligado: nada é enviado; as mensagens recebidas ficam registradas.'} />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Input label="Nome do assistente" defaultValue={a.name} onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && save({ name: e.target.value.trim() })} />
            <Toggle checked={a.settings.autoReply} onChange={(v) => save({ settings: { autoReply: v } })} label="Responder automaticamente"
              hint="Menu de autoatendimento: apólices, parcelas, sinistro, cotação e falar com um corretor." />
          </div>
          {saving && <Spinner className="mt-2 h-4 w-4" />}
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Resumo">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Num label="Clientes que autorizaram avisos" value={a.stats.consented} />
            <Num label="Conversas aguardando a equipe" value={a.stats.waiting} to="?tab=conversas" />
            <Num label="Mensagens enviadas (30 dias)" value={a.stats.sent_30d} />
            <Num label="Pediram para sair" value={a.stats.opted_out} />
          </dl>
        </Section>
        <Section title="Como conectar">
          <ol className="space-y-3 text-sm">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                <div><p className="font-medium">{t}</p><p className="text-ink-soft">{d}</p></div></li>
            ))}
          </ol>
          <Notice className="mt-3">Mensagens iniciadas pela corretora (avisos e lembretes) só saem com <b>modelo aprovado</b> pela Meta e para quem autorizou. Respostas livres só dentro de 24 h da última mensagem do cliente.</Notice>
        </Section>
      </div>
      <PromptModal open={reauthOpen} title="Confirme sua identidade" subtitle="Trocar credenciais do WhatsApp exige confirmação."
        fields={[{ key: 'code', label: user?.mfa_enabled ? 'Código do aplicativo autenticador' : 'Sua senha', required: true, type: user?.mfa_enabled ? 'text' : 'password' }]}
        confirmText="Salvar conexão" onClose={() => setReauthOpen(false)} onSubmit={(v) => doSave(v)} />
    </div>
  );
}
const CopyRow = ({ label, value, onCopy }) => (
  <div><span className="label">{label}</span>
    <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-app-sm border border-line bg-muted px-3 py-2 text-xs">{value}</code>
      <button className="btn-outline h-9 px-2.5" onClick={() => onCopy(value)} aria-label={`Copiar ${label}`}><Copy className="h-4 w-4" /></button></div></div>
);
const Num = ({ label, value, to }) => {
  const body = <><dt className="text-xs text-ink-faint">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value ?? 0}</dd></>;
  return to ? <Link to={to} className="rounded-app-sm border border-line p-3 hover:bg-muted">{body}</Link> : <div className="rounded-app-sm border border-line p-3">{body}</div>;
};

// ---------------- Avisos aos clientes ----------------
function Routines({ a, setA }) {
  const [save] = useSave(a, setA);
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [preview, setPreview] = useState(null);
  const s = a.settings;
  const setRoutine = (key, patch) => save({ settings: { routines: { [key]: patch } } });
  const openPreview = async (r) => {
    const list = await run(() => api.get(`/v1/agent/routines/${r.key}/preview`));
    if (list !== FAIL) setPreview({ r, list });
  };
  const runNow = async (r) => {
    if (!(await confirm({ title: `Enviar agora: ${r.label}?`, message: 'Os avisos de hoje desta rotina serão enviados agora (respeitando consentimento, horário permitido e quem já recebeu).', confirmText: 'Enviar agora' }))) return;
    const out = await run(() => api.post(`/v1/agent/routines/${r.key}/run`, {}));
    if (out !== FAIL) setPreview({ r, result: out });
  };
  return (
    <div className="space-y-4">
      <Notice>Os avisos só vão para clientes com a autorização <b>"Avisos automáticos por WhatsApp"</b> registrada na ficha (aniversário exige autorização de marketing). Quem responde <b>SAIR</b> deixa de receber. Ninguém recebe o mesmo aviso duas vezes.</Notice>
      <Section title="Horários" subtitle="As rotinas rodam de hora em hora e enviam a partir do horário escolhido, no fuso da corretora.">
        <div className="grid gap-4 sm:grid-cols-4">
          <Select label="Enviar a partir de" value={s.sendHour} onChange={(e) => save({ settings: { sendHour: Number(e.target.value) } })}>{HOURS.map((h) => <option key={h} value={h}>{h}h</option>)}</Select>
          <Select label="Nunca antes de" value={s.windowStart} onChange={(e) => save({ settings: { windowStart: Number(e.target.value) } })}>{HOURS.map((h) => <option key={h} value={h}>{h}h</option>)}</Select>
          <Select label="Nunca depois de" value={s.windowEnd} onChange={(e) => save({ settings: { windowEnd: Number(e.target.value) } })}>{[...HOURS.slice(1), 24].map((h) => <option key={h} value={h}>{h}h</option>)}</Select>
          <Input label="Máximo por rotina e execução" type="number" min={1} max={1000} defaultValue={s.maxPerRun} onBlur={(e) => Number(e.target.value) !== s.maxPerRun && save({ settings: { maxPerRun: Math.max(1, Math.min(1000, Number(e.target.value) || 150)) } })} />
        </div>
        <div className="mt-2"><Toggle checked={s.weekends} onChange={(v) => save({ settings: { weekends: v } })} label="Enviar também aos sábados e domingos" /></div>
      </Section>
      <div className="grid gap-4 xl:grid-cols-2">
        {a.routines.map((r) => <RoutineCard key={r.key} r={r} cfg={s.routines[r.key]} onSave={(p) => setRoutine(r.key, p)} onPreview={() => openPreview(r)} onRun={() => runNow(r)} busy={busy} canSend={a.can_send} />)}
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} size="lg" title={preview?.result ? `Resultado — ${preview?.r.label}` : `Prévia de hoje — ${preview?.r.label}`}
        subtitle={preview?.result ? null : 'Quem receberia hoje (nada foi enviado).'} footer={<button className="btn-primary" onClick={() => setPreview(null)}>Fechar</button>}>
        {preview?.result ? (
          <div className="space-y-2 text-sm">
            <p><b>{preview.result.sent}</b> enviada(s) · <b>{preview.result.failed}</b> falha(s) · <b>{preview.result.skipped}</b> ignorada(s)</p>
            {preview.result.note && <Notice tone="warn">{preview.result.note}</Notice>}
            <ul className="space-y-1">{(preview.result.details || []).map((d, i) => <li key={i} className={d.ok ? '' : 'text-red-600'}>{d.ok ? '✓' : '✗'} {d.name}{d.error ? ` — ${d.error}` : ''}</li>)}</ul>
          </div>
        ) : !preview?.list?.length ? <Empty icon={Eye} title="Ninguém para hoje" text="Nenhum cliente autorizado se enquadra nesta rotina hoje." /> : (
          <ul className="space-y-3">
            {preview.list.map((t, i) => (
              <li key={i} className="rounded-app-sm border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{t.name}</span><span className="text-xs text-ink-faint">{t.phone} · marco {t.milestone}</span></div>
                {t.skip ? <p className="mt-1 text-amber-700 dark:text-amber-300">Não envia: {t.skip}</p> : <p className="mt-1 whitespace-pre-wrap text-ink-soft">{t.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function RoutineCard({ r, cfg, onSave, onPreview, onRun, busy, canSend }) {
  const [days, setDays] = useState((cfg.days || []).join(', '));
  const [template, setTemplate] = useState(cfg.template || '');
  useEffect(() => { setDays((cfg.days || []).join(', ')); setTemplate(cfg.template || ''); }, [cfg.days, cfg.template]);
  const dayLabel = { parcela_a_vencer: 'Dias antes do vencimento', parcela_vencida: 'Dias depois do vencimento', renovacao: 'Dias antes do fim da vigência', cotacao_vencendo: 'Dias antes de a cotação vencer' }[r.key];
  const parseDays = (t) => [...new Set(String(t).split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 120))].slice(0, 6);
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-semibold">{r.label}</h3><p className="mt-0.5 text-sm text-ink-soft">{r.help}</p></div>
        <Toggle checked={!!cfg.enabled} onChange={(v) => onSave({ enabled: v })} label="" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {dayLabel && <Input label={dayLabel} hint="Separe por vírgula (ex.: 30, 15)" value={days} onChange={(e) => setDays(e.target.value)}
          onBlur={() => { const d = parseDays(days); if (d.join() !== (cfg.days || []).join()) onSave({ days: d }); }} />}
        <Input label="Nome do modelo aprovado na Meta" value={template} placeholder="ex.: apolven_renovacao" onChange={(e) => setTemplate(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          onBlur={() => template !== (cfg.template || '') && onSave({ template })} />
      </div>
      <p className="mt-3 rounded-app-sm bg-muted p-3 text-xs text-ink-soft">{r.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-outline" disabled={busy} onClick={onPreview}><Eye className="h-4 w-4" />Prévia de hoje</button>
        <button className="btn-ghost" disabled={busy || !canSend} title={canSend ? '' : 'Ligue os envios reais na aba Conexão'} onClick={onRun}><Play className="h-4 w-4" />Enviar agora</button>
      </div>
    </div>
  );
}

// ---------------- Lembretes da equipe ----------------
function Team({ a, setA }) {
  const { company } = useAuth();
  const [save] = useSave(a, setA);
  const [run, busy] = useAction();
  const [result, setResult] = useState(null);
  const t = a.settings.team;
  const setT = (p) => save({ settings: { team: p } });
  const runNow = async () => { const r = await run(() => api.post('/v1/agent/team/run', {})); if (r !== FAIL) setResult(r); };
  const withPhone = a.users.filter((u) => u.wa_reminders && u.phone);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-4">
        <Section title="Rotina diária de lembretes" subtitle="Gera tarefas na Agenda para cada responsável e envia um resumo no WhatsApp de quem pediu.">
          <Toggle checked={t.enabled} onChange={(v) => setT({ enabled: v })} label="Lembretes ligados" hint="Roda uma vez por dia; tarefas já existentes não se repetem." />
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Select label="Horário" value={t.hour} onChange={(e) => setT({ hour: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{h}h</option>)}</Select>
            <div className="sm:col-span-2"><Toggle checked={t.tasks} onChange={(v) => setT({ tasks: v })} label="Criar tarefas na Agenda" hint="Para o corretor responsável pelo cliente (sem responsável: proprietário e administradores)." /></div>
          </div>
          <Toggle checked={t.whatsapp} onChange={(v) => setT({ whatsapp: v })} label="Resumo no WhatsApp" hint={`Modelo "${t.template}" — exige modelo aprovado e envios ligados.`} />
          <h4 className="mb-1 mt-4 text-sm font-semibold">O que lembrar</h4>
          <div className="grid gap-1 sm:grid-cols-2">
            {a.team_items.map((it) => (
              <label key={it.key} className="flex items-start gap-2 rounded-app-sm p-1.5 text-sm hover:bg-muted">
                <input type="checkbox" className="mt-0.5" checked={t.items[it.key] !== false} onChange={(e) => setT({ items: { [it.key]: e.target.checked } })} />{it.label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Input label="Assistida sem resposta há (dias)" type="number" min={1} max={30} defaultValue={t.staleDays.assistidas} onBlur={(e) => setT({ staleDays: { assistidas: Number(e.target.value) || 1 } })} />
            <Input label="Comparativo sem escolha há (dias)" type="number" min={1} max={30} defaultValue={t.staleDays.comparativos} onBlur={(e) => setT({ staleDays: { comparativos: Number(e.target.value) || 2 } })} />
            <Input label="Proposta sem retorno há (dias)" type="number" min={1} max={60} defaultValue={t.staleDays.propostas} onBlur={(e) => setT({ staleDays: { propostas: Number(e.target.value) || 5 } })} />
          </div>
          <div className="mt-4 flex gap-2"><button className="btn-primary" disabled={busy} onClick={runNow}>{busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}Gerar lembretes agora</button>
            <Link to="/agenda" className="btn-ghost">Abrir a Agenda</Link></div>
          {result && (
            <Notice tone="ok" className="mt-3">
              {result.note}{Object.entries(result.tasks || {}).filter(([, n]) => n).length ? `: ${Object.entries(result.tasks).filter(([, n]) => n).map(([k, n]) => `${n} ${a.team_items.find((x) => x.key === k)?.label.split(' (')[0].toLowerCase()}`).join(' · ')}` : ''}.
              {result.sent ? ` Resumo enviado a ${result.sent} pessoa(s).` : ''}
            </Notice>
          )}
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Quem recebe no WhatsApp">
          {!withPhone.length ? <p className="text-sm text-ink-soft">Ninguém ainda. Cada pessoa liga os lembretes em <Link className="font-medium text-primary hover:underline" to="/conta">Minha conta</Link>, informando o celular.</p> : (
            <ul className="space-y-1 text-sm">{withPhone.map((u) => <li key={u.id} className="flex justify-between gap-2"><span>{u.name}</span><span className="text-ink-faint">{u.phone}</span></li>)}</ul>
          )}
          <p className="mt-3 text-xs text-ink-faint">{a.users.length - withPhone.length} pessoa(s) da equipe sem lembretes no WhatsApp (continuam recebendo as tarefas na Agenda).</p>
        </Section>
        <Notice><Info className="mr-1 inline h-4 w-4" />Exemplo do resumo: “Bom dia, Carla! Seus lembretes de hoje na {company?.trade_name || company?.name}: 2 renovações, 1 parcela vencida, 3 cotações.”</Notice>
      </div>
    </div>
  );
}

// ---------------- Conversas ----------------
function Conversations({ a }) {
  const [filter, setFilter] = useState('');
  const { data: list, reload } = useFetch(() => api.get(`/v1/agent/conversations${filter ? `?status=${filter}` : ''}`), [filter]);
  const [sel, setSel] = useState(null);
  useEffect(() => { const t = setInterval(reload, 20000); return () => clearInterval(t); }, [reload]);
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="card flex max-h-[75vh] flex-col overflow-hidden">
        <div className="flex gap-1 border-b border-line p-2 text-sm">
          {[['', 'Todas'], ['humano', 'Com a equipe'], ['agente', 'Assistente'], ['encerrada', 'Encerradas']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} className={cx('rounded-app-sm px-2.5 py-1', filter === v ? 'bg-primary/10 font-medium text-primary' : 'text-ink-soft hover:bg-muted')}>{l}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {!list ? <Loading /> : !list.length ? <Empty icon={MessageCircle} title="Nenhuma conversa" text={a.enabled ? 'As mensagens recebidas aparecem aqui.' : 'Conecte o número e ligue os envios para começar.'} /> : list.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={cx('flex w-full items-start gap-3 border-b border-line p-3 text-left hover:bg-muted', sel === c.id && 'bg-primary/5')}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700"><MessageCircle className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{c.client_name || c.user_name || c.contact_name || `+${c.phone}`}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{ago(c.updated_at)}</span></span>
                <span className="block truncate text-xs text-ink-soft">{c.last_body}</span>
                <span className="mt-1 flex flex-wrap gap-1"><StatusChip map={CONV} value={c.status} />{c.unread > 0 && <span className="chip bg-red-500 text-white">{c.unread} nova(s)</span>}
                  {c.opted_out_at && <span className="chip bg-zinc-500/10 text-zinc-600">SAIR</span>}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {sel ? <Thread id={sel} onChange={reload} /> : <div className="card grid place-items-center p-10 text-sm text-ink-faint">Escolha uma conversa.</div>}
    </div>
  );
}

function Thread({ id, onChange, simulated }) {
  const { data: c, reload } = useFetch(() => api.get(`/v1/agent/conversations/${id}`), [id]);
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [c?.messages?.length]);
  useEffect(() => { if (simulated) return undefined; const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload, simulated]);
  if (!c) return <div className="card"><Loading /></div>;
  const setStatus = async (status) => { const r = await run(() => api.post(`/v1/agent/conversations/${id}/status`, { status }), status === 'humano' ? 'Você assumiu a conversa.' : status === 'agente' ? 'Conversa devolvida ao assistente.' : 'Conversa encerrada.'); if (r !== FAIL) { reload(); onChange?.(); } };
  const send = async () => { const r = await run(() => api.post(`/v1/agent/conversations/${id}/messages`, { text })); if (r !== FAIL) { setText(''); reload(); onChange?.(); } };
  return (
    <div className="card flex max-h-[75vh] min-h-[420px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.client_name || c.contact_name || `+${c.phone}`}</p>
          <p className="text-xs text-ink-faint">+{c.phone}{c.client_id && <> · <Link className="text-primary hover:underline" to={`/clientes/${c.client_id}`}>abrir cliente</Link></>}{c.handoff_reason ? ` · ${c.handoff_reason}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip map={CONV} value={c.status} />
          {c.status !== 'humano' && <button className="btn-outline h-8 px-2.5 text-xs" disabled={busy} onClick={() => setStatus('humano')}><Hand className="h-3.5 w-3.5" />Assumir</button>}
          {c.status !== 'agente' && <button className="btn-outline h-8 px-2.5 text-xs" disabled={busy} onClick={() => setStatus('agente')}><Undo2 className="h-3.5 w-3.5" />Devolver ao assistente</button>}
          {c.status !== 'encerrada' && <button className="btn-ghost h-8 px-2.5 text-xs" disabled={busy} onClick={() => setStatus('encerrada')}>Encerrar</button>}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/50 p-3">
        {c.messages.map((m) => (
          <div key={m.id} className={cx('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-soft', m.direction === 'out' ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm bg-surface')}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={cx('mt-1 text-[10px]', m.direction === 'out' ? 'text-white/75' : 'text-ink-faint')}>
                {fmtDateTime(m.created_at)}{m.direction === 'out' ? ` · ${m.sent_by_name || ROUTINE_LABEL[m.routine] || 'sistema'} · ${MSG[m.status] || m.status}` : ''}{m.error ? ` · ${m.error}` : ''}
              </p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {!simulated && (
        <div className="border-t border-line p-3">
          {c.window_open ? (
            <div className="flex gap-2">
              <textarea className="input min-h-[44px] flex-1" rows={2} placeholder="Escreva a resposta… (envia pelo número da corretora)" value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); send(); } }} />
              <button className="btn-primary self-end" disabled={busy || !text.trim()} onClick={send} aria-label="Enviar"><Send className="h-4 w-4" /></button>
            </div>
          ) : <p className="flex items-center gap-2 text-xs text-ink-soft"><Clock className="h-4 w-4" />Fora da janela de 24 h do WhatsApp: só é possível responder depois que o cliente mandar uma nova mensagem (ou por um modelo aprovado).</p>}
        </div>
      )}
    </div>
  );
}

// ---------------- Simulador ----------------
function Simulator() {
  const [client, setClient] = useState(null);
  const [text, setText] = useState('');
  const [log, setLog] = useState([]);
  const [run, busy] = useAction();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [log.length]);
  const say = async (t) => {
    const msg = (t ?? text).trim();
    if (!msg) return;
    setLog((l) => [...l, { me: true, text: msg }]); setText('');
    const r = await run(() => api.post('/v1/agent/simulate', { client_id: client?.id || null, text: msg }));
    if (r !== FAIL) setLog((l) => [...l, ...(r.replies.length ? r.replies.map((x) => ({ text: x })) : [{ info: r.status === 'humano' ? 'Conversa com a equipe: o assistente fica em silêncio (como no WhatsApp real).' : 'Sem resposta automática.' }])]);
  };
  const reset = async () => { const r = await run(() => api.del('/v1/agent/simulate')); if (r !== FAIL) setLog([]); };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="card flex h-[70vh] min-h-[460px] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line p-3">
          <div><p className="font-semibold">Teste como cliente</p><p className="text-xs text-ink-faint">{client ? `Você está escrevendo como ${client.name}` : 'Número sem cadastro'} · nada é enviado ao WhatsApp</p></div>
          <button className="btn-ghost h-8 px-2.5 text-xs" disabled={busy} onClick={reset}><Trash2 className="h-3.5 w-3.5" />Recomeçar</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-3 dark:bg-muted/60">
          {!log.length && <p className="mx-auto mt-10 max-w-sm text-center text-sm text-ink-soft">Escolha um cliente ao lado e mande “oi”. Experimente 1, 2, 3, 4, 5 ou SAIR.</p>}
          {log.map((m, i) => m.info ? <p key={i} className="text-center text-xs text-ink-faint">{m.info}</p> : (
            <div key={i} className={cx('flex', m.me ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-soft', m.me ? 'rounded-br-sm bg-[#d9fdd3] text-zinc-900' : 'rounded-bl-sm bg-white text-zinc-900')}>{m.text}</div>
            </div>
          ))}
          {busy && <Spinner className="h-4 w-4" />}
          <div ref={end} />
        </div>
        <div className="flex gap-2 border-t border-line p-3">
          <input className="input flex-1" placeholder="Mensagem do cliente…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && say()} aria-label="Mensagem do cliente" />
          <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => say()} aria-label="Enviar"><Send className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="space-y-4">
        <Section title="Cliente do teste"><ClientPicker label="Escrever como" value={client} onChange={(c) => { setClient(c); setLog([]); }} hint="Usa o celular do cadastro. Sem cliente: número desconhecido." /></Section>
        <Section title="Atalhos">
          <div className="flex flex-wrap gap-2">{['oi', '1', '2', '3', '4', '5', 'SAIR'].map((t) => <button key={t} className="btn-outline h-8 px-3 text-xs" disabled={busy} onClick={() => say(t)}>{t}</button>)}</div>
          <p className="mt-3 text-xs text-ink-soft">Para ver apólices e parcelas o assistente pede os 3 primeiros dígitos do CPF/CNPJ do cliente. Links e protocolos não são gerados no teste.</p>
        </Section>
      </div>
    </div>
  );
}

// ---------------- Modelos ----------------
function Templates({ a }) {
  const { toast } = useUI();
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copiado.')).catch(() => {});
  return (
    <div className="space-y-4">
      <Notice>Cadastre cada modelo no Gerenciador do WhatsApp (Meta Business › WhatsApp Manager › Modelos de mensagem), com o <b>mesmo nome</b>, idioma <b>Português (BR)</b>, a categoria indicada e as variáveis na ordem abaixo. Depois da aprovação, informe o nome na rotina correspondente.</Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        {a.templates.map((t) => (
          <div key={t.name} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-semibold">{t.label}</h3><p className="font-mono text-xs text-ink-faint">{t.name} · {t.category === 'MARKETING' ? 'Marketing' : 'Utilidade'} · pt_BR</p></div>
              <button className="btn-outline h-8 px-2.5 text-xs" onClick={() => copy(t.body)}><Copy className="h-3.5 w-3.5" />Copiar texto</button>
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-app-sm bg-muted p-3 text-sm">{t.body}</p>
            <p className="mt-2 text-xs text-ink-soft">Variáveis: {t.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Histórico ----------------
function Runs() {
  const { data } = useFetch(() => api.get('/v1/agent/runs'), []);
  if (!data) return <Loading />;
  if (!data.length) return <div className="card"><Empty icon={History} title="Nenhuma execução ainda" text="As execuções das rotinas (agendadas e manuais) aparecem aqui." /></div>;
  return (
    <div className="card overflow-x-auto">
      <table className="table-clean">
        <thead><tr><th>Data</th><th>Rotina</th><th>Origem</th><th>Enviadas</th><th>Falhas</th><th>Ignoradas</th><th>Observação</th></tr></thead>
        <tbody>{data.map((r) => (
          <tr key={r.id}><td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td><td>{ROUTINE_LABEL[r.routine] || r.routine}</td>
            <td>{r.trigger === 'manual' ? `Manual${r.user_name ? ` (${r.user_name})` : ''}` : 'Agendada'}</td><td className="tabular-nums">{r.sent}</td>
            <td className={cx('tabular-nums', r.failed && 'text-red-600')}>{r.failed}</td><td className="tabular-nums">{r.skipped}</td><td className="text-ink-soft">{r.note || '—'}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Seção da página Minha conta: celular e lembretes no WhatsApp. */
export function MyWhatsAppReminders() {
  const { data, setData } = useFetch(() => api.get('/v1/agent/me'), []);
  const [phone, setPhone] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (data) setPhone(data.phone ? `+${data.phone}` : ''); }, [data]);
  if (!data) return null;
  const save = async (wa) => {
    const r = await run(() => api.put('/v1/agent/me', { phone: phone.trim() || null, wa_reminders: wa }), wa ? 'Lembretes no WhatsApp ligados.' : 'Preferência salva.');
    if (r !== FAIL) setData({ phone: phone.replace(/\D/g, '') || null, wa_reminders: r.wa_reminders });
  };
  return (
    <Section title="Lembretes no WhatsApp" subtitle="Resumo diário das suas tarefas (renovações, parcelas, cotações) no seu celular.">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Input label="Seu celular com DDD" placeholder="(19) 99999-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn-outline" disabled={busy} onClick={() => save(data.wa_reminders)}>Salvar celular</button>
      </div>
      <div className="mt-2"><Toggle checked={data.wa_reminders} onChange={(v) => save(v)} label="Receber os lembretes no WhatsApp" hint="Enviados pelo número da corretora, se o agente do WhatsApp estiver ligado. As tarefas continuam na Agenda." /></div>
    </Section>
  );
}
