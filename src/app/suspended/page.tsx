import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/profile";
import { CONTACT_EMAIL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account suspended · ArmoryPal" };

/** Where requireProfile() sends banned players. Not in (app): no app bar or navigation. */
export default async function SuspendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ban } = await supabase.from("bans").select("reason, created_at").eq("user_id", user.id).maybeSingle();
  if (!ban) redirect("/");

  return (
    <main className="flex min-h-[80dvh] flex-col justify-center gap-5">
      <header className="space-y-1 text-center">
        <p className="font-logo text-xl font-bold tracking-wide">ArmoryPal</p>
        <h1 className="text-2xl font-bold">Your account is suspended</h1>
      </header>
      <div className="card space-y-2">
        <p className="text-sm text-muted">Reason</p>
        <p>{ban.reason}</p>
      </div>
      <p className="text-center text-sm text-muted">
        If you think this is a mistake, email{" "}
        <a className="font-medium text-accent-text" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      <form action={signOut}>
        <button className="btn btn-secondary">Sign out</button>
      </form>
    </main>
  );
}
