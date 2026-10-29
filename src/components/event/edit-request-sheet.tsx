"use client";

import { useState, useTransition } from "react";
import { cancelRequest, updateRequest } from "@/app/actions/requests";
import { PitchDot } from "@/components/pitch-dot";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Sheet } from "@/components/sheet";
import { cardLabel } from "@/lib/cards";
import type { RequestView } from "@/lib/request-view";
import { MAX_NOTE_LENGTH, MAX_QUANTITY } from "@/lib/rules";

/** "Edit" button + sheet for one of the viewer's own requests. */
export function EditRequestButton({ eventId, request }: { eventId: string; request: RequestView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-secondary !min-h-10 !w-auto px-3 text-sm" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Edit request">
        {open && <EditRequestForm eventId={eventId} request={request} onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

function EditRequestForm({ eventId, request, onDone }: { eventId: string; request: RequestView; onDone: () => void }) {
  const [quantity, setQuantity] = useState(request.quantity);
  const [note, setNote] = useState(request.note ?? "");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
      else onDone();
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <PitchDot color={request.card.color} />
        <p className="font-semibold">{cardLabel(request.card)}</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-medium">How many do you need?</span>
        <QuantityStepper
          label="How many do you need"
          value={quantity}
          min={Math.max(1, request.pledged)}
          max={MAX_QUANTITY}
          onChange={setQuantity}
        />
      </div>
      {request.pledged > 0 && (
        <p className="text-sm text-muted">
          {request.pledged} already pledged, so you can&apos;t go below that.
        </p>
      )}

      <div>
        <label className="label" htmlFor="edit-note">
          Note
        </label>
        <input
          id="edit-note"
          className="input"
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <p className="field-error">{error}</p>}
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() => act(() => updateRequest(eventId, request.id, quantity, note))}
      >
        {pending ? "Saving…" : "Save"}
      </button>

      {confirmCancel ? (
        <div className="card space-y-3 border-danger">
          <p className="text-sm">
            Cancel this request?
            {request.pledgers.length > 0 &&
              ` ${request.pledgers.map((p) => p.name).join(", ")} won't need to bring it anymore.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-secondary" onClick={() => setConfirmCancel(false)} disabled={pending}>
              Keep it
            </button>
            <button className="btn btn-primary" onClick={() => act(() => cancelRequest(eventId, request.id))} disabled={pending}>
              Cancel request
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setConfirmCancel(true)} disabled={pending}>
          Cancel request
        </button>
      )}
    </div>
  );
}
