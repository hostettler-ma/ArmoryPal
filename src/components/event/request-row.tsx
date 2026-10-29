import { PitchDot } from "@/components/pitch-dot";
import { cardLabel } from "@/lib/cards";
import type { RequestView } from "@/lib/request-view";
import type { Coverage } from "@/lib/rules";
import { EditRequestButton } from "./edit-request-sheet";
import { PledgeButton } from "./pledge-sheet";

const CHIP: Record<Coverage, string> = {
  open: "bg-chip-open-bg text-chip-open-fg",
  partial: "bg-chip-partial-bg text-chip-partial-fg",
  covered: "bg-chip-covered-bg text-chip-covered-fg",
};

export function CoverageChip({ request }: { request: RequestView }) {
  const text =
    request.coverage === "open"
      ? `Need ${request.quantity}`
      : request.coverage === "partial"
        ? `${request.pledged} of ${request.quantity} coming`
        : `Covered · ${request.quantity}`;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${CHIP[request.coverage]}`}>{text}</span>;
}

/**
 * One request. `mode="bring"` is the shared bring list; `mode="mine"` shows
 * the viewer's own request with who's bringing it.
 */
export function RequestRow({
  eventId,
  request,
  mode,
  editable,
}: {
  eventId: string;
  request: RequestView;
  mode: "bring" | "mine";
  editable: boolean;
}) {
  const showPledge = mode === "bring" && (request.canPledge.ok || (request.myPledge > 0 && editable));
  return (
    <li className="card space-y-2">
      <div className="flex items-start gap-3">
        <span className="pt-1">
          <PitchDot color={request.card.color} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{cardLabel(request.card)}</p>
          <p className="text-sm text-muted">
            {mode === "bring" && (request.isMine ? "Your request" : `for ${request.requesterName}`)}
            {mode === "bring" && request.note && " · "}
            {request.note && <span className="italic">“{request.note}”</span>}
          </p>
        </div>
        <CoverageChip request={request} />
      </div>

      {mode === "mine" && (
        <p className="text-sm">
          {request.pledgers.length === 0 ? (
            <span className="text-muted">Nobody is bringing this yet.</span>
          ) : (
            request.pledgers.map((p) => `${p.name} ×${p.quantity}`).join(" · ")
          )}
        </p>
      )}

      {(showPledge || (mode === "mine" && editable)) && (
        <div className="flex justify-end">
          {showPledge && <PledgeButton eventId={eventId} request={request} />}
          {mode === "mine" && editable && <EditRequestButton eventId={eventId} request={request} />}
        </div>
      )}
    </li>
  );
}
