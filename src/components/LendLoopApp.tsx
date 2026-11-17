"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Calendar,
  Lock,
  Pencil,
  Plus,
  Shield,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AdminPanel } from "./AdminPanel";
import { CATEGORY_LABELS, CONDITION_LABELS } from "./formatRelativeTime";
import { LoanCard, type EnrichedLoanItem } from "./LoanCard";

type ActiveTab = "browse" | "my_listings" | "my_requests" | "incoming" | "admin";

export function LendLoopApp() {
  const { isSignedIn, isLoaded } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading LendLoop...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                LendLoop
              </span>
              <p className="text-xs text-slate-500">
                Borrow what you need. Lend what you don&apos;t.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <UserButton afterSignOutUrl="/" />
            ) : (
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-800"
                >
                  Sign in to lend or borrow
                </button>
              </SignInButton>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {!isSignedIn ? (
          <PublicToolsView
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        ) : (
          <AuthenticatedDashboard
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        )}
      </main>
    </div>
  );
}

function PublicToolsView({
  selectedCategory,
  onSelectCategory,
}: {
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
}) {
  const publicTools = useQuery(api.tools.listPublic, {
    category: selectedCategory,
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Available Neighborhood Tools
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="h-3.5 w-3.5 text-emerald-700" />
            Read-only public view: strictly shows tool name and category (no
            owner details).
          </p>
        </div>

        <select
          aria-label="Filter public tools by category"
          value={selectedCategory}
          onChange={(e) => onSelectCategory(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {publicTools === undefined ? (
        <p className="py-8 text-center text-sm text-slate-500">
          Loading neighborhood board...
        </p>
      ) : publicTools.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          No tools listed in this category yet. Sign in to share your first tool!
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {publicTools.map((tool) => (
            <div
              key={tool._id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4"
            >
              <span className="font-medium text-slate-900">{tool.name}</span>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                {CATEGORY_LABELS[tool.category] ?? tool.category}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AuthenticatedDashboard({
  selectedCategory,
  onSelectCategory,
}: {
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
}) {
  const syncUser = useMutation(api.users.syncCurrentUser);
  const profile = useQuery(api.users.currentProfile);

  const [tab, setTab] = useState<ActiveTab>("browse");
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!synced) {
      syncUser()
        .then(() => setSynced(true))
        .catch(() => setSynced(true));
    }
  }, [syncUser, synced]);

  const tools = useQuery(
    api.tools.listAuthenticated,
    profile ? { category: selectedCategory } : "skip"
  );
  const myTools = useQuery(api.tools.listMyTools, profile ? {} : "skip");
  const myLoans = useQuery(api.loans.listMyLoans, profile ? {} : "skip");

  const createTool = useMutation(api.tools.createTool);
  const updateTool = useMutation(api.tools.updateTool);
  const deleteTool = useMutation(api.tools.deleteTool);
  const requestBorrow = useMutation(api.loans.requestBorrow);
  const respondToRequest = useMutation(api.loans.respondToRequest);
  const markReturned = useMutation(api.loans.markReturned);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  // Add / Edit Tool state
  const [editingToolId, setEditingToolId] = useState<Id<"tools"> | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolCategory, setToolCategory] = useState("power_tools");
  const [toolCondition, setToolCondition] = useState("good");
  const [toolDescription, setToolDescription] = useState("");

  // Borrow modal state
  const [borrowTarget, setBorrowTarget] = useState<{
    _id: Id<"tools">;
    name: string;
  } | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [borrowNote, setBorrowNote] = useState("");

  if (!profile) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        Initializing neighborhood profile...
      </div>
    );
  }

  async function handleSaveTool(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setBusyId("save_tool");
    try {
      if (editingToolId) {
        await updateTool({
          toolId: editingToolId,
          name: toolName,
          category: toolCategory,
          condition: toolCondition,
          description: toolDescription,
        });
        setFeedback({ type: "ok", text: "Tool listing updated." });
      } else {
        await createTool({
          name: toolName,
          category: toolCategory,
          condition: toolCondition,
          description: toolDescription,
        });
        setFeedback({ type: "ok", text: "Tool published to LendLoop." });
      }
      setEditingToolId(null);
      setToolName("");
      setToolDescription("");
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Unable to save tool",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteTool(toolId: Id<"tools">) {
    setBusyId(toolId);
    setFeedback(null);
    try {
      await deleteTool({ toolId });
      setFeedback({ type: "ok", text: "Listing deleted." });
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Unable to delete tool",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleSubmitBorrow(e: React.FormEvent) {
    e.preventDefault();
    if (!borrowTarget) return;
    setBusyId(borrowTarget._id);
    setFeedback(null);
    try {
      await requestBorrow({
        toolId: borrowTarget._id,
        startDate,
        endDate,
        note: borrowNote || undefined,
      });
      setBorrowTarget(null);
      setBorrowNote("");
      setFeedback({
        type: "ok",
        text: "Borrow request submitted and owner notification queued.",
      });
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Borrow request failed",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRespond(
    loanId: string,
    decision: "approved" | "declined"
  ) {
    setBusyId(loanId);
    setFeedback(null);
    try {
      await respondToRequest({
        loanId: loanId as Id<"loanRequests">,
        decision,
      });
      setFeedback({ type: "ok", text: `Loan request ${decision}.` });
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkReturned(loanId: string) {
    setBusyId(loanId);
    setFeedback(null);
    try {
      await markReturned({ loanId: loanId as Id<"loanRequests"> });
      setFeedback({ type: "ok", text: "Tool marked returned." });
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusyId(null);
    }
  }

  const incomingCount = (myLoans?.incomingRequests ?? []).filter(
    (l) => l.status === "pending"
  ).length;

  return (
    <div className="space-y-6">
      {/* User identity bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate-900">
            Welcome, {profile.name}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-700">
            {profile.role}
          </span>
          {profile.isTrustedLender && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              <BadgeCheck className="h-3.5 w-3.5" />
              Trusted Lender
            </span>
          )}
        </div>

        <nav className="flex flex-wrap gap-1.5">
          {(
            [
              ["browse", "Browse Tools"],
              ["my_listings", "My Listings"],
              ["my_requests", "My Requests"],
              [
                "incoming",
                incomingCount > 0
                  ? `Incoming Requests (${incomingCount})`
                  : "Incoming Requests",
              ],
            ] as Array<[ActiveTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === key
                  ? "bg-emerald-700 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
          {profile.role === "admin" && (
            <button
              type="button"
              onClick={() => setTab("admin")}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === "admin"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              Admin
            </button>
          )}
        </nav>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            feedback.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* BROWSE TAB */}
      {tab === "browse" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">
              Neighborhood Tool Directory
            </h1>
            <select
              aria-label="Filter tools by category"
              value={selectedCategory}
              onChange={(e) => onSelectCategory(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(tools ?? []).map((tool) => (
              <div
                key={tool._id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">
                      {tool.name}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        tool.isAvailable
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {tool.isAvailable ? "Available" : "On Loan"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                      {CATEGORY_LABELS[tool.category] ?? tool.category}
                    </span>
                    <span>
                      Condition:{" "}
                      {CONDITION_LABELS[tool.condition] ?? tool.condition}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    {tool.description}
                  </p>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                    <span>Owner: {tool.ownerName}</span>
                    {tool.lenderTrusted && (
                      <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Trusted Lender
                      </span>
                    )}
                  </div>
                  {!tool.isOwner && tool.isAvailable && (
                    <button
                      type="button"
                      onClick={() =>
                        setBorrowTarget({ _id: tool._id, name: tool.name })
                      }
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800"
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      Request to Borrow
                    </button>
                  )}
                  {tool.isOwner && (
                    <span className="block text-center text-xs font-medium text-slate-400">
                      Your listing
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {tools && tools.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No tools in this category yet.
            </p>
          )}
        </section>
      )}

      {/* MY LISTINGS TAB */}
      {tab === "my_listings" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <form
            onSubmit={handleSaveTool}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 h-fit"
          >
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
              <Plus className="h-4 w-4 text-emerald-700" />
              {editingToolId ? "Edit Tool Listing" : "List a Tool to Lend"}
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Tool Name
              </label>
              <input
                required
                minLength={2}
                maxLength={80}
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                placeholder="e.g. Makita Cordless Impact Driver"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Category
                </label>
                <select
                  value={toolCategory}
                  onChange={(e) => setToolCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                >
                  {Object.entries(CATEGORY_LABELS)
                    .filter(([k]) => k !== "all")
                    .map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Condition
                </label>
                <select
                  value={toolCondition}
                  onChange={(e) => setToolCondition(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                >
                  {Object.entries(CONDITION_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Short Description
              </label>
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={toolDescription}
                onChange={(e) => setToolDescription(e.target.value)}
                placeholder="Includes battery & charger; porch pickup."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busyId === "save_tool"}
                className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {editingToolId ? "Save Changes" : "Publish Listing"}
              </button>
              {editingToolId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingToolId(null);
                    setToolName("");
                    setToolDescription("");
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              Your Published Tools ({myTools?.length ?? 0})
            </h2>
            {(myTools ?? []).map((tool) => (
              <div
                key={tool._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {tool.name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        tool.isAvailable
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {tool.isAvailable ? "Available" : "Out on loan"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {CATEGORY_LABELS[tool.category] ?? tool.category} |{" "}
                    {CONDITION_LABELS[tool.condition] ?? tool.condition}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {tool.description}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingToolId(tool._id);
                      setToolName(tool.name);
                      setToolCategory(tool.category);
                      setToolCondition(tool.condition);
                      setToolDescription(tool.description);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === tool._id}
                    onClick={() => handleDeleteTool(tool._id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MY REQUESTS TAB */}
      {tab === "my_requests" && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            My Borrow Requests
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {(myLoans?.myRequests ?? []).map((loan) => (
              <LoanCard
                key={loan._id}
                loan={loan as unknown as EnrichedLoanItem}
                mode="borrower"
                onMarkReturned={handleMarkReturned}
                busyId={busyId}
              />
            ))}
          </div>
          {myLoans && myLoans.myRequests.length === 0 && (
            <p className="text-sm text-slate-500">
              You haven&apos;t requested to borrow any tools yet.
            </p>
          )}
        </section>
      )}

      {/* INCOMING REQUESTS TAB */}
      {tab === "incoming" && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            Incoming Requests on Your Tools
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {(myLoans?.incomingRequests ?? []).map((loan) => (
              <LoanCard
                key={loan._id}
                loan={loan as unknown as EnrichedLoanItem}
                mode="lender"
                onRespond={handleRespond}
                onMarkReturned={handleMarkReturned}
                busyId={busyId}
              />
            ))}
          </div>
          {myLoans && myLoans.incomingRequests.length === 0 && (
            <p className="text-sm text-slate-500">
              No neighbors have requested your tools yet.
            </p>
          )}
        </section>
      )}

      {/* ADMIN TAB */}
      {tab === "admin" && profile.role === "admin" && (
        <AdminPanel
          allTools={(tools ?? []).map((t) => ({
            _id: t._id,
            name: t.name,
            category: t.category,
            ownerName: t.ownerName,
            isAvailable: t.isAvailable,
          }))}
        />
      )}

      {/* Borrow Request Modal */}
      {borrowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSubmitBorrow}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Request to Borrow: {borrowTarget.name}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Return Date
                </label>
                <input
                  type="date"
                  required
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Note to Neighbor (Optional)
              </label>
              <textarea
                rows={2}
                maxLength={240}
                value={borrowNote}
                onChange={(e) => setBorrowNote(e.target.value)}
                placeholder="Putting up shelves this weekend — can pick up Saturday morning."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBorrowTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === borrowTarget._id}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Send Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
