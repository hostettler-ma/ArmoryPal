"use client";

import {
  cancelOwnershipRequest,
  decideOwnershipRequest,
  removeStoreOwner,
  requestOwnership,
} from "@/app/actions/ownership";
import { ConfirmButton } from "@/components/admin/moderation-buttons";

/** Store page: a player asks an admin to let them manage this store. */
export function RequestOwnershipButton({ storeId, storeName }: { storeId: string; storeName: string }) {
  return (
    <ConfirmButton
      label="I run this store"
      title={`Manage ${storeName}?`}
      description={
        <>
          Store owners link the GEM event and tickets, move or add events, run format polls, and hear when players
          drop out. An admin checks each request first.
        </>
      }
      reason="optional"
      reasonLabel="How are you connected to the store?"
      confirmLabel="Send request"
      run={(message) => requestOwnership(storeId, message)}
    />
  );
}

export function CancelOwnershipRequestButton({ requestId, storeId }: { requestId: string; storeId: string }) {
  return (
    <ConfirmButton
      compact
      label="Withdraw"
      title="Withdraw your request?"
      description="You can ask again any time."
      confirmLabel="Withdraw request"
      run={() => cancelOwnershipRequest(requestId, storeId)}
    />
  );
}

export function DecideOwnershipButtons({ requestId, name, store }: { requestId: string; name: string; store: string }) {
  return (
    <div className="flex gap-2">
      <ConfirmButton
        compact
        label="Approve"
        title={`Let ${name} manage ${store}?`}
        description="They can edit event links, move and add events, change weekly slots, and run format polls for this store."
        reason="optional"
        reasonLabel="Note to the player"
        confirmLabel="Approve"
        run={(note) => decideOwnershipRequest(requestId, true, note)}
      />
      <ConfirmButton
        compact
        danger
        label="Reject"
        title={`Reject ${name}'s request?`}
        description="They get a notification with your reason, and can ask again later."
        reason="optional"
        confirmLabel="Reject"
        run={(note) => decideOwnershipRequest(requestId, false, note)}
      />
    </div>
  );
}

export function RemoveOwnerButton({ storeId, userId, name }: { storeId: string; userId: string; name: string }) {
  return (
    <ConfirmButton
      compact
      danger
      label="Remove"
      title={`Remove ${name} as owner?`}
      description="They can no longer manage this store. Events, links and polls stay as they are."
      confirmLabel="Remove owner"
      run={() => removeStoreOwner(storeId, userId)}
    />
  );
}
