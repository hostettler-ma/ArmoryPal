"use client";

import { useEffect, useId, useRef, useState } from "react";
import { groupCards, type CardGroup, type CardRow } from "@/lib/cards";
import { createClient } from "@/lib/supabase/client";
import { PitchDot } from "./pitch-dot";

const DEBOUNCE_MS = 150;

/**
 * Two-step card picker backed by the `search_cards` RPC: search shows one
 * entry per card name; if the name has several pitch colors, the user toggles
 * one or more of them. `onSelect` receives the chosen cards (name + pitch) in
 * pitch order, or an empty array while nothing is chosen.
 */
export function CardAutocomplete({
  onSelect,
  autoFocus,
  id: idProp,
}: {
  onSelect: (cards: CardRow[]) => void;
  autoFocus?: boolean;
  id?: string;
}) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const listId = `${id}-list`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<CardGroup | null>(null);
  const [chosenIds, setChosenIds] = useState<string[]>([]);
  const requestSeq = useRef(0);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      const { data } = await createClient().rpc("search_cards", { q: term, max_results: 15 });
      if (seq !== requestSeq.current) return; // a newer keystroke superseded this request
      setResults(groupCards((data ?? []) as CardRow[]));
      setActive(0);
      setOpen(true);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function chooseGroup(g: CardGroup) {
    requestSeq.current++; // drop any in-flight search so it can't reopen the list
    setLoading(false);
    skipNextSearch.current = true;
    setQuery(g.name);
    setOpen(false);
    setGroup(g);
    // Only one version (hero, equipment, token, single-color card): done.
    const chosen = g.variants.length === 1 ? g.variants : [];
    setChosenIds(chosen.map((v) => v.id));
    onSelect(chosen);
  }

  function toggleVariant(card: CardRow) {
    if (!group) return;
    const next = chosenIds.includes(card.id) ? chosenIds.filter((x) => x !== card.id) : [...chosenIds, card.id];
    setChosenIds(next);
    onSelect(group.variants.filter((v) => next.includes(v.id))); // keep pitch order
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      chooseGroup(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= 2;

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          className="input"
          placeholder="Start typing a card name…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Editing the text clears the previous choice.
            setGroup(null);
            setChosenIds([]);
            onSelect([]);
          }}
          onFocus={() => results.length && !group && setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {loading && (
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-body-compact text-muted">…</span>
        )}
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-[50dvh] w-full overflow-y-auto rounded-container border border-border bg-surface shadow-overlay"
          >
            {results.length === 0 && !loading ? (
              <li className="px-4 py-3 text-muted">No cards match.</li>
            ) : (
              results.map((g, i) => (
                <li
                  key={g.name}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown (not click) so the input's blur doesn't close the list first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseGroup(g);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex min-h-control-lg cursor-pointer items-center gap-3 px-4 py-2 ${i === active ? "bg-background" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{g.name}</span>
                    <span className="block truncate text-helper text-muted">
                      {g.types.filter((t) => t !== "Generic").join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1" aria-label={variantsLabel(g)}>
                    {g.variants.map((v) => (
                      <PitchDot key={v.id} color={v.color} />
                    ))}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {group && group.variants.length > 1 && (
        <fieldset>
          <legend className="label">
            Which colors? <span className="font-normal text-muted">(pick one or more)</span>
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {group.variants.map((v) => {
              const selected = chosenIds.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleVariant(v)}
                  className={`btn gap-2 border ${selected ? "border-accent-text bg-highlight text-highlight-foreground" : "border-accent-soft bg-surface"}`}
                >
                  <PitchDot color={v.color} />
                  {v.color ?? "No pitch"}
                  {selected && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function variantsLabel(g: CardGroup): string {
  const colors = g.variants.map((v) => v.color).filter(Boolean);
  return colors.length ? `Available in ${colors.join(", ")}` : "No pitch";
}
