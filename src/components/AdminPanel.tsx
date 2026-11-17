"use client";

import { useMutation, useQuery } from "convex/react";
import { BadgeCheck, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS } from "./formatRelativeTime";
import { LoanCard, type EnrichedLoanItem } from "./LoanCard";

export function AdminPanel({
  allTools,
}: {
  allTools: Array<{
    _id: Id<"tools">;
    name: string;
    category: string;
    ownerName: string;
    isAvailable: boolean;
  }>;
}) {
  const allLoans = useQuery(api.loans.adminListAllLoans);
  const allUsers = useQuery(api.users.adminListUsers);
  const removeTool = useMutation(api.tools.adminRemoveTool);
  const setTrustedLender = useMutation(api.users.adminSetTrustedLender);
  const markReturned = useMutation(api.loans.markReturned);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleRemoveTool(toolId: Id<"tools">) {
    setBusyId(toolId);
    setErrorMsg(null);
    try {
      await removeTool({ toolId });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to remove tool");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleTrusted(
    userId: Id<"users">,
    nextState: boolean
  ) {
    setBusyId(userId);
    setErrorMsg(null);
    try {
      await setTrustedLender({ userId, isTrustedLender: nextState });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update lender");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkReturned(loanId: string) {
    setBusyId(loanId);
    setErrorMsg(null);
    try {
      await markReturned({ loanId: loanId as Id<"loanRequests"> });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update loan");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      {errorMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {/* Trusted Lenders Management */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-emerald-700" />
          <h2 className="text-base font-semibold text-slate-900">
            Neighbors & Trusted Lender Verification
          </h2>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {(allUsers ?? []).map((u) => (
            <div
              key={u._id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <div>
                <span className="font-medium text-slate-900">{u.name}</span>
                <span className="ml-2 text-xs text-slate-500">{u.email}</span>
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] uppercase text-slate-600">
                  {u.role}
                </span>
              </div>
              <button
                type="button"
                disabled={busyId === u._id}
                onClick={() => handleToggleTrusted(u._id, !u.isTrustedLender)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  u.isTrustedLender
                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <BadgeCheck className="h-3.5 w-3.5" />
                {u.isTrustedLender
                  ? "Trusted Lender (Revoke)"
                  : "Mark as Trusted Lender"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Moderation: Remove any listing */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          All Listings Moderation
        </h2>
        <div className="mt-4 divide-y divide-slate-100">
          {allTools.map((tool) => (
            <div
              key={tool._id}
              className="flex items-center justify-between gap-2 py-3 text-sm"
            >
              <div>
                <span className="font-medium text-slate-900">{tool.name}</span>
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {CATEGORY_LABELS[tool.category] ?? tool.category}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  Owner: {tool.ownerName}
                </span>
              </div>
              <button
                type="button"
                disabled={busyId === tool._id}
                onClick={() => handleRemoveTool(tool._id)}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove Listing
              </button>
            </div>
          ))}
          {allTools.length === 0 && (
            <p className="py-4 text-sm text-slate-500">No active listings.</p>
          )}
        </div>
      </section>

      {/* All Neighborhood Loans */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          All Neighborhood Loans & Automation Logs
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(allLoans ?? []).map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan as unknown as EnrichedLoanItem}
              mode="admin"
              onMarkReturned={handleMarkReturned}
              busyId={busyId}
            />
          ))}
        </div>
        {allLoans && allLoans.length === 0 && (
          <p className="text-sm text-slate-500">No loan activity yet.</p>
        )}
      </section>
    </div>
  );
}
