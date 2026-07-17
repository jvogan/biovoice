import { AlertTriangle, Check, Download, ExternalLink, FileJson, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { buildRunReceiptUrl, type RunReceiptSummary } from "../lib/api";

export interface ReceiptsPanelProps {
  receipts: RunReceiptSummary[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}

export function ReceiptsPanel(props: ReceiptsPanelProps) {
  const { receipts, loading, error, onRefresh } = props;

  return (
    <section aria-labelledby="runs-heading">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 id="runs-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent runs</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Local receipts show what ran, what evidence it produced, and whether that run currently owns the one-level undo checkpoint.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh run receipts"
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && receipts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-300/80 dark:border-zinc-800 px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400" role="status">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading recent runs…
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {!loading && !error && receipts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 px-5 py-8 text-center">
          <FileJson className="mx-auto w-6 h-6 text-zinc-400" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">No run receipts yet</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Complete a workflow or voice turn and its receipt will appear here.</p>
        </div>
      ) : null}

      {receipts.length > 0 ? (
        <ol className="space-y-3" aria-label="Recent run receipts">
          {receipts.map((receipt) => {
            const receiptUrl = buildRunReceiptUrl(receipt.id);
            const downloadName = `biovoice-run-${safeFilePart(receipt.id)}.json`;
            return (
              <li key={receipt.id} className="rounded-2xl border border-zinc-300/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/45 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <EvidenceBadge level={receipt.evidenceLevel} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {receipt.target === "pymol" ? "PyMOL" : "ChimeraX"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">{receipt.summary}</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatReceiptDate(receipt.createdAt)}</p>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
                      receipt.checkpointAvailable
                        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                    title={receipt.checkpointAvailable ? "A scene checkpoint was captured for this run" : "This run did not capture a scene checkpoint"}
                  >
                    {receipt.checkpointAvailable ? <RotateCcw className="w-3 h-3" aria-hidden="true" /> : <Check className="w-3 h-3" aria-hidden="true" />}
                    {receipt.checkpointAvailable ? "Checkpoint" : "Recorded"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 dark:border-zinc-800/80 pt-3">
                  <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{receipt.artifacts.length} artifact{receipt.artifacts.length === 1 ? "" : "s"}</span>
                    {receipt.warnings.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        {receipt.warnings.length} warning{receipt.warnings.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <a
                      href={receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      Review JSON
                    </a>
                    <a
                      href={receiptUrl}
                      download={downloadName}
                      aria-label={`Download JSON receipt for ${receipt.summary}`}
                      className="inline-flex items-center rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function EvidenceBadge({ level }: { level: string }) {
  const normalized = level.trim().toLowerCase();
  const classes = normalized.includes("quant") || normalized.includes("measure") || normalized.includes("computed")
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
    : normalized.includes("qual")
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
      : "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${classes}`}>
      {formatEvidenceLevel(level)}
    </span>
  );
}

function formatEvidenceLevel(level: string): string {
  const cleaned = level.trim().replace(/[_-]+/g, " ");
  if (!cleaned) return "Unclassified";
  return cleaned.replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatReceiptDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "receipt";
}
