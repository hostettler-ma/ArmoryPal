import Link from "next/link";
import { requireProfile } from "@/lib/auth";

export default async function HomePage() {
  const { profile } = await requireProfile();

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ArmoryPal</h1>
        <Link
          href="/me"
          className="flex h-10 min-w-10 items-center justify-center rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-border"
        >
          {profile.display_name}
        </Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My stores</h2>
        <div className="card text-muted">
          You haven&apos;t added any stores yet. Store search arrives in Phase 1.
        </div>
      </section>
    </main>
  );
}
