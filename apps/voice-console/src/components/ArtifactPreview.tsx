import { Image as ImageIcon, Maximize2 } from "lucide-react";
import type { ArtifactSummary } from "./types";

export interface ArtifactPreviewProps {
  artifact: ArtifactSummary | null;
  onExpand?: () => void;
}

export function ArtifactPreview({ artifact, onExpand }: ArtifactPreviewProps) {
  return (
    <div className="h-64 bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-300/60 dark:border-zinc-800/80 rounded-2xl p-5 flex flex-col shrink-0 relative overflow-hidden group shadow-sm dark:shadow-none">
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-purple-500 dark:text-purple-400" />
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
            Latest Artifact
          </h2>
        </div>
        {onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            title="Expand"
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 rounded-xl overflow-hidden bg-zinc-200/50 dark:bg-zinc-950 border border-zinc-300/80 dark:border-zinc-800 relative flex items-center justify-center">
        {artifact && artifact.kind === "image" && artifact.url ? (
          <>
            <img
              src={artifact.url}
              alt={artifact.label}
              className="w-full h-full object-cover opacity-90 dark:opacity-80 group-hover:opacity-100 transition-opacity duration-500"
              referrerPolicy="no-referrer"
            />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-zinc-900/90 dark:from-zinc-950/90 to-transparent p-4 pt-12">
              <p className="text-sm font-medium text-zinc-100">{artifact.label}</p>
              {artifact.timestamp ? (
                <p className="text-xs text-zinc-300 dark:text-zinc-500">
                  {new Date(artifact.timestamp).toLocaleTimeString()}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-zinc-400 dark:text-zinc-600 flex flex-col items-center gap-2">
            <ImageIcon className="w-8 h-8 opacity-50" />
            <span className="text-sm">No artifacts generated yet</span>
          </div>
        )}
      </div>
    </div>
  );
}
