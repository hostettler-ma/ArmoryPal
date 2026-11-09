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
    <li className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-heading-02">
          {label}
        </label>
        <p className="text-body-compact text-muted">{description}</p>
        {error && <p className="field-error">{error}</p>}
      </div>
      {/* 48px tap target around a 24×48 track; the focus ring is drawn on the track. */}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={toggle}
        disabled={pending}
        className="group flex h-control-lg shrink-0 items-center focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={`relative h-6 w-12 rounded-full transition-colors group-focus-visible:focus-ring ${enabled ? "bg-accent" : "bg-border"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-raised transition-transform ${enabled ? "translate-x-6" : ""}`}
          />
        </span>
      </button>
    </li>
  );
}
