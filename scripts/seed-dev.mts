// Creates local test players (Alice, Bob, Carol) and a realistic current event:
// all three follow two stores and are going to Uncommons' Armory, Bob and Carol
// request cards, and Alice and Carol pledge some of them. Safe to re-run.
// Then sign in as any of them from the "Dev sign-in" box on localhost:3000/login.
// Usage: npx tsx scripts/seed-dev.mts   (local Supabase only; run import-cards first for requests)
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { DEV_PASSWORD, DEV_USERS, isLocalSupabase } from "../src/lib/dev-users";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secret) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.local.");
  process.exit(1);
}
if (!isLocalSupabase(url)) {
  console.error(`Refusing to seed test players into a non-local Supabase: ${url}`);
  process.exit(1);
}

console.log(`Target: ${url}`);
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url, secret, noSession);

// Seeded in supabase/seed.sql: Uncommons (Mon) and Action City Comics (Tue).
const EVENT_STORE = "00000000-0000-4000-b000-000000000001";
const FOLLOWED_STORES = [EVENT_STORE, "00000000-0000-4000-b000-000000000002"];

type Player = { id: string; name: string; client: SupabaseClient<Database> };

async function ensurePlayer(email: string, name: string): Promise<Player> {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  let id = list.users.find((u) => u.email === email)?.id;
  if (id) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: DEV_PASSWORD });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
    if (error) throw error;
    id = data.user.id;
  }
  const { error: profileError } = await admin.from("profiles").update({ display_name: name }).eq("id", id);
  if (profileError) throw profileError;

  const client = createClient<Database>(url!, publishableKey!, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (signInError) throw signInError;
  return { id, name, client };
}

function check<T>(label: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const [alice, bob, carol] = await Promise.all(DEV_USERS.map((u) => ensurePlayer(u.email, u.name)));

check(
  "follow stores",
  await admin
    .from("user_stores")
    .upsert(
      [alice, bob, carol].flatMap((p) => FOLLOWED_STORES.map((store_id) => ({ user_id: p.id, store_id }))),
      { onConflict: "user_id,store_id", ignoreDuplicates: true },
    ),
);

const events = check("current event", await alice.client.rpc("current_events_for_stores", { p_store_ids: [EVENT_STORE] }));
const event = events?.[0];
if (!event) throw new Error("Uncommons has no active schedule. Did `npx supabase db reset` run the seed?");
for (const p of [alice, bob, carol]) check(`${p.name} attends`, await p.client.rpc("attend_event", { p_event_id: event.id }));
console.log(`Event ${event.event_date} at Uncommons: /events/${event.id}`);

// Requests: [player, card name, colour, quantity]; pledges: [pledger, requester, card name, colour, quantity].
const REQUESTS: [Player, string, string | null, number][] = [
  [bob, "Snatch", "Red", 3],
  [bob, "Sink Below", "Red", 2],
  [bob, "Command and Conquer", "Red", 1],
  [carol, "Enlightened Strike", "Red", 2],
  [carol, "Snatch", "Blue", 1],
];
const PLEDGES: [Player, Player, string, string | null, number][] = [
  [alice, bob, "Snatch", "Red", 2],
  [alice, carol, "Enlightened Strike", "Red", 1],
  [carol, bob, "Sink Below", "Red", 1],
];

const cards = check(
  "cards",
  await admin.from("cards").select("id, name, color").in("name", [...new Set(REQUESTS.map((r) => r[1]))]),
);
const cardId = (name: string, color: string | null) => cards.find((c) => c.name === name && c.color === color)?.id;
if (!cards.length) {
  console.log("No cards found, so no requests were seeded. Run `npx tsx scripts/import-cards.mts`, then re-run this.");
  process.exit(0);
}

// Re-running shouldn't stack quantities: only request cards a player hasn't already requested here.
const existing = check(
  "existing requests",
  await admin.from("requests").select("id, requester_id, card_id").eq("event_id", event.id).eq("status", "active"),
);
for (const player of [bob, carol]) {
  const items = REQUESTS.filter(([p]) => p === player)
    .map(([, name, color, quantity]) => ({ card_id: cardId(name, color), quantity }))
    .filter((i): i is { card_id: string; quantity: number } => !!i.card_id)
    .filter((i) => !existing.some((r) => r.requester_id === player.id && r.card_id === i.card_id));
  if (items.length) {
    check(`${player.name} requests`, await player.client.rpc("add_requests", { p_event_id: event.id, p_items: items }));
  }
}

const requests = check(
  "requests",
  await admin.from("requests").select("id, requester_id, card_id").eq("event_id", event.id).eq("status", "active"),
);
for (const [pledger, requester, name, color, quantity] of PLEDGES) {
  const request = requests.find((r) => r.requester_id === requester.id && r.card_id === cardId(name, color));
  if (!request) continue;
  // pledge() replaces the caller's quantity, so this is idempotent.
  check(`${pledger.name} pledges`, await pledger.client.rpc("pledge", { p_request_id: request.id, p_quantity: quantity }));
}

console.log(`Seeded ${DEV_USERS.map((u) => u.name).join(", ")} (password "${DEV_PASSWORD}").`);
console.log("Sign in from the Dev sign-in box on http://localhost:3000/login.");
