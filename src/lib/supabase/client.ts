import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { supabaseKey, supabaseUrl } from "./env";

export function createClient() {
  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
