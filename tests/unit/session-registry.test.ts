import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeSessionRegistry } from "../../packages/runtime-and-adapters/src/realtime/session-registry.js";

function createRegistry() {
  return new RealtimeSessionRegistry({
    openAiApiKey: "",
    realtimeModel: "gpt-realtime-1.5",
    realtimeVoice: "marin",
    audioTranscriptionModel: "gpt-4o-mini-transcribe",
    realtimeOutputSpeed: 1,
    realtimeMaxOutputTokens: 1536,
    realtimeTracing: null,
    realtimeTruncation: null,
    pymol: {
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 1_000,
      renderTimeoutMs: 1_000,
      autolaunch: false,
    },
    chimerax: {
      port: 60958,
      timeoutMs: 1_000,
      autolaunch: false,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("realtime session registry hardening", () => {
  it("creates and validates per-session access tokens", async () => {
    const registry = createRegistry();
    vi.spyOn(registry as any, "createEphemeralSession").mockResolvedValue({ value: "ephemeral-secret" });

    const prepared = await registry.prepareSession("pymol", "push_to_talk");

    expect(prepared.clientSecret).toBe("ephemeral-secret");
    expect(prepared.registerToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(prepared.sessionAccessToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(() => registry.validateSessionAccess(prepared.sessionId, prepared.sessionAccessToken)).not.toThrow();
    expect(() => registry.validateSessionAccess(prepared.sessionId, "wrong-token")).toThrow(/invalid realtime session access token/i);

    (registry as never as { disposeSession(sessionId: string): void }).disposeSession(prepared.sessionId);
  });

  it("requires a valid single-use register token before attaching a call", () => {
    const registry = createRegistry();
    vi.spyOn(registry as any, "attachSideband").mockResolvedValue(undefined);

    const record = (registry as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
        recipeId?: string,
        accessToken?: string,
        registerToken?: string,
      ) => unknown;
      sessions: Map<string, unknown>;
    }).createSessionRecord("session-1", "", "pymol", "push_to_talk", undefined, "access-1", "register-1");
    (registry as never as { sessions: Map<string, unknown> }).sessions.set("session-1", record);

    expect(() => registry.registerCall("session-1", "call-1", "wrong-register")).toThrow(/invalid realtime call registration token/i);
    expect(() => registry.registerCall("session-1", "call-1", "register-1")).not.toThrow();
    expect(() => registry.registerCall("session-1", "call-2", "register-1")).toThrow(/already registered/i);

    (registry as never as { disposeSession(sessionId: string): void }).disposeSession("session-1");
  });

  it("revokes the session access token after disconnect", async () => {
    const registry = createRegistry();
    vi.spyOn(registry as any, "createEphemeralSession").mockResolvedValue({ value: "ephemeral-secret" });

    const prepared = await registry.prepareSession("pymol", "push_to_talk");
    await registry.disconnect(prepared.sessionId);

    expect(() => registry.validateSessionAccess(prepared.sessionId, prepared.sessionAccessToken)).toThrow(/invalid realtime session access token/i);

    (registry as never as { disposeSession(sessionId: string): void }).disposeSession(prepared.sessionId);
  });

  it("downgrades post-step PyMOL stabilization failures into warnings", async () => {
    const registry = createRegistry() as never as {
      runRecipeDirect: (
        recipeId: string,
        target: "pymol" | "chimerax",
        dryRun?: boolean,
      ) => Promise<{
        stepResults: Array<{
          stepId: string;
          result: {
            warnings: string[];
          };
        }>;
      }>;
      executeTargetActions: ReturnType<typeof vi.fn>;
      pymolAdapter: {
        waitUntilCommandReady: ReturnType<typeof vi.fn>;
      };
    };

    registry.executeTargetActions = vi.fn().mockResolvedValue({
      target: "pymol",
      commandsExecuted: [],
      logs: [],
      artifacts: [],
      metrics: [],
      warnings: [],
    });
    registry.pymolAdapter.waitUntilCommandReady = vi.fn().mockRejectedValue(new Error("stabilization timed out"));

    const result = await registry.runRecipeDirect("pymol-surface-and-presentation", "pymol");

    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults[0]?.result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/slow to stabilize/i),
      expect.stringMatching(/load-and-color/i),
    ]));
    expect(registry.executeTargetActions).toHaveBeenCalledTimes(3);
    expect(registry.pymolAdapter.waitUntilCommandReady).toHaveBeenCalledTimes(2);
  });
});
