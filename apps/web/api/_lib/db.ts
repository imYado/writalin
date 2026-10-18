import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sql: NeonQueryFunction<false, false> | null = null;

/** Neon's HTTP driver: one round trip per query, ideal for serverless functions. */
export function db(): NeonQueryFunction<false, false> {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add your Neon connection string in Vercel project settings.");
    sql = neon(url);
  }
  return sql;
}
