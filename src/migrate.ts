import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';

export async function runMigrations(): Promise<string[]> {
  const files = (await readdir(config.sqlDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const done = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const alreadyApplied = new Set(done.rows.map((row) => row.name));

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        continue;
      }
      const sql = await readFile(path.join(config.sqlDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }

  return applied;
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  const applied = await runMigrations();
  console.log(
    applied.length === 0
      ? 'Base de datos al día.'
      : `Migraciones aplicadas: ${applied.join(', ')}`
  );
  await pool.end();
}
