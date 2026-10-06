import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Calculator, Wallet, FileCheck2, PlugZap, Building2, PlayCircle, LogIn, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, cx, SubmitButton } from '../components/ui';
import { Logo } from '../components/Layout';
import { maskPhone, maskDoc } from '../lib/format';
import { api } from '../lib/api';

function Shell({ children }) {
  const features = [
    [Calculator, 'Cotações e comparativos', 'Rodadas por seguradora, respostas parciais e comparação técnica transparente.'],
    [FileCheck2, 'Propostas e apólices', 'Autorização, transmissão, aceite e conferência do documento como fatos separados.'],
    [Wallet, 'Comissões e repasses', 'Previsto, confirmado e liquidado separados; conciliação de extratos e estornos.'],
    [PlugZap, 'Seguradoras e integrações', 'Credenciamento, credenciais protegidas e ativação por função, sem integração fictícia.'],
  ];
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md animate-pop">
          <div className="mb-6"><Logo company={{ name: 'APOLVEN' }} /></div>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:flex lg:items-center lg:justify-center">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-[28rem] w-[28rem] rounded-full border-[40px] border-white/10" />
        <div className="relative max-w-md p-10 text-primary-fg">
          <h2 className="text-3xl font-semibold leading-tight">Sua corretora organizada.<br />Da cotação à comissão.</h2>
          <div className="mt-10 space-y-6">
            {features.map(([Icon, t, d]) => (
              <div key={t} className="flex gap-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-app-sm bg-white/15"><Icon className="h-5 w-5" /></div>
                <div><div className="font-medium">{t}</div><div className="text-sm opacity-80">{d}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeTabs({ mode }) {
  const tabs = [['/entrar', 'Entrar', LogIn], ['/cadastro', 'Cadastrar corretora', Building2]];
  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-app-sm bg-muted p-1">
      {tabs.map(([to, l, I]) => (
        <Link key={to} to={to} className={cx('flex items-center justify-center gap-2 rounded-[calc(var(--radius)*0.45)] px-3 py-2 text-sm font-medium transition',
          mode === to ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink')}>
          <I className="h-4 w-4" />{l}
        </Link>
      ))}
    </div>
  );
}

function DemoCard() {
  const nav = useNavigate();
  return (
    <div className="mt-6 rounded-app border border-dashed border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Quer só conhecer o sistema?</div>
          <p className="mt-0.5 text-xs text-ink-soft">Abra uma demonstração com clientes, apólices, cotações, parcelas e comissões fictícias. Você cria um login (e-mail e senha) para voltar quando quiser e, depois, ativa o uso normal com os seus dados.</p>
          <button className="btn-outline mt-3 w-full border-primary/40 text-primary" onClick={() => nav('/demonstracao')}>
            <PlayCircle className="h-4 w-4" /> Experimentar a demonstração
          </button>
        </div>
      </div>
    </div>
  );
}

/** Demonstração com login próprio: nome, e-mail e senha (mesma política do cadastro). */
export function DemoSignup() {
  const { demo } = useAuth();
  const { toast } = useUI();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const problems = [
    f.name.trim().length < 2 && { text: 'Informe seu nome.', field: 'Seu nome' },
    !/^\S+@\S+\.\S+$/.test(f.email.trim()) && { text: 'Informe um e-mail válido (será o seu login).', field: 'E-mail' },
    f.password.length < 10 && { text: 'A senha precisa de no mínimo 10 caracteres, com letras e números.', field: 'Senha' },
    f.password.length >= 10 && !(/[a-z]/i.test(f.password) && /\d/.test(f.password)) && { text: 'Use letras e números na senha.', field: 'Senha' },
    f.confirm !== f.password && { text: 'A confirmação da senha não confere.', field: 'Repita a senha' },
  ];
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await demo({ name: f.name.trim(), email: f.email.trim(), password: f.password });
      toast('Demonstração pronta! Os dados são fictícios; seu login vale para voltar depois.');
      nav('/');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Experimentar a demonstração</h1>
      <p className="mt-1 text-sm text-ink-faint">Crie seu login para entrar e voltar à demonstração quando quiser. Os dados de exemplo são fictícios e a demonstração é apagada após alguns dias sem ativação.</p>
      <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (!problems.some(Boolean)) submit(); }} noValidate>
        <Input label="Seu nome" autoComplete="name" value={f.name} onChange={set('name')} />
        <Input label="E-mail (será o seu login)" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
        <Input label="Senha" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} hint="Mínimo de 10 caracteres, com letras e números" />
        <Input label="Repita a senha" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />
        {err && <div role="alert" className="rounded-app-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">{err}{/cadastrado/i.test(err) && <> <Link to="/entrar" className="font-medium underline">Entrar</Link></>}</div>}
        <div className="flex flex-col gap-2">
          <SubmitButton className="btn-primary w-full" busy={busy} problems={problems} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} {busy ? 'Preparando a demonstração…' : 'Abrir a demonstração'}
          </SubmitButton>
        </div>
      </form>
      <p className="mt-4 text-center text-sm text-ink-faint">Já tem login? <Link to="/entrar" className="font-medium text-primary hover:underline">Entrar</Link></p>
    </Shell>
  );
}

