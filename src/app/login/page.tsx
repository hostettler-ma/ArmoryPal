import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(safeNext(next));

  return (
    <main className="flex min-h-[80dvh] flex-col justify-center gap-8">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">ArmoryPal</h1>
        <p className="text-muted">Borrow and bring cards for your weekly Armory.</p>
      </header>
      {error && (
        <p className="card text-center text-sm text-accent">
          That sign-in link didn&apos;t work. It may have expired. Try again.
        </p>
      )}
      <LoginForm next={safeNext(next)} />
    </main>
  );
}
