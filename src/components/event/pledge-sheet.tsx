"use client";

import { useState, useTransition } from "react";
import { pledge, unpledge } from "@/app/actions/requests";
import { PitchDot } from "@/components/pitch-dot";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Sheet } from "@/components/sheet";
import { cardLabel } from "@/lib/cards";
import type { RequestView } from "@/lib/request-view";

/** "I'll bring it" button + sheet for one request. */
export function PledgeButton({ eventId, request }: { eventId: string; request: RequestView }) {
  const [open, setOpen] = useState(false);
  const label = request.myPledge > 0 ? `Bringing ${request.myPledge}` : "I'll bring it";

  return (
    <>
      <button
        className={`btn !min-h-10 !w-auto px-3 text-sm ${request.myPledge > 0 ? "btn-secondary" : "btn-primary"}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={request.myPledge > 0 ? "Your pledge" : "Bring this card"}>
        {open && <PledgeForm eventId={eventId} request={request} onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

function PledgeForm({ eventId, request, onDone }: { eventId: string; request: RequestView; onDone: () => void }) {
  const [quantity, setQuantity] = useState(request.myPledge > 0 ? request.myPledge : Math.min(1, request.maxPledge));
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
        <div className="min-w-0">
          <p className="font-semibold">{cardLabel(request.card)}</p>
          <p className="text-sm text-muted">
            for {request.requesterName} · needs {request.quantity}
            {request.pledged > request.myPledge && `, ${request.pledged - request.myPledge} already coming`}
          </p>
          {request.note && <p className="text-sm italic text-muted">“{request.note}”</p>}
        </div>
      </div>

      {request.card.set_ids.length > 0 && (
        <div>
          <p className="text-sm font-medium">Printed in</p>
          <p className="font-mono text-sm text-muted">{request.card.set_ids.join(" · ")}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="font-medium">How many will you bring?</span>
        <QuantityStepper label="How many will you bring" value={quantity} max={request.maxPledge} onChange={setQuantity} />
      </div>

      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary" disabled={pending} onClick={() => act(() => pledge(eventId, request.id, quantity))}>
        {pending ? "Saving…" : request.myPledge > 0 ? "Update pledge" : `I'll bring ${quantity}`}
      </button>
      {request.myPledge > 0 && (
        <button className="btn btn-secondary" disabled={pending} onClick={() => act(() => unpledge(eventId, request.id))}>
          I can&apos;t bring it after all
        </button>
      )}
    </div>
  );
}
