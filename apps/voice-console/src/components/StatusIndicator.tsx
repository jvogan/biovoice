import type { ConnectionState } from "./types";

const COLORS: Record<ConnectionState, string> = {
  offline: "bg-zinc-400 dark:bg-zinc-600",
  connecting: "bg-amber-500 animate-pulse",
  connected: "bg-emerald-500",
  error: "bg-rose-500",
};

const LABELS: Record<ConnectionState, string> = {
  offline: "Offline",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection Error",
};

export function StatusIndicator({ state }: { state: ConnectionState }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-200/50 dark:bg-zinc-900/50 border border-zinc-300/80 dark:border-zinc-800 shadow-sm dark:shadow-none">
      <div className={`w-2 h-2 rounded-full ${COLORS[state]}`} />
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{LABELS[state]}</span>
    </div>
  );
}
