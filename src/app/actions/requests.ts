"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/auth";
import {
  applyFullNameMatches,
  buildImportPreview,
  MAX_IMPORT_LINES,
  parseCardList,
  type ImportItem,
  type Resolution,
  type SkippedLine,
} from "@/lib/card-import";
import type { CardRow } from "@/lib/cards";
import { ruleMessage } from "@/lib/rules";
import { createClient } from "@/lib/supabase/server";

// Thin wrappers around the request/pledge RPCs, which enforce every rule.
// Each returns { error } with a friendly message, or {} on success.

export type ActionResult = { error?: string };

async function run(eventId: string, call: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string } | null }>): Promise<ActionResult> {
  if (!isUuid(eventId)) return { error: ruleMessage("event_not_found") };
  const supabase = await createClient();
  const { error } = await call(supabase);
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
  return {};
}

export async function addRequests(
  eventId: string,
  items: { cardId: string; quantity: number }[],
  note: string,
): Promise<ActionResult> {
  return run(eventId, (s) =>
    s.rpc("add_requests", {
      p_event_id: eventId,
      p_items: items.map((i) => ({ card_id: i.cardId, quantity: i.quantity })),
      p_note: note,
    }),
  );
}

export async function updateRequest(eventId: string, requestId: string, quantity: number, note: string): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("update_request", { p_request_id: requestId, p_quantity: quantity, p_note: note }));
}

export async function cancelRequest(eventId: string, requestId: string): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("cancel_request", { p_request_id: requestId }));
}

export async function pledge(eventId: string, requestId: string, quantity: number): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("pledge", { p_request_id: requestId, p_quantity: quantity }));
}

export type ImportPreview = { items: ImportItem[]; skipped: SkippedLine[]; error?: string };

/**
 * Parses a pasted card list and resolves it against the catalog for the
 * confirmation step. Nothing is written; confirming calls addRequests().
 */
export async function previewCardImport(text: string): Promise<ImportPreview> {
  const parsed = parseCardList(text.slice(0, 20_000));
  const parsedLines = parsed.lines.slice(0, MAX_IMPORT_LINES);
  const tooMany = parsed.lines.slice(MAX_IMPORT_LINES).map((l) => ({
    lineNo: l.lineNo,
    raw: l.raw,
    reason: `Only the first ${MAX_IMPORT_LINES} cards are imported`,
  }));
  if (parsedLines.length === 0) return { items: [], skipped: [...parsed.skipped, ...tooMany] };

  const supabase = await createClient();
  const resolve = async (list: string[]) => {
    const { data, error } = await supabase.rpc("resolve_card_names", { p_names: list });
    const res = list.map((_, i): Resolution => {
      const r = data?.find((x) => x.idx === i + 1);
      return { name: r?.name ?? null, match: (r?.match as Resolution["match"]) ?? null };
    });
    return { res, error };
  };

  const primary = await resolve(parsedLines.map((l) => l.name));
  if (primary.error) return { items: [], skipped: [], error: ruleMessage(primary.error.message) };

  // "Snatch blue": also check whether the full text is a card name on its own.
  const withFull = parsedLines.flatMap((l, i) => (l.fullName ? [{ i, name: l.fullName }] : []));
  const fullResolutions: (Resolution | null)[] = parsedLines.map(() => null);
  if (withFull.length) {
    const full = await resolve(withFull.map((w) => w.name));
    if (full.error) return { items: [], skipped: [], error: ruleMessage(full.error.message) };
    withFull.forEach((w, j) => (fullResolutions[w.i] = full.res[j]));
  }
  const { lines, resolutions } = applyFullNameMatches(parsedLines, primary.res, fullResolutions);

  const names = [...new Set(resolutions.map((r) => r.name).filter((n): n is string => !!n))];
  const { data: cards } = names.length
    ? await supabase.from("cards").select("id, name, pitch, color, types, image_url, set_ids").in("name", names)
    : { data: [] };
  const variantsByName = new Map<string, CardRow[]>();
  for (const c of (cards ?? []) as CardRow[]) variantsByName.set(c.name, [...(variantsByName.get(c.name) ?? []), c]);

  const preview = buildImportPreview(lines, resolutions, variantsByName);
  return {
    items: preview.items,
    skipped: [...parsed.skipped, ...preview.skipped, ...tooMany].sort((a, b) => a.lineNo - b.lineNo),
  };
}

/** Copies the viewer's still-needed requests from last week's event into this one. */
export async function copyOpenRequests(eventId: string, fromEventId: string): Promise<ActionResult> {
  if (!isUuid(fromEventId)) return { error: ruleMessage("event_not_found") };
  return run(eventId, (s) => s.rpc("copy_open_requests", { p_from_event: fromEventId, p_to_event: eventId }));
}

export async function unpledge(eventId: string, requestId: string): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("unpledge", { p_request_id: requestId }));
}