export function Login() {
  const { login, verifyMfa } = useAuth();
  const { toast } = useUI();
  const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '', remember: false });
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await login(f.email, f.password, f.remember);
      if (r?.mfa_required) setChallenge(r.challenge);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await verifyMfa(challenge, useRecovery ? { recovery_code: code } : { code }, f.remember); }
    catch (err) { toast(err.message, 'error'); if (/tempo/.test(err.message)) setChallenge(null); } finally { setBusy(false); }
  };
  if (challenge) {
    return (
      <Shell>
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">Verificação em duas etapas</h1>
        <p className="mt-1 text-sm text-ink-faint">{useRecovery ? 'Informe um dos códigos de recuperação guardados na ativação.' : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'}</p>
        <form onSubmit={confirm} className="mt-6 space-y-4">
          <Input label={useRecovery ? 'Código de recuperação' : 'Código'} autoFocus inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code"
            value={code} onChange={(e) => setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <button className="btn-primary w-full" disabled={busy || (!useRecovery && code.length !== 6)}>{busy ? 'Conferindo…' : 'Confirmar'}</button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <button className="font-medium text-primary hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>{useRecovery ? 'Usar o aplicativo' : 'Perdi o acesso ao aplicativo'}</button>
          <button className="text-ink-faint hover:underline" onClick={() => { setChallenge(null); setCode(''); }}>Voltar</button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <ModeTabs mode={loc.pathname} />
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 text-sm text-ink-faint">Entre para gerenciar sua corretora.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input label="E-mail" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label="Senha" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <div className="-mt-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} /> Manter conectado neste aparelho</label>
          <Link to="/esqueci-senha" className="text-xs font-medium text-primary hover:underline">Esqueci minha senha</Link>
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <Link to="/cadastro" className="mt-4 flex items-center justify-center gap-1 text-sm font-medium text-primary hover:underline">
        Ainda não tem conta? Cadastre sua corretora <ArrowRight className="h-4 w-4" />
      </Link>
      <DemoCard />
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const { toast } = useUI();
  const loc = useLocation();
  const nav = useNavigate();
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '', phone: '', demo: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await register(f); toast('Corretora criada! Bem-vindo ao APOLVEN.'); nav('/'); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <ModeTabs mode={loc.pathname} />
      <h1 className="text-2xl font-semibold tracking-tight">Cadastre sua corretora</h1>
      <p className="mt-1 text-sm text-ink-faint">Leva menos de um minuto. Registro SUSEP, responsável técnico e credenciamentos você completa depois.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input label="Nome da corretora" required value={f.companyName} onChange={set('companyName')} placeholder="Ex.: Proteger Corretora de Seguros" />
        <Input label="CNPJ (opcional)" value={f.document || ''} onChange={(e) => setF({ ...f, document: maskDoc(e.target.value) })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Seu nome" required value={f.name} onChange={set('name')} />
          <Input label="Telefone / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} />
        </div>
        <Input label="E-mail (login)" type="email" required value={f.email} onChange={set('email')} />
        <Input label="Senha" type="password" minLength={10} required autoComplete="new-password" value={f.password} onChange={set('password')} hint="Mínimo de 10 caracteres, com letras e números" />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.demo} onChange={(e) => setF({ ...f, demo: e.target.checked })} />
          <span>Começar com dados de exemplo<span className="block text-xs text-ink-faint">Clientes, apólices e cotações fictícias para aprender o sistema (identificados como exemplo).</span></span>
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Criando…' : 'Criar minha corretora'}</button>
      </form>
      <DemoCard />
    </Shell>
  );
}

// "Esqueci minha senha": o link chega pelo e-mail de suporte da plataforma e vale por 60 minutos
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const [available, setAvailable] = useState(true);
  useEffect(() => { api.get('/auth/reset-options').then((r) => setAvailable(r.available !== false)).catch(() => {}); }, []);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/auth/forgot', { email }); setDone(r.message); }
    catch (e2) { if (e2.data?.code === 'RESET_UNAVAILABLE') setAvailable(false); else setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Esqueci minha senha</h1>
      {!available ? (
        <div className="mt-6 space-y-2 rounded-app-sm bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100" data-reset-unavailable>
          <p className="font-medium">A recuperação por e-mail ainda não está ativa.</p>
          <p><b>Colaborador:</b> peça ao administrador da corretora para definir uma nova senha em Usuários.</p>
          <p><b>Proprietário:</b> fale com o suporte do APOLVEN.</p>
        </div>
      ) : done ? (
        <div className="mt-6 rounded-app-sm bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200" data-forgot-done>{done} Confira também a caixa de spam. O e-mail vem do suporte da plataforma.</div>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-faint">Informe o e-mail de acesso. Enviaremos um link para você criar uma nova senha.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {err && <div className="rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{err}</div>}
            <Input label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/entrar" className="font-medium text-primary hover:underline">Voltar para o login</Link></p>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [f, setF] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) { setErr('As senhas não conferem.'); return; }
    setBusy(true);
    try { await api.post('/auth/reset', { token, new_password: f.password }); setDone(true); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Criar nova senha</h1>
      {!token ? <p className="mt-6 text-sm">Link inválido. Peça um novo em <Link to="/esqueci-senha" className="font-medium text-primary hover:underline">Esqueci minha senha</Link>.</p>
        : done ? (
          <div className="mt-6 space-y-4"><div className="rounded-app-sm bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">Senha alterada. Entre de novo com a nova senha.</div>
            <Link to="/entrar" className="btn-primary w-full">Entrar</Link></div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-ink-faint">Use ao menos 10 caracteres, com letras e números.</p>
            {err && <div className="rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{err}</div>}
            <Input label="Nova senha" type="password" autoComplete="new-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <Input label="Repita a nova senha" type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
          </form>
        )}
    </Shell>
  );
}
