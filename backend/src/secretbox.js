// Cofre de segredos (credenciais de integração e segredo do MFA): AES-256-GCM com chave derivada (HKDF)
// de APOLVEN_VAULT_KEY quando definido — chave administrada separadamente dos dados (26.3) — ou do JWT_SECRET.
// O banco guarda só o texto cifrado; a chave nunca fica no banco junto com os dados quando APOLVEN_VAULT_KEY é usado.
import crypto from 'node:crypto';
import { secret } from './auth.js';
import { HttpError } from './util.js';

const key = (purpose) => Buffer.from(crypto.hkdfSync('sha256', process.env.APOLVEN_VAULT_KEY || secret(), 'apolven', `apolven:${purpose}`, 32));

/** Objeto → texto cifrado "v1.iv.tag.dados" (base64url). */
export function seal(obj, purpose = 'vault') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(purpose), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj ?? {}), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Texto cifrado → objeto. Falha de chave vira mensagem clara (sem expor nada). */
export function unseal(text, purpose = 'vault') {
  if (!text) return {};
  try {
    const [v, iv, tag, data] = String(text).split('.');
    if (v !== 'v1') throw new Error('versão');
    const d = crypto.createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8'));
  } catch {
    throw new HttpError(409, 'Não foi possível ler o segredo salvo (a chave do cofre mudou). Cadastre a credencial de novo.', { code: 'VAULT_KEY_CHANGED' });
  }
}

/** Mostra só o final de um identificador (ex.: ••••a1b2). Nunca usado para segredo. */
export const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
