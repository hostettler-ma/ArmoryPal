/** "This event is cancelled", with the store's message if it left one. */
export function CancelledNotice({ note }: { note: string | null }) {
  return (
    <div role="status" className="rounded-container border-2 border-danger bg-surface p-3 text-danger">
      <p className="text-heading-02">This event is cancelled</p>
      {note && <p className="mt-1 whitespace-pre-line text-body">{note}</p>}
    </div>
  );
}

/** Small "Cancelled" pill for event rows and cards. */
export function CancelledBadge() {
  return <span className="rounded-full border border-danger px-2 text-tag text-danger">Cancelled</span>;
}
