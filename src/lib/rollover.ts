import { totalPledged } from "./rules";

export type PreviousRequest = {
  id: string;
  quantity: number;
  status: string;
  pledges: { quantity: number }[];
};

export type CopySummary = { requests: number; copies: number };

/**
 * What copy_open_requests would copy from last week's event: active requests
 * with something still needed, not already copied into this week (by
 * copied_from_id). Mirrors the SQL; keep them in sync.
 */
export function copySummary(previous: PreviousRequest[], alreadyCopiedFrom: ReadonlySet<string>): CopySummary {
  let requests = 0;
  let copies = 0;
  for (const r of previous) {
    if (r.status !== "active" || alreadyCopiedFrom.has(r.id)) continue;
    const remaining = r.quantity - totalPledged(r.pledges);
    if (remaining <= 0) continue;
    requests += 1;
    copies += remaining;
  }
  return { requests, copies };
}
