const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const apiBase = `${BASE}/api`;
/** URL absoluta de uma rota do app. */
export const appUrl = (path) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

// sessão: token em sessionStorage (some ao fechar a aba); "manter conectado" usa localStorage
const TOKEN_KEY = 'apolven.token';
export const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t, remember = null) => {
  try {
    const keep = remember ?? !!localStorage.getItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
    if (t) (keep ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch { /* sem armazenamento */ }
};

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Falha de comunicação com o servidor.');
    this.status = status;
    this.data = data;
    this.code = data?.code;
  }
}

async function request(method, path, body, headers = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'Servidor indisponível. Se for o primeiro acesso do dia, aguarde alguns segundos e tente de novo.' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !path.startsWith('/auth/login')) {
    if (data?.code !== 'REAUTH_REQUIRED') { setToken(null); window.dispatchEvent(new Event('apolven:logout')); }
  }
  if (res.status === 402 || (res.status === 403 && ['FEATURE_DISABLED', 'MFA_SETUP_REQUIRED'].includes(data?.code))) window.dispatchEvent(new Event('apolven:access'));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Chave de idempotência estável para uma operação sensível (29.2). */
export const idemKey = (prefix = 'op') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}, h) => request('POST', p, b, h),
  put: (p, b = {}, h) => request('PUT', p, b, h),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

/** Download autenticado (documentos, CSV): nunca coloca o token na URL. */
export async function download(path, fallbackName = 'arquivo') {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d); }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/);
  const name = m ? decodeURIComponent(m[1] || m[2]) : fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Arquivo → { filename, mime, data(base64) } para envio de documentos. */
export const fileToPayload = (file) => new Promise((resolve, reject) => {
  if (file.size > 8 * 1024 * 1024) { reject(new Error('Arquivo acima de 8 MB.')); return; }
  const r = new FileReader();
  r.onload = () => resolve({ filename: file.name, mime: file.type || 'application/octet-stream', data: String(r.result).split(',')[1] });
  r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
  r.readAsDataURL(file);
});
export const fileToText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
  r.readAsText(file, 'utf-8');
});

export const qs = (obj) => {
  const s = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
  const str = s.toString();
  return str ? `?${str}` : '';
};
