// Adaptador "API de cotação — padrão APOLVEN": chama a API cadastrada pela corretora (endereço, autenticação e tempo
// configurados na conexão) seguindo o contrato apolven-cotacao/1. Toda chamada passa por secureRequest (SSRF) e a
// resposta só é aceita se for JSON e estiver no contrato. Nunca devolve segredo em mensagens.
import crypto from 'node:crypto';
import { secureRequest, parseJsonStrict, joinUrl, safeHeaderName, SafeHttpError } from './safeHttp.js';
import { CONTRACT, PATHS, validateResponse, validateStatus, buildQuoteRequest, mapResponse } from './quoteApi.js';

export const MAX_RESPONSE = 512 * 1024;
export const DEFAULT_TIMEOUT = 15000;
const tokenCache = new Map(); // conexão+credencial → { token, exp } (somente em memória)

const timeoutOf = (cfg) => Math.min(30000, Math.max(2000, Number(cfg?.timeout_ms) || DEFAULT_TIMEOUT));

const cacheKey = (cfg, cred, connectionId) => crypto.createHash('sha256').update(`${connectionId}|${cfg.token_url}|${cred.client_id}|${cred.client_secret}|${cfg.scope || ''}`).digest('hex');

async function oauthToken(cfg, cred, connectionId, deadline) {
  const key = cacheKey(cfg, cred, connectionId);
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 30000) return hit.token;
  const form = new URLSearchParams({ grant_type: 'client_credentials', ...(cfg.scope ? { scope: cfg.scope } : {}) }).toString();
  const res = await secureRequest(cfg.token_url, {
    method: 'POST', body: form, timeoutMs: Math.max(1000, deadline - Date.now()), maxBytes: 64 * 1024,
    headers: {
      'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(cred.client_id)}:${encodeURIComponent(cred.client_secret)}`).toString('base64')}`,
    },
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new SafeHttpError('AUTH_REJECTED', `O servidor de autorização recusou as credenciais (HTTP ${res.status}).`);
  if (res.status >= 300) throw new SafeHttpError(res.status >= 500 || res.status === 429 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_ERROR', `O servidor de autorização respondeu HTTP ${res.status}.`);
  const j = parseJsonStrict(res.text);
  if (typeof j.access_token !== 'string' || !j.access_token || j.access_token.length > 8192) throw new SafeHttpError('INVALID_JSON', 'O servidor de autorização não devolveu access_token.');
  const ttl = Math.min(3600, Math.max(60, Number(j.expires_in) || 300));
  tokenCache.set(key, { token: j.access_token, exp: Date.now() + ttl * 1000 });
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
  return j.access_token;
}

/** Cabeçalhos de autenticação conforme o tipo configurado. */
async function authHeaders(cfg, cred, connectionId, deadline) {
  if (cfg.auth_type === 'bearer') return { authorization: `Bearer ${cred.token}` };
  if (cfg.auth_type === 'api_key') {
    const name = safeHeaderName(cfg.header_name);
    if (!name) throw new SafeHttpError('CONFIG_INVALID', 'Nome do cabeçalho da chave de API inválido.');
    return { [name]: cred.api_key };
  }
  if (cfg.auth_type === 'oauth2_cc') return { authorization: `Bearer ${await oauthToken(cfg, cred, connectionId, deadline)}` };
  throw new SafeHttpError('CONFIG_INVALID', 'Tipo de autenticação não configurado.');
}

/**
 * Envia com autenticação; no OAuth2, um 401 descarta o token guardado e tenta uma única vez com token novo
 * (o token pode ter sido revogado antes do vencimento).
 */
async function sendAuthed(cfg, cred, connectionId, deadline, send) {
  let res = await send(await authHeaders(cfg, cred, connectionId, deadline));
  if (res.status === 401 && cfg.auth_type === 'oauth2_cc' && deadline - Date.now() > 1500) {
    tokenCache.delete(cacheKey(cfg, cred, connectionId));
    res = await send(await authHeaders(cfg, cred, connectionId, deadline));
  }
  return res;
}

const ERR_TASK = {
  TIMEOUT: 'tempo_excedido', CONNECTION_FAILED: 'fonte_indisponivel', DNS_FAILED: 'fonte_indisponivel', UPSTREAM_UNAVAILABLE: 'fonte_indisponivel',
  AUTH_REJECTED: 'autorizacao_expirada', HOST_BLOCKED: 'indeterminado', URL_INVALID: 'indeterminado', REDIRECT_BLOCKED: 'indeterminado', TOO_LARGE: 'indeterminado',
  INVALID_JSON: 'indeterminado', TLS_ERROR: 'fonte_indisponivel', UPSTREAM_ERROR: 'indeterminado', CONFIG_INVALID: 'indeterminado', CONTRACT_VIOLATION: 'indeterminado',
};

const rawFor = (text) => { try { return JSON.parse(text); } catch { return { texto: String(text || '').slice(0, 4000) }; } };

export const apolvenAdapter = {
  /** "Testar conexão": autenticação + GET {base}/v1/status (somente leitura; nada é cotado). */
  async testConnection({ credentials, connection }) {
    const cfg = connection.api_config || {};
    if (!cfg.base_url) return { auth: 'nao_verificada', code: 'CREDENTIAL_MISSING' };
    const started = Date.now();
    const deadline = started + timeoutOf(cfg);
    try {
      const res = await sendAuthed(cfg, credentials, connection.id, deadline, (auth) => secureRequest(joinUrl(cfg.base_url, PATHS.status), {
        headers: { accept: 'application/json', 'x-apolven-contrato': CONTRACT, ...auth }, timeoutMs: Math.max(1000, deadline - Date.now()), maxBytes: 64 * 1024,
      }));
      const exchange = { http_status: res.status, duration_ms: Date.now() - started, response_raw: rawFor(res.text), response_bytes: res.bytes };
      if (res.status === 401 || res.status === 403) return { auth: 'invalida', code: 'AUTHENTICATION_REJECTED', exchange, detail: `A API recusou a autenticação (HTTP ${res.status}).` };
      if (res.status >= 500 || res.status === 429) return { auth: 'indisponivel', code: 'PROVIDER_TEMPORARILY_UNAVAILABLE', exchange, detail: `A API respondeu HTTP ${res.status}.` };
      if (res.status !== 200) return { auth: 'indisponivel', code: 'PROVIDER_TEMPORARILY_UNAVAILABLE', exchange, detail: `A API respondeu HTTP ${res.status} em ${PATHS.status}.` };
      const v = validateStatus(parseJsonStrict(res.text));
      if (!v.ok) return { auth: 'indisponivel', code: 'CAPABILITY_UNVERIFIED', exchange, detail: v.error };
      const branchesOk = !v.data.ramos?.length || !connection.products?.length || connection.products.some((p) => v.data.ramos.includes(p));
      return {
        auth: 'valida', environment: connection.environment, broker_code: null, exchange,
        capabilities: { cotacao: v.data.status === 'ok' && branchesOk ? 'autorizada' : 'nao_verificada' },
        limitations: [
          `Contrato ${CONTRACT} reconhecido${v.data.seguradora ? ` (${v.data.seguradora})` : ''}${v.data.ambiente ? ` · ambiente informado pela API: ${v.data.ambiente}` : ''}.`,
          ...(v.data.status !== 'ok' ? ['A API informou que está indisponível no momento.'] : []),
          ...(!branchesOk ? [`A API informou outros ramos (${v.data.ramos.join(', ')}) que não os produtos desta conexão.`] : []),
          ...(v.data.ambiente === 'homologacao' && connection.environment === 'producao' ? ['Atenção: a API se declara de homologação, mas a conexão está em produção.'] : []),
        ],
      };
    } catch (e) {
      const code = e instanceof SafeHttpError ? e.code : 'CONNECTION_FAILED';
      return {
        auth: code === 'AUTH_REJECTED' ? 'invalida' : 'indisponivel',
        code: code === 'AUTH_REJECTED' ? 'AUTHENTICATION_REJECTED' : 'PROVIDER_TEMPORARILY_UNAVAILABLE',
        detail: e instanceof SafeHttpError ? e.message : 'Falha técnica ao chamar a API.',
        exchange: { http_status: null, duration_ms: Date.now() - started, error: code },
      };
    }
  },

  /** Cotação: POST {base}/v1/cotacoes. Devolve { ok, status, offers, reason, protocol, exchange }. */
  async quote({ round, task, connection, credentials, quoteContext }) {
    const cfg = connection.api_config || {};
    const started = Date.now();
    const deadline = started + timeoutOf(cfg);
    const { body, fields } = buildQuoteRequest({ taskId: task.id, round, scenario: task.scenario, connection, ...quoteContext });
    const exchange = { fields_sent: fields, request_hash: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') };
    const end = (status, reason, extra = {}) => ({ ok: false, status, reason, ...extra, exchange: { ...exchange, duration_ms: Date.now() - started, outcome: status, error: reason, ...extra.exchange } });
    try {
      const res = await sendAuthed(cfg, credentials, connection.id, deadline, (auth) => secureRequest(joinUrl(cfg.base_url, PATHS.quote), {
        method: 'POST', body, timeoutMs: Math.max(1000, deadline - Date.now()), maxBytes: MAX_RESPONSE,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-apolven-contrato': CONTRACT, 'idempotency-key': task.id, ...auth },
      }));
      const ex = { http_status: res.status, response_bytes: res.bytes, response_raw: rawFor(res.text) };
      if (res.status === 401 || res.status === 403) return end('autorizacao_expirada', `A API recusou a autenticação (HTTP ${res.status}): confira as credenciais e teste a conexão.`, { exchange: ex });
      if (res.status === 408 || res.status === 429 || res.status >= 500) return end('fonte_indisponivel', `A API respondeu HTTP ${res.status} — falha técnica, não é recusa.`, { exchange: ex });
      if (res.status === 422) return end('dados_insuficientes', 'A API informou que os dados enviados não bastam para cotar (HTTP 422).', { exchange: ex });
      if (res.status !== 200) return end('indeterminado', `A API respondeu HTTP ${res.status}.`, { exchange: ex });
      if (!/application\/(.+\+)?json/i.test(String(res.headers['content-type'] || ''))) return end('indeterminado', 'A API não respondeu com Content-Type application/json.', { exchange: ex });
      const v = validateResponse(parseJsonStrict(res.text), task.id);
      if (!v.ok) return end('indeterminado', v.error.slice(0, 480), { exchange: ex });
      const m = mapResponse(v.data, quoteContext?.today);
      return {
        ok: true, status: m.status, offers: m.offers, refusal: m.refusal,
        exchange: { ...exchange, ...ex, duration_ms: Date.now() - started, outcome: m.status },
      };
    } catch (e) {
      const code = e instanceof SafeHttpError ? e.code : 'CONNECTION_FAILED';
      const msg = e instanceof SafeHttpError ? e.message : 'Falha técnica ao chamar a API.';
      return end(ERR_TASK[code] || 'indeterminado', code === 'TIMEOUT' ? 'Sem resposta dentro do tempo configurado: pesquisa parcial (não é recusa).' : msg, { exchange: { error: code } });
    }
  },
  submitProposal: () => ({ ok: false, code: 'UNSUPPORTED_CAPABILITY' }),
};
