/** A store's notes (e.g. "Pre-register at …"), shown as an info box. Renders nothing if empty. */
export function StoreNotes({ notes }: { notes: string | null | undefined }) {
  if (!notes?.trim()) return null;
  return (
    <div className="rounded-xl border border-store/40 bg-store-bg p-3 text-sm text-store-fg">
      <p className="mb-0.5 font-semibold">Store notes</p>
      <p className="whitespace-pre-line">{notes}</p>
    </div>
  );
}
