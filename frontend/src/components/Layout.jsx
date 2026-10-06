import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, LifeBuoy, Users, Wallet, BarChart3, UserRound, Settings, LogOut, Menu, X, Sun, Moon, ChevronDown, Plus, ShieldCheck, Building2,
  CreditCard, ChevronsLeft, ChevronsRight, ChevronRight, Home, CalendarDays, Target, Calculator, FileText, Send, FileCheck2, RefreshCw, Receipt,
  BadgePercent, HandCoins, Landmark, Siren, Package, PlugZap, FolderOpen, MessageSquare, MessageCircle, Lock, Briefcase, ShieldPlus,
} from 'lucide-react';
import { GlobalSearch, SearchButton, Notifications, HelpButton, useShortcuts } from './Workspace';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/format';
import { cx, Avatar } from './ui';
import DemoBanner from './DemoBanner';
import { BillingNotices } from './Billing';
import { PRESET_COLORS } from '../lib/theme';

export function Mark({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  );
}

export function Logo({ company, compact, light }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {company?.logo_url
        ? <img src={company.logo_url} alt="" className="h-9 w-9 rounded-app-sm bg-white object-contain p-0.5" />
        : <div className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-app-sm', light ? 'bg-primary-fg/15 text-primary-fg' : 'bg-primary text-primary-fg')}>
            <Mark />
          </div>}
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="max-w-[180px] truncate text-sm font-semibold">{company?.trade_name || company?.name || 'APOLVEN'}</div>
          <div className={cx('whitespace-nowrap text-[11px]', light ? 'hidden opacity-70 2xl:block' : 'text-ink-faint')}>APOLVEN · corretora de seguros</div>
        </div>
      )}
    </div>
  );
}

/** Menu funcional (4.2) conforme perfil e módulos liberados pela central. */
export function useNav() {
  const { can, feature, access, user } = useAuth();
  const groups = [
    { label: 'Relacionamento', icon: Users, children: [
      { to: '/agenda', label: 'Agenda e pendências', icon: CalendarDays },
      can('opportunities') && feature('crm') && { to: '/oportunidades', label: 'CRM e oportunidades', icon: Target },
      can('clients_view') && { to: '/clientes', label: 'Clientes e grupos', icon: Users },
      (can('agent_manage') || can('agent_inbox')) && feature('whatsapp') && { to: '/agente-whatsapp', label: 'Agente do WhatsApp', icon: MessageCircle },
    ] },
    { label: 'Vendas', icon: Calculator, children: [
      can('quotes_view') && feature('multicalculo') && { to: '/cotacoes', label: 'Cotações e multicálculo', icon: Calculator },
      can('quotes_view') && feature('propostas') && { to: '/propostas', label: 'Propostas e transmissão', icon: Send },
    ] },
    { label: 'Carteira', icon: Briefcase, children: [
      can('policies_view') && { to: '/apolices', label: 'Apólices e certificados', icon: FileCheck2 },
      can('renewals') && feature('renovacoes') && { to: '/renovacoes', label: 'Renovações', icon: RefreshCw },
      can('installments') && { to: '/parcelas', label: 'Parcelas dos seguros', icon: Receipt },
      (can('claims') || can('service_requests')) && feature('sinistros') && { to: '/sinistros', label: 'Sinistros e solicitações', icon: Siren },
    ] },
    { label: 'Financeiro', icon: Landmark, children: [
      can('commissions_view') && feature('comissoes') && { to: '/comissoes', label: 'Comissões a receber', icon: BadgePercent },
      can('splits_view') && feature('repasses') && { to: '/repasses', label: 'Repasses', icon: HandCoins },
      can('finance') && feature('financeiro') && { to: '/financeiro', label: 'Financeiro da corretora', icon: Wallet },
    ] },
    { label: 'Cadastros e integrações', icon: PlugZap, children: [
      can('integrations_view') && feature('integracoes') && { to: '/integracoes', label: 'Seguradoras e integrações', icon: PlugZap },
      { to: '/produtos', label: 'Planos, produtos e coberturas', icon: Package },
      { to: '/documentos', label: 'Documentos e importações', icon: FolderOpen },
      { to: '/comunicacao', label: 'Comunicação', icon: MessageSquare },
    ] },
    { label: 'Gestão', icon: BarChart3, children: [
      can('reports') && feature('relatorios') && { to: '/relatorios', label: 'Relatórios e indicadores', icon: BarChart3 },
      can('audit_view') && { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck },
      can('privacy') && { to: '/privacidade', label: 'Privacidade (LGPD)', icon: Lock },
    ] },
    { label: 'Configurações', icon: Settings, children: [
      can('settings', 'users', 'units_manage') && { to: '/configuracoes', label: 'Configurações da corretora', icon: Settings },
      access && ['owner', 'admin'].includes(user?.role) && { to: '/assinatura', label: 'Assinatura e plano', icon: CreditCard },
      { to: '/conta', label: 'Minha conta e segurança', icon: UserRound },
      { to: '/suporte', label: 'Suporte', icon: LifeBuoy },
    ] },
  ].map((g) => ({ ...g, children: g.children.filter(Boolean) })).filter((g) => g.children.length);
  return [{ to: '/', label: 'Painel', icon: LayoutDashboard, end: true }, ...groups];
}

