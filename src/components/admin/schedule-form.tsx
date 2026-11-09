"use client";

import { useActionState, useEffect, useRef } from "react";
import { addSchedule, type FormState } from "@/app/actions/admin";
import { WEEKDAYS } from "@/lib/stores";

/**
 * Add (or, with `schedule`, edit) a weekly slot. Admins use the default
 * action; owners pass the owner actions from src/app/actions/manage.ts.
 */
export function ScheduleForm({
  storeId,
  action: serverAction = addSchedule,
  schedule,
  title = "Add a weekly slot",
  submitLabel = "Add slot",
  note,
  onSaved,
  bare,
}: {
  storeId: string;
  action?: (prev: FormState, formData: FormData) => Promise<FormState>;
  schedule?: { id: string; label: string; weekday: number; start_time: string };
  title?: string;
  submitLabel?: string;
  /** Shown above the button, e.g. what saving changes. */
  note?: React.ReactNode;
  onSaved?: () => void;
  /** Without the card frame and title (inside a sheet). */
  bare?: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(serverAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const idPrefix = schedule ? `slot-${schedule.id}-` : "slot-new-";

  useEffect(() => {
    if (!state.saved) return;
    if (!schedule) formRef.current?.reset();
    onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new result
  }, [state]);

  return (
    <form ref={formRef} action={action} className={bare ? "space-y-3" : "card space-y-3"}>
      <input type="hidden" name="storeId" value={storeId} />
      {schedule && <input type="hidden" name="scheduleId" value={schedule.id} />}
      {!bare && <p className="font-semibold">{title}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`${idPrefix}weekday`}>
            Day
          </label>
          <select
            id={`${idPrefix}weekday`}
            name="weekday"
            className="input"
            defaultValue={schedule ? String(schedule.weekday) : ""}
            required
          >
            <option value="" disabled>
              Pick…
            </option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          {state.errors?.weekday && <p className="field-error">{state.errors.weekday}</p>}
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}start_time`}>
            Starts
          </label>
          <input
            id={`${idPrefix}start_time`}
            name="start_time"
            type="time"
            className="input"
            defaultValue={schedule?.start_time.slice(0, 5)}
            required
          />
          {state.errors?.start_time && <p className="field-error">{state.errors.start_time}</p>}
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}label`}>
          Label <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={`${idPrefix}label`}
          name="label"
          className="input"
          placeholder="Armory"
          maxLength={40}
          defaultValue={schedule?.label}
        />
        {state.errors?.label && <p className="field-error">{state.errors.label}</p>}
      </div>
      {note && <p className="text-sm text-muted">{note}</p>}
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <button className={schedule ? "btn btn-primary" : "btn btn-secondary"} disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
