/**
 * The store's links for an event: buy a ticket, and the GEM event (a link, or
 * the code to search for in GEM). Links were checked to be https on save.
 */
export function EventLinks({
  gemUrl,
  gemCode,
  ticketUrl,
}: {
  gemUrl: string | null;
  gemCode: string | null;
  ticketUrl: string | null;
}) {
  if (!gemUrl && !gemCode && !ticketUrl) return null;
  return (
    <div className="space-y-2">
      {ticketUrl && (
        <a href={ticketUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          Buy a ticket ↗
        </a>
      )}
      {gemUrl && (
        <a href={gemUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
          Open in GEM ↗
        </a>
      )}
      {!gemUrl && gemCode && (
        <p className="card text-body-compact">
          GEM event code: <span className="font-mono font-semibold select-all">{gemCode}</span>
        </p>
      )}
    </div>
  );
}
