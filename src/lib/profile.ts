export type ProfileInput = { displayName: string; gemId: string | null };

export type ProfileResult =
  | { ok: true; value: ProfileInput }
  | { ok: false; errors: Partial<Record<keyof ProfileInput, string>> };

/** Normalizes and validates the onboarding / profile form. Mirrors the DB checks on `profiles`. */
export function parseProfileInput(raw: { displayName?: unknown; gemId?: unknown }): ProfileResult {
  const displayName = String(raw.displayName ?? "").trim().replace(/\s+/g, " ");
  const gemRaw = String(raw.gemId ?? "").replace(/\s/g, "");
  const gemId = gemRaw === "" ? null : gemRaw;

  const errors: Partial<Record<keyof ProfileInput, string>> = {};
  if (displayName.length === 0) errors.displayName = "Pick a display name.";
  else if (displayName.length > 40) errors.displayName = "Keep it to 40 characters or fewer.";
  if (gemId !== null && !/^[0-9]{1,12}$/.test(gemId)) errors.gemId = "GEM IDs are numbers only.";

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { displayName, gemId } };
}
