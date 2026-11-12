import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Guards the design tokens in src/app/globals.css (see "Design tokens" in CLAUDE.md):
 * components use the Carbon spacing scale and the named type, radius, shadow, size and
 * motion utilities, never raw Tailwind values.
 */

const SRC = join(__dirname, "..");

/** Carbon spacing scale in Tailwind steps (2 4 8 12 16 24 32 40 48 64 80 96px), plus 0. */
const SPACING_STEPS = new Set(["0", "0.5", "1", "2", "3", "4", "6", "8", "10", "12", "16", "20", "24"]);
const SPACING_PX = new Set([0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96]);

const SPACING =
  /^-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|bottom|left|right|start|end)-(\d+(?:\.\d+)?|px|\[[^\]\s]+\])$/;

/** Raw utilities that have a named token instead. */
const FORBIDDEN: [RegExp, string][] = [
  [/^text-(xs|sm|base|lg|xl|\dxl)$/, "use a type style (text-body, text-label, text-heading-0x …)"],
  [/^text-\[/, "use a type style"],
  [/^font-(thin|extralight|light|medium|bold|extrabold|black)$/, "use a type style (font-semibold/font-normal only as inline emphasis)"],
  [/^(leading|tracking)-/, "type styles set line height; the wordmark sets tracking"],
  [/^font-logo$/, "use the wordmark utility"],
  [/^rounded(-[trblse]{1,2})?(-(none|xs|sm|md|lg|xl|2xl|3xl|\[.+\]))?$/, "use rounded-control, rounded-container or rounded-full"],
  [/^shadow(-(2xs|xs|sm|md|lg|xl|2xl|\[.+\]))?$/, "use shadow-raised or shadow-overlay"],
  [/^(duration|delay)-(\d+|\[.+\])$/, "use a motion duration (duration-fast-02 …)"],
  [/^ease-(linear|in|out|in-out|\[.+\])$/, "use ease-productive or ease-expressive"],
  [/^min-h-(8|9|10|11|12|14)$/, "control heights: use min-h-control-sm/md/lg"],
  [/^(scale|opacity)-\[/, "states come from the interactive utility"],
];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) yield path;
  }
}

/** Class tokens from string literals, without variant prefixes (hover:, [&_a]:, …) or "!". */
function classTokens(source: string): string[] {
  const tokens: string[] = [];
  for (const m of source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    const text = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ");
    for (const raw of text.split(/\s+/)) {
      if (!raw) continue;
      // Split off variants, but not colons inside an arbitrary value like [&_a]: or [max(…)].
      let depth = 0;
      let start = 0;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "[" || raw[i] === "(") depth++;
        else if (raw[i] === "]" || raw[i] === ")") depth--;
        else if (raw[i] === ":" && depth === 0) start = i + 1;
      }
      tokens.push(raw.slice(start).replace(/^!/, ""));
    }
  }
  return tokens;
}

/** Arbitrary spacing is only allowed for safe-area insets, combined with on-scale lengths. */
function arbitrarySpacingOk(value: string): boolean {
  if (!value.includes("env(safe-area-inset-")) return false;
  const lengths = [...value.matchAll(/(\d*\.?\d+)(rem|px)/g)].map(([, n, unit]) => Number(n) * (unit === "rem" ? 16 : 1));
  return lengths.every((px) => SPACING_PX.has(px));
}

const violations: string[] = [];
for (const file of sourceFiles(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, "/");
  for (const token of classTokens(readFileSync(file, "utf8"))) {
    const spacing = SPACING.exec(token);
    if (spacing) {
      const value = spacing[1];
      const ok = value.startsWith("[") ? arbitrarySpacingOk(value.slice(1, -1)) : SPACING_STEPS.has(value);
      if (!ok) violations.push(`${rel}: ${token} is off the spacing scale`);
      continue;
    }
    for (const [rule, hint] of FORBIDDEN) {
      if (rule.test(token)) violations.push(`${rel}: ${token} (${hint})`);
    }
  }
}

describe("design tokens", () => {
  it("parses class tokens with variants and arbitrary values", () => {
    expect(classTokens('className="sm:px-5 [&_li]:ml-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"')).toEqual([
      "px-5",
      "ml-5",
      "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
    ]);
    expect(arbitrarySpacingOk("max(1.5rem,env(safe-area-inset-bottom))")).toBe(true);
    expect(arbitrarySpacingOk("calc(0.375rem+env(safe-area-inset-top))")).toBe(false);
    expect(arbitrarySpacingOk("13px")).toBe(false);
  });

  it("uses only on-scale spacing and named tokens in src/", () => {
    expect(violations).toEqual([]);
  });
});
