import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { SCHEMA } from "./schema.js";

let sql: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

/** Neon's HTTP driver: one round trip per query, ideal for serverless functions. */
export function db(): NeonQueryFunction<false, false> {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add your Neon connection string in Vercel project settings.");
    sql = neon(url);
  }
  return sql;
}

/**
 * Create or update the tables the first time the API meets a database that lacks them, so a new
 * Neon database works without running anything by hand. One cheap check per cold start.
 */
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const sql = db();
    // The newest column: present means every statement has already run.
    const [row] = (await sql`select exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'ai_settings' and column_name = 'base_url') as ready`) as [{ ready: boolean }];
    if (row.ready) return;
    for (const s of SCHEMA) await sql.query(s);
  })().catch((e) => {
    schemaReady = null; // try again on the next request
    throw e;
  });
  return schemaReady;
}
