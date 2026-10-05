import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import {
  signToken, requireAuth, signMfaChallenge, verifyMfaChallenge, newTotpSecret, verifyTotp, mfaRequired,
} from '../auth.js';
import {
  parse, slugify, withDefaults, HttpError, DEFAULT_SETTINGS, permissionsFor, PERMISSIONS, ROLES, MFA_ROLES, onlyDigits, validDocument, BRANCHES, sha256,
} from '../util.js';
import { seal, unseal } from '../secretbox.js';
import { seedDemo } from '../seed.js';
import { accessFor, registerCompany, hubCall } from '../platform.js';
import { audit } from '../audit.js';
import { passwordSchema, setPassword, limitByIp, limitByKey, clearHits } from '../security.js';
import { getSystemParams, systemNotice, newCompanySettings } from '../params.js';

const r = Router();
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0bYqK2Q0Yy9y8l1wq3J7wJ0eJ6a2';
const loginLimiter = limitByIp('login', 30, 15 * 60);
const signupLimiter = limitByIp('signup', 10, 60 * 60, 'Muitos cadastros a partir deste endereço. Tente mais tarde.');
const resetLimiter = limitByIp('reset', 30, 60 * 60);
const activateLimiter = limitByIp('activate', 10, 60 * 60);
const mfaLimiter = limitByIp('mfa', 30, 15 * 60);

export const COMPANY_COLS = `select id, name, trade_name, slug, document, susep_code, tech_responsible_name, tech_responsible_document, segments,
  phone, email, cep, street, number, complement, district, city, uf, city_code, logo_url, settings, is_demo, created_at
  from companies where id = $1`;

export async function loadSession(userId) {
  const user = await one(
    `select u.id, u.name, u.email, u.role, u.unit_id, u.team, u.preferences, u.company_id, u.auth_version, u.mfa_enabled
       from users u where u.id = $1`, [userId]);
  const company = await one(COMPANY_COLS, [user.company_id]);
  company.settings = withDefaults(company.settings);
  const access = await accessFor(company.id).catch(() => null);
  const notice = await systemNotice().catch(() => null);
  const { auth_version: _av, ...pub } = user;
  return {
    user: pub, company, access, notice, permissions: permissionsFor(user.role, company.settings), permissionCatalog: PERMISSIONS, roles: ROLES,
    branches: BRANCHES, mfa_setup_required: mfaRequired(user, company.is_demo) && !user.mfa_enabled, mfa_roles: MFA_ROLES, _av,
  };
}
async function sessionWithToken(userId, { mfa = false } = {}) {
  const { _av, ...session } = await loadSession(userId);
  return { token: signToken({ id: session.user.id, company_id: session.user.company_id, auth_version: _av }, { mfa }), ...session };
}

const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'informe o nome da corretora'),
  document: z.string().trim().optional().nullable(),
  name: z.string().trim().min(2, 'informe seu nome'),
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  password: passwordSchema,
  phone: z.string().trim().optional(),
  demo: z.boolean().optional().default(false),
});
const signupClosed = () => new HttpError(403, 'Novos cadastros estão temporariamente fechados.');

