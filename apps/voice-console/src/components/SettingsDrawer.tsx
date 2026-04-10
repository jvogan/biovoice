import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type {
  AuthSnapshot,
  GuardrailsSnapshot,
  RuntimeSnapshot,
  SettingsTab,
  UsageSnapshot,
} from "./types";

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  runtimeHealth: RuntimeSnapshot;
  auth: AuthSnapshot;
  guardrails: GuardrailsSnapshot;
  usage?: UsageSnapshot;
  activeTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  workflowsContent?: React.ReactNode;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "workflows", label: "Workflows" },
  { id: "usage", label: "Usage" },
];

export function SettingsDrawer(props: SettingsDrawerProps) {
  const {
    open,
    onClose,
    runtimeHealth,
    auth,
    guardrails,
    usage,
    activeTab = "runtime",
    onTabChange,
    workflowsContent,
  } = props;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-zinc-950/30 dark:bg-zinc-950/60 backdrop-blur-sm z-40"
          />
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 w-[480px] max-w-full bg-zinc-50 dark:bg-zinc-950 border-l border-zinc-300/80 dark:border-zinc-800/80 shadow-2xl z-50 flex flex-col"
            role="dialog"
            aria-label="Settings"
          >
            <div className="h-16 border-b border-zinc-300/80 dark:border-zinc-800/80 flex items-center justify-between px-6 shrink-0">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-zinc-300/80 dark:border-zinc-800/80 shrink-0">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange?.(tab.id)}
                    className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? "text-cyan-600 dark:text-cyan-400 border-b-2 border-cyan-500"
                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === "runtime" ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
                      Runtime
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard label="Data Channel" value={runtimeHealth.data} />
                      <StatCard label="Event Stream" value={runtimeHealth.eventStream} />
                      <StatCard label="Controller" value={runtimeHealth.controller} />
                      <StatCard label="Phase" value={runtimeHealth.phase} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
                      Auth
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard
                        label="Realtime Key"
                        value={auth.realtimeKey}
                        tone={auth.realtimeValid ? "ok" : "warn"}
                      />
                      <StatCard
                        label="Realtime Auth"
                        value={auth.realtimeValid ? "Valid" : "Unverified"}
                        tone={auth.realtimeValid ? "ok" : "warn"}
                      />
                      <StatCard
                        label="Usage Key"
                        value={auth.usageKey}
                        tone={auth.usageValid ? "ok" : "warn"}
                      />
                      <StatCard
                        label="Usage Scope"
                        value={auth.usageValid ? "Valid" : "Untested"}
                        tone={auth.usageValid ? "ok" : "warn"}
                      />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
                      Session Guardrails
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard
                        label="Voice Mode"
                        value={guardrails.voiceMode === "push_to_talk" ? "Push-to-Talk" : "Open Mic"}
                        tone={guardrails.voiceMode === "push_to_talk" ? "ok" : "warn"}
                      />
                      <StatCard label="Idle Disconnect" value={formatSeconds(guardrails.idleDisconnectSeconds)} />
                      <StatCard label="Session Cap" value={`${guardrails.maxSessionMinutes}m`} />
                      <StatCard label="Responses" value={String(guardrails.maxResponsesPerSession)} />
                      <StatCard label="Transcriptions" value={String(guardrails.maxTranscriptionsPerSession)} />
                      <StatCard
                        label="Billable Tokens"
                        value={guardrails.maxBillableTokensPerSession.toLocaleString()}
                      />
                      <StatCard
                        label="Active Sessions"
                        value={String(guardrails.maxActiveSessions)}
                      />
                    </div>
                    <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      Guardrails warn at {Math.round(guardrails.warningRatio * 100)}% of the configured session caps, disconnect the session if it crosses a limit, and refuse to open more than {guardrails.maxActiveSessions} Realtime session{guardrails.maxActiveSessions === 1 ? "" : "s"} at once.
                    </p>
                  </div>
                </div>
              ) : null}

              {activeTab === "workflows" ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {workflowsContent ?? "Workflow dossier content will appear here."}
                </div>
              ) : null}

              {activeTab === "usage" ? (
                <div className="space-y-3">
                  {usage ? (
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard label="Current Month" value={usage.currentMonth ?? "—"} />
                      <StatCard
                        label="Spent (USD)"
                        value={usage.dollarsSpent != null ? `$${usage.dollarsSpent.toFixed(2)}` : "—"}
                      />
                      <StatCard
                        label="Total Tokens"
                        value={usage.totalTokens != null ? usage.totalTokens.toLocaleString() : "—"}
                      />
                      <StatCard
                        label="Session Responses"
                        value={guardrails.currentResponses != null ? String(guardrails.currentResponses) : "—"}
                        tone={guardrails.warningActive ? "warn" : "neutral"}
                      />
                      <StatCard
                        label="Session Transcripts"
                        value={guardrails.currentTranscriptions != null ? String(guardrails.currentTranscriptions) : "—"}
                        tone={guardrails.warningActive ? "warn" : "neutral"}
                      />
                      <StatCard
                        label="Session Billable"
                        value={guardrails.currentBillableTokens != null ? guardrails.currentBillableTokens.toLocaleString() : "—"}
                        tone={guardrails.warningActive ? "warn" : "neutral"}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-500 dark:text-zinc-600 italic">
                        No organization usage data yet. Connect the OpenAI usage endpoint to populate the rolling cost summary.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <StatCard
                          label="Session Responses"
                          value={guardrails.currentResponses != null ? String(guardrails.currentResponses) : "—"}
                          tone={guardrails.warningActive ? "warn" : "neutral"}
                        />
                        <StatCard
                          label="Session Transcripts"
                          value={guardrails.currentTranscriptions != null ? String(guardrails.currentTranscriptions) : "—"}
                          tone={guardrails.warningActive ? "warn" : "neutral"}
                        />
                        <StatCard
                          label="Session Billable"
                          value={guardrails.currentBillableTokens != null ? guardrails.currentBillableTokens.toLocaleString() : "—"}
                          tone={guardrails.warningActive ? "warn" : "neutral"}
                        />
                        <StatCard
                          label="Warning Threshold"
                          value={`${Math.round(guardrails.warningRatio * 100)}%`}
                        />
                      </div>
                    </>
                  )}
                  {guardrails.warningMessage || guardrails.breachMessage ? (
                    <p className={`text-sm leading-relaxed ${guardrails.breachMessage ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}>
                      {guardrails.breachMessage ?? guardrails.warningMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function formatSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "Off";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) {
    return `${seconds}s`;
  }
  if (!seconds) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn" | "error";
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "text-zinc-900 dark:text-zinc-100",
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    error: "text-rose-600 dark:text-rose-400",
  };
  return (
    <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-300/80 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500 mb-1">
        {label}
      </div>
      <div className={`text-sm font-mono font-medium ${toneClasses[tone]}`}>{value}</div>
    </div>
  );
}
