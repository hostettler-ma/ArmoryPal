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

/** Google sign-in. Off unless NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true, so it only shows once configured. */
const GOOGLE_LOGIN = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === "true";

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

  const discordLink = useDiscordLink(next);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "sending" });
    // Magic links use the same PKCE verifier cookie, so stop preparing Discord links first.
    await discordLink.leaving();
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl() },
    });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "sent", email: email.trim() });
  }

  /**
   * Redirect sign-in through Supabase (Google, and Discord when no direct link
   * is ready). Every provider shares the PKCE verifier cookie, so stop
   * preparing Discord links before starting.
   */
  async function signInWith(provider: "discord" | "google") {
    await discordLink.leaving();
    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl(), queryParams: provider === "discord" ? DISCORD_QUERY : undefined },
    });
    if (error) setStatus({ kind: "error", message: error.message });
  }

  if (status.kind === "sent") {
    return (
      <div className="card space-y-2 text-center">
        <p className="text-heading-03">Check your email</p>
        <p className="text-muted">
          We sent a sign-in link to <span className="font-semibold text-foreground">{status.email}</span>.
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
      <div className="space-y-3">
        {discordLink.href ? (
          // A direct discord.com link, so phones can open it in the Discord app.
          <a
            href={discordLink.href}
            className={`btn ${EMAIL_LOGIN ? "btn-secondary" : "btn-primary"}`}
            onClick={(e) => {
              if (!discordLink.fresh()) {
                e.preventDefault();
                void signInWith("discord");
              } else void discordLink.leaving();
            }}
          >
            <DiscordIcon /> Continue with Discord
          </a>
        ) : (
          <button
            type="button"
            className={`btn ${EMAIL_LOGIN ? "btn-secondary" : "btn-primary"}`}
            onClick={() => signInWith("discord")}
          >
            <DiscordIcon /> Continue with Discord
          </button>
        )}
        {GOOGLE_LOGIN && (
          <button type="button" className="btn btn-secondary" onClick={() => signInWith("google")}>
            <GoogleIcon /> Continue with Google
          </button>
        )}
      </div>

      {EMAIL_LOGIN && (
        <>
          <div className="flex items-center gap-3 text-body-compact text-muted">
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
    <svg aria-hidden viewBox="0 0 24 24" className="size-icon-md fill-current">
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9 0 13.6.3 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.8-13.7ZM8.7 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm6.6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}

/** Google's multicolour "G" mark, which its branding guidelines require on sign-in buttons. */
function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-icon-md">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
