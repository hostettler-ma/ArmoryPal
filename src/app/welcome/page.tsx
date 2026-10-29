import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { createClient } from "@/lib/supabase/server";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, gem_id")
    .eq("id", user.id)
    .single();

  return (
    <main className="space-y-6 pt-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Welcome to ArmoryPal</h1>
        <p className="text-muted">What should other players call you?</p>
      </header>
      <ProfileForm
        displayName={profile?.display_name ?? ""}
        gemId={profile?.gem_id ?? ""}
        submitLabel="Continue"
        redirectTo="/"
      />
    </main>
  );
}
