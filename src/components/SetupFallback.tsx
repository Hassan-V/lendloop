"use client";

import { Wrench, ShieldCheck, Lock, Terminal } from "lucide-react";
import { CATEGORY_LABELS } from "./formatRelativeTime";

const PREVIEW_PUBLIC_TOOLS = [
  { id: "1", name: "DeWalt 20V Cordless Drill", category: "power_tools" },
  { id: "2", name: "Fiskars Telescoping Tree Pruner", category: "garden" },
  { id: "3", name: "2-Burner Propane Camp Stove", category: "camping" },
  { id: "4", name: "KitchenAid Stand Mixer", category: "kitchen" },
];

export function SetupFallback() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
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
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <Terminal className="h-3.5 w-3.5" />
            Configure .env.local to connect Clerk + Convex
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
          <p className="font-semibold">Local Environment Setup Needed</p>
          <p className="mt-1 text-amber-800">
            Copy <code>.env.example</code> to <code>.env.local</code>, add your
            Clerk Publishable/Secret keys, and run <code>npx convex dev</code> to
            populate <code>NEXT_PUBLIC_CONVEX_URL</code>. Meanwhile, see the
            README for architecture, RBAC, and Docker n8n instructions.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">
                Neighborhood Available Tools (Public Preview)
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5 text-emerald-600" />
                Data minimization enforced: only tool name and category are
                exposed publicly.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white opacity-75">
              <ShieldCheck className="h-4 w-4" />
              Sign in to lend or borrow
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PREVIEW_PUBLIC_TOOLS.map((tool) => (
              <div
                key={tool.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 p-4"
              >
                <span className="font-medium text-slate-900">{tool.name}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  {CATEGORY_LABELS[tool.category] ?? tool.category}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
