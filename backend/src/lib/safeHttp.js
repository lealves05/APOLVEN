// Chamadas HTTP a endereços informados pela corretora (API de cotação de seguradora/parceiro) com proteção contra SSRF:
//  - só https (porta 443 ou ≥ 1024), sem usuário/senha na URL, sem query/fragmento no endereço base;
//  - IP literal recusado; o nome é resolvido e TODOS os endereços precisam ser públicos (privado, loopback, link-local,
//    metadados de nuvem, CGNAT, multicast, documentação, 6to4/Teredo/NAT64… são recusados — IPv4 e IPv6);
//  - a conexão é feita no IP já conferido (sem nova resolução: evita DNS rebinding), com SNI/Host do nome original;
//  - sem redirecionamento, com tempo máximo e limite de tamanho da resposta.
// Localhost só é aceito com APOLVEN_ALLOW_LOCAL_API=1 (desenvolvimento/testes/gravação de aulas) — nunca por padrão:
// com a variável, aceita-se "localhost" e nomes que resolvem para loopback (127.0.0.0/8, ::1); outras redes internas continuam bloqueadas.
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export class SafeHttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const localApiAllowed = () => globalThis.process?.env?.APOLVEN_ALLOW_LOCAL_API === '1';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const BLOCKED_SUFFIX = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.arpa'];
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'cookie', 'keep-alive', 'upgrade',
  'proxy-authorization', 'te', 'trailer', 'expect', 'accept-encoding', 'idempotency-key', 'x-apolven-contrato']);

// ---------- Faixas de IP não públicas ----------
const v4num = (ip) => ip.split('.').reduce((a, b) => (a * 256) + Number(b), 0);
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [v4num(base), bits]);

export function isPublicIPv4(ip) {
  if (net.isIPv4(ip) !== true) return false;
  const n = v4num(ip);
  return !V4_BLOCKED.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

/** IPv6 → 8 blocos de 16 bits (aceita forma comprimida e IPv4 embutido). */
export function ipv6Words(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = v4num(v4[1]);
    s = s.slice(0, -v4[1].length) + `${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const words = [...head, ...Array(fill).fill('0'), ...tail];
  if (words.length !== 8 || words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.map((w) => parseInt(w, 16));
}

export function isPublicIPv6(ip) {
  const w = ipv6Words(ip);
  if (!w) return false;
  // só unicast global (2000::/3)
  if ((w[0] & 0xe000) !== 0x2000) return false;
  if (w[0] === 0x2001 && w[1] < 0x0200) return false;   // 2001::/23 (Teredo, ORCHID, benchmarking, IANA)
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentação
  if (w[0] === 0x2002) return false;                     // 6to4 (IPv4 embutido)
  if (w[0] === 0x3fff && w[1] < 0x1000) return false;    // documentação (3fff::/20)
  return true;
}

export function isPublicIp(ip) {
  if (net.isIPv4(ip)) return isPublicIPv4(ip);
  if (net.isIPv6(ip)) {
    const w = ipv6Words(ip);
    // IPv4 mapeado (::ffff:a.b.c.d) / NAT64 (64:ff9b::/96): decide pelo IPv4 embutido — e NAT64 nunca
    if (w && w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return isPublicIPv4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
    return isPublicIPv6(ip);
  }
  return false;
}

const isLoopback = (ip) => (net.isIPv4(ip) ? ip.startsWith('127.') : (ipv6Words(ip) || []).join(',') === '0,0,0,0,0,0,0,1');

/**
 * Valida o endereço sem rede (no cadastro e antes de cada chamada). Devolve { url, host, port, local }.
 * `allowPath` = o endereço é base (pode ter caminho, sem query/fragmento).
 */
export function validateApiUrl(value, { label = 'Endereço da API' } = {}) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch { throw new SafeHttpError('URL_INVALID', `${label}: informe uma URL completa começando com https://.`); }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const local = localApiAllowed() && LOCAL_HOSTS.has(host);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new SafeHttpError('URL_INVALID', `${label}: use somente https://.`);
  if (u.username || u.password) throw new SafeHttpError('URL_INVALID', `${label}: não coloque usuário ou senha na URL.`);
  if (u.search || u.hash) throw new SafeHttpError('URL_INVALID', `${label}: informe o endereço base, sem "?" nem "#".`);
  if (!local) {
    if (net.isIP(host)) throw new SafeHttpError('HOST_BLOCKED', `${label}: use o nome do servidor (ex.: api.seguradora.com.br), não um IP.`);
    if (!host.includes('.') || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.split('.').some((p) => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))) {
      throw new SafeHttpError('URL_INVALID', `${label}: nome de servidor inválido.`);
    }
    if (host === 'localhost' || BLOCKED_SUFFIX.some((s) => host.endsWith(s))) throw new SafeHttpError('HOST_BLOCKED', `${label}: endereço interno não é permitido.`);
    const port = u.port ? Number(u.port) : 443;
    if (port !== 443 && port < 1024) throw new SafeHttpError('URL_INVALID', `${label}: porta não permitida (use 443 ou acima de 1024).`);
  }
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  return { url: u, host, port, local };
}

