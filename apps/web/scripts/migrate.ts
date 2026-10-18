// Apply db/schema.sql to the database in DATABASE_URL. Safe to re-run.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(1);
}
const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);
for (const s of statements) await sql.query(s);
console.log(`Applied ${statements.length} statements.`);