/** Trilha de navegação a partir do menu. */
function Breadcrumbs({ nav }) {
  const loc = useLocation();
  const path = loc.pathname;
  if (path === '/') return null;
  let group = null;
  let item = null;
  for (const n of nav) {
    for (const c of n.children || [n]) {
      const hit = c.to && (c.end ? path === c.to : path === c.to || path.startsWith(`${c.to}/`));
      if (hit && (!item || c.to.length > item.to.length)) { item = c; group = n.children ? n : null; }
    }
  }
  const rest = item ? path.slice(item.to.length).split('/').filter(Boolean) : [];
  const tail = rest.length ? (['novo', 'nova'].includes(rest[0]) ? 'Novo registro' : 'Detalhe') : null;
  return (
    <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1 text-xs text-ink-faint">
      <Link to="/" className="shrink-0 hover:text-ink" title="Início"><Home className="h-3.5 w-3.5" /></Link>
      {group && <><ChevronRight className="h-3 w-3 shrink-0" /><span className="hidden truncate sm:inline">{group.label}</span></>}
      {item && <><ChevronRight className="hidden h-3 w-3 shrink-0 sm:inline" /><Link to={item.to} className="truncate hover:text-ink">{item.label}</Link></>}
      {tail && <><ChevronRight className="h-3 w-3 shrink-0" /><span className="truncate text-ink-soft">{tail}</span></>}
    </nav>
  );
}

