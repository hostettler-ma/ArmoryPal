// Turns the nightly run's outputs into one Markdown summary (used for the job
// summary, the failure issue and PR comments).
//
//   npx tsx e2e/support/summarize.mts > summary.md
//
// Reads, if present: test-results/results.json (Playwright), audit.txt
// (scripts/audit-check.mts output) and zap.json (ZAP scan).

import { existsSync, readFileSync } from "node:fs";

type Result = { status: string; error?: { message?: string }; errors?: { message?: string }[]; retry: number };
type Spec = { title: string; file: string; line: number; tests: { projectName: string; results: Result[]; status: string }[] };
type Suite = { title: string; specs?: Spec[]; suites?: Suite[] };

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const out: string[] = [];
let failed = false;

// --- Playwright ---------------------------------------------------------------
if (existsSync("test-results/results.json")) {
  const report = JSON.parse(readFileSync("test-results/results.json", "utf8")) as {
    suites: Suite[];
    stats: { expected: number; unexpected: number; flaky: number; skipped: number; duration: number };
  };
  const { expected, unexpected, flaky, skipped, duration } = report.stats;
  out.push(
    `### Browser tests: ${unexpected ? `❌ ${unexpected} failed` : "✅ all passed"}`,
    `${expected} passed · ${unexpected} failed · ${flaky} flaky · ${skipped} skipped · ${Math.round(duration / 1000)}s`,
  );

  const failures: string[] = [];
  const flakies: string[] = [];
  const walk = (suite: Suite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const name = `[${t.projectName}] ${[...path, spec.title].filter(Boolean).join(" › ")} (${spec.file}:${spec.line})`;
        if (t.status === "unexpected") {
          const last = t.results[t.results.length - 1];
          const msg = strip(last?.error?.message ?? last?.errors?.[0]?.message ?? "").split("\n").slice(0, 12).join("\n");
          failures.push(`<details><summary>${name}</summary>\n\n\`\`\`\n${msg}\n\`\`\`\n</details>`);
        } else if (t.status === "flaky") flakies.push(`- ${name}`);
      }
    }
    for (const s of suite.suites ?? []) walk(s, [...path, s.title]);
  };
  for (const s of report.suites) walk(s, []);
  if (failures.length) out.push("", ...failures);
  if (flakies.length) out.push("", "**Passed only on retry (flaky):**", ...flakies);
  if (unexpected) failed = true;
} else {
  out.push("### Browser tests: ⚠️ no results (the run stopped before the tests finished)");
  failed = true;
}

// --- Unit and DB tests (Vitest output) ---------------------------------------------
for (const [file, label] of [
  ["unit-tests.txt", "Unit tests"],
  ["db-tests.txt", "Database rule tests"],
] as const) {
  if (!existsSync(file)) continue;
  const text = strip(readFileSync(file, "utf8"));
  const totals = text.match(/^\s*Tests\s+.+$/m)?.[0].trim() ?? "no summary line";
  const failing = [...text.matchAll(/^\s*(?:FAIL|×|✗)\s+(.+)$/gm)].map((m) => `- ${m[1].trim()}`);
  const bad = /\bfailed\b/.test(totals) || !/\bpassed\b/.test(totals);
  if (bad) failed = true;
  out.push("", `### ${label}: ${bad ? "❌" : "✅"} ${totals}`, ...[...new Set(failing)].slice(0, 20));
}

// --- Dependency audit -------------------------------------------------------------
if (existsSync("audit.txt")) {
  const audit = readFileSync("audit.txt", "utf8").trim();
  const bad = audit.includes("Needs attention");
  if (bad) failed = true;
  out.push("", `### Dependency audit: ${bad ? "❌ needs attention" : "✅ ok"}`, "```", audit, "```");
}

// --- ZAP --------------------------------------------------------------------------
if (existsSync("zap.json")) {
  type Instance = { uri: string; method?: string; param?: string; attack?: string; evidence?: string; otherinfo?: string };
  type Alert = { name: string; riskcode: string; riskdesc: string; pluginid: string; otherinfo?: string; instances: Instance[] };
  const zap = JSON.parse(readFileSync("zap.json", "utf8")) as { site: { alerts: Alert[] }[] };
  // Rules marked IGNORE in .github/zap-rules.tsv (with the reason there) are left out.
  const ignored = existsSync(".github/zap-rules.tsv")
    ? new Set(
        readFileSync(".github/zap-rules.tsv", "utf8")
          .split("\n")
          .filter((l) => l.split("\t")[1] === "IGNORE")
          .map((l) => l.split("\t")[0]),
      )
    : new Set<string>();
  // Next.js encodes which server action to run in form fields named $ACTION_* (the action id, its
  // bound arguments, a random key). Mangling them makes Next return a different page, which ZAP's
  // boolean SQL-injection check reads as injection. They never reach the database, so findings on
  // them are set aside (and counted), while the same rule still fails the run on any real parameter.
  const frameworkParam = (p?: string) => !!p && /^\$ACTION/.test(p);
  let setAside = 0;
  const alerts = zap.site
    .flatMap((s) => s.alerts)
    .filter((a) => !ignored.has(a.pluginid))
    .map((a) => {
      const real = a.instances.filter((i) => !frameworkParam(i.param));
      setAside += a.instances.length - real.length;
      return { ...a, instances: real };
    })
    .filter((a) => a.instances.length > 0)
    .sort((a, b) => Number(b.riskcode) - Number(a.riskcode));
  const high = alerts.filter((a) => a.riskcode === "3");
  if (high.length) failed = true;
  out.push("", `### ZAP security scan: ${high.length ? `❌ ${high.length} high-risk finding(s)` : "✅ no high-risk findings"}`);
  if (setAside) out.push(`(${setAside} finding(s) on Next.js server-action internals ($ACTION_*) set aside; they never reach the database.)`);
  if (alerts.length) {
    out.push("| Risk | Finding | Rule | Example URL |", "|---|---|---|---|");
    for (const a of alerts) out.push(`| ${a.riskdesc.split(" ")[0]} | ${a.name} | ${a.pluginid} | ${a.instances[0]?.uri ?? ""} |`);
  }
  // For high and medium findings, show exactly what ZAP sent and saw, so they can be verified or dismissed.
  const clip = (v: unknown, n = 300) => String(v ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  for (const a of alerts.filter((x) => Number(x.riskcode) >= 2)) {
    out.push("", `<details><summary>${a.riskdesc.split(" ")[0]}: ${a.name} (rule ${a.pluginid}), ${a.instances.length} instance(s)</summary>`, "");
    for (const i of a.instances.slice(0, 5)) {
      out.push(
        `- \`${i.method ?? "GET"} ${i.uri}\``,
        `  - parameter: \`${clip(i.param, 80) || "-"}\``,
        `  - attack: \`${clip(i.attack, 200) || "-"}\``,
        `  - evidence: \`${clip(i.evidence, 200) || "-"}\``,
        ...(i.otherinfo ? [`  - ZAP's reasoning: ${clip(i.otherinfo, 500)}`] : []),
      );
    }
    if (a.otherinfo) out.push("", `ZAP's reasoning: ${clip(a.otherinfo, 600)}`);
    out.push("", "</details>");
  }
}

console.log(out.join("\n"));
process.exitCode = failed ? 1 : 0;
