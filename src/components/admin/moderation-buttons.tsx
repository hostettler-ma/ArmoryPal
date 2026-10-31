"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  banPlayer,
  deleteStore,
  removeAttendee,
  restoreStore,
  unbanPlayer,
  type ModerationResult,
} from "@/app/actions/moderation";
import { Sheet } from "@/components/sheet";
import { MAX_REASON_LENGTH } from "@/lib/moderation";

type ConfirmProps = {
  /** Text on the button that opens the sheet. */
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** Show a reason field: "required", "optional", or none. */
  reason?: "required" | "optional";
  /** Small inline button (lists) instead of a full-width one. */
  compact?: boolean;
  danger?: boolean;
  run: (reason: string) => Promise<ModerationResult>;
  onDone?: (result: ModerationResult) => void;
};

/** A button that opens a confirm sheet (optionally asking for a reason) before an admin action. */
function ConfirmButton({ label, title, description, confirmLabel, reason, compact, danger, run, onDone }: ConfirmProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const result = await run(text);
      if (result.error) return setError(result.error);
      setOpen(false);
      setText("");
      onDone?.(result);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn ${danger ? "btn-danger" : "btn-secondary"} ${compact ? "!min-h-10 !w-auto px-3 text-sm" : ""}`}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-4">
          <div className="text-muted">{description}</div>
          {reason && (
            <div>
              <label className="label" htmlFor="moderation-reason">
                Reason {reason === "optional" && <span className="font-normal text-muted">(optional)</span>}
              </label>
              <textarea
                id="moderation-reason"
                className="input min-h-20 py-2"
                maxLength={MAX_REASON_LENGTH}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}
          {error && <p className="field-error">{error}</p>}
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            disabled={pending || (reason === "required" && !text.trim())}
            onClick={confirm}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** Event page, Going tab: take another player off this event. */
export function RemoveAttendeeButton({ eventId, userId, name }: { eventId: string; userId: string; name: string }) {
  return (
    <ConfirmButton
      compact
      danger
      label="Remove"
      title={`Remove ${name}?`}
      description={
        <>
          {name} comes off the Going list. Cards they pledged are needed again and their requests here are cancelled.
          Everyone affected gets notified. They can join again; to keep them out, ban them instead.
        </>
      }
      reason="optional"
      confirmLabel="Remove from event"
      run={(reason) => removeAttendee(eventId, userId, reason)}
    />
  );
}

export function BanButton({ userId, name, openEvents }: { userId: string; name: string; openEvents: number }) {
  return (
    <ConfirmButton
      danger
      label="Ban player"
      title={`Ban ${name}?`}
      description={
        <>
          {name} won&apos;t be able to use ArmoryPal and will see your reason.{" "}
          {openEvents > 0
            ? `They'll be removed from ${openEvents} upcoming ${openEvents === 1 ? "event" : "events"}, and affected players get notified.`
            : "They aren't going to any upcoming events."}
        </>
      }
      reason="required"
      confirmLabel="Ban"
      run={(reason) => banPlayer(userId, reason)}
    />
  );
}

export function UnbanButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ConfirmButton
      label="Unban player"
      title={`Unban ${name}?`}
      description={<>{name} can use ArmoryPal again. They&apos;ll need to re-join any events themselves.</>}
      confirmLabel="Unban"
      run={() => unbanPlayer(userId)}
    />
  );
}

export function DeleteStoreButton({ storeId, name, eventCount }: { storeId: string; name: string; eventCount: number }) {
  const router = useRouter();
  const archive = eventCount > 0;
  return (
    <ConfirmButton
      danger
      label="Delete store"
      title={`Delete ${name}?`}
      description={
        archive ? (
          <>
            This store has {eventCount} {eventCount === 1 ? "event" : "events"} on record, so it will be{" "}
            <strong>archived</strong> instead: hidden from search and Home, with its weekly slots switched off. Past
            events stay intact, and you can restore it later.
          </>
        ) : (
          <>This store has never had an event, so it will be permanently deleted along with its weekly slots.</>
        )
      }
      confirmLabel={archive ? "Archive store" : "Delete permanently"}
      run={() => deleteStore(storeId)}
      onDone={(result) => {
        if (result.outcome === "deleted") router.push("/admin");
      }}
    />
  );
}

export function RestoreStoreButton({ storeId }: { storeId: string }) {
  return (
    <ConfirmButton
      label="Restore store"
      title="Restore this store?"
      description="It shows up in search and on Home again. Its weekly slots stay off until you activate the ones that still run."
      confirmLabel="Restore"
      run={() => restoreStore(storeId)}
    />
  );
}
