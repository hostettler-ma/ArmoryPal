"use client";

import { useEffect, useRef } from "react";

/** Mobile bottom sheet built on <dialog> (focus trap, Esc to close, backdrop tap closes). */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      // .sheet (globals.css) slides it up at moderate-02 expressive and fades the scrim.
      className="sheet fixed inset-x-0 top-auto bottom-0 mx-auto mb-0 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-container bg-surface p-0 text-foreground shadow-overlay"
    >
      <div className="space-y-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-heading-03">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="interactive -mr-3 flex size-control-lg shrink-0 items-center justify-center rounded-full text-glyph text-muted"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
