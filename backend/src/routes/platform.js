import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { setPassword } from '../security.js';
import { q, one, tx } from '../db.js';
import { parse, HttpError, notFound, ROLES } from '../util.js';
import { FEATURES, verifyHubRequest, tenantPayload, storeAccess, hubCall, accessFor } from '../platform.js';
import { settingsManifest, getSystemParams, setSystemParams, getTenantParams, setTenantParams } from '../params.js';

// =====================================================================
// Central → APOLVEN (/api/platform/v1): chamadas assinadas da central da plataforma
// =====================================================================
export const platformApi = Router();
platformApi.use(verifyHubRequest);
platformApi.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function company(id) {
  if (!uuid.test(id)) throw notFound('Empresa não encontrada.');
  const c = await one('select id, is_demo from companies where id=$1', [id]);
  if (!c || c.is_demo) throw notFound('Empresa não encontrada.');
  return c;
}

platformApi.get('/manifest', (_req, res) => res.json({
  code: 'apolven', name: 'APOLVEN', contract: 1, contract_minor: 1, version: process.env.APOLVEN_VERSION || '2026.10',
  description: 'Gestão para corretoras de seguros: CRM, cotações, propostas, apólices, parcelas, comissões, repasses e sinistros.',
  features: Object.fromEntries(Object.entries(FEATURES).map(([k, v]) => [k, v.label])),
  settings: settingsManifest(),
}));

platformApi.get('/tenants', async (_req, res) => {
  const { rows } = await q('select id from companies where not is_demo order by created_at limit 5000');
  const items = [];
  for (const r of rows) {
    const t = await tenantPayload(r.id);
    if (t) { const { is_demo: _d, ...x } = t; items.push(x); }
  }
  res.json({ items });
});

platformApi.get('/tenants/:id', async (req, res) => {
  const c = await company(req.params.id);
  const { is_demo: _d, ...t } = await tenantPayload(c.id);
  const { rows: users } = await q(`select name, email, role, active, last_login_at from users where company_id=$1 order by role='owner' desc, name limit 200`, [c.id]);
  const { rows: units } = await q('select name, active from units where company_id=$1 order by created_at', [c.id]);
  res.json({ tenant: { ...t, users: { n: users.length, active: users.filter((u) => u.active).length,
    list: users.map((u) => ({ ...u, role_label: ROLES[u.role] || u.role })) }, units } });
});

platformApi.post('/tenants/:id/access', async (req, res) => {
  const c = await company(req.params.id);
  const d = parse(z.object({ access: z.object({ status: z.string(), blocked: z.boolean() }).passthrough() }), req.body);
  await storeAccess(c.id, d.access);
  res.json({ ok: true });
});

/** A central pede uma nova senha para o responsável: senha provisória, exibida uma única vez ao administrador da central. */
platformApi.post('/tenants/:id/owner-reset', async (req, res) => {
  const c = await company(req.params.id);
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email().max(200).nullable().optional() }), req.body);
  const owner = await one(`select id, email from users where company_id=$1 and role='owner' order by created_at limit 1`, [c.id]);
  if (!owner) throw new HttpError(404, 'Esta empresa não tem usuário responsável.');
  let email = owner.email;
  if (d.email && d.email !== owner.email) {
    if (await one('select 1 from users where email=$1 and id<>$2', [d.email, owner.id])) throw new HttpError(409, 'Este e-mail já é usado por outro acesso.');
    await q('update users set email=$1 where id=$2', [d.email, owner.id]);
    email = d.email;
  }
  const temp = `Ap-${crypto.randomBytes(6).toString('base64url')}-${crypto.randomInt(10, 99)}`;
  // o responsável volta a cadastrar o segundo fator no primeiro acesso (perdeu o acesso ao autenticador)
  await q('update users set active = true, mfa_enabled = false, mfa_secret = null, mfa_recovery = null where id = $1', [owner.id]);
  await setPassword(null, owner.id, c.id, temp); // derruba as sessões anteriores do responsável
  await q(`insert into audit_log (company_id, user_id, user_name, entity, entity_id, action, summary, data)
           values ($1, null, 'Central da plataforma', 'user', $2, 'platform.owner_reset', 'Senha provisória do responsável criada pela central (segundo fator redefinido)', $3)`,
  [c.id, owner.id, JSON.stringify({ email })]);
  res.json({ ok: true, user_id: owner.id, email, temporary_password: temp,
    message: 'Senha provisória criada. No primeiro acesso o responsável troca a senha em "Minha conta" e cadastra de novo a verificação em duas etapas.' });
});

