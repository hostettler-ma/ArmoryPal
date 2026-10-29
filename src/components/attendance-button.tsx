"use client";

import { useActionState, useState } from "react";
import { setAttendance, type AttendanceState } from "@/app/actions/events";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Attend / leave toggle. Leaving while bringing cards or with open requests
 * asks first: pledges are always released (the cards become needed again and
 * requesters are notified); the user chooses whether to cancel their requests.
 */
export function AttendanceButton({
  eventId,
  attending,
  pledgedCards = 0,
  openRequests = 0,
}: {
  eventId: string;
  attending: boolean;
  /** Total copies the viewer has promised to bring to this event. */
  pledgedCards?: number;
  /** The viewer's active requests on this event. */
  openRequests?: number;
}) {
  const [state, action, pending] = useActionState<AttendanceState, FormData>(setAttendance, {});
  const [confirming, setConfirming] = useState(false);
  const needsConfirm = attending && (pledgedCards > 0 || openRequests > 0);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="attend" value={String(!attending)} />

      {/* Once the leave succeeds, needsConfirm turns false and this closes. */}
      {confirming && needsConfirm ? (
        <div className="card space-y-3 border-live">
          <p className="font-semibold">Can&apos;t make it?</p>
          {pledgedCards > 0 && (
            <p className="text-sm">
              You&apos;re bringing {plural(pledgedCards, "card", "cards")} for others.{" "}
              {pledgedCards === 1 ? "It goes" : "They go"} back to being needed, and the requesters are told.
            </p>
          )}
          {openRequests > 0 && (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="cancelRequests" defaultChecked className="mt-0.5 h-5 w-5 accent-[var(--accent)]" />
              <span>
                Also cancel my {plural(openRequests, "request", "requests")}. Anyone bringing{" "}
                {openRequests === 1 ? "it" : "them"} will be told. Leave unchecked if someone will pick them up for you.
              </span>
            </label>
          )}
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
        <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
          I can&apos;t make it
        </button>
      ) : (
        <button className={`btn ${attending ? "btn-primary" : "btn-primary"}`} disabled={pending}>
          {pending ? "Saving…" : attending ? "I can't make it" : "I'm going"}
        </button>
      )}

      {state.error && <p className="field-error text-center">{state.error}</p>}
    </form>
  );
}
