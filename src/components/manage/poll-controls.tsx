"use client";

import { useState, useTransition } from "react";
import { confirmFormat, deletePoll, openPoll, setWeeklyPoll, type PollResult } from "@/app/actions/polls";
import { FormatChip } from "@/components/event/format-poll";
import { SheetButton } from "@/components/manage/manage-forms";
import { ALL_FORMATS, FORMATS, formatLabel, type FormatCode, type PollResults } from "@/lib/formats";

function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<PollResult>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
      else onDone?.();
    });
  return { pending, error, run };
}

/** Checkboxes for the formats a poll offers (all four by default). */
function FormatChecklist({ value, onChange }: { value: FormatCode[]; onChange: (v: FormatCode[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">Formats to vote on</legend>
      {FORMATS.map((f) => (
        <label key={f.code} className="flex min-h-control-lg items-center gap-3">
          <input
            type="checkbox"
            className="size-icon-md accent-accent"
            checked={value.includes(f.code)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? ALL_FORMATS.filter((c) => c === f.code || value.includes(c))
                  : value.filter((c) => c !== f.code),
              )
            }
          />
          {f.label}
        </label>
      ))}
    </fieldset>
  );
}

function StartPollForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [options, setOptions] = useState<FormatCode[]>(ALL_FORMATS);
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-4">
      <FormatChecklist value={options} onChange={setOptions} />
      <p className="text-body-compact text-muted">
        Everyone going or following your store can vote, and gets a notification. Voting closes when you confirm a
        format or the event starts.
      </p>
      {error && <p className="field-error">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || options.length < 2}
        onClick={() => run(() => openPoll(eventId, options), onDone)}
      >
        {pending ? "Starting…" : "Start poll"}
      </button>
    </div>
  );
}

/**
 * Owner event page: start a one-time poll, see results, and confirm the
 * format to run (with or without a poll).
 */
export function OwnerPollControls({
  eventId,
  results,
  hasPoll,
  pollOpen,
  format,
}: {
  eventId: string;
  results: PollResults | null;
  hasPoll: boolean;
  pollOpen: boolean;
  format: string | null;
}) {
  const { pending, error, run } = useAction();
  const choices = results?.options.map((o) => o.code) ?? ALL_FORMATS;

  return (
    <div className="space-y-3">
      {format && (
        <p>
          <FormatChip format={format} />
        </p>
      )}

      {results && (
        <div className="card space-y-2">
          <p className="flex items-baseline justify-between">
            <span className="font-semibold">{pollOpen ? "Poll is open" : "Poll closed"}</span>
            <span className="text-body-compact text-muted">
              {results.total} {results.total === 1 ? "vote" : "votes"}
            </span>
          </p>
          <ul className="divide-y divide-border">
            {results.options.map((o) => (
              <li key={o.code} className="flex min-h-control-lg items-center gap-3 py-1">
                <span className="min-w-0 flex-1">
                  <span className={results.leaders.includes(o.code) ? "font-semibold" : ""}>{o.label}</span>
                  <span className="ml-2 text-body-compact text-muted">{o.votes}</span>
                </span>
                {format !== o.code && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    disabled={pending}
                    onClick={() => run(() => confirmFormat(eventId, o.code))}
                  >
                    Run this
                  </button>
                )}
              </li>
            ))}
          </ul>
          {results.leaders.length > 1 && pollOpen && (
            <p className="text-body-compact text-muted">It&apos;s a tie: {results.leaders.map(formatLabel).join(" and ")}.</p>
          )}
          {results.total === 0 && (
            <button
              type="button"
              className="link text-label"
              disabled={pending}
              onClick={() => run(() => deletePoll(eventId))}
            >
              Remove this poll
            </button>
          )}
        </div>
      )}

      {!hasPoll && !format && (
        <SheetButton label="Start a format poll" title="Format poll">
          {(close) => <StartPollForm eventId={eventId} onDone={close} />}
        </SheetButton>
      )}

      {!results && (
        <div>
          <label className="label" htmlFor="set-format">
            {format ? "Change format" : "Or just set the format"}
          </label>
          <select
            id="set-format"
            className="input"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && run(() => confirmFormat(eventId, e.target.value))}
          >
            <option value="">Pick…</option>
            {choices
              .filter((c) => c !== format)
              .map((c) => (
                <option key={c} value={c}>
                  {formatLabel(c)}
                </option>
              ))}
          </select>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** Store dashboard: weekly polls on or off for one slot. */
export function WeeklyPollToggle({
  scheduleId,
  storeId,
  on,
  options,
}: {
  scheduleId: string;
  storeId: string;
  on: boolean;
  options: string[];
}) {
  const [picked, setPicked] = useState<FormatCode[]>(ALL_FORMATS.filter((c) => options.includes(c)));
  const { pending, error, run } = useAction();
  return (
    <SheetButton compact label={on ? "Poll: weekly" : "Poll: off"} title="Weekly format poll">
      {(close) => (
        <div className="space-y-4">
          <p className="text-muted">
            Every week&apos;s event gets a poll, shown on the event page. Players going or following your store vote;
            you confirm the format.
          </p>
          {on && (
            <p className="text-body-compact text-muted">
              Turning it off removes the weekly polls nobody has voted in yet. Polls with votes stay until you confirm a
              format.
            </p>
          )}
          <FormatChecklist value={picked} onChange={setPicked} />
          {error && <p className="field-error">{error}</p>}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || picked.length < 2}
            onClick={() => run(() => setWeeklyPoll(scheduleId, storeId, true, picked), close)}
          >
            {on ? "Save" : "Turn on weekly polls"}
          </button>
          {on && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => run(() => setWeeklyPoll(scheduleId, storeId, false, picked), close)}
            >
              Turn off
            </button>
          )}
        </div>
      )}
    </SheetButton>
  );
}
