// Neon Postgres connection and schema bootstrap.
//
// The StockX exporter next door deliberately has no database, because it is a
// one-off download. This tool is the opposite: its entire value is comparing
// today against yesterday, so persistence is not an add-on, it is the product.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Lazily created singleton pool.
 *
 * Throws rather than returning a null pool: every caller here needs the
 * database to do anything meaningful, and a silent no-op would let a scan
 * "succeed" while recording nothing.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. This tool cannot run without it.');
    }
    pool = new Pool({
      connectionString,
      // Neon is over the public internet; TLS is not optional.
      ssl: { rejectUnauthorized: false },
      max: 4
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Run several statements in one transaction, rolling back on any failure. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Apply schema.sql. Every statement is CREATE ... IF NOT EXISTS, so this is
 * safe to run on every boot and on every scheduled scan.
 */
export async function ensureSchema(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await query(sql);
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
