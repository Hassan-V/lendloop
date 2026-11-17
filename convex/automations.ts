import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { signPayload } from "./lib/hmac";

export interface LoanWebhookPayload {
  eventType: "request_created_webhook" | "status_changed_webhook";
  loanId: Id<"loanRequests">;
  status: string;
  toolName: string;
  startDate: string;
  endDate: string;
  recipientEmail: string;
  recipientName: string;
  counterpartyName: string;
}

export const getLoanNotificationPayload = internalQuery({
  args: {
    loanId: v.id("loanRequests"),
    eventType: v.union(
      v.literal("request_created_webhook"),
      v.literal("status_changed_webhook")
    ),
  },
  handler: async (ctx, args): Promise<LoanWebhookPayload | null> => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return null;

    const [tool, lender, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.lenderId),
      ctx.db.get(loan.borrowerId),
    ]);

    if (!lender || !borrower) return null;

    // Data minimization: send only the fields required to notify the relevant user
    const notifyLender = args.eventType === "request_created_webhook";
    return {
      eventType: args.eventType,
      loanId: loan._id,
      status: loan.status,
      toolName: tool?.name ?? "Neighborhood Tool",
      startDate: loan.startDate,
      endDate: loan.endDate,
      recipientEmail: notifyLender ? lender.email : borrower.email,
      recipientName: notifyLender ? lender.name : borrower.name,
      counterpartyName: notifyLender ? borrower.name : lender.name,
    };
  },
});

export const recordAutomationEvent = internalMutation({
  args: {
    loanId: v.optional(v.id("loanRequests")),
    eventType: v.union(
      v.literal("request_created_webhook"),
      v.literal("status_changed_webhook"),
      v.literal("overdue_reminder_sent"),
      v.literal("webhook_failed")
    ),
    summary: v.string(),
    status: v.union(
      v.literal("delivered"),
      v.literal("retrying"),
      v.literal("failed")
    ),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"automationEvents">> => {
    return await ctx.db.insert("automationEvents", {
      loanId: args.loanId,
      eventType: args.eventType,
      summary: args.summary,
      status: args.status,
      idempotencyKey: args.idempotencyKey,
      createdAt: Date.now(),
    });
  },
});

export const dispatchLoanWebhook = internalAction({
  args: {
    loanId: v.id("loanRequests"),
    eventType: v.union(
      v.literal("request_created_webhook"),
      v.literal("status_changed_webhook")
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const payload = await ctx.runQuery(
      internal.automations.getLoanNotificationPayload,
      {
        loanId: args.loanId,
        eventType: args.eventType,
      }
    );
    if (!payload) return;

    const webhookUrl = process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_HMAC_SECRET;

    if (!webhookUrl || !secret) {
      await ctx.runMutation(internal.automations.recordAutomationEvent, {
        loanId: args.loanId,
        eventType: args.eventType,
        status: "failed",
        summary: "n8n webhook skipped: N8N_LOAN_EVENT_WEBHOOK_URL or secret unset",
      });
      return;
    }

    const body = JSON.stringify(payload);
    const maxAttempts = 3;
    let lastError = "Unknown error";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const timestamp = String(Date.now());
        const signature = await signPayload(secret, timestamp, body);
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-LendLoop-Timestamp": timestamp,
            "X-LendLoop-Signature": signature,
          },
          body,
        });

        if (response.ok) {
          const actionLabel =
            args.eventType === "request_created_webhook"
              ? "Request notification sent to lender"
              : `Status update (${payload.status}) delivered`;
          await ctx.runMutation(internal.automations.recordAutomationEvent, {
            loanId: args.loanId,
            eventType: args.eventType,
            status: "delivered",
            summary: actionLabel,
          });
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }

    await ctx.runMutation(internal.automations.recordAutomationEvent, {
      loanId: args.loanId,
      eventType: "webhook_failed",
      status: "failed",
      summary: `Notification webhook failed after ${maxAttempts} tries (${lastError})`,
    });
  },
});

export const getOverdueLoansInternal = internalQuery({
  args: {
    todayIso: v.string(),
  },
  handler: async (ctx, args) => {
    const approvedLoans = await ctx.db
      .query("loanRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    const overdue = approvedLoans.filter((loan) => loan.endDate < args.todayIso);

    const results = await Promise.all(
      overdue.map(async (loan) => {
        const [tool, borrower, lender] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
          ctx.db.get(loan.lenderId),
        ]);
        // Data minimization: expose strictly what n8n needs to send the reminder
        return {
          loanId: loan._id,
          toolName: tool?.name ?? "Tool",
          endDate: loan.endDate,
          borrowerName: borrower?.name ?? "Neighbor",
          borrowerEmail: borrower?.email ?? "",
          lenderName: lender?.name ?? "Owner",
          reminderCount: loan.reminderCount,
          lastReminderSentAt: loan.lastReminderSentAt ?? null,
        };
      })
    );

    return results.filter((r) => Boolean(r.borrowerEmail));
  },
});

export const recordOverdueReminderInternal = internalMutation({
  args: {
    loanId: v.id("loanRequests"),
    idempotencyKey: v.string(),
    summary: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; deduplicated: boolean }> => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing) {
      return { ok: true, deduplicated: true };
    }

    const loan = await ctx.db.get(args.loanId);
    if (!loan || loan.status !== "approved") {
      return { ok: false, deduplicated: false };
    }

    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      loanId: loan._id,
      eventType: "overdue_reminder_sent",
      idempotencyKey: args.idempotencyKey,
      summary: args.summary ?? "Overdue reminder sent to borrower",
      status: "delivered",
      createdAt: now,
    });

    await ctx.db.patch(loan._id, {
      lastReminderSentAt: now,
      reminderCount: loan.reminderCount + 1,
      updatedAt: now,
    });

    return { ok: true, deduplicated: false };
  },
});

export const recordErrorReportInternal = internalMutation({
  args: {
    loanId: v.optional(v.id("loanRequests")),
    workflowName: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ recorded: true }> => {
    await ctx.db.insert("automationEvents", {
      loanId: args.loanId,
      eventType: "webhook_failed",
      summary: `n8n workflow error (${args.workflowName}): ${args.message.slice(0, 200)}`,
      status: "failed",
      createdAt: Date.now(),
    });
    return { recorded: true };
  },
});
