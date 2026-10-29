"use client";

export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const btn =
    "flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-xl font-semibold disabled:opacity-30";
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Fewer">
        −
      </button>
      <output className="w-6 text-center text-lg font-semibold tabular-nums" aria-live="polite">
        {value}
      </output>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="More">
        +
      </button>
    </div>
  );
}
