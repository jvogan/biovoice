export type VoiceMode = "push_to_talk" | "open_mic";

export type VoiceWidgetState =
  | "offline"
  | "connecting"
  | "ready"
  | "listening"
  | "executing"
  | "paused"
  | "error";

export function resolveVoiceWidgetState(input: {
  phase: string;
  connected: boolean;
  sessionPaused: boolean;
  localMicEnabled: boolean;
  ready: boolean;
  connectBusy: boolean;
}): VoiceWidgetState {
  if (!input.connected) return input.connectBusy ? "connecting" : "offline";
  if (input.sessionPaused) return "paused";
  if (input.phase === "error") return "error";
  if (input.localMicEnabled || input.phase === "listening") return "listening";
  if (["transcribing", "planning", "executing", "confirming"].includes(input.phase)) return "executing";
  if (["arming", "connecting"].includes(input.phase) || !input.ready) return "connecting";
  if (input.ready || input.phase === "ready") return "ready";
  return "connecting";
}

export function describeVoiceWidgetHint(input: {
  widgetState: VoiceWidgetState;
  connectBusy: boolean;
  voiceMode: VoiceMode;
  openMicArmed: boolean;
}): string {
  if (input.connectBusy && input.widgetState === "offline") {
    return "arming session…";
  }

  switch (input.widgetState) {
    case "offline":
      return "connect to go live";
    case "connecting":
      return input.connectBusy ? "arming session…" : "waiting for realtime…";
    case "ready":
      if (input.voiceMode === "open_mic") {
        return input.openMicArmed ? "open mic armed" : "arm open mic";
      }
      return "hold to speak";
    case "listening":
      return input.voiceMode === "push_to_talk" ? "release to send" : "listening…";
    case "executing":
      return "running…";
    case "paused":
      return "resume to re-enable audio";
    case "error":
      return "needs attention";
    default:
      return "";
  }
}

export function cleanWidgetText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "—";
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}…` : normalized;
}

export function compactInstrumentMessage(text: string): string {
  const normalized = cleanWidgetText(text)
    .replace(/^LAST\s*>\s*/i, "")
    .replace(/^session manually disconnected.*$/i, "session ended")
    .replace(/^disconnected idle realtime session.*$/i, "idle disconnect")
    .replace(/^connect to begin$/i, "ready to connect")
    .replace(/^open mic primed$/i, "open mic primed")
    .replace(/^session armed$/i, "session armed")
    .replace(/^session paused$/i, "session paused")
    .replace(/^running command$/i, "running command")
    .replace(/^running pymol actions$/i, "PyMOL action")
    .replace(/^running chimerax actions$/i, "ChimeraX action")
    .replace(/^staging scientific workflow$/i, "workflow staged")
    .replace(/^capturing current view$/i, "capturing view")
    .replace(/^exporting artifact$/i, "exporting")
    .replace(/.*target not ready.*$/i, "launch app first")
    .replace(/.*peer connection.*$/i, "reconnect needed")
    .replace(/.*data channel.*$/i, "reconnect needed");
  return truncateInstrumentText(normalized, 17);
}

export function truncateInstrumentText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
