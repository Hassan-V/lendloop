import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type UserRole = "admin" | "user";

export interface PublicToolSummary {
  _id: string;
  name: string;
  category: string;
  isAvailable: boolean;
}

/**
 * Server-side data minimization for the unauthenticated public board.
 * Strips ownerId, condition, description, and timestamps so no PII leaks over the wire.
 */
export function sanitizePublicTool(tool: {
  _id: string;
  name: string;
  category: string;
  isAvailable: boolean;
}): PublicToolSummary {
  return {
    _id: String(tool._id),
    name: tool.name,
    category: tool.category,
    isAvailable: Boolean(tool.isAvailable),
  };
}

export function assertAuthenticatedIdentity<T extends { subject: string }>(
  identity: T | null | undefined
): T {
  if (!identity || !identity.subject) {
    throw new Error("Unauthorized: sign in required");
  }
  return identity;
}

export function assertAdminRole(user: { role: UserRole }): void {
  if (user.role !== "admin") {
    throw new Error("Forbidden: admin role required");
  }
}

export function assertToolOwnerOnly(
  user: { _id: string },
  tool: { ownerId: string }
): void {
  if (String(tool.ownerId) !== String(user._id)) {
    throw new Error("Forbidden: only the listing owner can modify this tool");
  }
}

export function assertToolOwnerOrAdmin(
  user: { _id: string; role: UserRole },
  tool: { ownerId: string }
): void {
  if (user.role === "admin") {
    return;
  }
  assertToolOwnerOnly(user, tool);
}

export function assertLoanParticipant(
  user: { _id: string; role: UserRole },
  loan: { lenderId: string; borrowerId: string }
): void {
  if (user.role === "admin") {
    return;
  }
  const uid = String(user._id);
  if (String(loan.lenderId) !== uid && String(loan.borrowerId) !== uid) {
    throw new Error("Forbidden: not a participant in this loan");
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidDateRange(startDate: string, endDate: string): void {
  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
    throw new Error("Invalid date format: expected YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new Error("Invalid date range: start date must be on or before end date");
  }
}

export async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

/**
 * Derives the authenticated user strictly from the verified Clerk JWT token.
 * Never trusts client-provided user IDs or roles.
 */
export async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  const identity = assertAuthenticatedIdentity(await ctx.auth.getUserIdentity());
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) {
    throw new Error("User profile not synced yet; please reload after signing in");
  }
  return user;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  const user = await requireAuthenticatedUser(ctx);
  assertAdminRole(user);
  return user;
}
