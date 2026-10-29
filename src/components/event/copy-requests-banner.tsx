"use client";

import { useEffect, useState, useTransition } from "react";
import { copyOpenRequests } from "@/app/actions/requests";
import type { CopySummary } from "@/lib/rollover";

const dismissKey = (eventId: string) => `armorypal:copy-dismissed:${eventId}`;

/** Offers to copy last week's still-needed requests into this event. "Not now" is remembered per device. */
export function CopyRequestsBanner({
  eventId,
  fromEventId,
  summary,
}: {
  eventId: string;
  fromEventId: string;
  summary: CopySummary;
}) {
  // Hidden until we've checked localStorage, so a dismissed banner doesn't flash.
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(dismissKey(eventId)) !== "1");
    } catch {
      setVisible(true); // storage blocked (private mode): just show it
    }
  }, [eventId]);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(dismissKey(eventId), "1");
    } catch {
      // ignore: it just won't be remembered
    }
    setVisible(false);
  }

  function copy() {
    setError(null);
    startTransition(async () => {
      const result = await copyOpenRequests(eventId, fromEventId);
      if (result.error) setError(result.error);
      // On success the page re-renders without this banner.
    });
  }

  const cards = `${summary.copies} ${summary.copies === 1 ? "card" : "cards"}`;
  return (
    <div className="card space-y-3 border-accent">
      <p>
        <span className="font-semibold">Still need cards from last week?</span>{" "}
        Nobody covered {cards} you asked for ({summary.requests}{" "}
        {summary.requests === 1 ? "request" : "requests"}). Add them to this week?
      </p>
      {error && <p className="field-error">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={dismiss} disabled={pending}>
          Not now
        </button>
        <button className="btn btn-primary" onClick={copy} disabled={pending}>
          {pending ? "Adding…" : `Add ${cards}`}
        </button>
      </div>
    </div>
  );
}
