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
    "interactive flex size-control-lg items-center justify-center rounded-full border border-border bg-surface text-heading-03";
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Fewer">
        −
      </button>
      <output className="w-8 text-center text-heading-03 tabular-nums" aria-live="polite">
        {value}
      </output>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="More">
        +
      </button>
    </div>
  );
}
