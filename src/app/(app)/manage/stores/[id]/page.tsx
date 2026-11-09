import Link from "next/link";
import { notFound } from "next/navigation";
import { addOwnerSchedule, setOwnerScheduleActive } from "@/app/actions/manage";
import { ScheduleForm } from "@/components/admin/schedule-form";
import { CreateEventButton, EditSlotButton, StoreInfoForm } from "@/components/manage/manage-forms";
import { WeeklyPollToggle } from "@/components/manage/poll-controls";
import { formatLabel } from "@/lib/formats";
import { PageHeader } from "@/components/page-header";
import { requireStoreManager } from "@/lib/auth";
import { localToday } from "@/lib/event-manage";
import { formatEventWhen } from "@/lib/events";
import { formatSchedule } from "@/lib/stores";

/** How many weeks ahead owners see (and can prepare) weekly events. */
const WEEKS_AHEAD = 6;

// Display order; the first tab is the default.
const TABS = ["upcoming", "weekly", "info"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { upcoming: "Upcoming", weekly: "Weekly Armories", info: "Store info" };

/** Owner dashboard for one store, in tabs: upcoming events, weekly Armories, store info. */
export default async function ManageStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const tabParam = (await searchParams).tab;
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : TABS[0];
  const { supabase } = await requireStoreManager(id);

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, timezone, archived_at, notes, ticket_url")
    .eq("id", id)
    .maybeSingle();
  if (!store || store.archived_at) notFound();

  return (
    <main className="space-y-6">
      <PageHeader
        title={store.name}
        trail={[{ label: "Manage", href: "/manage" }]}
        action={
          <Link href={`/stores/${store.id}`} className="text-label link">
            View
          </Link>
        }
      />

      <nav className="tab-bar" aria-label="Store sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/manage/stores/${store.id}?tab=${t}`}
            replace
            scroll={false}
            aria-current={t === tab ? "page" : undefined}
            className="tab"
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {tab === "upcoming" && <UpcomingTab supabase={supabase} store={store} />}
      {tab === "weekly" && <WeeklyTab supabase={supabase} storeId={store.id} />}
      {tab === "info" && (
        <section className="space-y-3">
          <StoreInfoForm storeId={store.id} notes={store.notes ?? ""} ticket={store.ticket_url ?? ""} />
        </section>
      )}
    </main>
  );
}

type Store = { id: string; timezone: string };
type Supabase = Awaited<ReturnType<typeof requireStoreManager>>["supabase"];

async function UpcomingTab({ supabase, store }: { supabase: Supabase; store: Store }) {
  const { data: upcoming, error } = await supabase.rpc("owner_upcoming_events", {
    p_store_id: store.id,
    p_weeks: WEEKS_AHEAD,
  });
  if (error) throw error;
  const events = upcoming ?? [];
  const { data: attendances } = events.length
    ? await supabase
        .from("attendances")
        .select("event_id")
        .in(
          "event_id",
          events.map((e) => e.id),
        )
    : { data: [] };
  const going = new Map<string, number>();
  for (const a of attendances ?? []) going.set(a.event_id, (going.get(a.event_id) ?? 0) + 1);

  return (
    <section className="space-y-3">
      {events.length === 0 ? (
        <p className="card text-muted">
          No events coming up. Add a one-off event below, or a weekly Armory in the{" "}
          <Link href={`/manage/stores/${store.id}?tab=weekly`} replace className="font-semibold link">
            Weekly Armories
          </Link>{" "}
          tab.
        </p>
      ) : (
        <ul className="card-list">
          {events.map((e) => {
            const linked = e.gem_url || e.gem_code;
            return (
              <li key={e.id}>
                <Link href={`/manage/events/${e.id}`} className="list-row flex min-h-control-lg items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-heading-02">
                      {e.label}
                      {!e.schedule_id && (
                        <span className="ml-2 rounded-full border border-border px-2 text-helper">One-off</span>
                      )}
                      {e.moved_from && (
                        <span className="ml-2 rounded-full border border-border px-2 text-helper">Moved</span>
                      )}
                    </span>
                    <span className="block text-body-compact text-muted">
                      {formatEventWhen(e.starts_at, store.timezone)}
                      {e.format && ` · ${formatLabel(e.format)}`}
                      {!linked && " · no GEM link yet"}
                    </span>
                  </span>
                  <span className="shrink-0 text-body-compact text-muted">{going.get(e.id) ?? 0} going</span>
                  <span aria-hidden className="shrink-0 text-glyph text-muted">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <CreateEventButton storeId={store.id} today={localToday(store.timezone)} />
    </section>
  );
}

async function WeeklyTab({ supabase, storeId }: { supabase: Supabase; storeId: string }) {
  const { data: schedules } = await supabase
    .from("store_schedules")
    .select("*")
    .eq("store_id", storeId)
    .order("weekday")
    .order("start_time");

  return (
    <section className="space-y-3">
      {(schedules ?? []).length === 0 && <p className="text-muted">No weekly Armories yet. Add one below.</p>}
      <ul className="space-y-2">
        {(schedules ?? []).map((s) => (
          <li key={s.id} className={`card flex items-center gap-2 ${s.active ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-heading-02">
                {s.label} {!s.active && <span className="text-body-compact text-muted">(paused)</span>}
              </p>
              <p className="text-body-compact text-muted">{formatSchedule(s)}</p>
            </div>
            {s.active && (
              <WeeklyPollToggle scheduleId={s.id} storeId={storeId} on={s.weekly_format_poll} options={s.poll_options} />
            )}
            {s.active && <EditSlotButton storeId={storeId} schedule={s} />}
            <form action={setOwnerScheduleActive}>
              <input type="hidden" name="scheduleId" value={s.id} />
              <input type="hidden" name="storeId" value={storeId} />
              <input type="hidden" name="active" value={String(!s.active)} />
              <button className="btn btn-secondary btn-compact">{s.active ? "Pause" : "Resume"}</button>
            </form>
          </li>
        ))}
      </ul>
      <ScheduleForm storeId={storeId} action={addOwnerSchedule} />
    </section>
  );
}
