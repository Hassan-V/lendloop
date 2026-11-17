import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
  assertLoanParticipant,
  assertValidDateRange,
  requireAdmin,
  requireAuthenticatedUser,
} from "./lib/rbac";

async function enrichLoans(ctx: QueryCtx, loans: Doc<"loanRequests">[]) {
  const toolIds = [...new Set(loans.map((l) => l.toolId))];
  const userIds = [
    ...new Set(loans.flatMap((l) => [l.lenderId, l.borrowerId])),
  ];

  const [toolDocs, userDocs, eventsPerLoan] = await Promise.all([
    Promise.all(toolIds.map((id) => ctx.db.get(id))),
    Promise.all(userIds.map((id) => ctx.db.get(id))),
    Promise.all(
      loans.map((loan) =>
        ctx.db
          .query("automationEvents")
          .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
          .order("desc")
          .take(5)
      )
    ),
  ]);

  const toolMap = new Map(
    toolDocs.filter(Boolean).map((t) => [String(t!._id), t!])
  );
  const userMap = new Map(
    userDocs.filter(Boolean).map((u) => [String(u!._id), u!])
  );

  return loans.map((loan, index) => {
    const tool = toolMap.get(String(loan.toolId));
    const lender = userMap.get(String(loan.lenderId));
    const borrower = userMap.get(String(loan.borrowerId));
    const events = eventsPerLoan[index].map((ev) => ({
      _id: ev._id,
      eventType: ev.eventType,
      summary: ev.summary,
      status: ev.status,
      createdAt: ev.createdAt,
    }));

    return {
      _id: loan._id,
      toolId: loan.toolId,
      toolName: tool?.name ?? "Removed Tool",
      toolCategory: tool?.category ?? "other",
      lenderName: lender?.name ?? "Neighbor",
      lenderTrusted: lender?.isTrustedLender ?? false,
      borrowerName: borrower?.name ?? "Neighbor",
      startDate: loan.startDate,
      endDate: loan.endDate,
      status: loan.status,
      note: loan.note,
      lastReminderSentAt: loan.lastReminderSentAt,
      reminderCount: loan.reminderCount,
      recentAutomationActivity: events,
      createdAt: loan.createdAt,
    };
  });
}

export const requestBorrow = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"loanRequests">> => {
    const borrower = await requireAuthenticatedUser(ctx);
    assertValidDateRange(args.startDate, args.endDate);

    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new Error("Tool listing not found");
    }
    if (!tool.isAvailable) {
      throw new Error("This tool is currently out on an active loan");
    }
    if (String(tool.ownerId) === String(borrower._id)) {
      throw new Error("You cannot request to borrow your own tool");
    }

    const existingForBorrower = await ctx.db
      .query("loanRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", borrower._id))
      .collect();
    const duplicatePending = existingForBorrower.some(
      (l) => String(l.toolId) === String(tool._id) && l.status === "pending"
    );
    if (duplicatePending) {
      throw new Error("You already have a pending request for this tool");
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loanRequests", {
      toolId: tool._id,
      lenderId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
      note: args.note?.trim() || undefined,
      reminderCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.automations.dispatchLoanWebhook, {
      loanId,
      eventType: "request_created_webhook",
    });

    return loanId;
  },
});

export const respondToRequest = mutation({
  args: {
    loanId: v.id("loanRequests"),
    decision: v.union(v.literal("approved"), v.literal("declined")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ loanId: Id<"loanRequests">; status: "approved" | "declined" }> => {
    const lender = await requireAuthenticatedUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throw new Error("Loan request not found");
    }
    if (String(loan.lenderId) !== String(lender._id)) {
      throw new Error("Forbidden: only the tool owner can approve or decline requests");
    }
    if (loan.status !== "pending") {
      throw new Error("Only pending loan requests can be updated");
    }

    const now = Date.now();
    if (args.decision === "approved") {
      const tool = await ctx.db.get(loan.toolId);
      if (!tool || !tool.isAvailable) {
        throw new Error("Tool is no longer available to lend");
      }
      await ctx.db.patch(tool._id, { isAvailable: false, updatedAt: now });

      // Prevent concurrent pending requests from double-booking the same tool
      const otherPending = await ctx.db
        .query("loanRequests")
        .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
        .collect();
      for (const candidate of otherPending) {
        if (
          String(candidate._id) !== String(loan._id) &&
          candidate.status === "pending"
        ) {
          await ctx.db.patch(candidate._id, {
            status: "declined",
            updatedAt: now,
          });
        }
      }
    }

    await ctx.db.patch(loan._id, {
      status: args.decision,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.automations.dispatchLoanWebhook, {
      loanId: loan._id,
      eventType: "status_changed_webhook",
    });

    return { loanId: loan._id, status: args.decision };
  },
});

export const markReturned = mutation({
  args: {
    loanId: v.id("loanRequests"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ loanId: Id<"loanRequests">; status: "returned" }> => {
    const actor = await requireAuthenticatedUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throw new Error("Loan record not found");
    }
    assertLoanParticipant(actor, loan);

    if (loan.status !== "approved") {
      throw new Error("Only approved active loans can be marked returned");
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "returned",
      updatedAt: now,
    });

    const tool = await ctx.db.get(loan.toolId);
    if (tool) {
      await ctx.db.patch(tool._id, {
        isAvailable: true,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.automations.dispatchLoanWebhook, {
      loanId: loan._id,
      eventType: "status_changed_webhook",
    });

    return { loanId: loan._id, status: "returned" };
  },
});

export const listMyLoans = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);

    const [borrowerLoans, lenderLoans] = await Promise.all([
      ctx.db
        .query("loanRequests")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
        .order("desc")
        .collect(),
      ctx.db
        .query("loanRequests")
        .withIndex("by_lender", (q) => q.eq("lenderId", user._id))
        .order("desc")
        .collect(),
    ]);

    const [myRequests, incomingRequests] = await Promise.all([
      enrichLoans(ctx, borrowerLoans),
      enrichLoans(ctx, lenderLoans),
    ]);

    return { myRequests, incomingRequests };
  },
});

export const adminListAllLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const allLoans = await ctx.db.query("loanRequests").order("desc").collect();
    return await enrichLoans(ctx, allLoans);
  },
});
