import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { verifySignedRequest } from "./lib/hmac";

const http = httpRouter();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

http.route({
  path: "/api/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.N8N_WEBHOOK_HMAC_SECRET ?? "";
    const timestamp = request.headers.get("X-LendLoop-Timestamp");
    const signature = request.headers.get("X-LendLoop-Signature");

    const check = await verifySignedRequest({
      secret,
      timestampHeader: timestamp,
      signatureHeader: signature,
      body: "GET:/api/n8n/overdue-loans",
    });

    if (!check.ok) {
      return jsonResponse({ error: check.reason }, 401);
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const loans = await ctx.runQuery(
      internal.automations.getOverdueLoansInternal,
      { todayIso }
    );

    return jsonResponse({ date: todayIso, loans }, 200);
  }),
});

http.route({
  path: "/api/n8n/reminder-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.N8N_WEBHOOK_HMAC_SECRET ?? "";
    const timestamp = request.headers.get("X-LendLoop-Timestamp");
    const signature = request.headers.get("X-LendLoop-Signature");
    const rawBody = await request.text();

    const check = await verifySignedRequest({
      secret,
      timestampHeader: timestamp,
      signatureHeader: signature,
      body: rawBody,
    });

    if (!check.ok) {
      return jsonResponse({ error: check.reason }, 401);
    }

    let parsed: { loanId?: string; idempotencyKey?: string; summary?: string };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!parsed.loanId || !parsed.idempotencyKey) {
      return jsonResponse(
        { error: "loanId and idempotencyKey are required" },
        400
      );
    }

    const result = await ctx.runMutation(
      internal.automations.recordOverdueReminderInternal,
      {
        loanId: parsed.loanId as Id<"loanRequests">,
        idempotencyKey: parsed.idempotencyKey,
        summary: parsed.summary,
      }
    );

    return jsonResponse(result, 200);
  }),
});

http.route({
  path: "/api/n8n/error-report",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.N8N_WEBHOOK_HMAC_SECRET ?? "";
    const timestamp = request.headers.get("X-LendLoop-Timestamp");
    const signature = request.headers.get("X-LendLoop-Signature");
    const rawBody = await request.text();

    const check = await verifySignedRequest({
      secret,
      timestampHeader: timestamp,
      signatureHeader: signature,
      body: rawBody,
    });

    if (!check.ok) {
      return jsonResponse({ error: check.reason }, 401);
    }

    let parsed: { loanId?: string; workflowName?: string; message?: string };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    await ctx.runMutation(internal.automations.recordErrorReportInternal, {
      loanId: parsed.loanId ? (parsed.loanId as Id<"loanRequests">) : undefined,
      workflowName: parsed.workflowName ?? "unknown",
      message: parsed.message ?? "Execution failed",
    });

    return jsonResponse({ recorded: true }, 200);
  }),
});

export default http;
