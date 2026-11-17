import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    isTrustedLender: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),

  tools: defineTable({
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
    ownerId: v.id("users"),
    isAvailable: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"])
    .index("by_available", ["isAvailable"]),

  loanRequests: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned")
    ),
    note: v.optional(v.string()),
    lastReminderSentAt: v.optional(v.number()),
    reminderCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_lender", ["lenderId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status", ["status"]),

  automationEvents: defineTable({
    loanId: v.optional(v.id("loanRequests")),
    eventType: v.union(
      v.literal("request_created_webhook"),
      v.literal("status_changed_webhook"),
      v.literal("overdue_reminder_sent"),
      v.literal("webhook_failed")
    ),
    idempotencyKey: v.optional(v.string()),
    summary: v.string(),
    status: v.union(
      v.literal("delivered"),
      v.literal("retrying"),
      v.literal("failed")
    ),
    createdAt: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_idempotency_key", ["idempotencyKey"]),
});
