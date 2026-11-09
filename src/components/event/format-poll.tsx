"use client";

import { useState, useTransition } from "react";
import { voteFormat } from "@/app/actions/polls";
import { formatLabel, type PollResults } from "@/lib/formats";

/** "Format: Draft" once the store has confirmed it. */
export function FormatChip({ format }: { format: string }) {
  return (
    <span className="inline-block rounded-full bg-highlight px-2 py-0.5 text-tag text-highlight-foreground">
      Format: {formatLabel(format)}
    </span>
  );
}

/**
 * The event's format poll: tap a format to vote (tap it again to take the
 * vote back). Results are live; voting closes when the store confirms a format
 * or the event starts.
 */
export function FormatPoll({
  eventId,
  results,
  open,
  canVote,
}: {
  eventId: string;
  results: PollResults;
  open: boolean;
  /** Going or saved the store (the poll's audience). */
  canVote: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const interactive = open && canVote;

  const vote = (code: string) =>
    startTransition(async () => {
      setError(null);
      const result = await voteFormat(eventId, results.mine === code ? null : code);
      if (result.error) setError(result.error);
    });

  return (
    <section className="card space-y-3" aria-label="Format poll">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-heading-02">Which format this week?</h2>
        <span className="shrink-0 text-body-compact text-muted">
          {results.total} {results.total === 1 ? "vote" : "votes"}
        </span>
      </div>
      <ul className="space-y-2">
        {results.options.map((o) => {
          const mine = results.mine === o.code;
          const leading = results.leaders.includes(o.code);
          const bar = (
            <>
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 rounded-control ${mine ? "bg-highlight" : "bg-accent-soft/50"}`}
                style={{ width: `${Math.round(o.share * 100)}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className={leading ? "font-semibold" : ""}>
                  {o.label}
                  {mine && <span className="ml-1 text-body-compact">✓</span>}
                </span>
                <span className="text-body-compact">{o.votes}</span>
              </span>
            </>
          );
          return (
            <li key={o.code}>
              {interactive ? (
                <button
                  type="button"
                  aria-pressed={mine}
                  disabled={pending}
                  onClick={() => vote(o.code)}
                  className={`interactive relative block min-h-control-lg w-full overflow-hidden rounded-control border px-3 py-2 text-left ${mine ? "border-accent-text" : "border-border"}`}
                >
                  {bar}
                </button>
              ) : (
                <div className="relative min-h-control-lg overflow-hidden rounded-control border border-border px-3 py-2">{bar}</div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="field-error">{error}</p>}
      <p className="text-helper text-muted">
        {!open
          ? "Voting has closed."
          : canVote
            ? results.mine
              ? "Tap your choice again to take your vote back. Voting closes when the event starts."
              : "Tap a format to vote. Voting closes when the event starts."
            : "Mark yourself as going, or save the store, to vote."}
      </p>
    </section>
  );
}
