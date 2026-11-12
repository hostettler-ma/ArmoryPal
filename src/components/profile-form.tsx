"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileFormState } from "@/app/actions/profile";

export function ProfileForm({
  displayName,
  gemId,
  submitLabel,
  redirectTo,
}: {
  displayName: string;
  gemId: string;
  submitLabel: string;
  redirectTo?: string;
}) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfile, {});

  return (
    <form action={action} className="space-y-4">
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      <div>
        <label className="label" htmlFor="displayName">
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          className="input"
          defaultValue={displayName}
          maxLength={40}
          required
          autoComplete="nickname"
        />
        <p className="mt-1 text-body-compact text-muted">Other players at your store will see this.</p>
        {state.errors?.displayName && <p className="field-error">{state.errors.displayName}</p>}
      </div>
      <div>
        <label className="label" htmlFor="gemId">
          GEM ID <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="gemId" name="gemId" className="input" defaultValue={gemId} inputMode="numeric" />
        {state.errors?.gemId && <p className="field-error">{state.errors.gemId}</p>}
      </div>
      {state.errors?.form && <p className="field-error">{state.errors.form}</p>}
      {state.saved && !pending && <p className="text-body-compact text-muted">Saved.</p>}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
