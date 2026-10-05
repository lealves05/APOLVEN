import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Info, Lock, CreditCard, LifeBuoy, LogOut, RefreshCw, MessageCircle, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cx } from './ui';
import { moneyReais as money } from '../lib/format';

export const TENANT_STATUS_LABEL = {
  ACTIVE: 'Ativo', TRIAL: 'Em teste', PAYMENT_PENDING: 'Aguardando pagamento', PAST_DUE: 'Inadimplente',
  SUSPENDED: 'Suspenso', CANCELED: 'Cancelado', EXPIRED: 'Expirado',
};
export const TENANT_STATUS_TONE = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', TRIAL: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PAYMENT_PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', PAST_DUE: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  SUSPENDED: 'bg-red-500/15 text-red-700 dark:text-red-300', CANCELED: 'bg-zinc-500/15 text-ink-soft', EXPIRED: 'bg-zinc-500/15 text-ink-soft',
};
export const PAYMENT_STATUS_LABEL = {
  PENDING: 'Pendente', CONFIRMED: 'Pago', OVERDUE: 'Vencido', FAILED: 'Recusado', REFUNDED: 'Estornado', CHARGEBACK: 'Contestado', CANCELED: 'Cancelado',
};
export const CYCLE_LABEL = { MONTHLY: 'Mensal', ANNUAL: 'Anual' };
export const TRIAL_LABEL = { '15_DAYS': '15 dias', '30_DAYS': '30 dias', UNLIMITED: 'Ilimitado', CUSTOM: 'Personalizado', NONE: 'Sem teste' };
export const REASON_LABEL = {
  ADMINISTRATIVO: 'Bloqueio administrativo', FINANCEIRO: 'Pendência financeira', TRIAL_EXPIRADO: 'Período de teste encerrado', CANCELAMENTO: 'Assinatura cancelada',
};

export function StatusChip({ status }) {
  return <span className={cx('chip', TENANT_STATUS_TONE[status] || 'bg-muted text-ink-soft')}>{TENANT_STATUS_LABEL[status] || status || '—'}</span>;
}

const isTenantAdmin = (u) => ['owner', 'admin'].includes(u?.role);

