// Prints SQL that makes a local database's privileges match production.
//
// Local Supabase auto-grants the API roles access to every new table and
// function; the production project doesn't. So, as CLAUDE.md describes: revoke
// everything, then replay every GRANT/REVOKE from the migrations in order.
// The anonymous-access tests then check what production really exposes.
//
//   npx tsx e2e/support/prod-grants.mts | psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase/migrations";
// No transaction on purpose: statements about functions a later migration
// dropped or replaced (e.g. an old leave_event(uuid)) fail harmlessly and
// psql carries on.
const out = [
  "revoke all on all tables in schema public from anon, authenticated, service_role, public;",
  "revoke all on all sequences in schema public from anon, authenticated, service_role, public;",
  "revoke all on all functions in schema public from anon, authenticated, service_role, public;",
];

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
  // GRANT/REVOKE statements never contain $$ bodies, so "up to the next ;" is safe.
  for (const m of sql.matchAll(/^\s*(grant|revoke)\b[^;]*;/gim)) out.push(`-- ${file}\n${m[0].trim()}`);
}

console.log(out.join("\n"));
