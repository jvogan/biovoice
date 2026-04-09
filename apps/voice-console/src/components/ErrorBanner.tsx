import { AlertTriangle, X } from "lucide-react";

export interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-20 right-6 z-40 max-w-md flex items-start gap-3 px-4 py-3 rounded-xl border border-rose-400/60 dark:border-rose-500/50 bg-rose-50/95 dark:bg-rose-950/80 backdrop-blur shadow-lg shadow-rose-500/10"
    >
      <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm text-rose-900 dark:text-rose-100 leading-relaxed break-words">
        {message}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="shrink-0 text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-200 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