function QuickActions({ light, collapsed }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const items = [
    can('quotes_manage') && { label: 'Nova cotação', icon: Calculator, to: '/cotacoes/nova', key: 'Alt+C' },
    can('clients_edit') && { label: 'Novo cliente', icon: Users, to: '/clientes?novo=1', key: 'Alt+N' },
    can('renewals') && { label: 'Renovações', icon: RefreshCw, to: '/renovacoes' },
    can('commissions_settle') && { label: 'Baixa de comissão', icon: BadgePercent, to: '/comissoes?tab=liquidacoes&nova=1' },
    can('service_requests') && { label: 'Nova solicitação', icon: ShieldPlus, to: '/sinistros?tab=solicitacoes&nova=1', key: 'Alt+S' },
    can('policies_manage') && { label: 'Cadastrar apólice', icon: FileText, to: '/apolices/nova' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={cx('btn h-9 gap-1.5 rounded-full px-3 text-xs', light ? 'bg-primary-fg text-primary hover:brightness-95' : 'bg-primary text-primary-fg')}>
        <Plus className="h-4 w-4" /><span className={cx('hidden sm:inline', collapsed && 'sm:hidden')}>Novo</span>
      </button>
      {open && (
        <div className="card animate-pop absolute right-0 top-full z-50 mt-2 w-64 p-1.5 text-sm text-ink">
          {items.map((i) => (
            <button key={i.to} onClick={() => { setOpen(false); nav(i.to); }} className="flex w-full items-center gap-2.5 rounded-app-sm px-3 py-2 text-left hover:bg-muted">
              <i.icon className="h-4 w-4 text-ink-faint" /><span className="flex-1">{i.label}</span>
              {i.key && <kbd className="hidden text-[10px] text-ink-faint sm:inline">{i.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ light, up }) {
  const { user, logout, savePrefs } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const dark = document.documentElement.classList.contains('dark');
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button className={cx('flex w-full items-center gap-2.5 rounded-app-sm p-1.5 text-left', light ? 'hover:bg-primary-fg/10' : 'hover:bg-muted')} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.name} size="h-8 w-8" color={light ? 'rgb(var(--primary-fg) / 0.22)' : undefined} />
        <div className={cx('min-w-0 flex-1 leading-tight', light && 'hidden xl:block')}>
          <div className="max-w-[140px] truncate text-sm font-medium">{user.name}</div>
          <div className={cx('text-[11px]', light ? 'opacity-70' : 'text-ink-faint')}>{ROLES[user.role]}</div>
        </div>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {open && (
        <div className={cx('card animate-pop absolute z-50 w-56 p-1.5 text-sm text-ink', up ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2')}>
          <NavLink to="/conta" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-app-sm px-3 py-2 hover:bg-muted">
            <UserRound className="h-4 w-4" /> Minha conta
          </NavLink>
          <button className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 hover:bg-muted" onClick={() => savePrefs({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} Tema {dark ? 'claro' : 'escuro'}
          </button>
          <div className="px-3 pb-1 pt-2">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Minha cor</div>
            <div className="grid grid-cols-6 gap-1.5">
              {PRESET_COLORS.slice(0, 11).map((c) => (
                <button key={c} title={c} onClick={() => savePrefs({ primaryColor: c })}
                  className={cx('h-6 w-6 rounded-full ring-offset-2 ring-offset-surface', user.preferences?.primaryColor === c && 'ring-2 ring-ink')} style={{ background: c }} />
              ))}
              <button title="Cor da empresa" onClick={() => savePrefs({ primaryColor: null })}
                className={cx('grid h-6 w-6 place-items-center rounded-full border border-dashed border-line text-[9px] text-ink-faint', !user.preferences?.primaryColor && 'ring-2 ring-ink ring-offset-2 ring-offset-surface')}>A</button>
            </div>
          </div>
          <button className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 text-red-600 hover:bg-muted" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

function Dropdown({ item, light }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const active = item.children.some((c) => (c.end ? loc.pathname === c.to : loc.pathname.startsWith(c.to)));
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen((o) => !o)} onMouseEnter={() => setOpen(true)}
        className={cx('flex h-14 items-center gap-2 whitespace-nowrap border-b-[3px] px-2.5 text-sm font-medium transition xl:px-3',
          active ? 'border-primary-fg text-primary-fg' : 'border-transparent text-primary-fg/80 hover:text-primary-fg', !light && 'text-ink')}>
        <item.icon className="h-[18px] w-[18px]" />{item.label}<ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div className="card animate-pop absolute left-0 top-full z-50 w-52 p-1.5">
          {item.children.map((c) => (
            <NavLink key={c.to} to={c.to} end={c.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-app-sm px-3 py-2 text-sm', isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-muted')}>
              <c.icon className="h-4 w-4" />{c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileDrawer({ nav, onClose }) {
  const { company } = useAuth();
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-black/40 animate-fade" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Menu" className="flex h-full w-72 flex-col bg-surface animate-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-16 items-center justify-between px-4"><Logo company={company} /><button className="btn-ghost btn-icon" onClick={onClose} aria-label="Fechar menu"><X className="h-4 w-4" /></button></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {nav.flatMap((n) => (n.children ? [{ section: n.label }, ...n.children] : [n])).map((n, i) => (n.section
            ? <div key={i} className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{n.section}</div>
            : (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose}
                className={({ isActive }) => cx('flex items-center gap-3 rounded-app-sm px-3 py-2.5 text-sm font-medium', isActive ? 'bg-primary/10 text-primary' : 'text-ink-soft hover:bg-muted')}>
                <n.icon className="h-[18px] w-[18px]" />{n.label}
              </NavLink>
            )))}
        </nav>
        <div className="border-t border-line p-3"><UserMenu up /></div>
      </aside>
    </div>
  );
}

/** Layout com menu superior (opcional). */
function TopLayout() {
  const { company } = useAuth();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const wide = false;
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 bg-primary text-primary-fg shadow-sm">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
          <button className="btn-icon h-9 rounded-app-sm hover:bg-primary-fg/10 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="shrink-0"><Logo company={company} light compact /></div>
          <nav className="ml-3 hidden h-14 items-stretch lg:flex">
            {nav.map((n) => (n.children ? <Dropdown key={n.label} item={n} light /> : (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => cx('flex items-center gap-2 whitespace-nowrap border-b-[3px] px-2.5 text-sm font-medium transition xl:px-3',
                  isActive ? 'border-primary-fg text-primary-fg' : 'border-transparent text-primary-fg/80 hover:text-primary-fg')}>
                <n.icon className="h-[18px] w-[18px]" />{n.short || n.label}
              </NavLink>
            )))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5"><SearchButton light /><HelpButton light /><Notifications light /><QuickActions light /><UserMenu light /></div>
        </div>
      </header>
      {open && <MobileDrawer nav={nav} onClose={() => setOpen(false)} />}
      <DemoBanner />
        <BillingNotices />
      <main key={loc.pathname} className="has-bottom-nav flex-1 overflow-y-auto">
        <div className={cx('mx-auto w-full p-4 animate-fade sm:p-6', wide ? 'max-w-none lg:px-6' : 'max-w-[1400px] lg:p-8')}>
          <div className="mb-3"><Breadcrumbs nav={nav} /></div>
          <Outlet />
        </div>
      </main>
      <BottomNav nav={nav} onMore={() => setOpen(true)} />
    </div>
  );
}

const readCollapsed = () => { try { return localStorage.getItem('apolven:sidebar') === '1'; } catch { return false; } };

// Grupos do menu: os do dia a dia começam abertos; a escolha de abrir/fechar fica lembrada neste aparelho.
const DAILY_GROUPS = ['Relacionamento', 'Vendas', 'Carteira', 'Financeiro'];
const NAV_KEY = 'apolven:navgroups';
const readGroups = () => { try { return JSON.parse(localStorage.getItem(NAV_KEY) || '{}') || {}; } catch { return {}; } };
const saveGroup = (label, open) => { try { localStorage.setItem(NAV_KEY, JSON.stringify({ ...readGroups(), [label]: open })); } catch { /* sem armazenamento */ } };

/** Grupo do menu lateral: expande/recolhe; recolhido mostra só ícones com dica. */
function SideGroup({ item, collapsed }) {
  const loc = useLocation();
  const active = item.children.some((c) => (c.end ? loc.pathname === c.to : loc.pathname.startsWith(c.to)));
  const [open, setOpen] = useState(() => {
    const saved = readGroups()[item.label];
    return active || (saved ?? DAILY_GROUPS.includes(item.label));
  });
  useEffect(() => { if (active) setOpen(true); }, [active]);
  if (collapsed) {
    return (
      <div className="space-y-0.5 border-t border-line/60 pt-1.5 first:border-0">
        {item.children.map((c) => <SideLink key={c.to} item={c} collapsed />)}
      </div>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((o) => { saveGroup(item.label, !o); return !o; })} aria-expanded={open}
        className={cx('flex w-full items-center gap-2 rounded-app-sm px-3 pb-1 pt-3 text-xs font-semibold', active ? 'text-primary' : 'text-ink-faint hover:text-ink-soft')}>
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown className={cx('h-3.5 w-3.5 transition', !open && '-rotate-90')} />
      </button>
      {open && <div className="space-y-0.5">{item.children.map((c) => <SideLink key={c.to} item={c} />)}</div>}
    </div>
  );
}

/** Barra inferior no celular: atalhos do dia a dia + "Mais" (menu completo). */
const BOTTOM_PRIORITY = [
  { to: '/agenda', short: 'Agenda' }, { to: '/cotacoes', short: 'Cotações' }, { to: '/renovacoes', short: 'Renovações' },
  { to: '/parcelas', short: 'Parcelas' }, { to: '/comissoes', short: 'Comissões' }, { to: '/clientes', short: 'Clientes' },
];
function BottomNav({ nav, onMore }) {
  const all = nav.flatMap((n) => n.children || [n]);
  const home = all.find((x) => x.to === '/');
  const picks = BOTTOM_PRIORITY.map((p) => { const it = all.find((x) => x.to === p.to); return it && { ...it, short: p.short }; }).filter(Boolean).slice(0, 3);
  const items = [home && { ...home, short: 'Início' }, ...picks].filter(Boolean);
  return (
    <nav aria-label="Atalhos" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}
            className={({ isActive }) => cx('flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium',
              isActive ? 'text-primary' : 'text-ink-faint')}>
            <i.icon className="h-5 w-5" aria-hidden />{i.short}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-ink-faint">
          <Menu className="h-5 w-5" aria-hidden />Mais
        </button>
      </div>
    </nav>
  );
}

function SideLink({ item, collapsed }) {
  return (
    <NavLink to={item.to} end={item.end} title={collapsed ? item.label : undefined} aria-label={item.label}
      className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-app-sm text-sm font-medium transition',
        collapsed ? 'h-10 justify-center' : 'px-3 py-2',
        isActive ? 'bg-primary/10 text-primary' : 'text-ink-soft hover:bg-muted hover:text-ink')}>
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-app-sm bg-ink px-2 py-1 text-xs text-surface shadow-lg group-hover:block group-focus-visible:block">
          {item.label}
        </span>
      )}
    </NavLink>
  );
}

/** Layout padrão: menu lateral recolhível com grupos, trilha, busca global e notificações. */
function SideLayout() {
  const { company } = useAuth();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const loc = useLocation();
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('apolven:sidebar', c ? '0' : '1'); } catch { /* sem armazenamento */ } return !c; });
  const wide = false;
  return (
    <div className="flex h-full">
      <aside className={cx('hidden h-full flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-64')}>
        <div className={cx('flex h-14 items-center', collapsed ? 'justify-center' : 'px-4')}><Logo company={company} compact={collapsed} /></div>
        <nav className={cx('flex-1 space-y-0.5 overflow-y-auto py-2', collapsed ? 'overflow-x-visible px-2' : 'px-3')} aria-label="Menu principal">
          {nav.map((n) => (n.children ? <SideGroup key={n.label} item={n} collapsed={collapsed} /> : <SideLink key={n.to} item={n} collapsed={collapsed} />))}
        </nav>
        <div className="border-t border-line p-2">
          <button onClick={toggle} className="btn-ghost h-9 w-full justify-center gap-2 text-xs text-ink-faint" title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Recolher menu</>}
          </button>
        </div>
      </aside>
      {open && <MobileDrawer nav={nav} onClose={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-4">
          <button className="btn-ghost btn-icon lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden"><Logo company={company} compact /></div>
          <div className="hidden min-w-0 flex-1 lg:block"><Breadcrumbs nav={nav} /></div>
          <div className="ml-auto flex items-center gap-1.5">
            <SearchButton />
            <HelpButton />
            <Notifications />
            <QuickActions />
            <div className="hidden sm:block"><UserMenu /></div>
          </div>
        </header>
        <DemoBanner />
        <BillingNotices />
        <main key={loc.pathname} className="has-bottom-nav flex-1 overflow-y-auto">
          <div className={cx('mx-auto w-full p-4 animate-fade sm:p-6', wide ? 'max-w-none lg:px-6' : 'max-w-[1400px] lg:p-8')}>
            <div className="mb-3 lg:hidden"><Breadcrumbs nav={nav} /></div>
            <Outlet />
          </div>
        </main>
        <BottomNav nav={nav} onMore={() => setOpen(true)} />
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, company } = useAuth();
  useShortcuts();
  // menu lateral recolhível é o padrão; a barra superior continua disponível (empresa ou "Minha conta")
  const layout = (user?.preferences?.layout || company?.settings?.layout) === 'top' ? 'top' : 'side';
  return (
    <>
      {layout === 'top' ? <TopLayout /> : <SideLayout />}
      <GlobalSearch />
    </>
  );
}
