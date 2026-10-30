// Fails if production dependencies have a high or critical advisory that isn't
// in .github/audit-allowlist.json, or if an allowlist entry is past its
// review date. Prints a short report either way.
//
//   npx tsx scripts/audit-check.mts

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Via = string | { source: number; title: string; url: string; severity: string; range: string };
type Vuln = { name: string; severity: string; via: Via[] };

const allow = JSON.parse(readFileSync(".github/audit-allowlist.json", "utf8")).advisories as Record<
  string,
  { package: string; reason: string; review_by: string }
>;

let raw: string;
try {
  raw = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) {
  raw = (e as { stdout: string }).stdout; // npm audit exits 1 when it finds anything
}
const vulns = Object.values((JSON.parse(raw).vulnerabilities ?? {}) as Record<string, Vuln>);

const problems: string[] = [];
const accepted: string[] = [];
const today = new Date().toISOString().slice(0, 10);

for (const v of vulns) {
  for (const via of v.via) {
    if (typeof via === "string") continue; // inherited from another package, reported there
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const ghsa = via.url.split("/").pop()!;
    const entry = allow[ghsa];
    if (!entry) problems.push(`${via.severity.toUpperCase()} ${v.name} ${via.range}: ${via.title} (${via.url})`);
    else if (entry.review_by < today) problems.push(`Allowlist entry ${ghsa} (${v.name}) was due for review on ${entry.review_by}`);
    else accepted.push(`${ghsa} ${v.name}: ${entry.reason}`);
  }
}

console.log(`npm audit (production dependencies): ${vulns.length} affected package(s).`);
if (accepted.length) console.log(`Accepted for now:\n  ${[...new Set(accepted)].join("\n  ")}`);
if (problems.length) {
  console.log(`\nNeeds attention:\n  ${[...new Set(problems)].join("\n  ")}`);
  process.exit(1);
}
console.log("No unaccepted high or critical advisories.");
