"use client";

import React from "react";
import {
  Activity,
  Cpu,
  Volume2,
  Radio,
  XCircle,
  Mic,
  ShieldCheck,
  Ban,
  AlertTriangle,
  FileCheck,
  CheckCircle2,
  Zap,
} from "lucide-react";
import type { SystemStatusMetrics } from "@/types/evidence";

interface SystemStatusPanelProps {
  status: SystemStatusMetrics;
}

const SSR_DEFAULT_STATUS: SystemStatusMetrics = {
  currentGeneration: 0,
  generationAuthorityStatus: "IDLE",
  activeAudioPlaybackCount: 0,
  activeStreamingCount: 0,
  activeAbortControllerCount: 0,
  microphoneMonitoringState: "IDLE",
  staleResultAttempts: 0,
  staleResultsBlocked: 0,
  staleResultProtectionRate: 100,
  audioResurrectionCount: 0,
  transcriptCorruptionCount: 0,
  resourceLeakCount: 0,
  chaosSafetyRate: 100,
  timestamp: 0,
};

export function SystemStatusPanel({ status }: SystemStatusPanelProps): React.JSX.Element {
  const [activeStatus, setActiveStatus] = React.useState<SystemStatusMetrics>(SSR_DEFAULT_STATUS);

  React.useEffect(() => {
    setActiveStatus(status);
  }, [status]);

  const currentStatus = activeStatus;

  return (
    <div className="system-status-panel rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur">
      <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-cyan-400" />
          <h3 className="text-base font-semibold tracking-wide text-slate-100">
            SYSTEM STATUS & RUNTIME AUTHORITY
          </h3>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
            currentStatus.generationAuthorityStatus === "ACTIVE"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : currentStatus.generationAuthorityStatus === "INTERRUPTED"
              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              : "bg-slate-700/40 text-slate-400 border border-slate-700"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          Authority: {currentStatus.generationAuthorityStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
        {/* Current Generation */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Cpu size={14} className="text-cyan-400" /> Current Generation
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-slate-100" data-testid="metric-current-generation">
            G{currentStatus.currentGeneration}
          </span>
        </div>

        {/* Active Audio Playback */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Volume2 size={14} className="text-emerald-400" /> Active Audio Nodes
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-slate-100" data-testid="metric-active-audio">
            {currentStatus.activeAudioPlaybackCount}
          </span>
        </div>

        {/* Active Streams */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Radio size={14} className="text-cyan-400" /> Active Streams
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-slate-100" data-testid="metric-active-streams">
            {currentStatus.activeStreamingCount}
          </span>
        </div>

        {/* Active AbortControllers */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <XCircle size={14} className="text-amber-400" /> Active Controllers
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-slate-100" data-testid="metric-active-controllers">
            {currentStatus.activeAbortControllerCount}
          </span>
        </div>

        {/* Microphone Monitoring State */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Mic size={14} className="text-purple-400" /> Mic Monitoring
          </span>
          <span className="mt-1 text-base font-semibold text-slate-200 uppercase" data-testid="metric-mic-state">
            {currentStatus.microphoneMonitoringState}
          </span>
        </div>

        {/* Stale Result Attempts */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <AlertTriangle size={14} className="text-amber-400" /> Stale Attempts
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-slate-100" data-testid="metric-stale-attempts">
            {currentStatus.staleResultAttempts}
          </span>
        </div>

        {/* Stale Results Blocked */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Ban size={14} className="text-emerald-400" /> Stale Blocked
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-emerald-400" data-testid="metric-stale-blocked">
            {currentStatus.staleResultsBlocked}
          </span>
        </div>

        {/* Stale Result Protection Rate */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <ShieldCheck size={14} className="text-emerald-400" /> Protection Rate
          </span>
          <span className="mt-1 text-xl font-mono font-bold text-emerald-400" data-testid="metric-protection-rate">
            {currentStatus.staleResultProtectionRate}%
          </span>
        </div>

        {/* Audio Resurrection Count */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <CheckCircle2 size={14} className="text-emerald-400" /> Audio Resurrections
          </span>
          <span
            className={`mt-1 text-xl font-mono font-bold ${
              currentStatus.audioResurrectionCount === 0 ? "text-emerald-400" : "text-rose-500"
            }`}
            data-testid="metric-audio-resurrections"
          >
            {currentStatus.audioResurrectionCount}
          </span>
        </div>

        {/* Transcript Corruption Count */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <FileCheck size={14} className="text-emerald-400" /> Transcript Corruptions
          </span>
          <span
            className={`mt-1 text-xl font-mono font-bold ${
              currentStatus.transcriptCorruptionCount === 0 ? "text-emerald-400" : "text-rose-500"
            }`}
            data-testid="metric-transcript-corruptions"
          >
            {currentStatus.transcriptCorruptionCount}
          </span>
        </div>

        {/* Resource Leaks Count */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <AlertTriangle size={14} className="text-cyan-400" /> Resource Leaks
          </span>
          <span
            className={`mt-1 text-xl font-mono font-bold ${
              currentStatus.resourceLeakCount === 0 ? "text-emerald-400" : "text-rose-500"
            }`}
            data-testid="metric-resource-leaks"
          >
            {currentStatus.resourceLeakCount}
          </span>
        </div>

        {/* Chaos Safety Rate */}
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Zap size={14} className="text-cyan-400" /> Chaos Safety Rate
          </span>
          <span
            className={`mt-1 text-xl font-mono font-bold ${
              currentStatus.chaosSafetyRate === 100 ? "text-emerald-400" : "text-amber-400"
            }`}
            data-testid="metric-chaos-safety"
          >
            {currentStatus.chaosSafetyRate}%
          </span>
        </div>
      </div>
    </div>
  );
}
