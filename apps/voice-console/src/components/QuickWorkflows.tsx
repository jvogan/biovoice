import { Loader2, Zap } from "lucide-react";
import type { RecipeSummary } from "./types";

export interface QuickWorkflowsProps {
  workflows: RecipeSummary[];
  onLaunch: (workflow: RecipeSummary) => void;
  disabled?: boolean;
  busyId?: string | null;
}

export function QuickWorkflows(props: QuickWorkflowsProps) {
  const { workflows, onLaunch, disabled = false, busyId = null } = props;

  return (
    <div className="h-48 bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-300/60 dark:border-zinc-800/80 rounded-2xl p-5 flex flex-col shrink-0 shadow-sm dark:shadow-none">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
          Quick Workflows
        </h2>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {workflows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-600">
            No workflows available for this target
          </div>
        ) : (
          workflows.map((workflow) => {
            const busy = busyId === workflow.id;
            return (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onLaunch(workflow)}
                disabled={disabled || Boolean(busyId)}
                title={workflow.goal}
                className="flex-shrink-0 w-40 p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-300/80 dark:border-zinc-700/50 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 shadow-sm dark:shadow-none transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors truncate">
                    {workflow.title}
                  </div>
                  {busy ? <Loader2 className="w-3 h-3 animate-spin text-cyan-500 shrink-0" /> : null}
                </div>
                <div className="text-xs text-zinc-500 font-mono truncate">
                  {workflow.prompts[0] ?? workflow.goal}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
