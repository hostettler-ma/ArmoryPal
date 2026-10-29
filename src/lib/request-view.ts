import type { CardColor } from "./cards";
import { canPledge, coverage, maxPledge, totalPledged, type Check, type Coverage } from "./rules";

/** Shape of a request row as loaded on the event page. */
export type LoadedRequest = {
  id: string;
  quantity: number;
  note: string | null;
  requester_id: string;
  created_at: string;
  card: { id: string; name: string; pitch: number | null; color: CardColor | null; types: string[] } | null;
  requester: { display_name: string | null } | null;
  pledges: { pledger_id: string; quantity: number; pledger: { display_name: string | null } | null }[];
};

export type RequestView = {
  id: string;
  card: NonNullable<LoadedRequest["card"]>;
  quantity: number;
  note: string | null;
  requesterId: string;
  requesterName: string;
  isMine: boolean;
  pledged: number;
  remaining: number;
  coverage: Coverage;
  myPledge: number;
  maxPledge: number;
  canPledge: Check;
  pledgers: { id: string; name: string; quantity: number }[];
};

const COVERAGE_ORDER: Record<Coverage, number> = { open: 0, partial: 1, covered: 2 };

/**
 * Bring-list group: others' unfilled requests first (what the viewer can act
 * on), then the viewer's own unfilled ones, then filled requests (others',
 * then the viewer's).
 */
function listGroup(v: Pick<RequestView, "coverage" | "isMine">): number {
  const filled = v.coverage === "covered";
  return (filled ? 2 : 0) + (v.isMine ? 1 : 0);
}

/**
 * Turns loaded rows into what the event page renders, sorted by listGroup,
 * then open before partial, most remaining first, oldest first.
 */
export function buildRequestViews(
  rows: LoadedRequest[],
  viewer: { id: string; attending: boolean; eventEnded: boolean },
): RequestView[] {
  const createdAt = new Map(rows.map((r) => [r.id, r.created_at]));
  return rows
    .filter((r): r is LoadedRequest & { card: NonNullable<LoadedRequest["card"]> } => r.card !== null)
    .map((r) => {
      const pledged = totalPledged(r.pledges);
      const myPledge = r.pledges.find((p) => p.pledger_id === viewer.id)?.quantity ?? 0;
      const ctx = {
        eventEnded: viewer.eventEnded,
        viewerAttending: viewer.attending,
        viewerIsRequester: r.requester_id === viewer.id,
        requestActive: true,
        requestQuantity: r.quantity,
        pledged,
        myPledge,
      };
      return {
        id: r.id,
        card: r.card,
        quantity: r.quantity,
        note: r.note,
        requesterId: r.requester_id,
        requesterName: r.requester?.display_name ?? "Unknown player",
        isMine: r.requester_id === viewer.id,
        pledged,
        remaining: Math.max(0, r.quantity - pledged),
        coverage: coverage(r.quantity, pledged),
        myPledge,
        maxPledge: maxPledge(ctx),
        canPledge: canPledge(ctx),
        pledgers: r.pledges.map((p) => ({
          id: p.pledger_id,
          name: p.pledger?.display_name ?? "Unknown player",
          quantity: p.quantity,
        })),
      };
    })
    .sort(
      (a, b) =>
        listGroup(a) - listGroup(b) ||
        COVERAGE_ORDER[a.coverage] - COVERAGE_ORDER[b.coverage] ||
        b.remaining - a.remaining ||
        createdAt.get(a.id)!.localeCompare(createdAt.get(b.id)!),
    );
}
