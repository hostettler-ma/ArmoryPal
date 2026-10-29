export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "18:30:00" or "18:30" → "6:30 PM". */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** e.g. "Tuesdays · 6:30 PM". */
export function formatSchedule(s: { weekday: number; start_time: string }): string {
  return `${WEEKDAYS[s.weekday]}s · ${formatTime(s.start_time)}`;
}

export function formatLocation(s: { city: string; region: string | null; country: string }): string {
  return [s.city, s.region, s.country].filter(Boolean).join(", ");
}

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Errors<K extends string> = Partial<Record<K, string>>;
type Parsed<T, K extends string> = { ok: true; value: T } | { ok: false; errors: Errors<K> };

export type StoreInput = {
  name: string;
  city: string;
  region: string | null;
  country: string;
  address: string | null;
  timezone: string;
};

const clean = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const optional = (v: unknown) => clean(v) || null;

/** Validates the admin store form. Mirrors the checks on `stores`. */
export function parseStoreInput(raw: Record<string, unknown>): Parsed<StoreInput, keyof StoreInput> {
  const value: StoreInput = {
    name: clean(raw.name),
    city: clean(raw.city),
    region: optional(raw.region),
    country: clean(raw.country),
    address: optional(raw.address),
    timezone: clean(raw.timezone),
  };
  const errors: Errors<keyof StoreInput> = {};
  const required = (k: "name" | "city" | "country", label: string) => {
    if (!value[k]) errors[k] = `${label} is required.`;
    else if (value[k].length > 80) errors[k] = `${label} must be 80 characters or fewer.`;
  };
  required("name", "Name");
  required("city", "City");
  required("country", "Country");
  if (value.region && value.region.length > 80) errors.region = "Region must be 80 characters or fewer.";
  if (value.address && value.address.length > 200) errors.address = "Address must be 200 characters or fewer.";
  if (!isValidTimezone(value.timezone)) errors.timezone = "Pick a valid time zone.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export type ScheduleInput = { label: string; weekday: number; start_time: string };

/** Validates the admin schedule form. Mirrors the checks on `store_schedules`. */
export function parseScheduleInput(raw: Record<string, unknown>): Parsed<ScheduleInput, keyof ScheduleInput> {
  const label = clean(raw.label) || "Armory";
  const weekday = Number(raw.weekday);
  const start_time = clean(raw.start_time);
  const errors: Errors<keyof ScheduleInput> = {};
  if (label.length > 40) errors.label = "Label must be 40 characters or fewer.";
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || clean(raw.weekday) === "")
    errors.weekday = "Pick a day.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)) errors.start_time = "Enter a start time like 18:30.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { label, weekday, start_time } };
}
