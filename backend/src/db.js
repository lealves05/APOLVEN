import pg from 'pg';

// bigint (centavos) -> number (cabe com folga em 2^53), numeric (percentuais) -> number, date -> 'YYYY-MM-DD'
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/apolven';

const isLocal = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(connectionString);
const ssl =
  process.env.DATABASE_SSL === 'false' || isLocal ? false : { rejectUnauthorized: false };

/**
 * Esquema próprio: o APOLVEN fica hospedado no mesmo projeto Supabase de outro sistema (como o RUSTEN),
 * isolado no schema "apolven". O search_path contém SÓ esse schema: nenhuma tabela de outro sistema
 * (ex.: public._secrets do TORVEN) é lida por engano.
 */
export const SCHEMA = process.env.DB_SCHEMA || 'apolven';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('DB_SCHEMA inválido');

export const pool = new pg.Pool({
  connectionString,
  ssl,
  max: Number(process.env.DB_POOL_MAX || 8),
  idleTimeoutMillis: 30000,
});
// as consultas de um cliente são executadas em ordem: o "set search_path" sempre roda antes de qualquer outra
pool.on('connect', (client) => { client.query(`set search_path to ${SCHEMA}`).catch(() => {}); });
pool.on('error', (err) => console.error('[db] erro no pool', err.message));

export const q = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Atalho para usar a conexão da transação ou o pool. */
export const runner = (db) => (db ? (t, p) => db.query(t, p) : q);
