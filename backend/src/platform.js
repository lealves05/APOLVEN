/**
 * Ligação do APOLVEN com a central da plataforma (MASTER do ORBI) — contrato v1.
 *
 * A central decide assinatura, período de teste, bloqueio e módulos de cada empresa, com a mesma base de cobrança
 * de todos os sistemas. O APOLVEN guarda a última situação recebida (companies.platform_access) e aplica o portão
 * de acesso localmente; se a central ficar fora do ar, vale a última situação conhecida.
 *
 * Assinatura das chamadas (nos dois sentidos), com o segredo do sistema cadastrado na central:
 *   X-Platform-Product · X-Platform-Timestamp (s) · X-Platform-Signature = hex(HMAC-SHA256(segredo, `${ts}\n${MÉTODO}\n${rota}\n${sha256(corpo)}`))
 *
 * Configuração: PLATFORM_HUB_URL + PLATFORM_SECRET (+ PLATFORM_PRODUCT, padrão "apolven") nas variáveis de ambiente
 * ou, na Edge Function, na tabela _secrets (platform_hub_url, platform_secret). Sem configuração, nada é bloqueado.
 */
import crypto from 'node:crypto';
import { q, one } from './db.js';
import { HttpError } from './util.js';

const SKEW = 300;
const FRESH_MS = 5 * 60 * 1000;
let hubDownUntil = 0; // central fora do ar: evita esperar o tempo limite a cada requisição

/** Módulos do APOLVEN que a central pode ligar/desligar por plano ou corretora. `routes` = prefixos da API protegidos. */
export const FEATURES = {
  crm: { label: 'CRM, oportunidades e tarefas', routes: ['/opportunities'] },
  multicalculo: { label: 'Central de cotações e comparativos', routes: ['/quote-requests', '/comparisons'] },
  propostas: { label: 'Propostas e transmissão', routes: ['/proposals'] },
  renovacoes: { label: 'Renovações', routes: ['/renewals'] },
  comissoes: { label: 'Comissões e conciliação de extratos', routes: ['/commissions', '/statements'] },
  repasses: { label: 'Repasses a produtores e parceiros', routes: ['/splits', '/partners'] },
  financeiro: { label: 'Financeiro da corretora e conciliação bancária', routes: ['/finance'] },
  sinistros: { label: 'Sinistros e solicitações', routes: ['/claims', '/service-requests'] },
  integracoes: { label: 'Seguradoras e integrações', routes: ['/integrations'] },
  importacoes: { label: 'Importações', routes: ['/imports'] },
  relatorios: { label: 'Relatórios e indicadores', routes: ['/reports'] },
  exportacao: { label: 'Exportação de dados', routes: ['/export'] },
};
/** Rotas liberadas mesmo com a empresa bloqueada (regularização e leitura mínima). */
const BLOCKED_ALLOWED = ['/billing', '/export'];

// ---------------- configuração ----------------
let cfgCache = { at: 0, v: null };
export async function platformConfig() {
  if (Date.now() - cfgCache.at < 60000) return cfgCache.v;
  let hub = process.env.PLATFORM_HUB_URL || '';
  let secret = process.env.PLATFORM_SECRET || '';
  let product = process.env.PLATFORM_PRODUCT || '';
  if (!hub || !secret) {
    try {
      const { rows } = await q(`select key, value from _secrets where key in ('platform_hub_url','platform_secret','platform_product')`);
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      hub ||= m.platform_hub_url || ''; secret ||= m.platform_secret || ''; product ||= m.platform_product || '';
    } catch { /* tabela ainda não criada */ }
  }
  const v = hub && secret ? { hub: hub.replace(/\/+$/, ''), secret, product: product || 'apolven' } : null;
  cfgCache = { at: Date.now(), v };
  return v;
}
export const clearPlatformConfig = () => { cfgCache.at = 0; };

const sha256 = (s) => crypto.createHash('sha256').update(s || '').digest('hex');
const sign = (secret, ts, method, route, body) =>
  crypto.createHmac('sha256', secret).update(`${ts}\n${method.toUpperCase()}\n${route}\n${sha256(body)}`).digest('hex');

