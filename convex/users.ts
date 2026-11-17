import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  assertAuthenticatedIdentity,
  getCurrentUserOrNull,
  requireAdmin,
} from "./lib/rbac";

export const syncCurrentUser = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const identity = assertAuthenticatedIdentity(await ctx.auth.getUserIdentity());
    const email = (identity.email ?? "").trim().toLowerCase();
    const name =
      (identity.name ?? identity.nickname ?? email.split("@")[0]) || "Neighbor";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    const initialAdminEmail = (process.env.INITIAL_ADMIN_EMAIL ?? "")
      .trim()
      .toLowerCase();
    const shouldBootstrapAdmin =
      Boolean(initialAdminEmail) && email === initialAdminEmail;

    if (existing) {
      const updates: { name?: string; email?: string; role?: "admin" | "user" } = {};
      if (name && existing.name !== name) updates.name = name;
      if (email && existing.email !== email) updates.email = email;
      if (shouldBootstrapAdmin && existing.role !== "admin") updates.role = "admin";
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      email,
      name,
      role: shouldBootstrapAdmin ? "admin" : "user",
      isTrustedLender: false,
      createdAt: Date.now(),
    });
  },
});

export const currentProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isTrustedLender: user.isTrustedLender,
    };
  },
});

export const adminListUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      isTrustedLender: u.isTrustedLender,
      createdAt: u.createdAt,
    }));
  },
});

export const adminSetTrustedLender = mutation({
  args: {
    userId: v.id("users"),
    isTrustedLender: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; isTrustedLender: boolean }> => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new Error("Target user not found");
    }
    await ctx.db.patch(args.userId, { isTrustedLender: args.isTrustedLender });
    return { userId: args.userId, isTrustedLender: args.isTrustedLender };
  },
});

export const adminSetUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; role: "admin" | "user" }> => {
    const actor = await requireAdmin(ctx);
    if (String(actor._id) === String(args.userId) && args.role !== "admin") {
      throw new Error("Admins cannot demote their own active session");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new Error("Target user not found");
    }
    await ctx.db.patch(args.userId, { role: args.role });
    return { userId: args.userId, role: args.role };
  },
});
