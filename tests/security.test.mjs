import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

async function loadTsModule(relPath) {
  const sourcePath = path.join(rootDir, relPath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lendloop-test-"));
  const outPath = path.join(tmpDir, path.basename(relPath).replace(/\.ts$/, ".mjs"));
  fs.writeFileSync(outPath, transpiled.outputText, "utf8");
  return await import(pathToFileURL(outPath).href);
}

const hmac = await loadTsModule("convex/lib/hmac.ts");
const rbac = await loadTsModule("convex/lib/rbac.ts");

test("signPayload and verifySignedRequest accept valid signed payload within window", async () => {
  const secret = "test_secret_64_chars_0123456789abcdef0123456789abcdef";
  const nowMs = 1_760_000_000_000;
  const timestamp = String(nowMs);
  const body = JSON.stringify({ loanId: "loan_1", status: "approved" });

  const signature = await hmac.signPayload(secret, timestamp, body);
  const res = await hmac.verifySignedRequest({
    secret,
    timestampHeader: timestamp,
    signatureHeader: signature,
    body,
    nowMs: nowMs + 15_000,
  });

  assert.deepEqual(res, { ok: true });
});

test("verifySignedRequest rejects tampered request body", async () => {
  const secret = "test_secret_value";
  const nowMs = 1_760_000_000_000;
  const timestamp = String(nowMs);
  const originalBody = JSON.stringify({ loanId: "loan_1", status: "pending" });
  const tamperedBody = JSON.stringify({ loanId: "loan_1", status: "approved" });

  const signature = await hmac.signPayload(secret, timestamp, originalBody);
  const res = await hmac.verifySignedRequest({
    secret,
    timestampHeader: timestamp,
    signatureHeader: signature,
    body: tamperedBody,
    nowMs,
  });

  assert.equal(res.ok, false);
  assert.match(res.reason, /Invalid HMAC signature/);
});

test("verifySignedRequest rejects stale timestamps outside 5-minute replay window", async () => {
  const secret = "test_secret_value";
  const nowMs = 1_760_000_000_000;
  const expiredTs = String(nowMs - 301_000);
  const body = JSON.stringify({ ping: true });

  const signature = await hmac.signPayload(secret, expiredTs, body);
  const res = await hmac.verifySignedRequest({
    secret,
    timestampHeader: expiredTs,
    signatureHeader: signature,
    body,
    nowMs,
  });

  assert.equal(res.ok, false);
  assert.match(res.reason, /replay window/);
});

test("timingSafeEqualHex validates exact hex equality and rejects invalid forms", () => {
  assert.equal(hmac.timingSafeEqualHex("abcd1234", "ABCD1234"), true);
  assert.equal(hmac.timingSafeEqualHex("sha256=abcd1234", "abcd1234"), true);
  assert.equal(hmac.timingSafeEqualHex("abcd1234", "abcd1235"), false);
  assert.equal(hmac.timingSafeEqualHex("abcd123", "abcd1234"), false);
  assert.equal(hmac.timingSafeEqualHex("zzzz", "zzzz"), false);
});

test("buildOverdueIdempotencyKey creates deterministic daily keys", () => {
  assert.equal(
    hmac.buildOverdueIdempotencyKey("loan_42", "2026-11-17T09:00:00Z"),
    "overdue:loan_42:2026-11-17"
  );
});

test("sanitizePublicTool strips owner PII, condition, and description", () => {
  const rawTool = {
    _id: "tool_99",
    name: "Pressure Washer",
    category: "garden",
    condition: "like_new",
    description: "Pick up on porch at 123 Maple St",
    ownerId: "user_secret_owner",
    ownerEmail: "owner@example.com",
    isAvailable: true,
    createdAt: 123456,
  };

  const sanitized = rbac.sanitizePublicTool(rawTool);
  assert.deepEqual(sanitized, {
    _id: "tool_99",
    name: "Pressure Washer",
    category: "garden",
    isAvailable: true,
  });
  assert.equal("ownerId" in sanitized, false);
  assert.equal("ownerEmail" in sanitized, false);
  assert.equal("description" in sanitized, false);
  assert.equal("condition" in sanitized, false);
});

test("RBAC assertions enforce ownership, admin privileges, and loan participation", () => {
  assert.throws(() => rbac.assertAuthenticatedIdentity(null), /Unauthorized/);

  const regularUser = { _id: "user_1", role: "user" };
  const otherUser = { _id: "user_2", role: "user" };
  const adminUser = { _id: "user_admin", role: "admin" };
  const tool = { ownerId: "user_1" };
  const loan = { lenderId: "user_1", borrowerId: "user_2" };
  const unrelatedUser = { _id: "user_3", role: "user" };

  assert.throws(() => rbac.assertAdminRole(regularUser), /Forbidden/);
  assert.doesNotThrow(() => rbac.assertAdminRole(adminUser));

  assert.doesNotThrow(() => rbac.assertToolOwnerOnly(regularUser, tool));
  assert.throws(() => rbac.assertToolOwnerOnly(otherUser, tool), /Forbidden/);
  assert.throws(() => rbac.assertToolOwnerOnly(adminUser, tool), /Forbidden/);

  assert.doesNotThrow(() => rbac.assertToolOwnerOrAdmin(adminUser, tool));
  assert.throws(() => rbac.assertToolOwnerOrAdmin(otherUser, tool), /Forbidden/);

  assert.doesNotThrow(() => rbac.assertLoanParticipant(regularUser, loan));
  assert.doesNotThrow(() => rbac.assertLoanParticipant(otherUser, loan));
  assert.doesNotThrow(() => rbac.assertLoanParticipant(adminUser, loan));
  assert.throws(() => rbac.assertLoanParticipant(unrelatedUser, loan), /Forbidden/);
});

test("assertValidDateRange checks format and ordering", () => {
  assert.doesNotThrow(() => rbac.assertValidDateRange("2026-11-17", "2026-11-20"));
  assert.throws(() => rbac.assertValidDateRange("2026-11-20", "2026-11-17"), /Invalid date range/);
  assert.throws(() => rbac.assertValidDateRange("11/17/2026", "2026-11-20"), /Invalid date format/);
});
