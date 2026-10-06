// Seguradoras e Integrações › conexão "API de cotação — padrão APOLVEN" › etapa 3: endereço https, autenticação,
// credenciais (enviadas só ao servidor, cifradas no cofre e nunca exibidas de volta), tempo máximo e "Testar conexão".
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, PlugZap, Globe, KeyRound, FileJson, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Section, KV, Input, Select, Notice, Spinner, SubmitButton, useAction, FAIL, cx } from './ui';
import { fmtDateTime } from '../lib/format';

export const AUTH_LABEL = { bearer: 'Bearer token', api_key: 'Chave de API em cabeçalho', oauth2_cc: 'OAuth2 (client credentials)' };
const SECRET_FIELDS = {
  bearer: [['token', 'Token (Bearer)', true]],
  api_key: [['api_key', 'Chave de API', true]],
  oauth2_cc: [['client_id', 'Client ID', false], ['client_secret', 'Client secret', true]],
};
const httpsProblem = (v, label) => {
  const s = String(v || '').trim();
  if (!s) return `Informe ${label}.`;
  if (!/^https:\/\//i.test(s) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(s)) return `${label[0].toUpperCase()}${label.slice(1)} precisa começar com https://.`;
  if (/[?#]/.test(s)) return `${label[0].toUpperCase()}${label.slice(1)}: sem "?" nem "#".`;
  return null;
};

export default function QuoteApiConfig({ c, reload, readOnly, onTest, testing }) {
  const { user, company } = useAuth();
  const [run, busy] = useAction();
  const cfg = c.api_config || null;
  const active = (c.credentials || []).find((x) => !x.revoked_at);
  const [v, setV] = useState(() => ({
    base_url: cfg?.base_url || '', auth_type: cfg?.auth_type || 'bearer', header_name: cfg?.header_name || 'X-API-Key',
    token_url: cfg?.token_url || '', scope: cfg?.scope || '', timeout_s: String(Math.round((cfg?.timeout_ms || 15000) / 1000)),
  }));
  const [secrets, setSecrets] = useState({});
  const [reauth, setReauth] = useState('');
  const [mfaMissing, setMfaMissing] = useState(false);
  useEffect(() => () => { setSecrets({}); setReauth(''); }, []); // segredos somem ao sair da etapa
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }));
  const sameAuth = !!cfg && cfg.auth_type === v.auth_type && !!active;
  const fields = SECRET_FIELDS[v.auth_type];
  const typed = fields.some(([k]) => String(secrets[k] || '').trim());
  const keep = sameAuth && !typed;
  const last = c.tests?.[0];
  const cot = (c.capability_list || []).find((x) => x.capability === 'cotacao');

  const problems = [
    httpsProblem(v.base_url, 'o endereço da API'),
    v.auth_type === 'oauth2_cc' && httpsProblem(v.token_url, 'o endereço do token'),
    v.auth_type === 'api_key' && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(v.header_name) && 'Nome do cabeçalho: letras, números e hífen.',
    !keep && fields.filter(([k]) => !String(secrets[k] || '').trim()).map(([, l]) => `Informe ${l}.`).join(' '),
    !(Number(v.timeout_s) >= 2 && Number(v.timeout_s) <= 30) && 'Tempo máximo entre 2 e 30 segundos.',
    !(user?.mfa_enabled ? reauth.length === 6 : reauth) && (user?.mfa_enabled ? 'Informe o código do autenticador.' : 'Confirme sua senha de acesso ao APOLVEN.'),
  ].filter(Boolean);

  const save = async () => {
    setMfaMissing(false);
    const body = {
      base_url: v.base_url.trim(), auth_type: v.auth_type, timeout_ms: Math.round(Number(v.timeout_s) * 1000),
      header_name: v.auth_type === 'api_key' ? v.header_name.trim() : null,
      token_url: v.auth_type === 'oauth2_cc' ? v.token_url.trim() : null, scope: v.auth_type === 'oauth2_cc' ? v.scope.trim() || null : null,
      secrets: keep ? {} : Object.fromEntries(fields.map(([k]) => [k, String(secrets[k] || '').trim()])), keep_secrets: keep,
      ...(user?.mfa_enabled ? { mfa_code: reauth } : { password: reauth }),
    };
    const r = await run(() => api.put(`/v1/integrations/connections/${c.id}/api-config`, body), 'API de cotação salva. Agora teste a conexão.', (e) => {
      if (e.code === 'MFA_REQUIRED') { setMfaMissing(true); return true; }
      if (e.code === 'REAUTH_REQUIRED') setReauth('');
      return false;
    });
    setSecrets({}); setReauth('');
    if (r !== FAIL) reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-4">
        <Section title="API de cotação" subtitle="Endereço e autenticação da API que a seguradora (ou parceiro/middleware) disponibilizou no padrão APOLVEN">
          {readOnly ? <Notice>Seu perfil não administra credenciais desta conexão.</Notice> : (
            <form className="space-y-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (!problems.length) save(); }}>
              {!user?.mfa_enabled && !company?.is_demo && <Notice>Administrar credenciais exige verificação em duas etapas ativa. <Link to="/conta" className="underline">Ativar em Minha conta</Link>.</Notice>}
              {mfaMissing && <Notice tone="danger">Ative a verificação em duas etapas para administrar credenciais. <Link to="/conta" className="underline">Ir para Minha conta</Link>.</Notice>}
              <Input label="Endereço base da API (https) *" value={v.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder="https://api.seguradora.com.br/apolven"
                inputMode="url" spellCheck={false} autoCapitalize="off"
                hint="O APOLVEN chama {endereço}/v1/status (teste) e {endereço}/v1/cotacoes (cotação). Endereços internos, IPs e redirecionamentos são bloqueados." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Autenticação *" value={v.auth_type} onChange={(e) => { set('auth_type', e.target.value); setSecrets({}); }}>
                  {Object.entries(AUTH_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Input label="Tempo máximo de resposta (segundos)" type="number" min={2} max={30} value={v.timeout_s} onChange={(e) => set('timeout_s', e.target.value)}
                  hint="Sem resposta nesse tempo, a consulta fica como “tempo esgotado” (não é recusa)." />
              </div>
              {v.auth_type === 'api_key' && (
                <Input label="Nome do cabeçalho da chave" value={v.header_name} onChange={(e) => set('header_name', e.target.value)} spellCheck={false} hint="Ex.: X-API-Key" />
              )}
              {v.auth_type === 'oauth2_cc' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Endereço do token (https) *" value={v.token_url} onChange={(e) => set('token_url', e.target.value)} spellCheck={false} placeholder="https://auth.seguradora.com.br/oauth/token" />
                  <Input label="Escopo (opcional)" value={v.scope} onChange={(e) => set('scope', e.target.value)} spellCheck={false} placeholder="cotacao" />
                </div>
              )}
              <div className="rounded-app-sm border border-line p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><KeyRound className="h-4 w-4" />Credenciais</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields.map(([k, label, secret]) => (
                    <label key={k} className="block">
                      <span className="label">{label}</span>
                      <input className="input font-mono" type={secret ? 'password' : 'text'} autoComplete={secret ? 'new-password' : 'off'} spellCheck={false} autoCapitalize="off"
                        data-lpignore="true" data-1p-ignore="true" name={`apv-api-${k}`} value={secrets[k] || ''} onChange={(e) => setSecrets((x) => ({ ...x, [k]: e.target.value }))}
                        placeholder={sameAuth ? '•••••••• (mantida — preencha só para trocar)' : ''} />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-faint">Enviadas só ao servidor, guardadas cifradas e nunca exibidas de volta.{sameAuth ? ' Deixe em branco para manter as atuais.' : ''}</p>
              </div>
              {user?.mfa_enabled ? (
                <Input label="Código do autenticador (6 dígitos)" inputMode="numeric" autoComplete="one-time-code" value={reauth}
                  onChange={(e) => setReauth(e.target.value.replace(/\D/g, '').slice(0, 6))} hint="Confirmação de identidade para esta operação." />
              ) : (
                <Input label="Sua senha de acesso ao APOLVEN" type="password" autoComplete="current-password" value={reauth} onChange={(e) => setReauth(e.target.value)}
                  hint="Confirmação de identidade para esta operação." />
              )}
              <Notice>Ao salvar, a configuração anterior é substituída e a cotação automática volta a pendente até um novo teste.</Notice>
              <div className="flex flex-wrap justify-end gap-2">
                <SubmitButton busy={busy} problems={problems} onClick={save}><ShieldCheck className="h-4 w-4" />{cfg ? 'Salvar alterações' : 'Salvar API de cotação'}</SubmitButton>
              </div>
            </form>
          )}
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Situação" actions={cfg && !readOnly && onTest && (
          <button type="button" className="btn-primary" disabled={testing} onClick={onTest}>{testing ? <Spinner className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}Testar conexão</button>
        )}>
          {cfg ? (
            <KV cols={1} items={[
              ['Servidor', <span key="h" className="inline-flex items-center gap-1.5 break-all"><Globe className="h-3.5 w-3.5 shrink-0" />{safeHost(cfg.base_url)}</span>],
              ['Autenticação', AUTH_LABEL[cfg.auth_type] || cfg.auth_type],
              ['Credencial', active ? `Versão ${active.version} · ${fmtDateTime(active.created_at)}` : '—'],
              ['Último teste', last ? <TestLine key="t" test={last} /> : 'Ainda não testada'],
              ['Cotação automática', cot?.state === 'ativa'
                ? <span key="a" className={cx('chip', c.environment === 'producao' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-violet-500/15 text-violet-700')}>{c.environment === 'producao' ? 'Ativa — entra no multicálculo' : 'Ativa só em testes'}</span>
                : <span key="p" className="text-ink-soft">{cot?.reason || 'Pendente'}</span>],
            ]} />
          ) : <p className="text-sm text-ink-faint">Nenhuma API configurada ainda.</p>}
          {cfg && c.accreditation !== 'sim' && <Notice tone="warn" className="mt-3">Confirme o credenciamento nesta seguradora (etapa 1) para que ela entre nas cotações.</Notice>}
          {cfg && c.environment !== 'producao' && <Notice tone="warn" className="mt-3">Conexão em ambiente de testes: não entra no multicálculo real. Use produção quando a seguradora liberar.</Notice>}
        </Section>
        <Section title="Contrato da API">
          <p className="text-sm text-ink-soft">A API precisa seguir o contrato público <b>apolven-cotacao/1</b>: requisição e resposta em JSON, valores em centavos, ofertas com status válida, indicativa ou recusa.</p>
          <Link to="/integracoes?tab=contrato" className="btn-outline mt-3"><FileJson className="h-4 w-4" />Ver contrato e exemplos</Link>
          <p className="mt-3 text-xs text-ink-faint">Dados enviados a cada consulta: só os necessários para precificar (segurado, risco, coberturas, vigência e preferências). E-mail, telefone e observações internas não são enviados. Cada envio fica registrado na cotação.</p>
        </Section>
      </div>
    </div>
  );
}

function safeHost(u) { try { return new URL(u).host; } catch { return u; } }

function TestLine({ test }) {
  const ok = test.results?.autenticacao === 'valida';
  return (
    <span className={cx('inline-flex items-start gap-1.5', ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600')}>
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{ok ? 'Conexão aprovada' : 'Falhou'} · {fmtDateTime(test.created_at)}{test.results?.http?.duracao_ms != null ? ` · ${test.results.http.duracao_ms} ms` : ''}
        {!ok && test.results?.limitacoes?.[0] && <span className="block text-xs text-ink-soft">{test.results.limitacoes[0]}</span>}</span>
    </span>
  );
}
