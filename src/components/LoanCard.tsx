"use client";

import { BadgeCheck, BellRing, Check, RotateCcw, X } from "lucide-react";
import { CATEGORY_LABELS, formatRelativeTime } from "./formatRelativeTime";

export interface AutomationActivityItem {
  _id: string;
  eventType: string;
  summary: string;
  status: string;
  createdAt: number;
}

export interface EnrichedLoanItem {
  _id: string;
  toolId: string;
  toolName: string;
  toolCategory: string;
  lenderName: string;
  lenderTrusted: boolean;
  borrowerName: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "declined" | "returned";
  note?: string;
  lastReminderSentAt?: number;
  reminderCount: number;
  recentAutomationActivity: AutomationActivityItem[];
  createdAt: number;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  declined: "bg-rose-50 text-rose-800 border-rose-200",
  returned: "bg-slate-100 text-slate-700 border-slate-200",
};

export function LoanCard({
  loan,
  mode,
  onRespond,
  onMarkReturned,
  busyId,
}: {
  loan: EnrichedLoanItem;
  mode: "borrower" | "lender" | "admin";
  onRespond?: (loanId: string, decision: "approved" | "declined") => void;
  onMarkReturned?: (loanId: string) => void;
  busyId: string | null;
}) {
  const isBusy = busyId === loan._id;
  const latestEvent = loan.recentAutomationActivity[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">{loan.toolName}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {CATEGORY_LABELS[loan.toolCategory] ?? loan.toolCategory}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Dates:{" "}
            <span className="font-medium text-slate-700">
              {loan.startDate} to {loan.endDate}
            </span>
          </p>
        </div>

        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${
            STATUS_STYLES[loan.status] ?? STATUS_STYLES.pending
          }`}
        >
          {loan.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {mode !== "lender" && (
          <span className="inline-flex items-center gap-1">
            Lender: <strong className="text-slate-800">{loan.lenderName}</strong>
            {loan.lenderTrusted && (
              <span
                title="Verified Trusted Lender"
                className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800"
              >
                <BadgeCheck className="h-3 w-3" />
                Trusted Lender
              </span>
            )}
          </span>
        )}
        {mode !== "borrower" && (
          <span>
            Borrower:{" "}
            <strong className="text-slate-800">{loan.borrowerName}</strong>
          </span>
        )}
      </div>

      {loan.note && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Note: {loan.note}
        </p>
      )}

      {/* Bonus: Recent n8n automation activity directly on the loan */}
      {(loan.lastReminderSentAt || latestEvent) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
          <BellRing className="h-3.5 w-3.5 text-emerald-700" />
          {loan.lastReminderSentAt ? (
            <span className="font-medium text-amber-800">
              Reminder sent {formatRelativeTime(loan.lastReminderSentAt)} (
              {loan.reminderCount} total)
            </span>
          ) : latestEvent ? (
            <span>
              {latestEvent.summary} ({formatRelativeTime(latestEvent.createdAt)})
            </span>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {mode === "lender" && loan.status === "pending" && onRespond && (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onRespond(loan._id, "approved")}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onRespond(loan._id, "declined")}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Decline
            </button>
          </>
        )}

        {loan.status === "approved" && onMarkReturned && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onMarkReturned(loan._id)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Mark Returned
          </button>
        )}
      </div>
    </div>
  );
}