/** Avisos de vencimento/teste/inadimplência no topo das telas (vindos do servidor). */
export function BillingNotices() {
  const { access: billing, user, notice } = useAuth();
  const notices = billing?.notices || [];
  if (!notices.length && !notice) return null;
  return (
    <div className="space-y-2 px-4 pt-3 sm:px-6">
      {notice && (
        <div role="status" className={cx('flex items-center gap-3 rounded-app-sm border px-3.5 py-2.5 text-sm',
          notice.level === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100' : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100')}>
          <Info className="h-4 w-4 shrink-0" /><span className="flex-1">{notice.text}</span>
        </div>
      )}
      {notices.map((n) => (
        <div key={n.text} role="status" className={cx('flex flex-wrap items-center gap-3 rounded-app-sm border px-3.5 py-2.5 text-sm',
          n.level === 'danger' ? 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100')}>
          {n.level === 'danger' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Info className="h-4 w-4 shrink-0" />}
          <span className="flex-1 min-w-[12rem]">{n.text}</span>
          {isTenantAdmin(user) && <Link to="/assinatura" className="font-medium underline underline-offset-2">Ver assinatura</Link>}
        </div>
      ))}
    </div>
  );
}

/** Tela exibida quando o acesso do contratante está bloqueado. Os dados continuam preservados no servidor. */
export function BlockedScreen() {
  const { access: billing, user, logout, company, refresh } = useAuth();
  const loc = useLocation();
  const admin = isTenantAdmin(user);
  const byAdmin = billing?.admin_blocked || billing?.reason === 'ADMINISTRATIVO';
  const title = byAdmin ? 'Acesso temporariamente bloqueado'
    : billing?.reason === 'TRIAL_EXPIRADO' ? 'Seu período de teste terminou'
      : billing?.reason === 'CANCELAMENTO' ? 'Sua assinatura foi encerrada' : 'Acesso suspenso por pendência financeira';
  const text = byAdmin
    ? 'O acesso desta empresa foi bloqueado pela administração da plataforma. Entre em contato com o suporte para mais informações.'
    : 'Para continuar utilizando o sistema, regularize sua assinatura. Seus dados estão preservados e o acesso volta assim que o pagamento for confirmado.';
  const support = billing?.support || '';
  const ch = billing?.support_channel || {};
  const supportHref = /^\S+@\S+\.\S+$/.test(support) ? `mailto:${support}` : /^\+?[\d\s()-]{8,}$/.test(support) ? `https://wa.me/${support.replace(/\D/g, '')}` : null;
  return (
    <div className="grid min-h-full place-items-center bg-bg p-4">
      <div className="card w-full max-w-lg p-6 text-center sm:p-8" data-testid="blocked-screen">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-red-500/10 text-red-600"><Lock className="h-6 w-6" /></div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{company?.trade_name || company?.name}</p>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{text}</p>
        {!admin && !byAdmin && <p className="mt-3 text-sm text-ink-soft">Peça ao proprietário ou a um administrador da empresa para regularizar a assinatura.</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          {admin && !byAdmin && (
            <>
              <Link to="/assinatura" className="btn-primary" aria-current={loc.pathname === '/assinatura' ? 'page' : undefined}>
                <CreditCard className="h-4 w-4" /> Regularizar pagamento
              </Link>
              <Link to="/assinatura?tab=pagamento" className="btn-outline">Atualizar forma de pagamento</Link>
            </>
          )}
          {ch.whatsapp || ch.email ? <SupportButtons ch={ch} />
            : supportHref ? <a href={supportHref} target="_blank" rel="noreferrer noopener" className="btn-outline"><LifeBuoy className="h-4 w-4" /> Falar com suporte</a>
              : support ? <span className="btn-outline pointer-events-none"><LifeBuoy className="h-4 w-4" /> Suporte: {support}</span> : null}
          <button className="btn-ghost" onClick={refresh}><RefreshCw className="h-4 w-4" /> {byAdmin ? 'Verificar novamente' : 'Já paguei, verificar'}</button>
          <button className="btn-ghost" onClick={logout}><LogOut className="h-4 w-4" /> Sair</button>
        </div>
      </div>
    </div>
  );
}

export const priceFor = (p, cycle) => Number(cycle === 'ANNUAL' ? p?.annual_price : p?.monthly_price) || 0;

export function PlanPicker({ plans, value, cycle, onChange, onCycle }) {
  return (
    <div>
      <div className="mb-3 inline-flex rounded-app-sm bg-muted p-1" role="radiogroup" aria-label="Ciclo de cobrança">
        {['MONTHLY', 'ANNUAL'].map((c) => (
          <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => onCycle(c)}
            className={cx('rounded-[calc(var(--radius)*0.45)] px-3 py-1.5 text-sm font-medium', cycle === c ? 'bg-surface shadow-soft' : 'text-ink-soft')}>
            {c === 'MONTHLY' ? 'Mensal (recorrente)' : 'Anual (pagamento único)'}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => {
          const price = priceFor(p, cycle);
          const off = !price;
          return (
            <button key={p.id} type="button" disabled={off} onClick={() => onChange(p.id)} aria-pressed={value === p.id}
              className={cx('card p-4 text-left transition disabled:opacity-50', value === p.id ? 'border-primary ring-4 ring-primary/15' : 'hover:border-ink-faint')}>
              <div className="font-semibold">{p.name}</div>
              {p.description && <p className="mt-1 text-xs text-ink-faint">{p.description}</p>}
              <div className="mt-3 text-lg font-semibold tabular-nums">{off ? 'Indisponível' : money(price)}
                {!off && <span className="text-xs font-normal text-ink-faint">{cycle === 'ANNUAL' ? ' /ano' : ' /mês'}</span>}</div>
              {p.max_users && <p className="mt-1 text-xs text-ink-faint">Até {p.max_users} usuários</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}


const waLink = (n) => `https://wa.me/${n.length >= 12 ? n : `55${n}`}`;
const fmtWa = (n) => { const d = n.length >= 12 ? n.slice(2) : n; return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : n; };

/** Botões do canal de suporte (WhatsApp e e-mail cadastrados pela plataforma). */
export function SupportButtons({ ch, block }) {
  return (
    <>
      {ch.whatsapp && <a href={waLink(ch.whatsapp)} target="_blank" rel="noreferrer noopener" className={cx('btn-outline text-emerald-700 dark:text-emerald-300', block && 'w-full')}><MessageCircle className="h-4 w-4" /> WhatsApp {fmtWa(ch.whatsapp)}</a>}
      {ch.email && <a href={`mailto:${ch.email}`} className={cx('btn-outline', block && 'w-full')}><Mail className="h-4 w-4" /> {ch.email}</a>}
    </>
  );
}
