import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  Code2,
  History,
  MessageSquareQuote,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { LogLine } from "./types";

export interface SessionLogProps {
  entries: LogLine[];
  onClear?: () => void;
}

export function SessionLog({ entries, onClear }: SessionLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  return (
    <div className="flex-1 bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-300/60 dark:border-zinc-800/80 rounded-2xl p-5 flex flex-col overflow-hidden shadow-sm dark:shadow-none">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-blue-500 dark:text-blue-400" />
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
            Session Log
          </h2>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            title="Clear log"
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-3">
        {entries.length === 0 ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-600 italic">
            Session is quiet. Connect and speak a command to begin.
          </div>
        ) : (
          entries.map((log) => (
            <div key={log.id} className="flex gap-3 text-sm">
              <div className="w-16 shrink-0 text-xs text-zinc-400 dark:text-zinc-500 font-mono pt-0.5">
                {log.timestamp.toLocaleTimeString([], {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              <div className="flex-1 min-w-0">
                {log.type === "system" && (
                  <span className="text-zinc-500 dark:text-zinc-400 italic">{log.message}</span>
                )}
                {log.type === "command" && (
                  <div className="flex items-start gap-2">
                    <Code2 className="w-4 h-4 text-cyan-600 dark:text-cyan-500 shrink-0 mt-0.5" />
                    <span className="text-cyan-800 dark:text-cyan-100 font-mono break-words">
                      {log.message}
                    </span>
                  </div>
                )}
                {log.type === "success" && (
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-emerald-700 dark:text-emerald-400/90 break-words">
                      {log.message}
                    </span>
                  </div>
                )}
                {log.type === "error" && (
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-500 shrink-0 mt-0.5" />
                    <span className="text-rose-700 dark:text-rose-400 break-words">
                      {log.message}
                    </span>
                  </div>
                )}
                {log.type === "transcript" && (
                  <div className="flex items-start gap-2">
                    <MessageSquareQuote className="w-4 h-4 text-violet-500 dark:text-violet-400 shrink-0 mt-0.5" />
                    <span className="text-violet-700 dark:text-violet-300 italic break-words">
                      &ldquo;{log.message}&rdquo;
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
