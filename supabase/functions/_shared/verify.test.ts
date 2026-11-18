import { beforeAll, describe, expect, it } from "vitest";
import { MAX_SIGNATURE_AGE_SECONDS, verifyDiscordRequest } from "./verify.ts";

const hex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("hex");

let publicKeyHex: string;
let otherPublicKeyHex: string;
let privateKey: CryptoKey;
const now = 1_800_000_000;
const timestamp = String(now);
const body = JSON.stringify({ type: 1 });

async function sign(message: string, key = privateKey) {
  return hex(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(message)));
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
  const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  otherPublicKeyHex = hex(await crypto.subtle.exportKey("raw", other.publicKey));
});

const check = (overrides: Partial<Parameters<typeof verifyDiscordRequest>[0]>) =>
  sign(timestamp + body).then((signatureHex) =>
    verifyDiscordRequest({ publicKeyHex, signatureHex, timestamp, body, nowSeconds: now, ...overrides }),
  );

describe("verifyDiscordRequest", () => {
  it("accepts a valid signature", async () => {
    expect(await check({})).toBe(true);
  });

  it("rejects a signature by another key", async () => {
    expect(await check({ publicKeyHex: otherPublicKeyHex })).toBe(false);
  });

  it("rejects a tampered body or timestamp", async () => {
    expect(await check({ body: JSON.stringify({ type: 2 }) })).toBe(false);
    expect(await check({ timestamp: String(now + 1) })).toBe(false);
  });

  it("rejects missing headers or a missing key", async () => {
    expect(await check({ signatureHex: null })).toBe(false);
    expect(await check({ timestamp: null })).toBe(false);
    expect(await check({ publicKeyHex: undefined })).toBe(false);
    expect(await check({ publicKeyHex: "" })).toBe(false);
  });

  it("rejects malformed hex without throwing", async () => {
    expect(await check({ signatureHex: "zz" })).toBe(false);
    expect(await check({ signatureHex: "ab".repeat(63) })).toBe(false);
    expect(await check({ publicKeyHex: "not-hex" })).toBe(false);
    expect(await check({ timestamp: "12abc" })).toBe(false);
  });

  it("rejects stale or future timestamps (replays)", async () => {
    const old = String(now - MAX_SIGNATURE_AGE_SECONDS - 1);
    expect(await verifyDiscordRequest({ publicKeyHex, signatureHex: await sign(old + body), timestamp: old, body, nowSeconds: now })).toBe(
      false,
    );
    const future = String(now + MAX_SIGNATURE_AGE_SECONDS + 1);
    expect(
      await verifyDiscordRequest({ publicKeyHex, signatureHex: await sign(future + body), timestamp: future, body, nowSeconds: now }),
    ).toBe(false);
  });
});
