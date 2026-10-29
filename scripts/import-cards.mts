// Imports the card catalog from the-fab-cube/flesh-and-blood-cards into `cards`,
// and records the dataset version and latest expansion in `catalog_meta`.
// Idempotent: upserts by the dataset's stable unique_id; cards are never deleted
// (requests may reference them).
//
// Usage:
//   npx tsx scripts/import-cards.mts                 # pinned DATASET_TAG
//   npx tsx scripts/import-cards.mts --tag v8.3.0    # a newer release
//   npx tsx scripts/import-cards.mts --dir ./data    # local card.json + set.json
//   npx tsx scripts/import-cards.mts --env .env.production.local   # target production
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local (or --env file, or the environment).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { latestExpansion, setInfo, toCardRow, type FabCubeCard, type FabCubeSet } from "../src/lib/cards";
import type { Database } from "../src/lib/supabase/database.types";

/** Bump this (and re-run) when a new set releases. */
const DATASET_TAG = "v8.2.0";
const BATCH_SIZE = 500;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

config({ path: arg("env") ?? ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const dir = arg("dir");
const tag = dir ? `local:${path.resolve(dir)}` : (arg("tag") ?? DATASET_TAG);

async function load<T>(file: "card.json" | "set.json"): Promise<T[]> {
  let data: unknown;
  if (dir) {
    console.log(`Reading ${path.join(dir, file)}`);
    data = JSON.parse(await readFile(path.join(dir, file), "utf8"));
  } else {
    const source = `https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/${tag}/json/english/${file}`;
    console.log(`Downloading ${source}`);
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Download of ${file} failed: HTTP ${res.status}`);
    data = await res.json();
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error(`${file} is empty or not an array.`);
  return data as T[];
}

const [rawCards, rawSets] = await Promise.all([load<FabCubeCard>("card.json"), load<FabCubeSet>("set.json")]);

const latest = latestExpansion(rawCards, rawSets);
if (!latest) throw new Error("Couldn't determine the latest expansion from set.json.");

const sets = setInfo(rawSets);
const rows = rawCards.map((c) => ({ ...toCardRow(c, sets), updated_at: new Date().toISOString() }));
console.log(`${rows.length} cards to upsert. Latest expansion: ${latest.name} (${latest.id}, ${latest.releasedOn}).`);

console.log(`Target: ${url}`);
const supabase = createClient<Database>(url, secret, { auth: { persistSession: false } });
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const { error } = await supabase.from("cards").upsert(batch, { onConflict: "id" });
  if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
  process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
}

const { error: metaError } = await supabase.from("catalog_meta").upsert({
  id: true,
  dataset_tag: tag,
  latest_set_id: latest.id,
  latest_set_name: latest.name,
  latest_set_released_on: latest.releasedOn,
  imported_at: new Date().toISOString(),
});
if (metaError) throw new Error(`Writing catalog_meta failed: ${metaError.message}`);

const { count } = await supabase.from("cards").select("*", { count: "exact", head: true });
console.log(`\nDone. ${count} cards in the catalog.`);
