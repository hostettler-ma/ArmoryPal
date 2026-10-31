import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StoreLink } from "@/components/store-link";
import { formatLocation } from "@/lib/stores";
import { isUuid, requireProfile } from "@/lib/auth";
import { formatEventWhen } from "@/lib/events";
import { coverage, totalPledged } from "@/lib/rules";

const PAGE_SIZE = 20;

/** Past (ended, read-only) events for a store, newest first. */
export default async function StoreHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { supabase } = await requireProfile();

  const [{ data: store }, { data: events }] = await Promise.all([
    supabase.from("stores").select("id, name, timezone, city, region, country").eq("id", id).maybeSingle(),
    supabase
      .from("events")
      .select(
        "id, starts_at, schedule:store_schedules(label), attendances(count), requests(quantity, status, pledges(quantity))",
      )
      .eq("store_id", id)
      .lte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE), // one extra row tells us if there's a next page
  ]);
  if (!store) notFound();

  const rows = (events ?? []).slice(0, PAGE_SIZE).map((e) => {
    const active = e.requests.filter((r) => r.status === "active");
    return {
      id: e.id,
      label: e.schedule?.label ?? "Armory",
      when: formatEventWhen(e.starts_at, store.timezone),
      going: e.attendances[0]?.count ?? 0,
      requests: active.length,
      covered: active.filter((r) => coverage(r.quantity, totalPledged(r.pledges)) === "covered").length,
    };
  });
  const hasMore = (events ?? []).length > PAGE_SIZE;

  return (
    <main className="space-y-5">
      <PageHeader title="Past events" trail={[{ label: store.name, href: `/stores/${store.id}` }]} />
      <StoreLink store={store} subtitle={formatLocation(store)} />

      {rows.length === 0 ? (
        <p className="card text-muted">No past events yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id}>
              <Link href={`/events/${e.id}`} className="card flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{e.label}</p>
                  <p className="text-sm text-muted">{e.when}</p>
                </div>
                <div className="shrink-0 text-right text-sm text-muted">
                  <p>{e.going} went</p>
                  {e.requests > 0 && (
                    <p>
                      {e.covered}/{e.requests} requests covered
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <nav className="flex justify-between text-sm font-medium">
          {page > 1 ? (
            <Link href={`/stores/${store.id}/history?page=${page - 1}`} className="text-accent-text">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={`/stores/${store.id}/history?page=${page + 1}`} className="text-accent-text">
              Older →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
