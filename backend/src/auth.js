import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one } from './db.js';
import { HttpError, permissionsFor, withDefaults, MFA_ROLES } from './util.js';

// ---------------- Segredo do JWT ----------------
// Produção exige um segredo forte (≥ 32 bytes). Ausente, conhecido, curto ou repetitivo impede o serviço de atender.
const DEV_SECRET = 'apolven-dev-secret-troque-em-producao';
const KNOWN = new Set([DEV_SECRET, 'changeme', 'secret', 'jwt_secret', 'troque-este-segredo', 'troque-este-valor']);
const isProd = () => process.env.NODE_ENV === 'production';
export function secretProblem(v) {
  if (!v) return 'JWT_SECRET ausente';
  if (KNOWN.has(v)) return 'JWT_SECRET é um valor de exemplo conhecido';
  if (Buffer.byteLength(v, 'utf8') < 32) return 'JWT_SECRET curto (mínimo de 32 bytes aleatórios)';
  if (new Set(v).size < 10) return 'JWT_SECRET com pouca variação de caracteres';
  return null;
}
export function assertSecret() {
  const m = secretProblem(process.env.JWT_SECRET);
  if (m && isProd()) throw new Error(`[auth] configuração insegura: ${m}`);
  if (m) console.warn(`[auth] desenvolvimento: ${m} — usando segredo local`);
}
export const secret = () => {
  const v = process.env.JWT_SECRET;
  if (secretProblem(v)) { if (isProd()) throw new HttpError(503, 'Serviço indisponível: configuração de segurança incompleta.'); return v || DEV_SECRET; }
  return v;
};
const JWT_OPTS = { algorithm: 'HS256', issuer: 'apolven-api', audience: 'apolven-app' };

/** Token de acesso: usuário, corretora, versão de autenticação e se o segundo fator foi verificado nesta sessão. */
export const signToken = (user, { mfa = false } = {}) =>
  jwt.sign({ uid: user.id, cid: user.company_id, av: Number(user.auth_version ?? 0), mf: !!mfa, typ: 'access' }, secret(), { ...JWT_OPTS, expiresIn: '12h' });

/** Desafio do segundo fator (5 minutos): só serve para concluir o login. */
export const signMfaChallenge = (user) =>
  jwt.sign({ uid: user.id, av: Number(user.auth_version ?? 0), typ: 'mfa' }, secret(), { ...JWT_OPTS, expiresIn: '5m' });
export function verifyMfaChallenge(token) {
  try {
    const p = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });
    return p.typ === 'mfa' ? p : null;
  } catch { return null; }
}

export function verifyToken(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });
    return p.typ === 'access' && Number.isInteger(p.av) ? p : null;
  } catch { return null; }
}

/** true para permissão booleana ligada ou escopo 'all'/'own'. */
export const granted = (v) => v === true || v === 'all' || v === 'own';

/** MFA exigido para este usuário (perfis críticos fora da demonstração). */
export const mfaRequired = (user, isDemo) => !isDemo && process.env.APOLVEN_MFA !== 'off' && MFA_ROLES.includes(user.role);

export async function requireAuth(req, _res, next) {
  const payload = verifyToken(req);
  if (!payload) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  const user = await one(
    `select u.id, u.company_id, u.name, u.email, u.role, u.unit_id, u.active, u.preferences, u.auth_version, u.mfa_enabled,
            c.settings, c.is_demo
       from users u join companies c on c.id = u.company_id where u.id = $1`,
    [payload.uid],
  );
  if (!user || !user.active) throw new HttpError(401, 'Usuário inativo ou removido.');
  // vínculo atual verificado no banco (26.1): troca de senha ou de corretora derruba os tokens anteriores
  if (user.company_id !== payload.cid || Number(user.auth_version) !== payload.av) throw new HttpError(401, 'Sessão encerrada. Entre novamente.');
  if (user.mfa_enabled && !payload.mf) throw new HttpError(401, 'Confirme o segundo fator para continuar.');
  req.isDemo = user.is_demo;
  req.mfaSetupRequired = mfaRequired(user, user.is_demo) && !user.mfa_enabled;
  req.mfaVerified = !!payload.mf;
  delete user.auth_version;
  req.settings = withDefaults(user.settings);
  delete user.settings;
  delete user.is_demo;
  req.user = user;
  req.companyId = user.company_id;
  req.perms = permissionsFor(user.role, req.settings);
  next();
}

/** Perfis críticos sem MFA configurado só acessam o cadastro do segundo fator e a sessão. */
export function mfaGate(req, _res, next) {
  if (req.mfaSetupRequired) {
    throw new HttpError(403, 'Configure a verificação em duas etapas para continuar.', { code: 'MFA_SETUP_REQUIRED' });
  }
  next();
}

/** Exige uma ou mais permissões (qualquer uma delas basta). */
export const need = (...keys) => (req, _res, next) => {
  if (keys.some((k) => granted(req.perms[k]))) return next();
  throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
};
export const can = (req, key) => granted(req.perms[key]);
/** Escopo da permissão: 'all' | 'own' | 'none'. */
export const scopeOf = (req, key) => (req.user?.role === 'owner' ? 'all' : (req.perms[key] === true ? 'all' : req.perms[key] || 'none'));

// ---------------- TOTP (RFC 6238) ----------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totp(secretB32, time = Date.now(), step = 30) {
  const counter = Math.floor(time / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}
export function verifyTotp(secretB32, code, window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  for (let w = -window; w <= window; w += 1) {
    const t = totp(secretB32, Date.now() + w * 30000);
    if (crypto.timingSafeEqual(Buffer.from(t), Buffer.from(c))) return true;
  }
  return false;
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

/**
 * Reautenticação para operações críticas (credenciais, favorecido de repasse): código do autenticador
 * quando o MFA está ativo; senha atual nos demais casos.
 */
export async function reauth(req, { code, password }) {
  const { unseal } = await import('./secretbox.js');
  // demonstração: dados fictícios e usuário sem senha — a reautenticação não se aplica
  if (req.isDemo) return;
  const u = await one('select password_hash, mfa_enabled, mfa_secret from users where id = $1', [req.user.id]);
  if (u.mfa_enabled) {
    const s = unseal(u.mfa_secret, 'mfa').secret;
    if (!verifyTotp(s, code)) throw new HttpError(401, 'Código de verificação inválido. Confirme no seu aplicativo autenticador.', { code: 'REAUTH_REQUIRED' });
    return;
  }
  if (!password || !(await bcrypt.compare(password, u.password_hash))) {
    throw new HttpError(401, 'Confirme sua senha para concluir esta operação.', { code: 'REAUTH_REQUIRED' });
  }
}
