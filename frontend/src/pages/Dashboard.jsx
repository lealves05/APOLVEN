// Painel (22.1/22.2): visão do corretor e cartões do gestor. Cada bloco aparece só se a permissão do perfil devolver os dados.
import { Link, useNavigate } from 'react-router-dom';
import {
  Calculator, UserPlus, Send, FileCheck2, RefreshCw, Receipt, Siren, Wallet, HandCoins, CalendarDays, Target, AlertTriangle, ChevronRight, Clock, ExternalLink,
  FileWarning, Inbox,
} from 'lucide-react';
import { api } from '../lib/api';
import { money, num, fmtDateTime, PRIORITY } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { Section, Empty, Loading, useFetch, cx } from '../components/ui';
import { taskBucket, taskEntityLink } from './Agenda';

const n = (v) => Number(v) || 0;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Cartão numérico clicável. tone: 'warn' | 'danger' quando há algo a fazer. */
function Card({ to, label, value, hint, icon: Icon, tone }) {
  const t = tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-ink-faint';
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-faint">{label}</span>
        {Icon && <Icon className={cx('h-4 w-4 shrink-0', t)} aria-hidden />}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className={cx('mt-0.5 text-xs', tone ? t : 'text-ink-faint')}>{hint}</div>}
    </>
  );
  if (!to) return <div className="card p-4">{body}</div>;
  return (
    <Link to={to} className="card group block p-4 transition hover:shadow-soft focus-visible:ring-2 focus-visible:ring-primary">
      {body}
      <span className="mt-2 inline-flex items-center text-xs text-primary opacity-80 group-hover:opacity-100">Ver detalhes <ChevronRight className="h-3.5 w-3.5" /></span>
    </Link>
  );
}

