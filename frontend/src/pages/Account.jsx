// Minha conta: perfil, senha, verificação em duas etapas (TOTP) e aparência.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, KeyRound, LogOut, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, PageHeader, Section, Notice, Toggle, useAction, FAIL, cx } from '../components/ui';
import { ROLES } from '../lib/format';
import { PRESET_COLORS } from '../lib/theme';
import { Logo } from '../components/Layout';

/** Ativação do segundo fator: QR code + confirmação + códigos de recuperação exibidos uma única vez. */
export function MfaEnroll({ onDone }) {
  const { replaceSession } = useAuth();
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [run, busy] = useAction();
  const start = async () => {
    const r = await run(() => api.post('/auth/mfa/setup', {}));
    if (r === FAIL) return;
    setSetup(r);
    setQr(await QRCode.toDataURL(r.otpauth, { margin: 1, width: 200 }));
  };
  const enable = async () => {
    const r = await run(() => api.post('/auth/mfa/enable', { code }), 'Verificação em duas etapas ativada.');
    if (r === FAIL) return;
    setCodes(r.recovery_codes);
    replaceSession(r);
  };
  if (codes) {
    return (
      <div className="space-y-3">
        <Notice tone="warn">Guarde estes códigos de recuperação em local seguro. Cada um vale uma vez e <b>não serão exibidos novamente</b>.</Notice>
        <div className="grid grid-cols-2 gap-2 rounded-app-sm bg-muted p-3 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}><Copy className="h-4 w-4" /> Copiar</button>
          {onDone && <button className="btn-primary" onClick={onDone}>Concluir</button>}
        </div>
      </div>
    );
  }
  if (!setup) return <button className="btn-primary" onClick={start} disabled={busy}><ShieldCheck className="h-4 w-4" /> Configurar com aplicativo autenticador</button>;
  return (
    <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
      <img src={qr} alt="QR code para o aplicativo autenticador" className="h-[200px] w-[200px] rounded-app-sm bg-white p-2" />
      <div className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
          <li>Abra um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Leia o QR code ou digite a chave abaixo.</li>
          <li>Informe o código de 6 dígitos gerado.</li>
        </ol>
        <div className="rounded-app-sm bg-muted px-3 py-2 font-mono text-xs break-all">{setup.secret}</div>
        <div className="flex items-end gap-2">
          <Input label="Código de 6 dígitos" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <button className="btn-primary" disabled={busy || code.length !== 6} onClick={enable}>Ativar</button>
        </div>
      </div>
    </div>
  );
}

/** Tela obrigatória para perfis críticos sem MFA (Master/administradores/financeiro — 26.1). */
export function MfaRequiredScreen() {
  const { company, user, logout, refresh } = useAuth();
  return (
    <div className="grid min-h-full place-items-center bg-bg p-4">
      <div className="card w-full max-w-2xl p-6 sm:p-8">
        <div className="mb-5"><Logo company={company} /></div>
        <h1 className="text-xl font-semibold">Ative a verificação em duas etapas</h1>
        <p className="mt-1 text-sm text-ink-soft">Seu perfil (<b>{ROLES[user?.role]}</b>) acessa dados financeiros, credenciais ou a administração da corretora. Por segurança, o segundo fator é obrigatório antes de continuar.</p>
        <div className="mt-6"><MfaEnroll onDone={refresh} /></div>
        <button className="btn-ghost mt-6" onClick={logout}><LogOut className="h-4 w-4" /> Sair</button>
      </div>
    </div>
  );
}

export default function Account() {
  const { user, savePrefs, replaceSession, refresh, mfa_roles: mfaRoles = [], company } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [dis, setDis] = useState({ code: '', password: '' });
  useEffect(() => setName(user.name), [user.name]);
  const required = mfaRoles.includes(user.role) && !company?.is_demo;
  const changePw = async () => {
    if (pw.newPassword !== pw.confirm) { toast('As senhas não conferem.', 'error'); return; }
    const r = await run(() => api.put('/auth/me', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }), 'Senha alterada. As outras sessões foram encerradas.');
    if (r !== FAIL) { replaceSession(r); setPw({ currentPassword: '', newPassword: '', confirm: '' }); }
  };
  const disable = async () => {
    const r = await run(() => api.post('/auth/mfa/disable', dis), 'Verificação em duas etapas desativada.');
    if (r !== FAIL) { replaceSession(r); setDis({ code: '', password: '' }); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Minha conta e segurança" subtitle={`${user.email} · ${ROLES[user.role]}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Perfil">
          <div className="flex items-end gap-2">
            <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <button className="btn-primary" disabled={busy || name.trim().length < 2} onClick={async () => { const r = await run(() => api.put('/auth/me', { name }), 'Nome atualizado.'); if (r !== FAIL) refresh(); }}>Salvar</button>
          </div>
        </Section>
        <Section title="Senha" subtitle="Trocar a senha encerra as outras sessões abertas.">
          <div className="space-y-3">
            <Input label="Senha atual" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nova senha" type="password" autoComplete="new-password" hint="Mínimo de 10 caracteres, com letras e números" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
              <Input label="Repita a nova senha" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </div>
            <button className="btn-primary" disabled={busy || !pw.currentPassword || pw.newPassword.length < 10} onClick={changePw}><KeyRound className="h-4 w-4" /> Trocar senha</button>
          </div>
        </Section>
        <Section title="Verificação em duas etapas" subtitle={required ? 'Obrigatória para o seu perfil.' : 'Recomendada; obrigatória para administrar credenciais de integração.'} className="lg:col-span-2">
          {user.mfa_enabled ? (
            <div className="space-y-3">
              <Notice tone="ok">Ativa. Ao entrar, o sistema pede o código do aplicativo autenticador.</Notice>
              {!required && (
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Input label="Código atual" inputMode="numeric" value={dis.code} onChange={(e) => setDis({ ...dis, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                  <Input label="Senha" type="password" value={dis.password} onChange={(e) => setDis({ ...dis, password: e.target.value })} />
                  <button className="btn-outline" disabled={busy || dis.code.length !== 6 || !dis.password} onClick={disable}>Desativar</button>
                </div>
              )}
            </div>
          ) : <MfaEnroll />}
        </Section>
        <Section title="Aparência" className="lg:col-span-2">
          <div className="space-y-4">
            <div>
              <div className="label">Minha cor</div>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button key={c} title={c} onClick={() => savePrefs({ primaryColor: c })} className={cx('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface', user.preferences?.primaryColor === c && 'ring-2 ring-ink')} style={{ background: c }} />
                ))}
                <button onClick={() => savePrefs({ primaryColor: null })} className="btn-ghost h-7 text-xs">Cor da corretora</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[['system', 'Seguir o sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => (
                <button key={v} onClick={() => savePrefs({ theme: v })} className={cx('btn-outline', (user.preferences?.theme || 'system') === v && 'border-primary text-primary')}>{l}</button>
              ))}
            </div>
            <Toggle checked={(user.preferences?.layout || 'side') === 'top'} onChange={(v) => savePrefs({ layout: v ? 'top' : 'side' })} label="Menu na barra superior" hint="Desligado: menu lateral recolhível." />
            <Toggle checked={user.preferences?.density === 'compact'} onChange={(v) => savePrefs({ density: v ? 'compact' : 'normal' })} label="Modo compacto" hint="Linhas e botões mais baixos para telas densas." />
          </div>
        </Section>
      </div>
    </div>
  );
}
