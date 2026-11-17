const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Signs `${timestamp}.${body}` using HMAC-SHA256 and returns lowercase hex digest.
 * Binding the timestamp directly into the signed message prevents replay attacks.
 */
export async function signPayload(
  secret: string,
  timestamp: string,
  body: string
): Promise<string> {
  if (!secret) {
    throw new Error("HMAC secret must not be empty");
  }
  const key = await importHmacKey(secret);
  const encoder = new TextEncoder();
  const message = `${timestamp}.${body}`;
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );
  return toHex(signatureBuffer);
}

/**
 * Constant-time string comparison to avoid timing side-channel leaks.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const normalizedA = a.trim().toLowerCase().replace(/^sha256=/, "");
  const normalizedB = b.trim().toLowerCase().replace(/^sha256=/, "");

  if (
    normalizedA.length === 0 ||
    normalizedA.length !== normalizedB.length ||
    !/^[0-9a-f]+$/.test(normalizedA) ||
    !/^[0-9a-f]+$/.test(normalizedB)
  ) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < normalizedA.length; i++) {
    mismatch |= normalizedA.charCodeAt(i) ^ normalizedB.charCodeAt(i);
  }
  return mismatch === 0;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verifies an incoming webhook/HTTP request signed with X-LendLoop-Timestamp and X-LendLoop-Signature.
 * Enforces replay protection within `maxSkewMs` (default 5 minutes).
 */
export async function verifySignedRequest(params: {
  secret: string;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  body: string;
  nowMs?: number;
  maxSkewMs?: number;
}): Promise<VerifyResult> {
  const {
    secret,
    timestampHeader,
    signatureHeader,
    body,
    nowMs = Date.now(),
    maxSkewMs = DEFAULT_MAX_SKEW_MS,
  } = params;

  if (!secret) {
    return { ok: false, reason: "Server HMAC secret not configured" };
  }
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "Missing timestamp or signature header" };
  }
  if (!/^\d+$/.test(timestampHeader.trim())) {
    return { ok: false, reason: "Invalid timestamp format" };
  }

  const timestampMs = Number(timestampHeader.trim());
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "Invalid timestamp number" };
  }

  const skew = Math.abs(nowMs - timestampMs);
  if (skew > maxSkewMs) {
    return { ok: false, reason: "Request timestamp outside allowed replay window" };
  }

  const expected = await signPayload(secret, timestampHeader.trim(), body);
  if (!timingSafeEqualHex(expected, signatureHeader)) {
    return { ok: false, reason: "Invalid HMAC signature" };
  }

  return { ok: true };
}

/**
 * Deterministic daily idempotency key for overdue loan reminders.
 */
export function buildOverdueIdempotencyKey(loanId: string, isoDate: string): string {
  return `overdue:${loanId}:${isoDate.slice(0, 10)}`;
}
