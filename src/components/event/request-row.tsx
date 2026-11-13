import { PitchDot } from "@/components/pitch-dot";
import { cardLabel, formatSetIds } from "@/lib/cards";
import type { RequestView } from "@/lib/request-view";
import type { Coverage } from "@/lib/rules";
import { CancelRequestButton, EditRequestButton } from "./edit-request-sheet";
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
  return <span className={`rounded-full px-2 py-0.5 text-tag whitespace-nowrap ${CHIP[request.coverage]}`}>{text}</span>;
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
  const showPledge = mode === "bring" && !request.isMine && (request.canPledge.ok || (request.myPledge > 0 && editable));
  // Your own requests are editable from both the Requests tab and My checklist.
  const canEdit = editable && (mode === "mine" || request.isMine);
  return (
    <li className="card space-y-2">
      <div className="flex items-start gap-3">
        <span className="pt-1">
          <PitchDot color={request.card.color} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-heading-02">{cardLabel(request.card)}</p>
          {request.card.set_ids.length > 0 && (
            <p className="font-mono text-helper text-muted" title={`Printed in: ${request.card.set_ids.join(", ")}`}>
              {formatSetIds(request.card.set_ids)}
            </p>
          )}
          <p className="text-body-compact text-muted">
            {mode === "bring" && (request.isMine ? "Your request" : `for ${request.requesterName}`)}
            {mode === "bring" && !request.requesterAttending && (
              <span className="ml-1 rounded-full border border-border px-2 text-helper">Not going</span>
            )}
            {mode === "bring" && request.note && " · "}
            {request.note && <span className="italic">“{request.note}”</span>}
          </p>
        </div>
        <CoverageChip request={request} />
      </div>

      {mode === "mine" && (
        <p className="text-body-compact">
          {request.pledgers.length === 0 ? (
            <span className="text-muted">Nobody is bringing this yet.</span>
          ) : (
            request.pledgers.map((p) => `${p.name} ×${p.quantity}`).join(" · ")
          )}
        </p>
      )}

      {(showPledge || canEdit) && (
        <div className="flex justify-end gap-2">
          {showPledge && <PledgeButton eventId={eventId} request={request} />}
          {canEdit && <CancelRequestButton eventId={eventId} request={request} />}
          {canEdit && <EditRequestButton eventId={eventId} request={request} />}
        </div>
      )}
    </li>
  );
}
