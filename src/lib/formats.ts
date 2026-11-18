// Formats an Armory can run, and poll results. Codes mirror public.is_format()
// in supabase/migrations/*_format_polls.sql: change both together.

import { FORMATS, isFormat, formatLabel, type FormatCode } from "../../supabase/functions/_shared/formats.ts";

// FORMATS, isFormat and formatLabel live in supabase/functions/_shared/formats.ts
// so ArmoryBot renders the same names.
export { FORMATS, isFormat, formatLabel, type FormatCode };

export const ALL_FORMATS: FormatCode[] = FORMATS.map((f) => f.code);

/** 2 to 4 distinct known formats, in FORMATS order. Mirrors public.valid_format_options(). */
export function parsePollOptions(input: unknown[]): { ok: true; value: FormatCode[] } | { ok: false; error: string } {
  const picked = new Set(input.filter(isFormat));
  const value = ALL_FORMATS.filter((c) => picked.has(c));
  if (value.length < 2) return { ok: false, error: "Pick at least two formats to vote on." };
  return { ok: true, value };
}

export type PollOption = { code: FormatCode; label: string; votes: number; share: number };
export type PollResults = {
  options: PollOption[];
  total: number;
  /** The options with the most votes (several on a tie; empty with no votes). */
  leaders: FormatCode[];
  mine: FormatCode | null;
};

/** Vote counts per option (in the poll's order), leaders, and the viewer's vote. */
export function pollResults(
  options: string[],
  votes: { user_id: string; format: string }[],
  viewerId: string,
): PollResults {
  const codes = options.filter(isFormat);
  const counts = new Map<string, number>(codes.map((c) => [c, 0]));
  for (const v of votes) if (counts.has(v.format)) counts.set(v.format, counts.get(v.format)! + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...counts.values());
  const mine = votes.find((v) => v.user_id === viewerId)?.format;
  return {
    options: codes.map((code) => {
      const n = counts.get(code)!;
      return { code, label: formatLabel(code), votes: n, share: total ? n / total : 0 };
    }),
    total,
    leaders: top > 0 ? codes.filter((c) => counts.get(c) === top) : [],
    mine: isFormat(mine) && counts.has(mine) ? mine : null,
  };
}

/** Voting is open until the owner confirms a format (closed_at) or the event starts. */
export function pollOpen(poll: { closed_at: string | null }, event: { starts_at: string }, now: Date = new Date()): boolean {
  return !poll.closed_at && now.getTime() < new Date(event.starts_at).getTime();
}
