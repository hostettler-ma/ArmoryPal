"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { parseProfileInput, type ProfileInput } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export type ProfileFormState = {
  errors?: Partial<Record<keyof ProfileInput | "form", string>>;
  saved?: boolean;
};

export async function saveProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const parsed = parseProfileInput({
    displayName: formData.get("displayName"),
    gemId: formData.get("gemId"),
  });
  if (!parsed.ok) return { errors: parsed.errors };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.value.displayName, gem_id: parsed.value.gemId })
    .eq("id", user.id);
  if (error) return { errors: { form: "Couldn't save your profile. Try again." } };

  revalidatePath("/", "layout");
  const redirectTo = formData.get("redirectTo");
  if (typeof redirectTo === "string" && redirectTo) redirect(safeNext(redirectTo));
  return { saved: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