async function createCompany(db, { name, document, phone, email, isDemo, slugBase }) {
  let slug = slugify(slugBase || name);
  const { rows: taken } = await db.query('select slug from companies where slug like $1', [`${slug}%`]);
  if (taken.some((t) => t.slug === slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const settings = await newCompanySettings(DEFAULT_SETTINGS);
  const { rows: [company] } = await db.query(
    'insert into companies (name, trade_name, slug, document, phone, email, settings, is_demo) values ($1,$1,$2,$3,$4,$5,$6,$7) returning id',
    [name, slug, document || null, phone || null, email || null, settings, !!isDemo]);
  await db.query(`insert into units (company_id, name, is_main) values ($1, 'Matriz', true)`, [company.id]);
  return company;
}

r.post('/register', signupLimiter, async (req, res) => {
  const d = parse(registerSchema, req.body);
  const sys = await getSystemParams();
  if (sys.signup_enabled === false) throw signupClosed();
  const doc = d.document ? onlyDigits(d.document) : null;
  if (doc && (doc.length !== 14 || !validDocument(doc))) throw new HttpError(400, 'CNPJ inválido.');
  if (await one('select 1 from users where email = $1', [d.email])) throw new HttpError(409, 'Este e-mail já está cadastrado.');
  const hash = await bcrypt.hash(d.password, 10);
  const userId = await tx(async (db) => {
    const company = await createCompany(db, { name: d.companyName, document: doc, phone: d.phone, email: d.email });
    const { rows: [unit] } = await db.query('select id from units where company_id = $1', [company.id]);
    const { rows: [user] } = await db.query(
      `insert into users (company_id, unit_id, name, email, password_hash, role) values ($1,$2,$3,$4,$5,'owner') returning id`,
      [company.id, unit.id, d.name, d.email, hash]);
    if (d.demo) await seedDemo(db, company.id, user.id);
    return user.id;
  });
  const u = await one('select company_id from users where id=$1', [userId]);
  await registerCompany(u.company_id).catch((e) => console.warn('[plataforma] cadastro na central adiado:', e.message));
  res.status(201).json(await sessionWithToken(userId));
});

r.post('/login', loginLimiter, async (req, res) => {
  const d = parse(z.object({
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    password: z.string().min(1, 'informe a senha'),
  }), req.body);
  await limitByKey('login', d.email, 10, 15 * 60, res, 'Muitas tentativas para esta conta. Aguarde 15 minutos ou use "Esqueci minha senha".');
  const user = await one('select id, company_id, password_hash, active, mfa_enabled, auth_version from users where email = $1', [d.email]);
  if (!(await bcrypt.compare(d.password, user?.password_hash || DUMMY_HASH)) || !user) {
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  if (!user.active) throw new HttpError(403, 'Usuário desativado. Fale com o administrador.');
  await clearHits(`login:id:${d.email}`);
  if (user.mfa_enabled) return res.json({ mfa_required: true, challenge: signMfaChallenge(user) });
  await q('update users set last_login_at=now() where id=$1', [user.id]);
  res.json(await sessionWithToken(user.id));
});

// ---------------- Verificação em duas etapas (26.1) ----------------
r.post('/mfa/verify', mfaLimiter, async (req, res) => {
  const d = parse(z.object({ challenge: z.string().min(10), code: z.string().trim().max(20).optional(), recovery_code: z.string().trim().max(40).optional() }), req.body);
  const p = verifyMfaChallenge(d.challenge);
  if (!p) throw new HttpError(401, 'O tempo para confirmar o código terminou. Entre novamente.');
  await limitByKey('mfa', p.uid, 8, 15 * 60, res, 'Muitos códigos incorretos. Aguarde 15 minutos.');
  const u = await one('select id, company_id, name, auth_version, mfa_enabled, mfa_secret, mfa_recovery, active from users where id = $1', [p.uid]);
  if (!u || !u.active || !u.mfa_enabled || Number(u.auth_version) !== p.av) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  let ok = false;
  if (d.code) ok = verifyTotp(unseal(u.mfa_secret, 'mfa').secret, d.code);
  else if (d.recovery_code) {
    const h = sha256(d.recovery_code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const list = Array.isArray(u.mfa_recovery) ? u.mfa_recovery : [];
    if (list.includes(h)) {
      ok = true;
      await q('update users set mfa_recovery = $2 where id = $1', [u.id, JSON.stringify(list.filter((x) => x !== h))]);
      await audit(null, { companyId: u.company_id, user: { id: u.id, name: u.name } }, { entity: 'user', entityId: u.id, action: 'mfa.recovery_used', summary: 'Entrou com código de recuperação' });
    }
  }
  if (!ok) throw new HttpError(401, 'Código incorreto.');
  await clearHits(`mfa:id:${p.uid}`);
  await q('update users set last_login_at=now() where id=$1', [u.id]);
  res.json(await sessionWithToken(u.id, { mfa: true }));
});

/** Gera um segredo novo (pendente até confirmar o primeiro código). */
r.post('/mfa/setup', requireAuth, async (req, res) => {
  const u = await one('select email, mfa_enabled from users where id = $1', [req.user.id]);
  if (u.mfa_enabled) throw new HttpError(409, 'A verificação em duas etapas já está ativa.');
  const secretB32 = newTotpSecret();
  await q('update users set mfa_secret = $2 where id = $1', [req.user.id, seal({ secret: secretB32 }, 'mfa')]);
  const label = encodeURIComponent(`APOLVEN:${u.email}`);
  res.json({ secret: secretB32, otpauth: `otpauth://totp/${label}?secret=${secretB32}&issuer=APOLVEN&algorithm=SHA1&digits=6&period=30` });
});

r.post('/mfa/enable', requireAuth, mfaLimiter, async (req, res) => {
  const d = parse(z.object({ code: z.string().trim() }), req.body);
  const u = await one('select mfa_secret, mfa_enabled from users where id = $1', [req.user.id]);
  if (u.mfa_enabled) throw new HttpError(409, 'A verificação em duas etapas já está ativa.');
  if (!u.mfa_secret) throw new HttpError(400, 'Gere o código QR primeiro.');
  if (!verifyTotp(unseal(u.mfa_secret, 'mfa').secret, d.code)) throw new HttpError(400, 'Código incorreto. Confira o horário do celular e tente de novo.');
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
  // ativar o MFA encerra as sessões anteriores (sem segundo fator); esta recebe um token novo
  await q(`update users set mfa_enabled = true, mfa_enabled_at = now(), mfa_recovery = $2, auth_version = auth_version + 1 where id = $1`,
    [req.user.id, JSON.stringify(codes.map((c) => sha256(c)))]);
  await audit(null, req, { entity: 'user', entityId: req.user.id, action: 'mfa.enable', summary: 'Ativou a verificação em duas etapas' });
  res.json({ ...(await sessionWithToken(req.user.id, { mfa: true })), recovery_codes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) });
});

r.post('/mfa/disable', requireAuth, async (req, res) => {
  const d = parse(z.object({ code: z.string().trim(), password: z.string().min(1) }), req.body);
  if (MFA_ROLES.includes(req.user.role) && !req.isDemo) throw new HttpError(403, 'Seu perfil exige a verificação em duas etapas.');
  const u = await one('select mfa_secret, mfa_enabled, password_hash from users where id = $1', [req.user.id]);
  if (!u.mfa_enabled) throw new HttpError(409, 'A verificação em duas etapas não está ativa.');
  if (!(await bcrypt.compare(d.password, u.password_hash)) || !verifyTotp(unseal(u.mfa_secret, 'mfa').secret, d.code)) throw new HttpError(401, 'Senha ou código incorretos.');
  await q('update users set mfa_enabled = false, mfa_secret = null, mfa_recovery = null, auth_version = auth_version + 1 where id = $1', [req.user.id]);
  await audit(null, req, { entity: 'user', entityId: req.user.id, action: 'mfa.disable', summary: 'Desativou a verificação em duas etapas' });
  res.json(await sessionWithToken(req.user.id));
});

// ---- Esqueci minha senha: link de uso único (60 min) enviado pela central, com o remetente da plataforma ----
const RESET_MIN = 60;
const GENERIC_FORGOT = { ok: true, message: 'Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha em alguns minutos.' };
const forgotLimiter = limitByIp('forgot', 20, 60 * 60, 'Muitos pedidos. Aguarde e tente de novo.');
let mailCache = { at: 0, v: false };
async function resetAvailable() {
  if (Date.now() - mailCache.at < 60000) return mailCache.v;
  let v = false;
  try { v = !!(await hubCall('GET', '/mail/status', undefined, 5000)).available; } catch { v = false; }
  mailCache = { at: Date.now(), v };
  return v;
}
r.get('/reset-options', async (_req, res) => res.json({ available: await resetAvailable() }));

r.post('/forgot', forgotLimiter, async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email('e-mail inválido').max(200) }), req.body);
  if (!(await resetAvailable())) throw new HttpError(503, 'A recuperação de senha por e-mail ainda não está ativa. Peça ao administrador da corretora para definir uma nova senha em Usuários, ou fale com o suporte.', { code: 'RESET_UNAVAILABLE' });
  try { await limitByKey('forgot', d.email, 3, 60 * 60); } catch { return res.json(GENERIC_FORGOT); }
  const u = await one(`select u.id, u.name, u.email, u.company_id, c.name as company_name, c.is_demo from users u join companies c on c.id = u.company_id
     where u.email = $1 and u.active`, [d.email]);
  if (!u || u.is_demo) return res.json(GENERIC_FORGOT);
  const token = crypto.randomBytes(32).toString('hex');
  await q('update password_resets set used_at = now() where user_id = $1 and used_at is null', [u.id]);
  await q(`insert into password_resets (user_id, token_hash, expires_at, ip) values ($1,$2, now() + make_interval(mins => $3), $4)`,
    [u.id, sha256(token), RESET_MIN, String(req.ip || '').slice(0, 64)]);
  try {
    await hubCall('POST', '/mail/password-reset', { to: u.email, name: u.name, company: u.company_name, path: `/redefinir-senha?token=${token}`, minutes: RESET_MIN }, 20000);
  } catch (e) {
    await q('update password_resets set used_at = now() where token_hash = $1', [sha256(token)]);
    throw new HttpError(e.status === 429 ? 429 : 502, e.status === 429 ? e.message : 'Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.');
  }
  await audit(null, { companyId: u.company_id, user: { id: u.id, name: u.name } }, { entity: 'user', entityId: u.id, action: 'senha_redefinicao_pedida', summary: 'Pediu o link de nova senha por e-mail' });
  res.json(GENERIC_FORGOT);
});

