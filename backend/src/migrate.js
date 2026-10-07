import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, SCHEMA } from './db.js';

/** Lista de migrações: embutida no build da Edge Function ou lida da pasta. */
function listMigrations() {
  const embedded = globalThis.__APOLVEN_MIGRATIONS__;
  if (embedded) return embedded;
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

export async function migrate() {
  const client = await pool.connect();
  let locked = false;
  try {
    // caminho rápido (cada instância nova da Edge Function passa por aqui): se todas as migrações deste pacote já
    // estão registradas, uma consulta basta — sem trava, sem DDL. Só com migração pendente segue o caminho completo.
    try {
      const names = listMigrations().map((m) => m.name);
      const { rows: [c] } = await client.query(`select count(*)::int as n from ${SCHEMA}._migrations where name = any($1::text[])`, [names]);
      if (c.n === names.length) return;
    } catch { /* tabela de controle ainda não existe: caminho completo */ }
    // trava para instâncias simultâneas da Edge Function (chave própria do APOLVEN)
    await client.query('select pg_advisory_lock(7265001)');
    locked = true;
    await client.query(`create schema if not exists ${SCHEMA}`);
    await client.query(`set search_path to ${SCHEMA}`);
    // o schema não é exposto pela API REST da Supabase; mesmo assim os papéis públicos não recebem acesso
    await client.query(`do $$ begin
      if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ${SCHEMA} from anon'; end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ${SCHEMA} from authenticated'; end if;
    end $$`);
    await client.query(`create table if not exists _migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    await client.query('alter table _migrations enable row level security');
    const { rows } = await client.query('select name from _migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const { name: file, sql } of listMigrations()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into _migrations(name) values ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] aplicada ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${e.message}`);
      }
    }
  } finally {
    if (locked) await client.query('select pg_advisory_unlock(7265001)').catch(() => {});
    client.release();
  }
}

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => { console.log('[migrate] ok'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
