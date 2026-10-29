"use client";

import { useState, useTransition } from "react";
import { setNotificationPreference } from "@/app/actions/notification-preferences";

/** On/off switch for one notification kind. Saves immediately, reverting if the save fails. */
export function NotificationToggle({
  kind,
  label,
  description,
  enabled: initial,
}: {
  kind: string;
  label: string;
  description: string;
  enabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `pref-${kind}`;

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await setNotificationPreference(kind, next);
      if (result.error) {
        setEnabled(!next);
        setError(result.error);
      }
    });
  }

  return (
    <li className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <p className="text-sm text-muted">{description}</p>
        {error && <p className="field-error">{error}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={toggle}
        disabled={pending}
        className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-border"}`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : ""}`}
        />
      </button>
    </li>
  );
}
