import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./client.js";
const dir = path.resolve(process.cwd(), "packages/db/src/migrations");
await pool.query(
  `CREATE TABLE IF NOT EXISTS schema_migrations (filename text primary key, applied_at timestamptz not null default now())`,
);
const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const exists = await pool.query(
    "SELECT 1 FROM schema_migrations WHERE filename=$1",
    [file],
  );
  if (exists.rowCount) continue;
  const sql = await fs.readFile(path.join(dir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [
      file,
    ]);
    await client.query("COMMIT");
    console.log(`Applied ${file}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
await pool.end();
