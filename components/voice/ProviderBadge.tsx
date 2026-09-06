"use client";

import React, { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import type { SafeProviderStatus } from "@/types/provider";

export type ProviderBadgeProps = {
  initialStatus?: SafeProviderStatus | null;
};

export function ProviderBadge({
  initialStatus = null,
}: ProviderBadgeProps): React.JSX.Element {
  const [status, setStatus] = useState<SafeProviderStatus | null>(initialStatus);
  const [loading, setLoading] = useState<boolean>(!initialStatus);

  useEffect(() => {
    let isMounted = true;

    async function fetchStatus(): Promise<void> {
      try {
        const res = await fetch("/api/voice/status");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          success: boolean;
          data?: SafeProviderStatus;
        };

        if (isMounted && json.success && json.data) {
          setStatus(json.data);
        }
      } catch (err) {
        console.warn(
          "[voice/provider-badge] Could not fetch dynamic provider status:",
          err
        );
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void fetchStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const isConfigured = status?.configured ?? false;
  const providerName = isConfigured
    ? (status?.provider ?? "Rime")
    : "Not configured";
  const model = status?.selectedModel ?? "—";
  const voice = status?.selectedVoice ?? "—";
  const note =
    status?.note ??
    (isConfigured
      ? "Rime active as primary voice synthesis provider"
      : "RIME_API_KEY not configured. Add to .env.local to activate.");

  return (
    <div className="console-card">
      <div className="console-card-header">
        <span className="console-card-title">
          <Radio size={16} />
          Speech Provider
        </span>
        <span
          className={
            isConfigured ? "status-pill status-pill-ready" : "status-pill"
          }
        >
          <span className={isConfigured ? "status-dot status-dot-pulse" : "status-dot"} />
          {loading ? "Checking..." : isConfigured ? "Connected" : "Not configured"}
        </span>
      </div>
      <div className="provider-box">
        <div className="provider-row">
          <span className="provider-label">Provider:</span>
          <span className="provider-value">{providerName}</span>
        </div>
        <div className="provider-row">
          <span className="provider-label">Model:</span>
          <span className="provider-value">{model}</span>
        </div>
        <div className="provider-row">
          <span className="provider-label">Voice:</span>
          <span className="provider-value">{voice}</span>
        </div>
        <div className="provider-note">{note}</div>
      </div>
    </div>
  );
}
