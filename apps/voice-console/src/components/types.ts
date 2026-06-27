export type TargetKind = "pymol" | "chimerax";
export type VoiceMode = "push_to_talk" | "open_mic";
export type ResponseLanguageMode = "standard" | "klingon";

export type ConnectionPhase =
  | "idle"
  | "arming"
  | "connecting"
  | "ready"
  | "listening"
  | "transcribing"
  | "planning"
  | "executing"
  | "confirming"
  | "error";

export type ConnectionState = "offline" | "connecting" | "connected" | "error";
export type VoiceUiState = "idle" | "listening" | "processing" | "executing";

export interface RecipeSummary {
  id: string;
  title: string;
  goal: string;
  apps: TargetKind[];
  category: string;
  estimatedMinutes: number;
  prompts: string[];
}

export interface ArtifactSummary {
  id: string;
  kind: "image" | "session" | "model";
  url?: string;
  label: string;
  timestamp?: string;
}

export interface LogLine {
  id: string;
  timestamp: Date;
  type: "command" | "system" | "error" | "success" | "transcript";
  message: string;
  details?: string;
}

export interface RuntimeSnapshot {
  data: string;
  eventStream: string;
  controller: string;
  phase: string;
}

export interface GuardrailsSnapshot {
  voiceMode: VoiceMode;
  idleDisconnectSeconds: number;
  maxSessionMinutes: number;
  maxResponsesPerSession: number;
  maxTranscriptionsPerSession: number;
  maxBillableTokensPerSession: number;
  maxActiveSessions: number;
  warningRatio: number;
  currentResponses?: number;
  currentTranscriptions?: number;
  currentBillableTokens?: number;
  warningActive?: boolean;
  warningMessage?: string;
  breachMessage?: string;
}

export interface AuthSnapshot {
  realtimeKey: string;
  realtimeValid: boolean;
  usageKey: string;
  usageValid: boolean;
}

export interface UsageSnapshot {
  currentMonth?: string;
  dollarsSpent?: number;
  totalTokens?: number;
}

export type SettingsTab = "runtime" | "workflows" | "usage";
