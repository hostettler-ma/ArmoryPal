import { describe, expect, it } from "vitest";
import { ADMIN_ACTION_LABELS, deleteStoreOutcome, MAX_REASON_LENGTH, parseReason } from "./moderation";

describe("parseReason", () => {
  it("trims and accepts a reason", () => {
    expect(parseReason("  Kept cards  ", { required: true })).toEqual({ ok: true, value: "Kept cards" });
  });

  it("requires a reason only when asked", () => {
    expect(parseReason("   ", { required: true }).ok).toBe(false);
    expect(parseReason(undefined, { required: true }).ok).toBe(false);
    expect(parseReason("", { required: false })).toEqual({ ok: true, value: "" });
  });

  it("caps the length like the database", () => {
    expect(parseReason("x".repeat(MAX_REASON_LENGTH), { required: true }).ok).toBe(true);
    expect(parseReason("x".repeat(MAX_REASON_LENGTH + 1), { required: false }).ok).toBe(false);
  });
});

describe("deleteStoreOutcome", () => {
  it("archives stores with history and deletes unused ones", () => {
    expect(deleteStoreOutcome(0)).toBe("delete");
    expect(deleteStoreOutcome(14)).toBe("archive");
  });
});

describe("ADMIN_ACTION_LABELS", () => {
  it("labels every action the database can log", () => {
    for (const action of ["remove_attendee", "ban", "unban", "archive_store", "restore_store", "delete_store"]) {
      expect(ADMIN_ACTION_LABELS[action]).toBeTruthy();
    }
  });
});
