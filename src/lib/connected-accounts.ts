// "Connected accounts" on /me: which sign-in methods a player has, and what
// they can do with each. Supabase enforces the same "keep at least one" rule
// (single_identity_not_deletable); this copy decides what the UI offers.

export type IdentityLike = {
  identity_id: string;
  provider: string;
  identity_data?: Record<string, unknown> | null;
};

export type AccountRow = {
  provider: "discord" | "google" | "email";
  label: string;
  /** Username or email shown under the label, when the provider gives one. */
  detail: string | null;
  identityId: string | null;
  connected: boolean;
  /** Only Discord can be connected and disconnected here. */
  canConnect: boolean;
  canDisconnect: boolean;
};

const LABELS = { discord: "Discord", google: "Google", email: "Email" } as const;

function detailOf(identity: IdentityLike | undefined): string | null {
  const data = identity?.identity_data ?? {};
  for (const key of ["full_name", "name", "user_name", "email"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * One row per sign-in method: Discord always (so it can be connected), and
 * Google and email when the account has them. Disconnecting Discord needs
 * another way to sign in.
 */
export function connectedAccounts(identities: readonly IdentityLike[]): AccountRow[] {
  const byProvider = (p: string) => identities.find((i) => i.provider === p);
  const rows: AccountRow[] = [];
  for (const provider of ["discord", "google", "email"] as const) {
    const identity = byProvider(provider);
    if (!identity && provider !== "discord") continue;
    rows.push({
      provider,
      label: LABELS[provider],
      detail: detailOf(identity),
      identityId: identity?.identity_id ?? null,
      connected: Boolean(identity),
      canConnect: provider === "discord" && !identity,
      canDisconnect: provider === "discord" && Boolean(identity) && identities.length > 1,
    });
  }
  return rows;
}

export function hasDiscord(identities: readonly IdentityLike[] | undefined): boolean {
  return (identities ?? []).some((i) => i.provider === "discord");
}

/** Errors Supabase reports when connecting or disconnecting an account (`error_code`). */
export const LINK_ERRORS: Record<string, string> = {
  identity_already_exists:
    "This Discord account already has its own ArmoryPal account. Sign in with Discord instead, or ask an admin to merge them.",
  manual_linking_disabled: "Connecting accounts isn't turned on yet. Try again later.",
  single_identity_not_deletable: "You need another way to sign in before you can disconnect Discord.",
};

export function linkErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return LINK_ERRORS[code] ?? "Couldn't connect your Discord. Try again.";
}
