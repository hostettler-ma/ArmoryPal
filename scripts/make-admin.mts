// Grants (or with --revoke, removes) admin rights for a user by email.
// Usage: npx tsx scripts/make-admin.mts you@example.com [--revoke]
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local (or the environment).
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

config({ path: ".env.local" });

const email = process.argv[2]?.toLowerCase();
const isAdmin = !process.argv.includes("--revoke");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!email || !url || !secret) {
  console.error("Usage: npx tsx scripts/make-admin.mts <email> [--revoke]  (needs SUPABASE_SECRET_KEY)");
  process.exit(1);
}

const supabase = createClient<Database>(url, secret, { auth: { persistSession: false } });

async function findUserId(target: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < 1000) return null;
  }
}

const id = await findUserId(email);
if (!id) {
  console.error(`No user with email ${email}. Sign in once first.`);
  process.exit(1);
}

const { error } = await supabase.from("profiles").update({ is_admin: isAdmin }).eq("id", id);
if (error) throw error;
console.log(`${email} is ${isAdmin ? "now an admin" : "no longer an admin"}.`);
