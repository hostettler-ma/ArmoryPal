"use client";

import { useState, useTransition } from "react";
import { addRequests } from "@/app/actions/requests";
import { CardAutocomplete } from "@/components/card-autocomplete";
import { PitchDot } from "@/components/pitch-dot";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Sheet } from "@/components/sheet";
import { cardLabel, type CardRow } from "@/lib/cards";
import { MAX_NOTE_LENGTH, MAX_QUANTITY } from "@/lib/rules";

export function AddRequestSheet({ eventId, catalogNote }: { eventId: string; catalogNote: string | null }) {
  const [open, setOpen] = useState(false);
  // Remounting the form on each open resets the picker and quantities.
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        + Request cards
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Request cards">
        {open && <AddRequestForm key={formKey} eventId={eventId} onDone={() => setOpen(false)} />}
        {catalogNote && <p className="text-xs text-muted">{catalogNote}</p>}
      </Sheet>
    </>
  );
}

function AddRequestForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const qty = (id: string) => quantities[id] ?? 1;
  // Count copies, not unique cards: 3× red + 1× blue Snatch = 4 cards.
  const totalCopies = cards.reduce((sum, c) => sum + qty(c.id), 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addRequests(
        eventId,
        cards.map((c) => ({ cardId: c.id, quantity: qty(c.id) })),
        note,
      );
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="space-y-4">
      <CardAutocomplete onSelect={setCards} autoFocus />

      {cards.length > 0 && (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <PitchDot color={c.color} />
              <span className="min-w-0 flex-1 truncate">{cardLabel(c)}</span>
              <QuantityStepper
                label={`How many ${cardLabel(c)}`}
                value={qty(c.id)}
                max={MAX_QUANTITY}
                onChange={(v) => setQuantities((q) => ({ ...q, [c.id]: v }))}
              />
            </li>
          ))}
        </ul>
      )}

      <div>
        <label className="label" htmlFor="request-note">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="request-note"
          className="input"
          placeholder="e.g. any printing, need by round 1"
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary" onClick={submit} disabled={pending || cards.length === 0}>
        {pending ? "Adding…" : `Request ${totalCopies} ${totalCopies === 1 ? "card" : "cards"}`}
      </button>
    </div>
  );
}
