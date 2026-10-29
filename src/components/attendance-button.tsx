"use client";

import { useActionState, useState } from "react";
import { setAttendance, type AttendanceState } from "@/app/actions/events";

/**
 * Attend / leave toggle. Leaving while bringing cards asks for confirmation,
 * since those pledges are released and the cards become needed again.
 */
export function AttendanceButton({
  eventId,
  attending,
  pledgedCards = 0,
}: {
  eventId: string;
  attending: boolean;
  /** Total copies the viewer has promised to bring to this event. */
  pledgedCards?: number;
}) {
  const [state, action, pending] = useActionState<AttendanceState, FormData>(setAttendance, {});
  const [confirming, setConfirming] = useState(false);
  const needsConfirm = attending && pledgedCards > 0;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="attend" value={String(!attending)} />

      {/* Once the leave succeeds, needsConfirm turns false and this closes. */}
      {confirming && needsConfirm ? (
        <div className="card space-y-3 border-live">
          <p className="text-sm">
            You&apos;re bringing {pledgedCards} {pledgedCards === 1 ? "card" : "cards"} for others. If you can&apos;t
            make it, {pledgedCards === 1 ? "it goes" : "they go"} back to being needed.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
              I&apos;m still going
            </button>
            <button className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "I can't make it"}
            </button>
          </div>
        </div>
      ) : needsConfirm ? (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          I can&apos;t make it
        </button>
      ) : (
        <button className={`btn ${attending ? "btn-secondary" : "btn-primary"}`} disabled={pending}>
          {pending ? "Saving…" : attending ? "I can't make it" : "I'm going"}
        </button>
      )}

      {state.error && <p className="field-error text-center">{state.error}</p>}
    </form>
  );
}
