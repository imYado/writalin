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
 * Create the tables the first time the API meets an empty database, so a new
 * Neon database works without running anything by hand. One cheap check per cold start.
 */
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const sql = db();
    const [row] = (await sql`select to_regclass('public.ai_usage') is not null as ready`) as [{ ready: boolean }];
    if (row.ready) return;
    for (const s of SCHEMA) await sql.query(s);
  })().catch((e) => {
    schemaReady = null; // try again on the next request
    throw e;
  });
  return schemaReady;
}
