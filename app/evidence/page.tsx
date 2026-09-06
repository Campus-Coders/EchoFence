import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { EvidenceDashboard } from "@/components/evidence/EvidenceDashboard";

export const metadata: Metadata = {
  title: "EchoFence Evidence — Judge Proof Dashboard & Authority Verification",
  description:
    "Machine-derived verification and deterministic stress replay proving EchoFence voice generation authority.",
};

export default function EvidencePage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Shield size={20} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-100">
                ECHOFENCE EVIDENCE
              </h1>
              <p className="text-[11px] font-mono text-cyan-400">
                DataForge 2026 x Rime Hackathon Release Candidate
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/console"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-slate-100 transition"
              data-testid="link-back-console"
            >
              <ArrowLeft size={14} />
              <span>Voice Console</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Evidence Container */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <EvidenceDashboard />
      </div>
    </main>
  );
}
