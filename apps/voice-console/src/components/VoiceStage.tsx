import { AnimatePresence, motion } from "motion/react";
import { Languages, Loader2, Mic, Terminal } from "lucide-react";
import type {
  ConnectionState,
  ConnectionPhase,
  ResponseLanguageMode,
  VoiceMode,
  VoiceUiState,
} from "./types";

export interface VoiceStageProps {
  connectionState: ConnectionState;
  phase: ConnectionPhase;
  voiceUiState: VoiceUiState;
  voiceMode: VoiceMode;
  onVoiceModeChange: (next: VoiceMode) => void;
  responseLanguageMode: ResponseLanguageMode;
  onResponseLanguageModeChange: (next: ResponseLanguageMode) => void;
  transcript: string;
  onPushToTalkStart: () => void;
  onPushToTalkEnd: () => void;
  micDisabled?: boolean;
  openMicArmed?: boolean;
  onToggleOpenMic?: () => void;
  hint?: string | null;
}

export function VoiceStage(props: VoiceStageProps) {
  const {
    connectionState,
    voiceUiState,
    voiceMode,
    onVoiceModeChange,
    responseLanguageMode,
    onResponseLanguageModeChange,
    transcript,
    onPushToTalkStart,
    onPushToTalkEnd,
    micDisabled = false,
    openMicArmed = false,
    onToggleOpenMic,
    hint,
  } = props;

  const isConnected = connectionState === "connected";
  const pttMode = voiceMode === "push_to_talk";
  const klingonMode = responseLanguageMode === "klingon";
  const interactionDisabled = !isConnected || micDisabled;

  const handlePttStart = () => {
    if (interactionDisabled || !pttMode) return;
    onPushToTalkStart();
  };
  const handlePttEnd = () => {
    if (!pttMode) return;
    onPushToTalkEnd();
  };

  return (
    <div className="relative flex-1 bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-300/60 dark:border-zinc-800/80 rounded-2xl flex flex-col items-center justify-center p-8 overflow-hidden group shadow-sm dark:shadow-none">
      <div
        className={`absolute inset-0 bg-gradient-to-b from-cyan-500/10 dark:from-cyan-500/5 to-transparent opacity-0 transition-opacity duration-700 ${
          voiceUiState !== "idle" ? "opacity-100" : ""
        }`}
      />

      <div className="relative z-10 flex flex-col items-center w-full max-w-2xl">
        <div className="h-8 mb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={voiceUiState}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 text-sm font-medium tracking-wide uppercase"
            >
              {voiceUiState === "idle" && (
                <span className="text-zinc-500">
                  {isConnected ? "Ready for command" : "Connect to begin"}
                </span>
              )}
              {voiceUiState === "listening" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <span className="text-rose-600 dark:text-rose-400">Listening</span>
                </>
              )}
              {voiceUiState === "processing" && (
                <>
                  <Loader2 className="w-4 h-4 text-cyan-600 dark:text-cyan-500 animate-spin" />
                  <span className="text-cyan-600 dark:text-cyan-400">Processing</span>
                </>
              )}
              {voiceUiState === "executing" && (
                <>
                  <Terminal className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Executing</span>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <button
          type="button"
          data-no-global-ptt="true"
          aria-label={pttMode ? "Hold to speak" : "Voice session indicator"}
          aria-pressed={voiceUiState === "listening"}
          onMouseDown={handlePttStart}
          onMouseUp={handlePttEnd}
          onMouseLeave={handlePttEnd}
          onPointerDown={handlePttStart}
          onPointerUp={handlePttEnd}
          onPointerLeave={handlePttEnd}
          onPointerCancel={handlePttEnd}
          onKeyDown={(event) => {
            if (
              (event.key === " " || event.key === "Enter")
              && !event.repeat
              && !event.altKey
              && !event.ctrlKey
              && !event.metaKey
              && pttMode
              && !interactionDisabled
            ) {
              event.preventDefault();
              onPushToTalkStart();
            }
          }}
          onKeyUp={(event) => {
            if (
              (event.key === " " || event.key === "Enter")
              && !event.altKey
              && !event.ctrlKey
              && !event.metaKey
              && pttMode
            ) {
              event.preventDefault();
              onPushToTalkEnd();
            }
          }}
          disabled={interactionDisabled}
          className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
            interactionDisabled
              ? "bg-zinc-200/50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
              : voiceUiState === "listening"
                ? "bg-rose-500 text-white scale-105 shadow-[0_0_40px_rgba(244,63,94,0.4)]"
                : voiceUiState === "processing" || voiceUiState === "executing"
                  ? "bg-cyan-100/50 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-300/50 dark:border-cyan-500/50"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white border border-zinc-300/80 dark:border-zinc-700/50 hover:border-zinc-400 dark:hover:border-zinc-600 shadow-xl"
          }`}
        >
          {voiceUiState === "listening" && (
            <div className="absolute inset-0 rounded-full border-2 border-rose-400 animate-ping opacity-20" />
          )}
          <Mic className={`w-12 h-12 ${voiceUiState === "listening" ? "animate-pulse" : ""}`} />
        </button>

        <div className="mt-12 h-24 w-full flex items-center justify-center">
          <AnimatePresence mode="wait">
            {transcript ? (
              <motion.p
                key="transcript"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className={`text-2xl text-center font-medium max-w-xl leading-relaxed ${
                  voiceUiState === "listening"
                    ? "text-zinc-500 dark:text-zinc-400"
                    : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                &ldquo;{transcript}&rdquo;
              </motion.p>
            ) : (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-zinc-500 dark:text-zinc-600 text-lg text-center max-w-md"
              >
                {hint ?? (pttMode ? "Hold spacebar or click to speak" : openMicArmed ? "Open mic live" : "Arm open mic to go hands-free")}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 flex bg-zinc-100/90 dark:bg-zinc-900/80 backdrop-blur p-1 rounded-lg border border-zinc-300/80 dark:border-zinc-800/80 shadow-sm dark:shadow-none">
        <button
          type="button"
          onClick={() => onVoiceModeChange("push_to_talk")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            pttMode
              ? "bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 shadow-sm dark:shadow-none"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Push-to-Talk
        </button>
        <button
          type="button"
          onClick={() => {
            if (onToggleOpenMic) {
              onToggleOpenMic();
              return;
            }
            onVoiceModeChange("open_mic");
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            !pttMode
              ? "bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 shadow-sm dark:shadow-none"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Open Mic
        </button>
      </div>

      <button
        type="button"
        aria-label="Toggle Klingon response mode"
        aria-pressed={klingonMode}
        title={klingonMode ? "Disable Klingon response mode" : "Enable Klingon response mode"}
        onClick={() => onResponseLanguageModeChange(klingonMode ? "standard" : "klingon")}
        className={`absolute bottom-6 left-6 inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-all shadow-sm dark:shadow-none ${
          klingonMode
            ? "bg-amber-100/90 dark:bg-amber-950/40 border-amber-300/80 dark:border-amber-700/60 text-amber-800 dark:text-amber-200"
            : "bg-zinc-100/90 dark:bg-zinc-900/80 border-zinc-300/80 dark:border-zinc-800/80 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        }`}
      >
        <Languages className="w-4 h-4" />
        <span>Klingon</span>
      </button>
    </div>
  );
}
