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
  const { error } = attend
    ? await supabase.rpc("attend_event", { p_event_id: eventId })
    : await supabase.rpc("leave_event", {
        p_event_id: eventId,
        p_cancel_requests: formData.get("cancelRequests") === "on",
      });
  if (error) {
    return { error: /ended/.test(error.message) ? "This event has already ended." : "Something went wrong. Try again." };
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
  revalidatePath("/stores/[id]", "page");
  return {};
}