// ---- Parâmetros (contrato v1.1): do sistema e de cada empresa ----
platformApi.get('/settings', async (_req, res) => res.json({ values: await getSystemParams() }));
platformApi.put('/settings', async (req, res) => res.json({ values: await setSystemParams(req.body?.values) }));
platformApi.get('/tenants/:id/settings', async (req, res) => {
  const c = await company(req.params.id);
  res.json({ values: await getTenantParams(c.id) });
});
platformApi.put('/tenants/:id/settings', async (req, res) => {
  const c = await company(req.params.id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null;
  const changed = await tx(async (db) => {
    const ch = await setTenantParams(db, c.id, req.body?.values);
    await db.query(`insert into audit_log (company_id, user_id, user_name, entity, entity_id, action, summary, data)
                    values ($1, null, 'Central da plataforma', 'company', $2, 'platform.settings', $3, $4)`,
    [c.id, String(c.id), `Parâmetros alterados pela central${reason ? `: ${reason}` : ''}`, JSON.stringify(ch)]);
    return ch;
  });
  res.json({ ok: true, changed, values: await getTenantParams(c.id) });
});

// =====================================================================
// Portal da assinatura (/api/billing) — repassa à central as ações do proprietário/administrador
// =====================================================================
export const billing = Router();
const adminOnly = (req, _res, next) => {
  if (!['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Somente o proprietário ou um administrador gerencia a assinatura.');
  next();
};
const actor = (req) => ({ user_email: req.user.email, user_name: req.user.name });
const rid = (req) => encodeURIComponent(req.companyId);

billing.get('/', async (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.json({ access: await accessFor(req.companyId), restricted: true });
  const out = await hubCall('GET', `/tenants/${rid(req)}/billing`);
  if (out.access) await storeAccess(req.companyId, out.access);
  res.json(out);
});
billing.post('/checkout', adminOnly, async (req, res) => {
  const d = parse(z.object({ plan_id: z.string().uuid(), cycle: z.enum(['MONTHLY', 'ANNUAL']) }), req.body);
  res.status(201).json(await hubCall('POST', `/tenants/${rid(req)}/billing/checkout`, { ...d, ...actor(req) }));
});
billing.post('/renew', adminOnly, async (req, res) => {
  res.status(201).json(await hubCall('POST', `/tenants/${rid(req)}/billing/renew`, actor(req)));
});
billing.post('/change-plan', adminOnly, async (req, res) => {
  const d = parse(z.object({ plan_id: z.string().uuid() }), req.body);
  const out = await hubCall('POST', `/tenants/${rid(req)}/billing/change-plan`, { ...d, ...actor(req) });
  await accessFor(req.companyId, { fresh: true });
  res.json(out);
});
billing.post('/cancel', adminOnly, async (req, res) => {
  parse(z.object({ confirm: z.literal(true, { errorMap: () => ({ message: 'confirme o cancelamento' }) }) }), req.body);
  const out = await hubCall('POST', `/tenants/${rid(req)}/billing/cancel`, { confirm: true, ...actor(req) });
  await accessFor(req.companyId, { fresh: true });
  res.json(out);
});
/** Depois de voltar da página de pagamento: consulta a situação atualizada. */
billing.post('/refresh', async (req, res) => res.json({ access: await accessFor(req.companyId, { fresh: true }) }));

