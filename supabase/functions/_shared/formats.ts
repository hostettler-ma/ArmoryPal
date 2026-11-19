// Formats an Armory can run. Codes mirror public.is_format() in
// supabase/migrations/*_format_polls.sql: change both together.
// Shared by the app (re-exported from src/lib/formats.ts) and ArmoryBot.

export const FORMATS = [
  { code: "draft", label: "Draft" },
  { code: "cc", label: "Classic Constructed" },
  { code: "silver_age", label: "Silver Age" },
  { code: "csp", label: "Crack, Shuffle, Play" },
] as const;

export type FormatCode = (typeof FORMATS)[number]["code"];

export function isFormat(code: unknown): code is FormatCode {
  return FORMATS.some((f) => f.code === code);
}

export function formatLabel(code: string | null | undefined): string {
  return FORMATS.find((f) => f.code === code)?.label ?? "Unknown format";
}
