import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQL } from 'bun';
import { config } from './config.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** One pool per process, Bun's native Postgres client: no native addons. */
export function connect({
  url = config.databaseUrl,
  max = Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeout = 30,
} = {}) {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new SQL({
    url,
    max,
    idleTimeout,
    connectionTimeout: 15,
    tls: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });
}

export const sql = connect();

export async function healthcheck() {
  const [row] = await sql`select 1 as ok`;
  return row?.ok === 1;
}

export async function close() {
  await sql.end();
}

/** Bun's driver can hand jsonb back as text; read it either way. */
export function jsonb(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

/**
 * Forward-only migrations, keyed by filename, one transaction each. Called on
 * boot by every process; the advisory lock makes that safe when two boot at
 * the same instant.
 */
export async function migrate({ log = console.log, directory = MIGRATIONS_DIR, url } = {}) {
  const db = connect({ url, max: 1, idleTimeout: 0 });
  try {
    await db`select pg_advisory_lock(7420011)`;
    try {
      await db`
        create table if not exists schema_migrations (
          filename   text primary key,
          applied_at timestamptz not null default now()
        )
      `;
      const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();
      const applied = new Set(
        (await db`select filename from schema_migrations`).map((r) => r.filename),
      );
      let ran = 0;
      for (const file of files) {
        if (applied.has(file)) continue;
        const body = await readFile(join(directory, file), 'utf8');
        log(`[migrate] applying ${file}`);
        await db.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`insert into schema_migrations ${tx({ filename: file })}`;
        });
        ran++;
      }
      log(ran === 0 ? '[migrate] up to date' : `[migrate] applied ${ran} migration(s)`);
      return ran;
    } finally {
      await db`select pg_advisory_unlock(7420011)`;
    }
  } finally {
    await db.end();
  }
}
