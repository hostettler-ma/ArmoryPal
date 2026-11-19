// Discord signs every interaction with Ed25519 over `timestamp + raw body`
// (headers X-Signature-Ed25519 and X-Signature-Timestamp). Anything that
// fails here gets a 401, which Discord also probes for when the endpoint URL
// is saved. WebCrypto Ed25519 works in Deno and Node 20+.

/** How old a signed request may be (replay window). */
export const MAX_SIGNATURE_AGE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importPublicKey(publicKeyHex: string, raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  let key = keyCache.get(publicKeyHex);
  if (!key) {
    key = crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    keyCache.set(publicKeyHex, key);
  }
  return key;
}

/**
 * True only for a well-formed, fresh signature by `publicKeyHex` (the app's
 * "Public Key" from the developer portal). Never throws.
 */
export async function verifyDiscordRequest(opts: {
  publicKeyHex: string | undefined;
  signatureHex: string | null;
  timestamp: string | null;
  body: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const { publicKeyHex, signatureHex, timestamp, body } = opts;
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false;

  const key = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  if (!key || key.length !== 32 || !signature || signature.length !== 64) return false;

  try {
    return await crypto.subtle.verify(
      "Ed25519",
      await importPublicKey(publicKeyHex, key),
      signature,
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}
