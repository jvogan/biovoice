import { Activity, Loader2, Moon, Power, RotateCcw, Settings, Sun } from "lucide-react";
import { StatusIndicator } from "./StatusIndicator";
import type { ConnectionState, TargetKind } from "./types";

export interface HeaderProps {
  appName?: string;
  target: TargetKind;
  onTargetChange: (next: TargetKind) => void;
  targetSwitchDisabled?: boolean;
  connectionState: ConnectionState;
  onPowerClick: () => void;
  powerBusy?: boolean;
  powerDisabled?: boolean;
  isDarkMode: boolean;
  onThemeToggle: () => void;
  onSettingsClick: () => void;
  undoAvailable?: boolean;
  undoBusy?: boolean;
  undoDisabledReason?: string;
  onUndo?: () => void;
}

const TARGETS: Array<{ id: TargetKind; label: string }> = [
  { id: "pymol", label: "PyMOL" },
  { id: "chimerax", label: "ChimeraX" },
];

export function Header(props: HeaderProps) {
  const {
    appName = "BioVoice Console",
    target,
    onTargetChange,
    targetSwitchDisabled = false,
    connectionState,
    onPowerClick,
    powerBusy = false,
    powerDisabled = false,
    isDarkMode,
    onThemeToggle,
    onSettingsClick,
    undoAvailable = false,
    undoBusy = false,
    undoDisabledReason,
    onUndo,
  } = props;

  const isConnected = connectionState === "connected";

  return (
    <header className="h-16 border-b border-zinc-300/80 dark:border-zinc-800/80 bg-zinc-100/80 dark:bg-zinc-950/50 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{appName}</h1>
        </div>

        <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-800" />

        <div className="flex bg-zinc-200/50 dark:bg-zinc-900 p-1 rounded-lg border border-zinc-300/80 dark:border-zinc-800/80 shadow-sm dark:shadow-none">
          {TARGETS.map(({ id, label }) => {
            const isActive = target === id;
            let classes: string;
            if (isActive) {
              classes = id === "pymol"
                ? "bg-cyan-100/80 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 shadow-sm dark:shadow-none"
                : "bg-indigo-100/80 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 shadow-sm dark:shadow-none";
            } else {
              classes = "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/80 dark:hover:bg-zinc-800/50";
            }
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTargetChange(id)}
                disabled={targetSwitchDisabled}
                title={targetSwitchDisabled ? "Disconnect first to switch targets" : `Switch to ${label}`}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all disabled:opacity-60 disabled:cursor-not-allowed ${classes}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <StatusIndicator state={connectionState} />
        <button
          type="button"
          onClick={onUndo}
          disabled={!undoAvailable || undoBusy || !onUndo}
          aria-label={undoBusy ? "Undoing last turn" : "Undo last turn"}
          title={undoBusy ? "Restoring the previous scene" : undoAvailable ? "Undo last turn" : undoDisabledReason ?? "Nothing to undo"}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-cyan-700 dark:hover:text-cyan-300 hover:bg-cyan-100/70 dark:hover:bg-cyan-400/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <RotateCcw className={`w-4 h-4 ${undoBusy ? "animate-spin" : ""}`} />
          <span>Undo</span>
        </button>
        <button
          type="button"
          onClick={onPowerClick}
          disabled={powerDisabled || powerBusy}
          aria-label={isConnected ? "Disconnect" : "Connect"}
          title={isConnected ? "Disconnect" : "Connect"}
          className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isConnected
              ? "text-zinc-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-400/10"
              : "text-zinc-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-400/10"
          }`}
        >
          {powerBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Power className="w-5 h-5" />}
        </button>
        <button
          type="button"
          onClick={onThemeToggle}
          aria-label={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
          title={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
          className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        >
          {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          aria-label="Open settings"
          title="Settings"
          className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
