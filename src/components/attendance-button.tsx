"use client";

import { useActionState } from "react";
import { setAttendance, type AttendanceState } from "@/app/actions/events";

export function AttendanceButton({ eventId, attending }: { eventId: string; attending: boolean }) {
  const [state, action, pending] = useActionState<AttendanceState, FormData>(setAttendance, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="attend" value={String(!attending)} />
      <button className={`btn ${attending ? "btn-secondary" : "btn-primary"}`} disabled={pending}>
        {pending ? "Saving…" : attending ? "I can't make it" : "I'm going"}
      </button>
      {state.error && <p className="field-error text-center">{state.error}</p>}
    </form>
  );
}