/** Resolve o nome e confere TODOS os endereços. Devolve o IP a usar na conexão (fixado). */
export async function resolvePublic(host, { local = false } = {}) {
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch { throw new SafeHttpError('DNS_FAILED', 'Não foi possível encontrar o servidor da API (DNS).'); }
  if (!addrs?.length) throw new SafeHttpError('DNS_FAILED', 'Não foi possível encontrar o servidor da API (DNS).');
  for (const a of addrs) {
    const ok = local ? isLoopback(a.address) : isPublicIp(a.address) || (localApiAllowed() && isLoopback(a.address));
    if (!ok) throw new SafeHttpError('HOST_BLOCKED', 'O endereço da API aponta para uma rede interna ou reservada e foi bloqueado.');
  }
  return addrs[0].address;
}

export function safeHeaderName(name) {
  const n = String(name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(n) || FORBIDDEN_HEADERS.has(n.toLowerCase())) return null;
  return n;
}

/** Junta o endereço base com um caminho fixo do contrato (o caminho nunca vem do formulário). */
export function joinUrl(base, path) {
  const u = new URL(String(base));
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
  return u.toString();
}

/**
 * Requisição protegida. Nada de redirecionamento; resposta limitada a maxBytes; tempo total limitado.
 * Devolve { status, headers, text, bytes, durationMs }.
 */
export async function secureRequest(target, { method = 'GET', headers = {}, body = null, timeoutMs = 15000, maxBytes = 512 * 1024 } = {}) {
  const { url, host, port, local } = validateApiUrl(target);
  const started = Date.now();
  const ip = await resolvePublic(host, { local });
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  const hostHeader = url.port ? `${host}:${url.port}` : host;
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (code, msg) => { if (!done) { done = true; clearTimeout(timer); reject(new SafeHttpError(code, msg)); } };
    const req = lib.request({
      host: ip, port, method, path: `${url.pathname}${url.search}`, agent: false,
      ...(url.protocol === 'https:' && !net.isIP(host) ? { servername: host } : {}),
      headers: { ...headers, host: hostHeader, ...(payload ? { 'content-length': payload.length } : {}) },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); req.destroy(); fail('REDIRECT_BLOCKED', `A API respondeu com redirecionamento (HTTP ${res.statusCode}); redirecionamentos não são seguidos.`); return; }
      const declared = Number(res.headers['content-length']);
      if (declared && declared > maxBytes) { res.resume(); req.destroy(); fail('TOO_LARGE', 'A resposta da API passou do tamanho máximo permitido.'); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); fail('TOO_LARGE', 'A resposta da API passou do tamanho máximo permitido.'); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), bytes: size, durationMs: Date.now() - started });
      });
      res.on('error', () => fail('CONNECTION_FAILED', 'A conexão com a API foi interrompida.'));
    });
    const timer = setTimeout(() => { req.destroy(); fail('TIMEOUT', 'A API não respondeu dentro do tempo configurado.'); }, Math.max(1000, timeoutMs));
    req.on('error', (e) => {
      const tls = /certificate|self[- ]signed|SSL|TLS|altnames/i.test(`${e.code || ''} ${e.message || ''}`);
      fail(tls ? 'TLS_ERROR' : 'CONNECTION_FAILED', tls ? 'O certificado HTTPS da API não é válido para este endereço.' : 'Não foi possível conectar à API.');
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** JSON estrito: exige corpo JSON (objeto), sem BOM/lixo. */
export function parseJsonStrict(text) {
  if (typeof text !== 'string' || !text.trim()) throw new SafeHttpError('INVALID_JSON', 'A API respondeu sem conteúdo JSON.');
  let v;
  try { v = JSON.parse(text); } catch { throw new SafeHttpError('INVALID_JSON', 'A API respondeu com JSON inválido.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SafeHttpError('INVALID_JSON', 'A API deve responder com um objeto JSON.');
  return v;
}
