import { describe, expect, it } from "vitest";
import { computeIdleGuardState, resolveIdleDisconnectSeconds } from "../../apps/voice-console/src/lib/session-guard";

describe("session guard helpers", () => {
  it("uses the open-mic timeout only for open-mic sessions", () => {
    expect(resolveIdleDisconnectSeconds("push_to_talk", 900, 180)).toBe(900);
    expect(resolveIdleDisconnectSeconds("open_mic", 900, 180)).toBe(180);
  });

  it("marks sessions as warning before expiry and expired at the timeout", () => {
    const base = 1_000_000;
    expect(computeIdleGuardState(base, base + 120_000, 180, 30)).toEqual({
      timeoutSeconds: 180,
      secondsRemaining: 60,
      warningActive: false,
      expired: false,
    });

    expect(computeIdleGuardState(base, base + 155_000, 180, 30)).toEqual({
      timeoutSeconds: 180,
      secondsRemaining: 25,
      warningActive: true,
      expired: false,
    });

    expect(computeIdleGuardState(base, base + 180_000, 180, 30)).toEqual({
      timeoutSeconds: 180,
      secondsRemaining: 0,
      warningActive: false,
      expired: true,
    });
  });

  it("disables idle countdowns when there is no activity timestamp or timeout", () => {
    expect(computeIdleGuardState(null, 1_000_000, 180, 30)).toEqual({
      timeoutSeconds: 180,
      secondsRemaining: null,
      warningActive: false,
      expired: false,
    });

    expect(computeIdleGuardState(1_000_000, 1_010_000, 0, 30)).toEqual({
      timeoutSeconds: 0,
      secondsRemaining: null,
      warningActive: false,
      expired: false,
    });
  });
});