r.post('/reset', resetLimiter, async (req, res) => {
  const d = parse(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, 'link inválido'), new_password: passwordSchema }), req.body);
  const row = await one(`update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha256(d.token)]);
  if (!row) throw new HttpError(400, 'Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”.', { code: 'RESET_INVALID' });
  const u = await one('select id, name, company_id from users where id = $1 and active', [row.user_id]);
  if (!u) throw new HttpError(400, 'Conta indisponível.');
  await setPassword(null, u.id, u.company_id, d.new_password);
  await audit(null, { companyId: u.company_id, user: { id: u.id, name: u.name } }, { entity: 'user', entityId: u.id, action: 'senha_redefinida_email', summary: 'Senha redefinida pelo link do e-mail' });
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  const { _av, ...session } = await loadSession(req.user.id);
  res.json(session);
});

r.put('/me', requireAuth, async (req, res) => {
  const d = parse(z.object({
    name: z.string().trim().min(2).optional(),
    preferences: z.record(z.any()).optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  }), req.body);
  if (d.newPassword) {
    await limitByKey('me-password', req.user.id, 10, 15 * 60, res);
    const u = await one('select password_hash from users where id = $1', [req.user.id]);
    if (!d.currentPassword || !(await bcrypt.compare(d.currentPassword, u.password_hash))) throw new HttpError(400, 'Senha atual incorreta.');
    await setPassword(null, req.user.id, req.companyId, d.newPassword);
    await audit(null, req, { entity: 'user', entityId: req.user.id, action: 'password_change', summary: 'Trocou a própria senha (outras sessões encerradas)' });
  }
  if (d.name) await q('update users set name = $1 where id = $2', [d.name, req.user.id]);
  if (d.preferences) {
    const prefs = Object.fromEntries(Object.entries(d.preferences).slice(0, 30));
    await q('update users set preferences = preferences || $1::jsonb where id = $2', [prefs, req.user.id]);
  }
  if (d.newPassword) return res.json(await sessionWithToken(req.user.id, { mfa: req.mfaVerified }));
  const { _av, ...session } = await loadSession(req.user.id);
  res.json(session);
});

// ---------- Versão de demonstração ----------
const demoLimiter = limitByIp('demo', 10, 60 * 60, 'Muitas demonstrações criadas a partir deste endereço. Tente mais tarde.');

r.post('/demo', demoLimiter, async (_req, res) => {
  const sys = await getSystemParams();
  if (sys.demo_enabled === false) throw new HttpError(403, 'A demonstração está desativada no momento.');
  await q('delete from companies where is_demo and created_at < now() - make_interval(days => $1)', [Number(sys.demo_days) || 7]).catch(() => {});
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `demo-${rand}@demo.apolven.app`;
  const hash = await bcrypt.hash(`${rand}${Date.now()}`, 8);
  const userId = await tx(async (db) => {
    const company = await createCompany(db, { name: 'Corretora Demonstração', isDemo: true, slugBase: `demo-${rand}` });
    const { rows: [unit] } = await db.query('select id from units where company_id = $1', [company.id]);
    const { rows: [user] } = await db.query(
      `insert into users (company_id, unit_id, name, email, password_hash, role) values ($1,$2,'Visitante',$3,$4,'owner') returning id`,
      [company.id, unit.id, email, hash]);
    await seedDemo(db, company.id, user.id);
    return user.id;
  });
  res.status(201).json(await sessionWithToken(userId));
});

/** Converte a demonstração em uso normal: corretora, login e senha (mantendo ou apagando os dados de exemplo). */
r.post('/activate', activateLimiter, requireAuth, async (req, res) => {
  const d = parse(z.object({
    companyName: z.string().trim().min(2, 'informe o nome da corretora'),
    name: z.string().trim().min(2, 'informe seu nome'),
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    password: passwordSchema,
    phone: z.string().trim().optional(),
    keepData: z.boolean().default(false),
  }), req.body);
  if ((await getSystemParams()).signup_enabled === false) throw signupClosed();
  if (req.user.role !== 'owner') throw new HttpError(403, 'Só o proprietário pode ativar o sistema.');
  const c = await one('select is_demo from companies where id = $1', [req.companyId]);
  if (!c?.is_demo) throw new HttpError(400, 'Esta corretora já está em uso normal.');
  if (await one('select 1 from users where email = $1 and id <> $2', [d.email, req.user.id])) throw new HttpError(409, 'Este e-mail já está cadastrado.');
  await tx(async (db) => {
    if (!d.keepData) {
      const id = req.companyId;
      // ordem respeita as chaves estrangeiras; a auditoria da demonstração é mantida
      for (const t of ['split_batch_items', 'split_accruals', 'split_payment_batches', 'policy_splits', 'split_rule_versions', 'reconciliation_matches',
        'statement_lines', 'commission_allocations', 'tax_withholdings', 'commission_adjustments', 'commission_settlements', 'bank_transactions',
        'import_files', 'disputes', 'commission_receivables', 'cash_entries', 'period_closures', 'bank_accounts', 'premium_refunds', 'premium_payments',
        'premium_installments', 'claim_events', 'claims', 'service_requests', 'cancellations', 'endorsements', 'policy_items', 'policy_versions']) {
        await db.query(`delete from ${t} where company_id = $1`, [id]);
      }
      await db.query('update proposals set policy_id = null where company_id = $1', [id]);
      await db.query('update opportunities set renewal_of_policy_id = null where company_id = $1', [id]);
      await db.query('update quote_requests set renewal_of_policy_id = null where company_id = $1', [id]);
      for (const t of ['policies', 'customer_authorizations', 'proposal_status_events', 'proposal_operations', 'proposals', 'comparisons',
        'quote_offers', 'quote_tasks', 'quote_rounds', 'quote_requests', 'commission_rule_versions', 'commission_agreements', 'products',
        'messages', 'tasks', 'activities', 'public_links', 'documents', 'opportunities', 'consents', 'privacy_requests', 'client_relationships',
        'client_contacts', 'clients', 'partners', 'integration_events', 'capability_validations', 'connection_test_runs', 'credential_versions',
        'integration_requirements', 'provider_connections', 'business_events', 'counters']) {
        await db.query(`delete from ${t} where company_id = $1`, [id]);
      }
      await db.query('delete from institutions where company_id = $1', [id]);
      await db.query(`delete from users where company_id = $1 and id <> $2`, [id, req.user.id]);
    }
    let slug = slugify(d.companyName);
    const { rows: dup } = await db.query('select 1 from companies where slug = $1 and id <> $2', [slug, req.companyId]);
    if (dup.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    await db.query('update companies set name = $2, trade_name = $2, slug = $3, email = $4, phone = coalesce($5, phone), is_demo = false where id = $1',
      [req.companyId, d.companyName, slug, d.email, d.phone || null]);
    await db.query('update users set name = $2, email = $3 where id = $1', [req.user.id, d.name, d.email]);
    await setPassword(db, req.user.id, req.companyId, d.password);
  });
  await registerCompany(req.companyId).catch((e) => console.warn('[plataforma] cadastro na central adiado:', e.message));
  res.json(await sessionWithToken(req.user.id));
});

export default r;
