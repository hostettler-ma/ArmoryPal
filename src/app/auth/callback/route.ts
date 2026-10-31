import { isAuthPKCECodeVerifierMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Landing point for magic links and Discord OAuth (PKCE code exchange). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

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