function Group({ title, subtitle, children }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-ink-faint">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function MyTasks({ tasks }) {
  if (!tasks?.length) return <Empty icon={CalendarDays} title="Nenhuma tarefa pendente" text="Sua agenda está em dia." />;
  const now = new Date();
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => {
        const b = taskBucket(t, now);
        const link = taskEntityLink(t);
        const pr = PRIORITY[t.priority] || PRIORITY.normal;
        return (
          <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {b === 'atrasada' && <span className="chip bg-red-500/10 text-red-700 dark:text-red-300">Atrasada</span>}
                {b === 'hoje' && <span className="chip bg-sky-500/10 text-sky-700 dark:text-sky-300">Hoje</span>}
                <span className="text-sm font-medium">{t.title}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-faint">
                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{t.due_at ? fmtDateTime(t.due_at) : 'Sem prazo'}</span>
                <span className={pr.cls}>Prioridade {pr.label.toLowerCase()}</span>
                {link && <Link to={link.to} className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" />{link.label}</Link>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const { user, can, scope } = useAuth();
  const { data: d, loading, reload } = useFetch(() => api.get('/v1/reports/dashboard'), []);
  const firstName = (user?.name || '').split(' ')[0];
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  const actions = (
    <div className="flex flex-wrap gap-2">
      {can('quotes_manage') && <button className="btn-primary" onClick={() => nav('/cotacoes/nova')}><Calculator className="h-4 w-4" /> Nova cotação</button>}
      {can('clients_edit') && <button className="btn-outline" onClick={() => nav('/clientes?novo=1')}><UserPlus className="h-4 w-4" /> Novo cliente</button>}
      <button className="btn-outline" onClick={() => nav('/agenda')}><CalendarDays className="h-4 w-4" /> Agenda</button>
    </div>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm capitalize text-ink-faint">{today}</p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mt-0.5 text-sm text-ink-faint">Resumo do que precisa da sua atenção.</p>
        </div>
        {actions}
      </div>

      {loading && !d ? <Loading /> : !d ? (
        <Section><Empty icon={AlertTriangle} title="Não foi possível carregar o painel" action={<button className="btn-outline" onClick={reload}>Tentar de novo</button>} /></Section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {(d.quotes || d.opportunities) && (
              <Group title="Vendas em andamento">
                {d.quotes && <>
                  <Card to="/cotacoes" icon={Calculator} label="Cotações abertas" value={num(d.quotes.quotes_open)} />
                  <Card to="/cotacoes" icon={Inbox} label="Consultas sem resposta" value={num(d.quotes.tasks_no_answer)}
                    hint={n(d.quotes.tasks_no_answer) ? 'Aguardando, assistidas ou com falha técnica (não é recusa)' : 'Nenhuma pendente'} tone={n(d.quotes.tasks_no_answer) ? 'warn' : null} />
                  <Card to="/propostas" icon={Send} label="Autorizadas e não transmitidas" value={num(d.quotes.authorized_not_sent)}
                    hint={n(d.quotes.authorized_not_sent) ? 'Cliente autorizou: transmitir' : 'Nenhuma'} tone={n(d.quotes.authorized_not_sent) ? 'danger' : null} />
                  <Card to="/propostas" icon={FileCheck2} label="Em contratação" value={num(d.quotes.in_contracting)} hint="Transmitidas até documento recebido" />
                </>}
                {d.opportunities && <>
                  <Card to="/oportunidades" icon={Target} label="Oportunidades abertas" value={num(d.opportunities.open)} />
                  <Card to="/oportunidades" icon={AlertTriangle} label="Sem próxima ação" value={num(d.opportunities.no_next_action)}
                    hint={n(d.opportunities.no_next_action) ? 'Defina data do próximo passo' : 'Todas com próxima ação'} tone={n(d.opportunities.no_next_action) ? 'warn' : null} />
                </>}
              </Group>
            )}

            {d.policies && (
              <Group title="Carteira e renovações">
                <Card to="/renovacoes" icon={RefreshCw} label="Vencem em 30 dias" value={num(d.policies.renew_30)} hint="Sem renovação emitida" tone={n(d.policies.renew_30) ? 'danger' : null} />
                <Card to="/renovacoes" icon={RefreshCw} label="Vencem em 90 dias" value={num(d.policies.renew_90)} hint="Sem renovação emitida" tone={n(d.policies.renew_90) ? 'warn' : null} />
                <Card to="/apolices" icon={FileCheck2} label="Apólices vigentes" value={num(d.policies.active_policies)} />
                <Card to="/apolices" icon={FileWarning} label="Documentos a conferir" value={num(d.policies.docs_pending)}
                  hint="Aguardando, recebidos ou divergentes" tone={n(d.policies.docs_pending) ? 'warn' : null} />
              </Group>
            )}

            {(d.installments || d.claims) && (
              <Group title="Pós-venda" subtitle={d.installments ? 'Parcelas do prêmio do seguro (pagas pelo cliente à seguradora)' : null}>
                {d.installments && <>
                  <Card to="/parcelas?status=vencida" icon={Receipt} label="Parcelas vencidas" value={num(d.installments.overdue)}
                    hint={n(d.installments.overdue) ? `Saldo ${money(d.installments.overdue_cents)}` : 'Nenhuma vencida'} tone={n(d.installments.overdue) ? 'danger' : null} />
                  <Card to="/parcelas?status=pagamento_informado" icon={Receipt} label="Pagamento informado" value={num(d.installments.informed)}
                    hint="Informado ≠ confirmado: conferir" tone={n(d.installments.informed) ? 'warn' : null} />
                  <Card to="/parcelas?status=proxima_vencimento" icon={Clock} label="Próximas do vencimento" value={num(d.installments.upcoming)} />
                </>}
                {d.claims && <>
                  <Card to="/sinistros" icon={Siren} label="Sinistros em andamento" value={num(d.claims.open)}
                    hint={n(d.claims.deadline_near) ? `${num(d.claims.deadline_near)} com prazo em até 3 dias` : 'Nenhum prazo próximo'} tone={n(d.claims.deadline_near) ? 'danger' : null} />
                  <Card to="/sinistros?tab=solicitacoes" icon={Inbox} label="Solicitações abertas" value={num(d.claims.requests_open)} />
                </>}
              </Group>
            )}

            {d.commissions && (
              <section>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">Comissões da corretora</h2>
                  <p className="text-xs text-ink-faint">Previsão e valores confirmados são mostrados separadamente e nunca somados.</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-app border border-dashed border-line p-3">
                    <div className="mb-2 flex items-center gap-2"><span className="chip bg-zinc-500/10 text-zinc-600 dark:text-zinc-300">Previsão</span>
                      <span className="text-xs text-ink-faint">Estimativas ainda não confirmadas pela seguradora</span></div>
                    <Card to="/comissoes" icon={Wallet} label="Comissão prevista (estimativa)" value={money(d.commissions.projected_cents)} hint="Pode mudar até a confirmação" />
                  </div>
                  <div className="rounded-app border border-line p-3">
                    <div className="mb-2 flex items-center gap-2"><span className="chip bg-sky-500/10 text-sky-700 dark:text-sky-300">Confirmado</span>
                      <span className="text-xs text-ink-faint">Valores confirmados / liquidados</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      <Card to="/comissoes" label="A receber (confirmado)" value={money(d.commissions.open_confirmed_cents)} />
                      <Card to="/comissoes" label="Vencido (confirmado)" value={money(d.commissions.overdue_cents)} tone={n(d.commissions.overdue_cents) ? 'danger' : null}
                        hint={n(d.commissions.overdue_cents) ? 'Cobrar a seguradora' : null} />
                      <Card to="/comissoes" label="Recebido no mês" value={money(d.commissions.settled_month_cents)} />
                      <Card to="/comissoes?tab=extratos" label="Divergências" value={num(d.commissions.divergent)} tone={n(d.commissions.divergent) ? 'warn' : null}
                        hint={n(d.commissions.divergent) ? 'Conciliar extrato' : 'Nenhuma'} />
                    </div>
                  </div>
                </div>
              </section>
            )}

            {d.splits && (
              <Group title="Repasses a parceiros" subtitle="Valores devidos a produtores/parceiros — separados das comissões">
                <Card to="/repasses" icon={HandCoins} label="Liberado para pagar" value={money(d.splits.released)} />
                <Card to="/repasses" icon={HandCoins} label="Recuperável (já pago)" value={money(d.splits.recoverable)} tone={n(d.splits.recoverable) ? 'warn' : null}
                  hint={n(d.splits.recoverable) ? 'Compensar em próximos lotes' : null} />
                <Card to="/repasses" icon={HandCoins} label="Pago (total)" value={money(d.splits.paid)} />
              </Group>
            )}

            {!d.quotes && !d.policies && !d.opportunities && !d.installments && !d.claims && !d.commissions && !d.splits && (
              <Section><Empty title="Sem indicadores para o seu perfil" text="Seu perfil de acesso não inclui módulos com indicadores. Use a agenda para acompanhar suas tarefas." /></Section>
            )}
          </div>

          <div className="space-y-4">
            <Section title="Minhas tarefas" subtitle="Próximas pendências atribuídas a você"
              actions={<Link to="/agenda" className="text-xs font-medium text-primary hover:underline">Abrir agenda</Link>}>
              <MyTasks tasks={d.my_tasks} />
            </Section>
            {scope('commissions_view') === 'own' && (
              <p className="text-xs text-ink-faint">Valores de comissão da sua carteira estão em <Link to="/comissoes" className="text-primary hover:underline">Comissões</Link>.</p>
            )}
            <p className="text-xs text-ink-faint">Atualizado em {fmtDateTime(d.generated_at)} · <button className="text-primary hover:underline" onClick={reload}>atualizar</button></p>
          </div>
        </div>
      )}
    </>
  );
}
