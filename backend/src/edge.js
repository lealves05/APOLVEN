// Entrada para Supabase Edge Functions (Deno). Gerada em bundle por scripts/build-edge.mjs.
import express from 'express';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { pool } from './db.js';
import { assertSecret } from './auth.js';

// a Supabase entrega o caminho com o nome da função
const FN = ['/apolven-api-cf', '/apolven-api'];

async function boot() {
  await migrate();
  // caminho rápido: lê os segredos já gravados numa consulta só (sem DDL a cada instância nova); cria só o que faltar
  if (!process.env.JWT_SECRET || !process.env.APOLVEN_VAULT_KEY) {
    const rows = await pool.query("select key, value from _secrets where key in ('jwt_secret','vault_key')").then((r) => r.rows).catch(() => []);
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!process.env.JWT_SECRET && m.jwt_secret) process.env.JWT_SECRET = m.jwt_secret;
    if (!process.env.APOLVEN_VAULT_KEY && m.vault_key) process.env.APOLVEN_VAULT_KEY = m.vault_key;
  }
  // segredo do JWT guardado no próprio schema do APOLVEN (Edge Functions não recebem variáveis pelo deploy)
  if (!process.env.JWT_SECRET) {
    await pool.query(`create table if not exists _secrets (key text primary key, value text not null)`);
    await pool.query('alter table _secrets enable row level security');
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(48)), (b) => b.toString(16).padStart(2, '0')).join('');
    await pool.query("insert into _secrets (key, value) values ('jwt_secret', $1) on conflict do nothing", [rand]);
    const { rows: [r] } = await pool.query("select value from _secrets where key = 'jwt_secret'");
    process.env.JWT_SECRET = r.value;
  }
  // chave do cofre de credenciais separada do segredo de sessão (26.3)
  if (!process.env.APOLVEN_VAULT_KEY) {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(48)), (b) => b.toString(16).padStart(2, '0')).join('');
    await pool.query("insert into _secrets (key, value) values ('vault_key', $1) on conflict do nothing", [rand]);
    const { rows: [r] } = await pool.query("select value from _secrets where key = 'vault_key'");
    process.env.APOLVEN_VAULT_KEY = r.value;
  }
  assertSecret();
}

let ready = null;
const server = express();
server.use(async (_req, res, next) => {
  try {
    ready ??= boot().catch((e) => { ready = null; throw e; });
    await ready;
    next();
  } catch (e) {
    console.error('[boot]', e);
    res.status(503).json({ error: 'Banco de dados indisponível. Tente novamente em instantes.' });
  }
});
server.use(FN, createApp());
server.listen(8000);
