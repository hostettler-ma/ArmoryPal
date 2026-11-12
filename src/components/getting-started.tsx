"use client";

import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { GUIDE_STEPS } from "@/lib/guide";

/** The getting-started guide as a step-by-step bottom sheet. */
export function GettingStartedGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const step = GUIDE_STEPS[index];
  const last = index === GUIDE_STEPS.length - 1;

  const close = () => {
    onClose();
    setIndex(0);
  };

  return (
    <Sheet open={open} onClose={close} title="Getting started">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-body-compact text-muted" aria-live="polite">
            Step {index + 1} of {GUIDE_STEPS.length}
          </p>
          <div className="flex gap-2" aria-hidden>
            {GUIDE_STEPS.map((s, i) => (
              <span
                key={s.title}
                className={`h-2 rounded-full transition-all duration-moderate-01 ${i === index ? "w-5 bg-accent" : "w-2 bg-border"}`}
              />
            ))}
          </div>
        </div>

        <div className="min-h-32 space-y-2">
          <h3 className="text-heading-03">{step.title}</h3>
          {/* No step links here: following one would close the guide (and on first run mark it seen)
              before the player reaches the remaining steps. The /guide page shows them instead. */}
          <p className="text-muted">{step.body}</p>
        </div>

        <div className="flex gap-2">
          {index > 0 && (
            <button type="button" className="btn btn-secondary w-auto px-6" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => (last ? close() : setIndex(index + 1))}
          >
            {last ? "Let's go" : "Next"}
          </button>
        </div>
        {!last && (
          <button type="button" className="interactive mx-auto block min-h-control-md rounded-control px-4 text-label text-muted" onClick={close}>
            Skip the guide
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Reopens the guide on demand (the /guide page). Doesn't change whether it was seen. */
export function ShowGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Show as walkthrough
      </button>
      <GettingStartedGuide open={open} onClose={() => setOpen(false)} />
    </>
  );
}
