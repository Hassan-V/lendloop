import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAdmin } from "./lib/rbac";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysOffset(offsetDays: number, nowMs: number): string {
  return new Date(nowMs + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

async function seedDatabase(ctx: MutationCtx): Promise<{
  seeded: boolean;
  message: string;
  usersCreated: number;
  toolsCreated: number;
  loansCreated: number;
}> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", "seed_maya"))
    .unique();

  if (existing) {
    return {
      seeded: false,
      message: "Demo neighborhood data already seeded",
      usersCreated: 0,
      toolsCreated: 0,
      loansCreated: 0,
    };
  }

  const now = Date.now();

  const mayaId = await ctx.db.insert("users", {
    clerkId: "seed_maya",
    email: "maya.lin@example.com",
    name: "Maya Lin",
    role: "user",
    isTrustedLender: true,
    createdAt: now - 30 * DAY_MS,
  });

  const liamId = await ctx.db.insert("users", {
    clerkId: "seed_liam",
    email: "liam.patel@example.com",
    name: "Liam Patel",
    role: "user",
    isTrustedLender: true,
    createdAt: now - 25 * DAY_MS,
  });

  const elenaId = await ctx.db.insert("users", {
    clerkId: "seed_elena",
    email: "elena.rostova@example.com",
    name: "Elena Rostova",
    role: "user",
    isTrustedLender: false,
    createdAt: now - 14 * DAY_MS,
  });

  const toolSeeds: Array<{
    name: string;
    category: string;
    condition: string;
    description: string;
    ownerId: Id<"users">;
    isAvailable: boolean;
  }> = [
    {
      name: "DeWalt 20V Brushless Hammer Drill",
      category: "power_tools",
      condition: "like_new",
      description: "Includes two 5Ah batteries, charger, and masonry bit kit.",
      ownerId: mayaId,
      isAvailable: true,
    },
    {
      name: "Fiskars Telescoping Tree Pruner",
      category: "garden",
      condition: "good",
      description: "Extends up to 12 ft; clean bypass blade for backyard limbs.",
      ownerId: liamId,
      isAvailable: true,
    },
    {
      name: "KitchenAid Artisan 5-Qt Stand Mixer",
      category: "kitchen",
      condition: "like_new",
      description: "Comes with dough hook, flat beater, and wire whip.",
      ownerId: elenaId,
      isAvailable: true,
    },
    {
      name: "Coleman 2-Burner Propane Camp Stove",
      category: "camping",
      condition: "good",
      description: "Wind-block panels included; bring your own 16 oz cylinder.",
      ownerId: liamId,
      isAvailable: true,
    },
    {
      name: "OBD-II Bluetooth Car Diagnostic Scanner",
      category: "automotive",
      condition: "like_new",
      description: "Reads check-engine fault codes on any post-1996 vehicle.",
      ownerId: mayaId,
      isAvailable: true,
    },
    {
      name: "Bosch Orbital Wood Sander",
      category: "power_tools",
      condition: "good",
      description: "5-inch hook-and-loop pad with 80/120/220 grit sanding discs.",
      ownerId: mayaId,
      isAvailable: true,
    },
    {
      name: "Sun Joe 2030 PSI Electric Pressure Washer",
      category: "garden",
      condition: "good",
      description: "Includes 20-ft hose and 15/25/40 degree quick-connect nozzles.",
      ownerId: mayaId,
      isAvailable: false,
    },
  ];

  const toolIds: Id<"tools">[] = [];
  for (const t of toolSeeds) {
    toolIds.push(
      await ctx.db.insert("tools", {
        ...t,
        createdAt: now - 10 * DAY_MS,
        updatedAt: now - 2 * DAY_MS,
      })
    );
  }

  const kitchenMixerId = toolIds[2];
  const boschSanderId = toolIds[5];
  const pressureWasherId = toolIds[6];

  // 1. Overdue approved loan (due 3 days ago, 1 reminder sent 2 days ago)
  const twoDaysAgo = now - 2 * DAY_MS;
  const overdueLoanId = await ctx.db.insert("loanRequests", {
    toolId: pressureWasherId,
    lenderId: mayaId,
    borrowerId: elenaId,
    startDate: isoDaysOffset(-10, now),
    endDate: isoDaysOffset(-3, now),
    status: "approved",
    note: "Washing patio pavers before weekend guests arrive.",
    lastReminderSentAt: twoDaysAgo,
    reminderCount: 1,
    createdAt: now - 11 * DAY_MS,
    updatedAt: twoDaysAgo,
  });

  // 2. Pending request (waiting for approval)
  const pendingLoanId = await ctx.db.insert("loanRequests", {
    toolId: boschSanderId,
    lenderId: mayaId,
    borrowerId: elenaId,
    startDate: isoDaysOffset(1, now),
    endDate: isoDaysOffset(4, now),
    status: "pending",
    note: "Refinishing our cedar porch bench this weekend.",
    reminderCount: 0,
    createdAt: now - 3 * 60 * 60 * 1000,
    updatedAt: now - 3 * 60 * 60 * 1000,
  });

  // 3. Returned historical loan
  const returnedLoanId = await ctx.db.insert("loanRequests", {
    toolId: kitchenMixerId,
    lenderId: elenaId,
    borrowerId: liamId,
    startDate: isoDaysOffset(-14, now),
    endDate: isoDaysOffset(-12, now),
    status: "returned",
    note: "Baking sourdough focaccia for block potluck.",
    reminderCount: 0,
    createdAt: now - 15 * DAY_MS,
    updatedAt: now - 12 * DAY_MS,
  });

  await ctx.db.insert("automationEvents", {
    loanId: overdueLoanId,
    eventType: "overdue_reminder_sent",
    idempotencyKey: `overdue:${overdueLoanId}:${isoDaysOffset(-2, now)}`,
    summary: `Overdue reminder sent for Sun Joe 2030 PSI Electric Pressure Washer`,
    status: "delivered",
    createdAt: twoDaysAgo,
  });

  await ctx.db.insert("automationEvents", {
    loanId: pendingLoanId,
    eventType: "request_created_webhook",
    summary: "Request notification sent to lender",
    status: "delivered",
    createdAt: now - 3 * 60 * 60 * 1000,
  });

  await ctx.db.insert("automationEvents", {
    loanId: returnedLoanId,
    eventType: "status_changed_webhook",
    summary: "Status update (returned) delivered",
    status: "delivered",
    createdAt: now - 12 * DAY_MS,
  });

  return {
    seeded: true,
    message: "Demo neighborhood users, tools, loans, and automation events seeded",
    usersCreated: 3,
    toolsCreated: toolIds.length,
    loansCreated: 3,
  };
}

export const seedDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await seedDatabase(ctx);
  },
});

export const adminSeedDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await seedDatabase(ctx);
  },
});
