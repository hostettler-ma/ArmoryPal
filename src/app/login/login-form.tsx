"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDiscordAuthorizeUrl } from "@/app/actions/auth";
import { DISCORD_LINK_MAX_AGE_MS } from "@/lib/discord-auth";
import { createClient } from "@/lib/supabase/client";

/**
 * Email magic-link sign-in. Off unless NEXT_PUBLIC_ENABLE_EMAIL_LOGIN=true:
 * production launches Discord-only until a real SMTP provider is configured
 * (Supabase's built-in mailer only sends a few emails per hour).
 */
const EMAIL_LOGIN = process.env.NEXT_PUBLIC_ENABLE_EMAIL_LOGIN === "true";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const callbackUrl = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "sending" });
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl() },
    });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "sent", email: email.trim() });
  }

  const discordLink = useDiscordLink(next);

  // Fallback when no direct link is ready: Supabase redirects to Discord as before.
  async function signInWithDiscord() {
    await discordLink.leaving();
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: callbackUrl(), queryParams: DISCORD_QUERY },
    });
    if (error) setStatus({ kind: "error", message: error.message });
  }

  if (status.kind === "sent") {
    return (
      <div className="card space-y-2 text-center">
        <p className="text-lg font-semibold">Check your email</p>
        <p className="text-muted">
          We sent a sign-in link to <span className="font-medium text-foreground">{status.email}</span>.
          Open it on this device.
        </p>
        <button className="btn btn-secondary mt-2" onClick={() => setStatus({ kind: "idle" })}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {discordLink.href ? (
        // A direct discord.com link, so phones can open it in the Discord app.
        <a
          href={discordLink.href}
          className={`btn ${EMAIL_LOGIN ? "btn-secondary" : "btn-primary"}`}
          onClick={(e) => {
            if (!discordLink.fresh()) {
              e.preventDefault();
              void signInWithDiscord();
            } else void discordLink.leaving();
          }}
        >
          <DiscordIcon /> Continue with Discord
        </a>
      ) : (
        <button
          type="button"
          className={`btn ${EMAIL_LOGIN ? "btn-secondary" : "btn-primary"}`}
          onClick={signInWithDiscord}
        >
          <DiscordIcon /> Continue with Discord
        </button>
      )}

      {EMAIL_LOGIN && (
        <>
          <div className="flex items-center gap-3 text-sm text-muted">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>
          <EmailForm email={email} setEmail={setEmail} onSubmit={sendMagicLink} sending={status.kind === "sending"} />
        </>
      )}

      {status.kind === "error" && <p className="field-error text-center">{status.message}</p>}
    </div>
  );
}

/** Skip Discord's "Authorize" screen for players who already approved ArmoryPal. */
const DISCORD_QUERY = { prompt: "none" };

/** Running as the installed app: a handoff to the Discord app would return to the browser instead. */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Prepares a direct discord.com authorize link: Supabase stores the PKCE code
 * verifier in this browser (as a normal sign-in would) and the server resolves
 * Supabase's redirect to Discord's URL. Re-prepared when it gets stale.
 */
function useDiscordLink(next: string) {
  const [link, setLinkState] = useState<{ href: string; at: number } | null>(null);
  const linkRef = useRef(link);
  const setLink = (value: typeof link) => {
    linkRef.current = value;
    setLinkState(value);
  };
  // Once a sign-in starts, don't prepare another one: that would replace the code verifier.
  const leavingRef = useRef(false);
  // Each preparation overwrites the verifier cookie, so only the latest one's link is valid.
  const attemptRef = useRef(0);
  // The in-flight signInWithOAuth call, which writes the verifier cookie.
  const pendingRef = useRef<Promise<unknown>>(Promise.resolve());

  const prepare = useCallback(async () => {
    if (leavingRef.current || isStandalone()) return;
    const attempt = ++attemptRef.current;
    const current = () => attempt === attemptRef.current && !leavingRef.current;
    setLink(null);
    const oauth = createClient().auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: DISCORD_QUERY,
        skipBrowserRedirect: true,
      },
    });
    pendingRef.current = oauth.catch(() => {});
    const { data, error } = await oauth;
    if (error || !data.url || !current()) return;
    const href = await resolveDiscordAuthorizeUrl(data.url);
    if (href && current()) setLink({ href, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setLink only touches refs and state setters
  }, [next]);

  useEffect(() => {
    void prepare();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back from Discord (bfcache) or after a while: start over if stale.
      leavingRef.current = false;
      const l = linkRef.current;
      if (!l || Date.now() - l.at > DISCORD_LINK_MAX_AGE_MS) void prepare();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [prepare]);

  return {
    href: link?.href ?? null,
    fresh: () => !!link && Date.now() - link.at <= DISCORD_LINK_MAX_AGE_MS,
    /** Stops preparing links; resolves once no preparation can still overwrite the verifier. */
    leaving: () => {
      leavingRef.current = true;
      attemptRef.current++; // drop any preparation still in flight
      return pendingRef.current;
    },
  };
}

function EmailForm({
  email,
  setEmail,
  onSubmit,
  sending,
}: {
  email: string;
  setEmail: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  sending: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="label" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        className="input"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn btn-primary" disabled={sending}>
        {sending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}

function DiscordIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9 0 13.6.3 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.8-13.7ZM8.7 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm6.6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}
