import { CARDS, E2E_STORE_ID, E2E_STORE_NAME } from "./env";
import { admin } from "./supabase";

/**
 * Seeds what every test relies on: a few test cards and one store with a
 * weekly slot. Idempotent, so it's safe against a database that already has
 * them. (The real card catalog isn't needed; `supabase db reset` leaves it empty.)
 */
export default async function globalSetup() {
  const db = admin();

  const { error: cardsError } = await db.from("cards").upsert([
    { id: "e2e-snatch-red", name: CARDS.snatch, pitch: 1, color: "Red", types: ["Generic", "Action", "Attack"], set_ids: ["WTR", "ARC"] },
    { id: "e2e-snatch-yellow", name: CARDS.snatch, pitch: 2, color: "Yellow", types: ["Generic", "Action", "Attack"], set_ids: ["WTR"] },
    { id: "e2e-snatch-blue", name: CARDS.snatch, pitch: 3, color: "Blue", types: ["Generic", "Action", "Attack"], set_ids: ["WTR"] },
    { id: "e2e-sledge", name: CARDS.sledge, pitch: null, color: null, types: ["Guardian", "Weapon"], set_ids: ["WTR"] },
  ]);
  if (cardsError) throw cardsError;

  const { error: storeError } = await db.from("stores").upsert({
    id: E2E_STORE_ID,
    name: E2E_STORE_NAME,
    city: "Testville",
    region: "NY",
    country: "USA",
    timezone: "UTC",
  });
  if (storeError) throw storeError;

  const { data: schedules } = await db.from("store_schedules").select("id").eq("store_id", E2E_STORE_ID);
  if (!schedules?.length) {
    // Two days from now, so this week's event is always upcoming (never "ended") while tests run.
    const weekday = (new Date().getUTCDay() + 2) % 7;
    const { error } = await db
      .from("store_schedules")
      .insert({ store_id: E2E_STORE_ID, label: "E2E Armory", weekday, start_time: "18:00" });
    if (error) throw error;
  }
}
