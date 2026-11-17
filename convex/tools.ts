import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  assertToolOwnerOnly,
  requireAdmin,
  requireAuthenticatedUser,
  sanitizePublicTool,
} from "./lib/rbac";

export const TOOL_CATEGORIES = [
  "power_tools",
  "garden",
  "kitchen",
  "camping",
  "automotive",
  "other",
] as const;

export const listPublic = query({
  args: {
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allAvailable = await ctx.db
      .query("tools")
      .withIndex("by_available", (q) => q.eq("isAvailable", true))
      .collect();

    const filtered =
      args.category && args.category !== "all"
        ? allAvailable.filter((t) => t.category === args.category)
        : allAvailable;

    // Strict server-side data minimization: strips ownerId, condition, description
    return filtered.map((tool) => sanitizePublicTool(tool));
  },
});

export const listAuthenticated = query({
  args: {
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireAuthenticatedUser(ctx);

    const tools =
      args.category && args.category !== "all"
        ? await ctx.db
            .query("tools")
            .withIndex("by_category", (q) => q.eq("category", args.category!))
            .collect()
        : await ctx.db.query("tools").collect();

    const ownerIds = [...new Set(tools.map((t) => t.ownerId))];
    const ownerDocs = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const ownerMap = new Map(
      ownerDocs.filter(Boolean).map((u) => [String(u!._id), u!])
    );

    return tools.map((tool) => {
      const owner = ownerMap.get(String(tool.ownerId));
      return {
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        isAvailable: tool.isAvailable,
        ownerName: owner?.name ?? "Neighbor",
        lenderTrusted: owner?.isTrustedLender ?? false,
        isOwner: String(tool.ownerId) === String(viewer._id),
        createdAt: tool.createdAt,
      };
    });
  },
});

export const listMyTools = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    return await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
  },
});

export const createTool = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"tools">> => {
    const user = await requireAuthenticatedUser(ctx);
    const name = args.name.trim();
    const description = args.description.trim();
    if (name.length < 2 || name.length > 80) {
      throw new Error("Tool name must be between 2 and 80 characters");
    }
    if (description.length < 5 || description.length > 500) {
      throw new Error("Short description must be between 5 and 500 characters");
    }

    const now = Date.now();
    return await ctx.db.insert("tools", {
      name,
      category: args.category.trim(),
      condition: args.condition.trim(),
      description,
      ownerId: user._id,
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTool = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args): Promise<{ toolId: Id<"tools"> }> => {
    const user = await requireAuthenticatedUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new Error("Tool listing not found");
    }
    assertToolOwnerOnly(user, tool);

    await ctx.db.patch(args.toolId, {
      name: args.name.trim(),
      category: args.category.trim(),
      condition: args.condition.trim(),
      description: args.description.trim(),
      updatedAt: Date.now(),
    });
    return { toolId: args.toolId };
  },
});

export const deleteTool = mutation({
  args: {
    toolId: v.id("tools"),
  },
  handler: async (ctx, args): Promise<{ deleted: true }> => {
    const user = await requireAuthenticatedUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new Error("Tool listing not found");
    }
    assertToolOwnerOnly(user, tool);

    const relatedLoans = await ctx.db
      .query("loanRequests")
      .withIndex("by_tool", (q) => q.eq("toolId", args.toolId))
      .collect();

    if (relatedLoans.some((loan) => loan.status === "approved")) {
      throw new Error("Cannot delete a tool while an approved loan is active");
    }

    const now = Date.now();
    for (const loan of relatedLoans) {
      if (loan.status === "pending") {
        await ctx.db.patch(loan._id, { status: "declined", updatedAt: now });
      }
    }

    await ctx.db.delete(args.toolId);
    return { deleted: true };
  },
});

export const adminRemoveTool = mutation({
  args: {
    toolId: v.id("tools"),
  },
  handler: async (ctx, args): Promise<{ removed: true }> => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new Error("Tool listing not found");
    }

    const relatedLoans = await ctx.db
      .query("loanRequests")
      .withIndex("by_tool", (q) => q.eq("toolId", args.toolId))
      .collect();

    const now = Date.now();
    for (const loan of relatedLoans) {
      if (loan.status === "pending") {
        await ctx.db.patch(loan._id, { status: "declined", updatedAt: now });
      }
    }

    await ctx.db.delete(args.toolId);
    return { removed: true };
  },
});
