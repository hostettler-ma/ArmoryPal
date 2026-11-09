"use client";

import { useActionState, useEffect, useState } from "react";
import type { FormState } from "@/app/actions/admin";
import {
  createOneOffEvent,
  moveEvent,
  renameEvent,
  saveEventLinks,
  saveStoreInfo,
  updateOwnerSchedule,
} from "@/app/actions/manage";
import { ScheduleForm } from "@/components/admin/schedule-form";
import { Sheet } from "@/components/sheet";
import { MAX_EVENT_LABEL, MAX_URL_LENGTH } from "@/lib/event-manage";
import { MAX_STORE_NOTES } from "@/lib/stores";

/** A button that opens a bottom sheet; `children` gets a `close` callback. */
export function SheetButton({
  label,
  title,
  primary,
  compact,
  children,
}: {
  label: string;
  title: string;
  primary?: boolean;
  compact?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn ${primary ? "btn-primary" : "btn-secondary"} ${compact ? "!min-h-10 !w-auto px-3 text-sm" : ""}`}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {open && children(() => setOpen(false))}
      </Sheet>
    </>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

const optional = <span className="font-normal text-muted">(optional)</span>;

function useSavedEffect(state: FormState, onSaved?: () => void) {
  useEffect(() => {
    if (state.saved) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new result
  }, [state]);
}

function SaveButton({ pending, label, saved }: { pending: boolean; label: string; saved?: boolean }) {
  return (
    <button className="btn btn-primary" disabled={pending}>
      {pending ? "Saving…" : saved ? "Saved ✓" : label}
    </button>
  );
}

/** GEM link or code, and the ticket page, for one event. */
export function EventLinksForm({
  eventId,
  storeId,
  gem,
  ticket,
  storeTicket,
}: {
  eventId: string;
  storeId: string;
  gem: string;
  ticket: string;
  storeTicket: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEventLinks, {});
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field
        id="gem"
        label={<>GEM event {optional}</>}
        error={state.errors?.gem}
        hint="Paste the event's gem.fabtcg.com link, or just its event code."
      >
        <input id="gem" name="gem" className="input" defaultValue={gem} maxLength={MAX_URL_LENGTH} inputMode="url" />
      </Field>
      <Field
        id="ticket"
        label={<>Ticket link {optional}</>}
        error={state.errors?.ticket}
        hint={storeTicket ? "Leave empty to use your store's default ticket link." : "Where players buy a ticket."}
      >
        <input
          id="ticket"
          name="ticket"
          type="url"
          className="input"
          defaultValue={ticket}
          placeholder={storeTicket ?? "https://"}
          maxLength={MAX_URL_LENGTH}
        />
      </Field>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <SaveButton pending={pending} label="Save links" saved={state.saved} />
    </form>
  );
}

/** Rename this one event ("Holiday Armory"). */
export function RenameEventForm({
  eventId,
  storeId,
  label,
  weekly,
  onSaved,
}: {
  eventId: string;
  storeId: string;
  label: string;
  weekly: boolean;
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(renameEvent, {});
  useSavedEffect(state, onSaved);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="rename-label" label="Name" error={state.errors?.label}>
        <input
          id="rename-label"
          name="label"
          className="input"
          defaultValue={label}
          maxLength={MAX_EVENT_LABEL}
          required
          autoFocus
        />
      </Field>
      {weekly && (
        <p className="text-sm text-muted">Only this event is renamed. To rename every week, edit the weekly slot.</p>
      )}
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <SaveButton pending={pending} label="Save name" />
    </form>
  );
}

export function RenameEventButton(props: Omit<React.ComponentProps<typeof RenameEventForm>, "onSaved">) {
  return (
    <SheetButton compact label="Rename" title="Rename this event">
      {(close) => <RenameEventForm {...props} onSaved={close} />}
    </SheetButton>
  );
}

/** Move this one event to another day or time (store-local). */
export function MoveEventForm({
  eventId,
  storeId,
  date,
  time,
  weekly,
  onSaved,
}: {
  eventId: string;
  storeId: string;
  date: string;
  time: string;
  weekly: boolean;
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(moveEvent, {});
  useSavedEffect(state, onSaved);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="storeId" value={storeId} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="move-date" label="Day" error={state.errors?.date}>
          <input id="move-date" name="date" type="date" className="input" defaultValue={date} required />
        </Field>
        <Field id="move-time" label="Starts" error={state.errors?.time}>
          <input id="move-time" name="time" type="time" className="input" defaultValue={time} required />
        </Field>
      </div>
      <p className="text-sm text-muted">
        Players stay signed up and keep their requests. Everyone going or following your store gets a notification.
        {weekly && " This only moves this week; to move every week, edit the weekly slot."}
      </p>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <SaveButton pending={pending} label="Move event" />
    </form>
  );
}

/** A one-off event outside the weekly schedule (pre-release, special Armory…). */
export function CreateEventForm({ storeId, today }: { storeId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createOneOffEvent, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="storeId" value={storeId} />
      <Field id="new-label" label="Name" error={state.errors?.label}>
        <input id="new-label" name="label" className="input" placeholder="Special Armory" maxLength={MAX_EVENT_LABEL} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="new-date" label="Day" error={state.errors?.date}>
          <input id="new-date" name="date" type="date" className="input" min={today} required />
        </Field>
        <Field id="new-time" label="Starts" error={state.errors?.time}>
          <input id="new-time" name="time" type="time" className="input" required />
        </Field>
      </div>
      <Field id="new-gem" label={<>GEM link or code {optional}</>} error={state.errors?.gem}>
        <input id="new-gem" name="gem" className="input" maxLength={MAX_URL_LENGTH} inputMode="url" />
      </Field>
      <Field id="new-ticket" label={<>Ticket link {optional}</>} error={state.errors?.ticket}>
        <input id="new-ticket" name="ticket" type="url" className="input" maxLength={MAX_URL_LENGTH} />
      </Field>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <SaveButton pending={pending} label="Create event" />
    </form>
  );
}

/** Store-wide notes and default ticket link. */
export function StoreInfoForm({ storeId, notes, ticket }: { storeId: string; notes: string; ticket: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveStoreInfo, {});
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="storeId" value={storeId} />
      <Field
        id="store-ticket"
        label={<>Default ticket link {optional}</>}
        error={state.errors?.ticket}
        hint="Shown on every event unless the event has its own."
      >
        <input id="store-ticket" name="ticket" type="url" className="input" defaultValue={ticket} maxLength={MAX_URL_LENGTH} />
      </Field>
      <Field id="store-notes" label={<>Notes for players {optional}</>} error={state.errors?.notes}>
        <textarea
          id="store-notes"
          name="notes"
          className="input min-h-24 py-2"
          defaultValue={notes}
          maxLength={MAX_STORE_NOTES}
          placeholder="Pre-register on our website…"
        />
      </Field>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <SaveButton pending={pending} label="Save" saved={state.saved} />
    </form>
  );
}

/** Edit a weekly slot ("move all events") in a sheet. */
export function EditSlotButton({
  storeId,
  schedule,
}: {
  storeId: string;
  schedule: { id: string; label: string; weekday: number; start_time: string };
}) {
  return (
    <SheetButton compact label="Edit" title="Change weekly slot">
      {(close) => (
        <ScheduleForm
          bare
          storeId={storeId}
          schedule={schedule}
          action={updateOwnerSchedule}
          submitLabel="Save every week"
          note="This week's event and the coming weeks change too, except ones you moved or renamed by hand. If the day or time changes, players stay signed up and get a notification."
          onSaved={close}
        />
      )}
    </SheetButton>
  );
}

export function MoveEventButton(props: Omit<React.ComponentProps<typeof MoveEventForm>, "onSaved">) {
  return (
    <SheetButton label="Move this event" title="Move this event">
      {(close) => <MoveEventForm {...props} onSaved={close} />}
    </SheetButton>
  );
}

export function CreateEventButton(props: React.ComponentProps<typeof CreateEventForm>) {
  return (
    <SheetButton label="+ Add a one-off event" title="New one-off event">
      {() => <CreateEventForm {...props} />}
    </SheetButton>
  );
}

/** Copies the GEM IDs of everyone going, one per line, for registering them in GEM. */
export function CopyGemIdsButton({ ids }: { ids: string[] }) {
  const [copied, setCopied] = useState(false);
  if (ids.length === 0) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(ids.join("\n"));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (e.g. insecure context); the IDs are visible in the list anyway.
        }
      }}
    >
      {copied ? "Copied ✓" : `Copy ${ids.length} GEM ${ids.length === 1 ? "ID" : "IDs"}`}
    </button>
  );
}
