// Apply the schema to the database in DATABASE_URL. Safe to re-run.
// The API also does this by itself the first time it starts against an empty database.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(1);
}
// Loaded by URL so Node runs the .ts file directly (no build step).
const { SCHEMA } = (await import(new URL("../api/_lib/schema.ts", import.meta.url).href)) as { SCHEMA: string[] };
const sql = neon(url);
for (const s of SCHEMA) await sql.query(s);
console.log(`Applied ${SCHEMA.length} statements.`);