// ---------------- APOLVEN → central ----------------
export async function hubCall(method, route, payload, timeoutMs = 10000) {
  const cfg = await platformConfig();
  if (!cfg) throw new HttpError(503, 'A assinatura ainda não está configurada nesta instalação. Fale com o suporte.', { code: 'PLATFORM_NOT_CONFIGURED' });
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  let res;
  try {
    res = await fetch(`${cfg.hub}/api/hub/v1${route}`, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', 'X-Platform-Product': cfg.product, 'X-Platform-Timestamp': String(ts),
        'X-Platform-Signature': sign(cfg.secret, ts, method, route, body) },
      body: body || undefined,
    });
  } catch {
    throw new HttpError(503, 'A central de assinaturas não respondeu. Tente novamente em instantes.', { code: 'PLATFORM_UNAVAILABLE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 401 ? 502 : res.status, data?.error || `Central: erro ${res.status}`, { code: data?.code });
  return data;
}

/** Dados da corretora enviados à central (sem senhas, tokens nem dados de clientes). */
export async function tenantPayload(companyId) {
  const c = await one(`select c.id, c.name, c.trade_name, c.email, c.phone, c.document, c.created_at, c.is_demo,
                              (select u.name from users u where u.company_id=c.id and u.role='owner' order by u.created_at limit 1) as owner_name,
                              (select u.email from users u where u.company_id=c.id and u.role='owner' order by u.created_at limit 1) as owner_email,
                              (select max(last_login_at) from users u where u.company_id=c.id) as last_access_at
                         from companies c where c.id=$1`, [companyId]);
  if (!c) return null;
  const m = await one(`select
      (select count(*)::int from users where company_id=$1 and active) as users,
      (select count(*)::int from clients where company_id=$1 and merged_into is null) as clients,
      (select count(*)::int from policies where company_id=$1 and contract_state='vigente') as policies_active,
      (select count(*)::int from quote_requests where company_id=$1 and created_at > now() - interval '30 days') as quotes_30d,
      (select count(*)::int from provider_connections where company_id=$1 and revoked_at is null) as connections`, [companyId]);
  return { remote_id: c.id, name: c.trade_name || c.name, email: c.owner_email || c.email, phone: c.phone, document: c.document,
    owner_name: c.owner_name, owner_email: c.owner_email, created_at: c.created_at, last_access_at: c.last_access_at, is_demo: c.is_demo, metrics: m };
}

async function storeAccess(companyId, access) {
  await q('update companies set platform_access=$2, platform_access_at=now() where id=$1', [companyId, JSON.stringify(access)]);
}

/** Cadastra (ou atualiza) a empresa na central e guarda a situação recebida. Demonstrações nunca são cadastradas. */
export async function registerCompany(companyId) {
  const cfg = await platformConfig();
  if (!cfg) return null;
  const t = await tenantPayload(companyId);
  if (!t || t.is_demo) return null;
  const { is_demo: _d, owner_email: _o, ...payload } = t;
  const out = await hubCall('POST', '/tenants', payload);
  await q('update companies set platform_registered_at=coalesce(platform_registered_at, now()) where id=$1', [companyId]);
  if (out?.access) await storeAccess(companyId, out.access);
  return out?.access || null;
}

/**
 * Situação de acesso da empresa (null = sem central configurada ou empresa de demonstração: acesso livre).
 * Usa a última situação recebida; se tiver mais de 5 min, consulta a central. Falha da central não bloqueia ninguém.
 */
export async function accessFor(companyId, { fresh = false } = {}) {
  const cfg = await platformConfig();
  if (!cfg) return null;
  const c = await one('select is_demo, platform_access, platform_access_at from companies where id=$1', [companyId]);
  if (!c || c.is_demo) return null;
  const age = c.platform_access_at ? Date.now() - new Date(c.platform_access_at).getTime() : Infinity;
  if (!fresh && c.platform_access && age < FRESH_MS) return c.platform_access;
  // central fora do ar há pouco: não espera de novo a cada requisição
  if (!fresh && Date.now() < hubDownUntil) return c.platform_access || null;
  try {
    const out = await hubCall('GET', `/tenants/${encodeURIComponent(companyId)}/access`, undefined, 4000);
    await storeAccess(companyId, out.access);
    return out.access;
  } catch (e) {
    if (e.status === 404) { try { return await registerCompany(companyId); } catch { /* segue com a última situação */ } }
    else hubDownUntil = Date.now() + 60000;
    return c.platform_access || null;
  }
}

// ---------------- Modo de operação (F13) ----------------
// standalone: instalação sem cobrança central (acesso livre, explícito). saas_required: a central decide o acesso.
// Padrão: saas_required em produção, standalone fora dela. Pode ser definido por PLATFORM_MODE ou _secrets.platform_mode.
const STALE_MAX_MS = 72 * 3600 * 1000; // última situação conhecida vale até 72 h com a central fora do ar
let modeCache = { at: 0, v: null };
export async function platformMode() {
  if (Date.now() - modeCache.at < 60000 && modeCache.v) return modeCache.v;
  let m = process.env.PLATFORM_MODE || '';
  if (!m) { try { m = (await one("select value from _secrets where key = 'platform_mode'"))?.value || ''; } catch { /* sem tabela */ } }
  if (!['standalone', 'saas_required'].includes(m)) m = process.env.NODE_ENV === 'production' ? 'saas_required' : 'standalone';
  modeCache = { at: Date.now(), v: m };
  return m;
}
const unavailable = () => new HttpError(503, 'Não foi possível confirmar a situação da assinatura agora. Tente de novo em alguns minutos; se continuar, fale com o suporte.', { code: 'PLATFORM_UNAVAILABLE' });

/** Portão: empresa bloqueada → 402 (exceto a regularização); módulo fora do plano → 403. */
export async function platformGate(req, _res, next) {
  const mode = await platformMode();
  const access = await accessFor(req.companyId);
  req.access = access;
  if (!access) {
    if (mode === 'standalone') return next();
    const c = await one('select is_demo, platform_access, platform_access_at from companies where id=$1', [req.companyId]);
    if (c?.is_demo) return next(); // demonstração não passa pela central
    if (!(await platformConfig())) {
      console.error('[plataforma] modo saas_required sem central configurada');
      throw new HttpError(503, 'A cobrança central não está configurada nesta instalação. Fale com o suporte.', { code: 'PLATFORM_NOT_CONFIGURED' });
    }
    throw unavailable(); // sem nenhuma situação conhecida e central fora do ar
  }
  if (mode === 'saas_required') {
    const c = await one('select platform_access_at from companies where id=$1', [req.companyId]);
    const age = c?.platform_access_at ? Date.now() - new Date(c.platform_access_at).getTime() : Infinity;
    // situação velha demais (central fora há mais de 72 h): só a regularização e o bloqueio continuam valendo
    if (age > STALE_MAX_MS && !access.blocked) throw unavailable();
  }
  const path = req.path;
  if (access.blocked && !BLOCKED_ALLOWED.some((p) => path === p || path.startsWith(`${p}/`))) {
    throw new HttpError(402, 'O acesso está temporariamente suspenso devido à situação da assinatura. Seus dados permanecem preservados.',
      { code: 'TENANT_BLOCKED', status: access.status, reason: access.reason });
  }
  const f = access.features || {};
  for (const [key, def] of Object.entries(FEATURES)) {
    if (f[key] === false && def.routes.some((p) => path === p || path.startsWith(`${p}/`))) {
      throw new HttpError(403, `O módulo ${def.label} não está disponível no seu plano.`, { code: 'FEATURE_DISABLED', feature: key });
    }
  }
  next();
}

// ---------------- central → APOLVEN ----------------
/** Aceita só chamadas assinadas pela central com o segredo deste sistema. */
export async function verifyHubRequest(req, _res, next) {
  const cfg = await platformConfig();
  const deny = () => new HttpError(401, 'Chamada da central não autenticada.');
  if (!cfg) throw new HttpError(503, 'Ligação com a central não configurada.');
  const ts = Number(req.headers['x-platform-timestamp']);
  const sig = String(req.headers['x-platform-signature'] || '');
  if (String(req.headers['x-platform-product'] || '') !== cfg.product || !Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) throw deny();
  if (Math.abs(Date.now() / 1000 - ts) > SKEW) throw deny();
  const body = req.rawBody ? req.rawBody.toString('utf8') : '';
  const want = sign(cfg.secret, ts, req.method, req.url, body);
  if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) throw deny();
  next();
}

export { storeAccess };
