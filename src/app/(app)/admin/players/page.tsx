import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";

const PROVIDER_LABEL: Record<string, string> = { discord: "Discord", google: "Google", email: "Email" };

export default async function AdminPlayersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { supabase } = await requireAdmin();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const { data: players, error } = await supabase.rpc("admin_list_players", { p_query: q, p_limit: 100 });

  return (
    <main className="space-y-6">
      <PageHeader title="Players" trail={[{ label: "Admin", href: "/admin" }]} />

      <form role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name or email"
          aria-label="Search players"
          className="input"
          enterKeyHint="search"
        />
        <button className="btn btn-primary w-auto">Search</button>
      </form>

      {error ? (
        <p className="field-error">Couldn&apos;t load players. Try again.</p>
      ) : (players ?? []).length === 0 ? (
        <p className="card text-center text-muted">{q ? `No players match “${q}”.` : "No players yet."}</p>
      ) : (
        <ul className="card-list">
          {players!.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/players/${p.id}`} className="list-row flex min-h-control-lg items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-heading-02">
                    {p.display_name ?? "(no name yet)"}
                    {p.is_admin && (
                      <span className="ml-2 rounded-full bg-highlight px-2 text-tag text-highlight-foreground">
                        Admin
                      </span>
                    )}
                    {p.banned && (
                      <span className="ml-2 rounded-full border border-danger px-2 text-tag text-danger">
                        Banned
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-body-compact text-muted">
                    {p.email ?? "no email"} · {PROVIDER_LABEL[p.provider ?? ""] ?? p.provider ?? "unknown"}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-glyph text-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(players ?? []).length === 100 && (
        <p className="text-center text-body-compact text-muted">Showing the 100 newest matches. Search to narrow it down.</p>
      )}
    </main>
  );
}
