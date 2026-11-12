/** A store's notes (e.g. "Pre-register at …"), shown as an info box. Renders nothing if empty. */
export function StoreNotes({ notes }: { notes: string | null | undefined }) {
  if (!notes?.trim()) return null;
  return (
    <div className="rounded-container border border-store/40 bg-store-bg p-3 text-body-compact text-store-fg">
      <p className="mb-0.5 text-heading-01">Store notes</p>
      <p className="whitespace-pre-line">{notes}</p>
    </div>
  );
}
