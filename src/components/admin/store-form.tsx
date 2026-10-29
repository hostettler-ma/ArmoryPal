"use client";

import { useActionState, useEffect, useState } from "react";
import { saveStore, type FormState } from "@/app/actions/admin";
import { MAX_STORE_NOTES } from "@/lib/stores";
import type { Tables } from "@/lib/supabase/database.types";

const FIELDS = [
  { name: "name", label: "Store name", required: true },
  { name: "city", label: "City", required: true },
  { name: "region", label: "State / region" },
  { name: "country", label: "Country", required: true },
  { name: "address", label: "Address" },
] as const;

export function StoreForm({ store }: { store?: Tables<"stores"> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveStore, {});

  return (
    <form action={action} className="space-y-4">
      {store && <input type="hidden" name="storeId" value={store.id} />}
      {FIELDS.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>
            {f.label} {!("required" in f) && <span className="font-normal text-muted">(optional)</span>}
          </label>
          <input
            id={f.name}
            name={f.name}
            className="input"
            defaultValue={store?.[f.name] ?? ""}
            required={"required" in f}
          />
          {state.errors?.[f.name] && <p className="field-error">{state.errors[f.name]}</p>}
        </div>
      ))}
      <div>
        <label className="label" htmlFor="timezone">
          Time zone
        </label>
        <TimezoneSelect defaultValue={store?.timezone} />
        {state.errors?.timezone && <p className="field-error">{state.errors.timezone}</p>}
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={MAX_STORE_NOTES}
          className="input py-3"
          placeholder="e.g. Pre-register at the store's website"
          defaultValue={store?.notes ?? ""}
        />
        <p className="mt-1 text-sm text-muted">Shown to players on the store and event pages.</p>
        {state.errors?.notes && <p className="field-error">{state.errors.notes}</p>}
      </div>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      {state.saved && !pending && <p className="text-sm text-muted">Saved.</p>}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : store ? "Save store" : "Create store"}
      </button>
    </form>
  );
}

/** Defaults to the admin's own browser time zone when creating a store. */
function TimezoneSelect({ defaultValue }: { defaultValue?: string }) {
  const [zones, setZones] = useState<string[]>(defaultValue ? [defaultValue] : []);
  const [value, setValue] = useState(defaultValue ?? "");

  useEffect(() => {
    setZones(Intl.supportedValuesOf("timeZone"));
    if (!defaultValue) setValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [defaultValue]);

  return (
    <select id="timezone" name="timezone" className="input" value={value} onChange={(e) => setValue(e.target.value)} required>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
