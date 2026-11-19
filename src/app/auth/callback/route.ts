import { isAuthPKCECodeVerifierMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth";
import { LINK_ERRORS } from "@/lib/connected-accounts";
import { createClient } from "@/lib/supabase/server";

/** Landing point for magic links, OAuth sign-in and connecting Discord on /me (PKCE code exchange). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Connecting an account failed on Supabase's side (e.g. that Discord account
  // already has its own ArmoryPal account): back to where the flow started.
  const errorCode = searchParams.get("error_code");
  if (!code && errorCode && Object.hasOwn(LINK_ERRORS, errorCode)) {
    const target = new URL(next, origin);
    target.searchParams.set("link_error", errorCode);
    return NextResponse.redirect(`${origin}${target.pathname}${target.search}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    // Sign-in started in another browser: the Discord app returns to the phone's
    // default browser, which doesn't hold the code verifier. Starting again here works.
    if (isAuthPKCECodeVerifierMissingError(error)) {
      return NextResponse.redirect(`${origin}/login?error=other_browser&next=${encodeURIComponent(next)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback`);
}
