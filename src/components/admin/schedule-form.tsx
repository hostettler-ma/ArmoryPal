"use client";

import { useActionState, useEffect, useRef } from "react";
import { addSchedule, type FormState } from "@/app/actions/admin";
import { WEEKDAYS } from "@/lib/stores";

export function ScheduleForm({ storeId }: { storeId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSchedule, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="card space-y-3">
      <input type="hidden" name="storeId" value={storeId} />
      <p className="font-semibold">Add a weekly slot</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="weekday">
            Day
          </label>
          <select id="weekday" name="weekday" className="input" defaultValue="" required>
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
          <label className="label" htmlFor="start_time">
            Starts
          </label>
          <input id="start_time" name="start_time" type="time" className="input" required />
          {state.errors?.start_time && <p className="field-error">{state.errors.start_time}</p>}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="label">
          Label <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="label" name="label" className="input" placeholder="Armory" maxLength={40} />
        {state.errors?.label && <p className="field-error">{state.errors.label}</p>}
      </div>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      <button className="btn btn-secondary" disabled={pending}>
        {pending ? "Adding…" : "Add slot"}
      </button>
    </form>
  );
}
