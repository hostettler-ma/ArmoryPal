import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Static guard against SQL injection. All database access goes through
 * Supabase's query builder and RPCs, which pass values as parameters. These
 * checks fail if code starts building SQL or PostgREST filter strings out of
 * values, which is how injection would get in.
 */

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
}

test("SQL functions never run dynamically built SQL", () => {
  const offenders: string[] = [];
  for (const file of files("supabase/migrations", /\.sql$/)) {
    const sql = readFileSync(file, "utf8").replace(/--.*$/gm, "");
    // EXECUTE as a statement (not "grant/revoke execute on function", not "execute function" in triggers).
    for (const m of sql.matchAll(/^\s*execute\s+(?!function|procedure)[^;]*;/gim)) offenders.push(`${file}: ${m[0].trim().slice(0, 120)}`);
    for (const m of sql.matchAll(/\bformat\s*\(\s*'[^']*%[sIL]/gi)) offenders.push(`${file}: ${m[0].slice(0, 120)}`);
  }
  expect(offenders, "dynamic SQL in migrations (use parameters, or review carefully and allowlist here)").toEqual([]);
});

test("app code never builds PostgREST filter strings from values", () => {
  const offenders: string[] = [];
  for (const file of files("src", /\.(ts|tsx)$/).filter((f) => !f.endsWith(".test.ts"))) {
    const code = readFileSync(file, "utf8");
    // .or(`...${x}...`), .filter("col", "op", `${x}`) and friends parse their string argument as filter syntax.
    for (const m of code.matchAll(/\.(or|filter|not|match|textSearch)\(\s*`[^`]*\$\{/g)) offenders.push(`${file}: ${m[0]}`);
    for (const m of code.matchAll(/\.(or|filter)\(\s*["'][^"']*["']\s*\+/g)) offenders.push(`${file}: ${m[0]}`);
    // Raw SQL from the app.
    for (const m of code.matchAll(/\b(sql|raw)`/g)) offenders.push(`${file}: ${m[0]}`);
  }
  expect(offenders, "filter strings built from values").toEqual([]);
});
