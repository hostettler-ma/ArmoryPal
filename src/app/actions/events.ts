"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AttendanceState = { error?: string };

export async function setAttendance(_prev: AttendanceState, formData: FormData): Promise<AttendanceState> {
  const eventId = formData.get("eventId");
  const attend = formData.get("attend") === "true";
  if (!isUuid(eventId)) return { error: "Unknown event." };

  const supabase = await createClient();
  const { error } = await supabase.rpc(attend ? "attend_event" : "leave_event", { p_event_id: eventId });
  if (error) {
    return { error: /ended/.test(error.message) ? "This event has already ended." : "Something went wrong. Try again." };
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
  revalidatePath("/stores/[id]", "page");
  return {};
}
