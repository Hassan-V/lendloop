import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const map = {};
  for (const rawLine of fs.readFileSync(envPath, "utf8").splitlines ? fs.readFileSync(envPath, "utf8").splitlines() : fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).replace(/\s+#.*$/, "").trim();
    map[key] = val;
  }
  return map;
}

const env = loadEnvLocal();
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
const CONVEX_SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL || env.NEXT_PUBLIC_CONVEX_SITE_URL;
const HMAC_SECRET = process.env.N8N_WEBHOOK_HMAC_SECRET || env.N8N_WEBHOOK_HMAC_SECRET;
const NEXT_URL = process.env.LENDLOOP_APP_URL || "http://localhost:3000";
const N8N_URL = process.env.LENDLOOP_N8N_URL || "http://localhost:5678";

assert.ok(CONVEX_URL, "NEXT_PUBLIC_CONVEX_URL must be configured in .env.local");
assert.ok(CONVEX_SITE, "NEXT_PUBLIC_CONVEX_SITE_URL must be configured in .env.local");
assert.ok(HMAC_SECRET, "N8N_WEBHOOK_HMAC_SECRET must be configured in .env.local");

const convex = new ConvexHttpClient(CONVEX_URL);

function signBody(bodyStr, offsetMs = 0) {
  const ts = String(Date.now() + offsetMs);
  const sig = crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${ts}.${bodyStr}`)
    .digest("hex");
  return { ts, sig };
}

test("Next.js landing page returns HTTP 200 without external Clerk redirect", async () => {
  const res = await fetch(`${NEXT_URL}/`, { redirect: "manual" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
  const html = await res.text();
  assert.match(html, /LendLoop/);
});

test("Docker n8n healthz returns 200 OK", async () => {
  const res = await fetch(`${N8N_URL}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { status: "ok" });
});

test("Convex tools:listPublic returns seeded tools with zero PII leaked", async () => {
  const tools = await convex.query(api.tools.listPublic, { category: "all" });
  assert.ok(Array.isArray(tools) && tools.length >= 6, "Expected at least 6 public tools");

  for (const t of tools) {
    assert.deepEqual(
      Object.keys(t).sort(),
      ["_id", "category", "isAvailable", "name"]
    );
    assert.equal(t.isAvailable, true);
  }

  const powerTools = await convex.query(api.tools.listPublic, {
    category: "power_tools",
  });
  assert.equal(powerTools.length, 2);
  for (const pt of powerTools) {
    assert.equal(pt.category, "power_tools");
  }
});

test("Convex RBAC rejects unauthenticated access to protected queries and mutations", async () => {
  await assert.rejects(
    () => convex.query(api.tools.listAuthenticated, { category: "all" }),
    /Unauthorized/
  );
  await assert.rejects(
    () => convex.query(api.loans.adminListAllLoans, {}),
    /Unauthorized/
  );
  await assert.rejects(
    () =>
      convex.mutation(api.tools.createTool, {
        name: "Unauthorized Drill",
        category: "power_tools",
        condition: "good",
        description: "Should be blocked by server RBAC",
      }),
    /Unauthorized/
  );
  await assert.rejects(
    () => convex.query(api.users.adminListUsers, {}),
    /Unauthorized/
  );
});

test("Convex HTTP Actions enforce HMAC, replay protection, and idempotent overdue write-backs", async () => {
  const noAuth = await fetch(`${CONVEX_SITE}/api/n8n/overdue-loans`);
  assert.equal(noAuth.status, 401);

  const stale = signBody("GET:/api/n8n/overdue-loans", -360_000);
  const staleRes = await fetch(`${CONVEX_SITE}/api/n8n/overdue-loans`, {
    headers: {
      "X-LendLoop-Timestamp": stale.ts,
      "X-LendLoop-Signature": stale.sig,
    },
  });
  assert.equal(staleRes.status, 401);

  const validGet = signBody("GET:/api/n8n/overdue-loans");
  const getRes = await fetch(`${CONVEX_SITE}/api/n8n/overdue-loans`, {
    headers: {
      "X-LendLoop-Timestamp": validGet.ts,
      "X-LendLoop-Signature": validGet.sig,
    },
  });
  assert.equal(getRes.status, 200);
  const overdueData = await getRes.json();
  assert.ok(Array.isArray(overdueData.loans) && overdueData.loans.length >= 1);

  const sampleLoan = overdueData.loans[0];
  const cbPayload = JSON.stringify({
    loanId: sampleLoan.loanId,
    idempotencyKey: `overdue:${sampleLoan.loanId}:${overdueData.date}`,
    summary: `Automated E2E verification reminder for ${sampleLoan.toolName}`,
  });

  const cb1Auth = signBody(cbPayload);
  const cb1Res = await fetch(`${CONVEX_SITE}/api/n8n/reminder-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": cb1Auth.ts,
      "X-LendLoop-Signature": cb1Auth.sig,
    },
    body: cbPayload,
  });
  assert.equal(cb1Res.status, 200);
  const cb1Json = await cb1Res.json();
  assert.equal(cb1Json.ok, true);

  // Repeat identical callback -> must deduplicate cleanly
  const cb2Auth = signBody(cbPayload);
  const cb2Res = await fetch(`${CONVEX_SITE}/api/n8n/reminder-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": cb2Auth.ts,
      "X-LendLoop-Signature": cb2Auth.sig,
    },
    body: cbPayload,
  });
  assert.equal(cb2Res.status, 200);
  const cb2Json = await cb2Res.json();
  assert.deepEqual(cb2Json, { ok: true, deduplicated: true });
});
