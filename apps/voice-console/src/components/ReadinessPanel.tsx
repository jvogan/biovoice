import { useEffect, useState } from "react";
import { AlertTriangle, Check, CircleAlert, Clipboard, Loader2, RefreshCw, Terminal } from "lucide-react";
import type { DoctorCheckStatus, DoctorResponse } from "../lib/api";
import type { TargetKind } from "./types";

export interface ReadinessPanelProps {
  doctor: DoctorResponse | null;
  loading: boolean;
  error?: string | null;
  target: TargetKind;
  rehearsalRecipeId?: string;
  onRefresh: () => void;
  onReviewWorkflows: () => void;
}

const STATUS_LABELS: Record<DoctorCheckStatus, string> = {
  ready: "Ready",
  warning: "Needs attention",
  blocked: "Blocked",
};

export function ReadinessPanel(props: ReadinessPanelProps) {
  const { doctor, loading, error, target, rehearsalRecipeId, onRefresh, onReviewWorkflows } = props;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const targetLabel = target === "pymol" ? "PyMOL" : "ChimeraX";
  const targetReady = doctor?.targets[target].ready ?? false;
  const readyChecks = doctor?.checks.filter((check) => check.status === "ready").length ?? 0;
  const totalChecks = doctor?.checks.length ?? 0;
  const defaultRecipeId = target === "pymol" ? "pymol-binding-pocket-story" : "chimerax-ligand-interaction-explainer";
  const rehearsalCommand = `npm run rehearse:workflow -- ${rehearsalRecipeId ?? defaultRecipeId} --target ${target} --dry-run`;

  useEffect(() => {
    setCopyState("idle");
  }, [target]);

  const copyRehearsalCommand = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(rehearsalCommand);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section aria-labelledby="readiness-heading" className="rounded-2xl border border-zinc-300/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/45 overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 id="readiness-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Ready for a first turn
            </h3>
            {doctor ? (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                doctor.ok && targetReady
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              }`}>
                {doctor.ok && targetReady ? "Ready" : "Check setup"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {doctor
              ? `${readyChecks} of ${totalChecks} checks ready · ${targetLabel} ${targetReady ? "responding" : "not ready"}`
              : "Checking the voice and molecular-viewer path."}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh readiness checks"
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="p-4">
        {loading && !doctor ? (
          <div className="flex items-center gap-2 py-3 text-sm text-zinc-500 dark:text-zinc-400" role="status">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking local setup…
          </div>
        ) : null}

        {error && !doctor ? (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300" role="alert">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {error && doctor ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200" role="status">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Could not refresh checks. The last successful snapshot is shown; Undo remains unavailable until the connection recovers.</span>
          </div>
        ) : null}

        {doctor ? (
          <ul className="space-y-2" aria-label="Readiness checks">
            {doctor.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-3 rounded-xl bg-zinc-100/70 dark:bg-zinc-950/50 px-3 py-3">
                <CheckStatusIcon status={check.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{check.label}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${statusTextClass(check.status)}`}>
                      {STATUS_LABELS[check.status]}
                    </span>
                  </div>
                  {check.detail ? (
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{check.detail}</p>
                  ) : null}
                  {check.action ? (
                    <p className="mt-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Next: {check.action}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-3 py-3">
          <div className="flex items-start gap-3">
            <Terminal className="w-4 h-4 mt-0.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Rehearse without voice first</p>
              <code className="mt-1 block overflow-x-auto whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400">
                {rehearsalCommand}
              </code>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void copyRehearsalCommand(); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  {copyState === "copied" ? "Copied" : "Copy rehearsal"}
                </button>
                <button
                  type="button"
                  onClick={onReviewWorkflows}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-cyan-700 hover:bg-cyan-50 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
                >
                  Review workflows
                </button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
                  {copyState === "error" ? "Clipboard unavailable — copy the command above." : ""}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckStatusIcon({ status }: { status: DoctorCheckStatus }) {
  if (status === "ready") {
    return <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  }
  if (status === "warning") {
    return <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
  }
  return <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />;
}

function statusTextClass(status: DoctorCheckStatus): string {
  if (status === "ready") return "text-emerald-600 dark:text-emerald-400";
  if (status === "warning") return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}
