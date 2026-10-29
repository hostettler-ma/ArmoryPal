"use client";

import { useFormStatus } from "react-dom";
import { setMyStore } from "@/app/actions/stores";

export function MyStoreButton({ storeId, isMine, wide }: { storeId: string; isMine: boolean; wide?: boolean }) {
  return (
    <form action={setMyStore} className={wide ? "w-full" : "shrink-0"}>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="add" value={String(!isMine)} />
      <SubmitButton isMine={isMine} wide={wide} />
    </form>
  );
}

function SubmitButton({ isMine, wide }: { isMine: boolean; wide?: boolean }) {
  const { pending } = useFormStatus();
  const size = wide ? "" : "!min-h-10 !w-auto px-3 text-sm";
  return (
    <button
      className={`btn ${isMine ? "btn-secondary" : "btn-primary"} ${size}`}
      disabled={pending}
      aria-label={isMine ? "Remove from My stores" : "Add to My stores"}
    >
      {isMine ? "Remove" : "+ Add"}
    </button>
  );
}
