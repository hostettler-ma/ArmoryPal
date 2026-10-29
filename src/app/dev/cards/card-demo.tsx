"use client";

import { useState } from "react";
import { CardAutocomplete } from "@/components/card-autocomplete";
import { PitchDot } from "@/components/pitch-dot";
import { cardLabel, type CardRow } from "@/lib/cards";

export function CardDemo() {
  const [cards, setCards] = useState<CardRow[]>([]);

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="card-search">
          Card
        </label>
        <CardAutocomplete id="card-search" onSelect={setCards} autoFocus />
      </div>
      {cards.length > 0 && (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li key={card.id} className="card flex items-center gap-3">
              <PitchDot color={card.color} />
              <div className="min-w-0">
                <p className="font-semibold">{cardLabel(card)}</p>
                <p className="text-sm text-muted">{card.types.join(" · ")}</p>
                <p className="truncate font-mono text-xs text-muted">id: {card.id}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
