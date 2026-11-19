"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type AccountRow, linkErrorMessage } from "@/lib/connected-accounts";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign-in methods on /me, with Connect / Disconnect for Discord. Connecting
 * goes through Discord and back to /auth/callback?next=/me (PKCE, like sign-in;
 * prompt=none skips Discord's Authorize screen for returning players).
 */
export function ConnectedAccounts({ rows, initialError }: { rows: AccountRow[]; initialError: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  function connect() {
    setError(null);
    startTransition(async () => {
      const { error } = await createClient().auth.linkIdentity({
        provider: "discord",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/me")}`,
          queryParams: { prompt: "none" },
        },
      });
      // On success the browser is already on its way to Discord.
      if (error) setError(linkErrorMessage(error.code ?? "unknown"));
    });
  }

  function disconnect(identityId: string) {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: listError } = await supabase.auth.getUserIdentities();
      const identity = data?.identities.find((i) => i.identity_id === identityId);
      if (listError || !identity) {
        setError(linkErrorMessage("unknown"));
        return;
      }
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) {
        setError(linkErrorMessage(error.code ?? "unknown"));
        return;
      }
      // The session still lists the old identity until it refreshes.
      await supabase.auth.refreshSession();
      router.refresh();
    });
  }

  return (
    <section id="connected-accounts" aria-labelledby="connected-accounts-title" className="space-y-3">
      <h2 id="connected-accounts-title" className="text-heading-03">
        Connected accounts
      </h2>
      <p className="text-body-compact text-muted">
        Connect Discord to use ArmoryBot&apos;s buttons in your store&apos;s server and to get DMs.
      </p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <ul className="card-list">
        {rows.map((row) => (
          <li key={row.provider} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-heading-02">{row.label}</p>
              <p className="text-body-compact text-muted truncate">
                {row.connected ? (row.detail ?? "Connected") : "Not connected"}
              </p>
            </div>
            {row.canConnect && (
              <button type="button" className="btn btn-primary btn-compact" onClick={connect} disabled={pending}>
                Connect
              </button>
            )}
            {row.canDisconnect && row.identityId && (
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => disconnect(row.identityId!)}
                disabled={pending}
              >
                Disconnect
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.some((r) => r.provider === "discord" && r.connected && !r.canDisconnect) && (
        <p className="text-helper text-muted">Discord is your only way to sign in, so it can&apos;t be disconnected.</p>
      )}
    </section>
  );
}
