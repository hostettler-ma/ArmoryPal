"use client";

import { useState, useTransition } from "react";
import { addRequests, previewCardImport, type ImportPreview } from "@/app/actions/requests";
import { CardAutocomplete } from "@/components/card-autocomplete";
import { PitchDot } from "@/components/pitch-dot";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Sheet } from "@/components/sheet";
import { importCopies, type ImportItem } from "@/lib/card-import";
import { cardLabel, type CardRow } from "@/lib/cards";
import { MAX_NOTE_LENGTH, MAX_QUANTITY } from "@/lib/rules";

type Mode = "search" | "paste";

export function AddRequestSheet({ eventId, catalogNote }: { eventId: string; catalogNote: string | null }) {
  const [open, setOpen] = useState(false);
  // Remounting the form on each open resets the picker, list, and quantities.
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
        {catalogNote && <p className="text-helper text-muted">{catalogNote}</p>}
      </Sheet>
    </>
  );
}

function AddRequestForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("search");
  return (
    <div className="space-y-4">
      <div className="tab-bar bg-background" role="tablist" aria-label="How to add cards">
        {(["search", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className="tab flex-1"
          >
            {m === "search" ? "Search" : "Paste list"}
          </button>
        ))}
      </div>
      {/* Both stay mounted so switching tabs doesn't lose what was typed. */}
      <div hidden={mode !== "search"}>
        <SearchForm eventId={eventId} onDone={onDone} />
      </div>
      <div hidden={mode !== "paste"}>
        <PasteForm eventId={eventId} onDone={onDone} />
      </div>
    </div>
  );
}

function NoteField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        Note <span className="font-normal text-muted">(optional)</span>
      </label>
      <input
        id={id}
        className="input"
        placeholder="e.g. any printing, need by round 1"
        maxLength={MAX_NOTE_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const cardsLabel = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

function SearchForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
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

      <NoteField id="request-note" value={note} onChange={setNote} />

      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary" onClick={submit} disabled={pending || cards.length === 0}>
        {pending ? "Adding…" : `Request ${cardsLabel(totalCopies)}`}
      </button>
    </div>
  );
}

const EXAMPLE = "1 Sledge of Anvilheim\n3 Oaken Old\n2 Boulder Drop\n1 Snatch (Blue)";

/** Paste a card list → check it → confirm what was found (and see what wasn't). */
function PasteForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    setError(null);
    startTransition(async () => {
      const result = await previewCardImport(text);
      if (result.error) setError(result.error);
      else {
        setPreview(result);
        setItems(result.items);
      }
    });
  }

  function switchColor(index: number, variant: CardRow) {
    setItems((list) => list.map((it, i) => (i === index ? { ...it, card: variant, defaultedToRed: false } : it)));
  }

  function submit() {
    setError(null);
    // Two rows may now point at the same card (after a color switch): merge them.
    const merged = new Map<string, number>();
    for (const it of items) merged.set(it.card.id, Math.min(MAX_QUANTITY, (merged.get(it.card.id) ?? 0) + it.quantity));
    startTransition(async () => {
      const result = await addRequests(
        eventId,
        [...merged].map(([cardId, quantity]) => ({ cardId, quantity })),
        note,
      );
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  if (!preview) {
    return (
      <div className="space-y-3">
        <label className="label" htmlFor="paste-list">
          Card list
        </label>
        <textarea
          id="paste-list"
          className="input min-h-48 py-3 font-mono text-body-compact"
          placeholder={EXAMPLE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <p className="text-body-compact text-muted">
          One card per line, like <code>2 Boulder Drop</code>. Add a color with <code>(Blue)</code>; otherwise
          multi-color cards default to Red.
        </p>
        {error && <p className="field-error">{error}</p>}
        <button className="btn btn-primary" onClick={check} disabled={pending || !text.trim()}>
          {pending ? "Checking…" : "Check list"}
        </button>
      </div>
    );
  }

  const copies = importCopies(items);
  return (
    <div className="space-y-4">
      <p className="text-heading-02">
        {items.length ? `Found ${cardsLabel(copies)}. Check before requesting:` : "No cards from this list could be imported."}
      </p>

      {items.length > 0 && (
        <ul className="card-list">
          {items.map((it, i) => (
            <li key={`${it.card.id}-${i}`} className="space-y-1 py-2">
              <div className="flex items-center gap-3">
                <PitchDot color={it.card.color} />
                <span className="min-w-0 flex-1">
                  {it.quantity}× {cardLabel(it.card)}
                </span>
                <button
                  type="button"
                  aria-label={`Don't import ${cardLabel(it.card)}`}
                  onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                  className="interactive -mr-2 flex size-control-md shrink-0 items-center justify-center rounded-full text-muted"
                >
                  ✕
                </button>
              </div>
              {it.variants.length > 1 && (
                <div className="flex items-center gap-2 pl-6 text-helper text-muted">
                  {it.defaultedToRed ? "Red by default · switch:" : "Color:"}
                  {it.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={v.id === it.card.id}
                      aria-label={`Use ${v.color ?? "no pitch"}`}
                      onClick={() => switchColor(i, v)}
                      className={`interactive flex size-control-sm items-center justify-center rounded-full ${v.id === it.card.id ? "bg-highlight" : ""}`}
                    >
                      <PitchDot color={v.color} />
                    </button>
                  ))}
                </div>
              )}
              {it.typedAs.length > 0 && (
                <p className="pl-6 text-helper text-muted">You typed “{it.typedAs.join("”, “")}”</p>
              )}
              {it.capped && <p className="pl-6 text-helper text-muted">Capped at {MAX_QUANTITY}</p>}
            </li>
          ))}
        </ul>
      )}

      {preview.skipped.length > 0 && (
        <div className="space-y-1">
          <p className="text-heading-01 text-danger">Not found / not imported ({preview.skipped.length})</p>
          <ul className="card space-y-1 text-body-compact">
            {preview.skipped.map((s) => (
              <li key={s.lineNo} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate font-mono">{s.raw}</span>
                <span className="shrink-0 text-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && <NoteField id="import-note" value={note} onChange={setNote} />}

      {error && <p className="field-error">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={() => setPreview(null)} disabled={pending}>
          Edit list
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={pending || items.length === 0}>
          {pending ? "Adding…" : `Request ${cardsLabel(copies)}`}
        </button>
      </div>
    </div>
  );
}
