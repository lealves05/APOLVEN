import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';
import { applyTheme } from '../lib/theme';

const Ctx = createContext(null);
const EMPTY = { loading: false, user: null, company: null, permissions: {}, permissionCatalog: [] };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...EMPTY, loading: !!getToken() });
  const [meta, setMeta] = useState(null);

  const load = useCallback(async () => {
    if (!getToken()) return setState(EMPTY);
    try {
      const s = await api.get('/auth/me');
      setState({ loading: false, ...s });
    } catch {
      setState(EMPTY);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const out = () => setState(EMPTY);
    window.addEventListener('apolven:logout', out);
    let t = null;
    const onAccess = () => { clearTimeout(t); t = setTimeout(() => { load(); }, 300); };
    window.addEventListener('apolven:access', onAccess);
    return () => { window.removeEventListener('apolven:logout', out); window.removeEventListener('apolven:access', onAccess); clearTimeout(t); };
  }, [load]);

  // metadados do catálogo (ramos, formulários de risco, coberturas, estados) — carregados uma vez por sessão
  useEffect(() => {
    if (state.user && !state.mfa_setup_required && !meta) api.get('/v1/catalog/meta').then(setMeta).catch(() => {});
  }, [state.user, state.mfa_setup_required, meta]);

  useEffect(() => {
    applyTheme(state.company?.settings, state.user?.preferences);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const h = () => applyTheme(state.company?.settings, state.user?.preferences);
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, [state.company, state.user]);

  const value = useMemo(() => {
    const enter = (s, remember) => { setToken(s.token, remember); setState({ loading: false, ...s }); };
    return {
      ...state,
      meta,
      /** Devolve { mfa_required, challenge } quando o segundo fator é exigido. */
      async login(email, password, remember = false) {
        const s = await api.post('/auth/login', { email, password });
        if (s.mfa_required) return s;
        enter(s, remember);
        return s;
      },
      async verifyMfa(challenge, payload, remember = false) {
        const s = await api.post('/auth/mfa/verify', { challenge, ...payload });
        enter(s, remember);
      },
      async register(data) { enter(await api.post('/auth/register', data), false); },
      async demo() { enter(await api.post('/auth/demo', {}), false); },
      async activate(data) { enter(await api.post('/auth/activate', data), false); },
      /** Sessão nova devolvida por troca de senha / MFA. */
      replaceSession(s) { if (s?.token) setToken(s.token); setState((st) => ({ ...st, ...s, loading: false })); },
      logout() { setToken(null, false); setState(EMPTY); setMeta(null); },
      setCompany(company) { setState((s) => ({ ...s, company })); load(); },
      async savePrefs(preferences) {
        setState((s) => ({ ...s, user: { ...s.user, preferences: { ...s.user.preferences, ...preferences } } }));
        const r = await api.put('/auth/me', { preferences });
        setState((s) => ({ ...s, ...r }));
      },
      refresh: load,
      /** true se o perfil tem QUALQUER uma das permissões (escopo 'all'/'own' conta como sim). */
      can(...keys) {
        if (!state.user) return false;
        if (state.user.role === 'owner') return true;
        return keys.some((k) => { const v = state.permissions?.[k]; return v === true || v === 'all' || v === 'own'; });
      },
      scope(key) { if (state.user?.role === 'owner') return 'all'; const v = state.permissions?.[key]; return v === true ? 'all' : v || 'none'; },
      /** Módulo liberado pela central da plataforma (sem central configurada, tudo liberado). */
      feature(key) { return state.access?.features ? state.access.features[key] !== false : true; },
      branchLabel(b) { return (meta?.branches || state.branches || {})[b] || b; },
    };
  }, [state, meta, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const useSettings = () => useContext(Ctx).company?.settings || {};
