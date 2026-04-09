type VoiceMode = "push_to_talk" | "open_mic";

export interface IdleGuardState {
  timeoutSeconds: number;
  secondsRemaining: number | null;
  warningActive: boolean;
  expired: boolean;
}

export function resolveIdleDisconnectSeconds(
  voiceMode: VoiceMode,
  pttSeconds: number,
  openMicSeconds: number,
): number {
  return voiceMode === "open_mic" ? openMicSeconds : pttSeconds;
}

export function computeIdleGuardState(
  lastActivityAtMs: number | null,
  nowMs: number,
  timeoutSeconds: number,
  warningSeconds: number,
): IdleGuardState {
  if (!lastActivityAtMs || timeoutSeconds <= 0) {
    return {
      timeoutSeconds,
      secondsRemaining: null,
      warningActive: false,
      expired: false,
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - lastActivityAtMs) / 1000));
  const secondsRemaining = Math.max(0, timeoutSeconds - elapsedSeconds);
  return {
    timeoutSeconds,
    secondsRemaining,
    warningActive: secondsRemaining > 0 && secondsRemaining <= warningSeconds,
    expired: elapsedSeconds >= timeoutSeconds,
  };
}
