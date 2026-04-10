import { AnimatePresence, motion } from "motion/react";
import type { GuardrailsSnapshot } from "./types";

export interface OpenMicConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  guardrails: GuardrailsSnapshot;
}

export function OpenMicConfirmDialog(props: OpenMicConfirmDialogProps) {
  const { open, onCancel, onConfirm, guardrails } = props;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="open-mic-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onCancel}
            className="fixed inset-0 bg-zinc-950/30 dark:bg-zinc-950/60 backdrop-blur-sm z-50"
          />
          <motion.div
            key="open-mic-dialog"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm open mic"
            className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          >
            <div className="w-full max-w-xl rounded-3xl border border-amber-300/80 dark:border-amber-700/60 bg-zinc-50 dark:bg-zinc-950 shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-zinc-300/80 dark:border-zinc-800/80">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Open mic needs a deliberate opt-in
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Push-to-talk is the lowest-risk mode for accidental spend. Open mic can create billable turns more easily from ambient speech, so BioVoice caps each session and disconnects automatically if it reaches a limit.
                </p>
              </div>

              <div className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <GuardrailCard label="Idle disconnect" value={formatSeconds(guardrails.idleDisconnectSeconds)} />
                  <GuardrailCard label="Session cap" value={`${guardrails.maxSessionMinutes}m`} />
                  <GuardrailCard label="Responses" value={String(guardrails.maxResponsesPerSession)} />
                  <GuardrailCard label="Transcriptions" value={String(guardrails.maxTranscriptionsPerSession)} />
                  <GuardrailCard label="Billable tokens" value={guardrails.maxBillableTokensPerSession.toLocaleString()} />
                  <GuardrailCard label="Active sessions" value={String(guardrails.maxActiveSessions)} />
                  <GuardrailCard label="Warning threshold" value={`${Math.round(guardrails.warningRatio * 100)}%`} />
                </div>

                <div className="rounded-2xl border border-amber-300/70 dark:border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
                  Best practice: start with push-to-talk, switch to open mic only when the room is quiet, and begin a fresh session when you want to reset the cost counters. BioVoice also blocks runaway reconnect churn by refusing to open more than {guardrails.maxActiveSessions} Realtime session{guardrails.maxActiveSessions === 1 ? "" : "s"} at once.
                </div>
              </div>

              <div className="px-6 py-4 border-t border-zinc-300/80 dark:border-zinc-800/80 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 rounded-xl border border-zinc-300/80 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  Stay on Push-to-Talk
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className="px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-500 transition-colors shadow-sm"
                >
                  Enable Open Mic
                </button>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function GuardrailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-300/80 dark:border-zinc-800/80 bg-zinc-100 dark:bg-zinc-900/70 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
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
