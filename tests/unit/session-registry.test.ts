import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeSessionCapacityError, RealtimeSessionRegistry, type RealtimeRegistryOptions } from "../../packages/runtime-and-adapters/src/realtime/session-registry.js";
import { createEmptySessionUsage } from "../../packages/runtime-and-adapters/src/realtime/usage.js";

function createRegistry(overrides: Partial<RealtimeRegistryOptions> = {}) {
  return new RealtimeSessionRegistry({
    openAiApiKey: "",
    realtimeModel: "gpt-realtime-2",
    realtimeVoice: "marin",
    realtimeReasoningEffort: "low",
    audioTranscriptionModel: "gpt-4o-mini-transcribe",
    realtimeOutputSpeed: 1,
    realtimeMaxOutputTokens: 1536,
    realtimeTracing: null,
    realtimeTruncation: null,
    sessionGuardrails: {
      maxSessionMinutes: 25,
      maxResponsesPerSession: 18,
      maxTranscriptionsPerSession: 36,
      maxBillableTokensPerSession: 24000,
      warningRatio: 0.8,
    },
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
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("realtime session registry hardening", () => {
  it("adds Realtime 2 reasoning config while preserving ordered tool execution", () => {
    const registry = createRegistry() as never as {
      buildSessionConfig: (
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => Record<string, unknown>;
    };

    const session = registry.buildSessionConfig("pymol", "push_to_talk");

    expect(session.model).toBe("gpt-realtime-2");
    expect(session.reasoning).toEqual({ effort: "low" });
    expect(session.parallel_tool_calls).toBe(false);
  });

  it("applies optional hosted prompt config and safety headers to client-secret setup", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      client_secret: {
        value: "ephemeral-secret",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const registry = createRegistry({
      openAiApiKey: "sk-test",
      openAiSafetyIdentifier: "biovoice-user-hash-123",
      realtimePrompt: {
        id: "pmpt_biovoice_operator",
        version: "7",
        variables: {
          audience: "scientist",
          rehearsal: false,
          maxSteps: 3,
        },
      },
    }) as never as {
      buildSessionConfig: (
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => Record<string, unknown>;
      createEphemeralSession: (
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => Promise<{ value: string }>;
    };

    const session = registry.buildSessionConfig("pymol", "push_to_talk");
    expect(session.prompt).toEqual({
      id: "pmpt_biovoice_operator",
      version: "7",
      variables: {
        audience: "scientist",
        rehearsal: false,
        maxSteps: 3,
      },
    });

    const secret = await registry.createEphemeralSession("pymol", "push_to_talk");

    expect(secret.value).toBe("ephemeral-secret");
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "biovoice-user-hash-123",
    });
    const body = JSON.parse(String(init.body)) as { session: { prompt?: unknown } };
    expect(body.session.prompt).toEqual(session.prompt);
  });

  it("passes safety headers through direct Realtime call setup", async () => {
    const fetchMock = vi.fn(async () => new Response("answer-sdp", {
      status: 200,
      headers: { Location: "https://api.openai.com/v1/realtime/calls/call_test_123" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const registry = createRegistry({
      openAiApiKey: "sk-test",
      openAiSafetyIdentifier: "biovoice-user-hash-456",
    });
    vi.spyOn(registry as never as { attachSideband: () => Promise<void> }, "attachSideband").mockResolvedValue(undefined);

    const result = await registry.connect({
      offerSdp: "offer-sdp",
      target: "pymol",
      voiceMode: "push_to_talk",
    });

    expect(result.answerSdp).toBe("answer-sdp");
    expect(result.callId).toBe("call_test_123");
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "OpenAI-Safety-Identifier": "biovoice-user-hash-456",
    });
  });

  it("summarizes Realtime rate-limit updates into the operator event stream", async () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        eventHistory: Array<{
          event: {
            kind: string;
            level?: string;
            text?: string;
          };
        }>;
      };
      handleSidebandMessage: (sessionId: string, raw: string) => Promise<void>;
      sessions: Map<string, unknown>;
      disposeSession(sessionId: string): void;
    };
    const record = registry.createSessionRecord("session-rate", "call-rate", "pymol", "push_to_talk");
    registry.sessions.set("session-rate", record);

    await registry.handleSidebandMessage("session-rate", JSON.stringify({
      type: "rate_limits.updated",
      rate_limits: [
        { name: "requests", limit: 100, remaining: 99, reset_seconds: 12.1 },
        { name: "tokens", limit: 20000, remaining: 1500, reset_seconds: 60 },
      ],
    }));

    expect(record.eventHistory.at(-1)?.event).toMatchObject({
      kind: "log",
      level: "warn",
      text: "Realtime rate limits: requests: 99/100 remaining, resets in 13s; tokens: 1500/20000 remaining, resets in 60s.",
    });

    registry.disposeSession("session-rate");
  });

  it("prunes old Realtime conversation items after the configured high-water mark", async () => {
    const registry = createRegistry({
      realtimeContextPruning: {
        enabled: true,
        maxItems: 3,
        retainItems: 2,
      },
    }) as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
        status: {
          contextWindow: {
            trackedItems: number;
            prunableItems: number;
            deletePendingItems: number;
            prunedItems: number;
          };
        };
      };
      handleSidebandMessage: (sessionId: string, raw: string) => Promise<void>;
      sessions: Map<string, unknown>;
      disposeSession(sessionId: string): void;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-prune", "call-prune", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-prune", record);

    for (let index = 1; index <= 4; index += 1) {
      await registry.handleSidebandMessage("session-prune", JSON.stringify({
        type: "conversation.item.created",
        item: {
          id: `item-${index}`,
          type: "message",
          role: index % 2 === 0 ? "assistant" : "user",
        },
      }));
    }

    const deleteEvents = sent.map((payload) => JSON.parse(payload) as { type: string; item_id?: string });
    expect(deleteEvents).toEqual([
      { type: "conversation.item.delete", item_id: "item-1" },
      { type: "conversation.item.delete", item_id: "item-2" },
    ]);
    expect(record.status.contextWindow).toMatchObject({
      trackedItems: 4,
      prunableItems: 2,
      deletePendingItems: 2,
      prunedItems: 0,
    });

    await registry.handleSidebandMessage("session-prune", JSON.stringify({
      type: "conversation.item.deleted",
      item_id: "item-1",
    }));
    await registry.handleSidebandMessage("session-prune", JSON.stringify({
      type: "conversation.item.deleted",
      item_id: "item-2",
    }));

    expect(record.status.contextWindow).toMatchObject({
      trackedItems: 2,
      prunableItems: 2,
      deletePendingItems: 0,
      prunedItems: 2,
    });

    registry.disposeSession("session-prune");
  });

  it("leaves Realtime conversation items alone when context pruning is disabled", async () => {
    const registry = createRegistry({
      realtimeContextPruning: {
        enabled: false,
        maxItems: 2,
        retainItems: 1,
      },
    }) as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
        status: {
          contextWindow: {
            pruningEnabled: boolean;
            trackedItems: number;
            deletePendingItems: number;
          };
        };
      };
      handleSidebandMessage: (sessionId: string, raw: string) => Promise<void>;
      sessions: Map<string, unknown>;
      disposeSession(sessionId: string): void;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-no-prune", "call-no-prune", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-no-prune", record);

    for (let index = 1; index <= 4; index += 1) {
      await registry.handleSidebandMessage("session-no-prune", JSON.stringify({
        type: "conversation.item.created",
        item: {
          id: `disabled-item-${index}`,
          type: "function_call_output",
        },
      }));
    }

    expect(sent).toEqual([]);
    expect(record.status.contextWindow).toMatchObject({
      pruningEnabled: false,
      trackedItems: 4,
      deletePendingItems: 0,
    });

    registry.disposeSession("session-no-prune");
  });

  it("ends wait_for_user turns without asking Realtime for a spoken follow-up", async () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
      };
      executeToolCall: (
        sessionId: string,
        callId: string,
        toolName: string,
        argumentsJson: string,
      ) => Promise<void>;
      sessions: Map<string, unknown>;
      disposeSession(sessionId: string): void;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-wait", "call-wait", "pymol", "open_mic");
    record.ws = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-wait", record);

    await registry.executeToolCall("session-wait", "tool-call-wait", "wait_for_user", "{}");

    const messages = sent.map((payload) => JSON.parse(payload) as {
      type: string;
      item?: {
        type?: string;
        output?: string;
      };
    });
    expect(messages.map((message) => message.type)).toEqual(["conversation.item.create"]);
    expect(messages).not.toContainEqual(expect.objectContaining({ type: "response.create" }));
    expect(messages[0]?.item?.type).toBe("function_call_output");
    expect(JSON.parse(messages[0]?.item?.output ?? "{}")).toMatchObject({
      ok: true,
      tool: "wait_for_user",
      result: {
        action: "wait_for_user",
      },
    });

    registry.disposeSession("session-wait");
  });

  it("dispatches fetch-backed scientific workflow tool calls through schema validation", async () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
      };
      executeToolCall: (
        sessionId: string,
        callId: string,
        toolName: string,
        argumentsJson: string,
      ) => Promise<void>;
      sessions: Map<string, unknown>;
      disposeSession(sessionId: string): void;
      runScientificWorkflowDirect: ReturnType<typeof vi.fn>;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-science", "call-science", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-science", record);
    registry.runScientificWorkflowDirect = vi.fn().mockResolvedValue({
      target: "pymol",
      workflow: "alphafold_pae_guided_triage",
      resolvedInputs: {
        modelSource: "afdb",
        uniprotId: "Q9H255",
      },
      actionsExecuted: [],
      commandsExecuted: [],
      logs: [],
      artifacts: [],
      metrics: [],
      warnings: [],
      workflowState: {},
      referenceHints: {},
    });

    await registry.executeToolCall("session-science", "tool-call-science", "run_scientific_workflow", JSON.stringify({
      target: "pymol",
      workflow: "alphafold_pae_guided_triage",
      presentationMode: "analysis",
      inputs: {
        uniprotId: "Q9H255",
        useAfdbPae: true,
      },
    }));

    expect(registry.runScientificWorkflowDirect).toHaveBeenCalledWith(expect.objectContaining({
      target: "pymol",
      workflow: "alphafold_pae_guided_triage",
      inputs: expect.objectContaining({
        uniprotId: "Q9H255",
        useAfdbPae: true,
      }),
    }));
    const messages = sent.map((payload) => JSON.parse(payload) as {
      type: string;
      item?: {
        output?: string;
      };
    });
    expect(messages.map((message) => message.type)).toEqual(["conversation.item.create", "response.create"]);
    expect(JSON.parse(messages[0]?.item?.output ?? "{}")).toMatchObject({
      ok: true,
      tool: "run_scientific_workflow",
      target: "pymol",
      workflow: "alphafold_pae_guided_triage",
    });

    registry.disposeSession("session-science");
  });

  it("dispatches scientific asset resolver tool calls through schema validation", async () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
      };
      executeToolCall: (
        sessionId: string,
        callId: string,
        toolName: string,
        argumentsJson: string,
      ) => Promise<void>;
      sessions: Map<string, unknown>;
      disposeSession(sessionId: string): void;
      resolveStructureAssetDirect: ReturnType<typeof vi.fn>;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-asset", "call-asset", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-asset", record);
    registry.resolveStructureAssetDirect = vi.fn().mockResolvedValue({
      resolution: {
        source: "rcsb",
        id: "4HHB",
        label: "RCSB 4HHB",
        files: [
          {
            kind: "model",
            path: "/tmp/4HHB.pdb",
            label: "RCSB 4HHB",
            sourceUrl: "https://files.rcsb.org/download/4HHB.pdb",
            format: "pdb",
            bytes: 123,
            sha256: "abcdef1234567890",
            cacheHit: true,
          },
        ],
        warnings: [],
      },
      loaded: true,
      warnings: [],
    });

    await registry.executeToolCall("session-asset", "tool-call-asset", "resolve_structure_asset", JSON.stringify({
      source: "rcsb",
      target: "pymol",
      loadIntoTarget: true,
      pdbId: "4hhb",
      format: "pdb",
      object: "exp_complex",
      semanticRole: "experimental",
    }));

    expect(registry.resolveStructureAssetDirect).toHaveBeenCalledWith(expect.objectContaining({
      source: "rcsb",
      target: "pymol",
      loadIntoTarget: true,
      pdbId: "4HHB",
      object: "exp_complex",
      semanticRole: "experimental",
    }));
    const messages = sent.map((payload) => JSON.parse(payload) as {
      type: string;
      item?: {
        output?: string;
      };
    });
    expect(messages.map((message) => message.type)).toEqual(["conversation.item.create", "response.create"]);
    expect(JSON.parse(messages[0]?.item?.output ?? "{}")).toMatchObject({
      ok: true,
      tool: "resolve_structure_asset",
      loaded: true,
      resolution: {
        source: "rcsb",
        id: "4HHB",
        files: [
          {
            file: "4HHB.pdb",
            cacheHit: true,
          },
        ],
      },
    });

    registry.disposeSession("session-asset");
  });

  it("adds visible map display actions when loading resolved EMDB assets into targets", () => {
    const registry = createRegistry() as never as {
      buildResolvedAssetLoadActions: (
        request: Record<string, unknown>,
        resolution: Record<string, unknown>,
        file: Record<string, unknown>,
      ) => Array<Record<string, unknown>>;
    };
    const mapFile = {
      kind: "map",
      path: "/tmp/emd_1234.map",
      label: "EMDB map EMD-1234",
      sourceUrl: "https://ftp.ebi.ac.uk/pub/databases/emdb/structures/EMD-1234/map/emd_1234.map.gz",
      format: "map",
      bytes: 8,
      sha256: "abcdef1234567890",
      cacheHit: false,
    };
    const resolution = {
      source: "emdb",
      id: "EMD-1234",
      label: "EMDB EMD-1234",
      files: [mapFile],
      warnings: [],
    };

    expect(registry.buildResolvedAssetLoadActions({
      source: "emdb",
      target: "pymol",
      loadIntoTarget: true,
      emdbId: "EMD-1234",
      object: "cryo_map",
    }, resolution, mapFile)).toEqual([
      expect.objectContaining({
        type: "load",
        source: "local",
        path: "/tmp/emd_1234.map",
        object: "cryo_map",
      }),
      expect.objectContaining({
        type: "map_display",
        mapName: "cryo_map",
        displayAs: "mesh",
        color: "cyan",
      }),
    ]);

    expect(registry.buildResolvedAssetLoadActions({
      source: "emdb",
      target: "chimerax",
      loadIntoTarget: true,
      emdbId: "EMD-1234",
      object: "cryo_map",
    }, resolution, mapFile)).toEqual([
      expect.objectContaining({
        type: "open",
        source: "local",
        path: "/tmp/emd_1234.map",
        id: "cryo_map",
      }),
      expect.objectContaining({
        type: "volume",
        action: "mesh",
        showOutlineBox: false,
      }),
    ]);
  });

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

  it("blocks runaway session creation when the active-session cap is reached", async () => {
    const registry = createRegistry();
    vi.spyOn(registry as any, "createEphemeralSession").mockResolvedValue({ value: "ephemeral-secret" });

    const first = await registry.prepareSession("pymol", "push_to_talk");
    const second = await registry.prepareSession("chimerax", "push_to_talk");

    await expect(registry.prepareSession("pymol", "push_to_talk")).rejects.toBeInstanceOf(RealtimeSessionCapacityError);

    (registry as never as { disposeSession(sessionId: string): void }).disposeSession(first.sessionId);
    (registry as never as { disposeSession(sessionId: string): void }).disposeSession(second.sessionId);
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

    expect(result.stepResults).toHaveLength(4);
    expect(result.stepResults[0]?.result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/slow to stabilize/i),
      expect.stringMatching(/load-and-color/i),
    ]));
    expect(registry.executeTargetActions).toHaveBeenCalledTimes(4);
    expect(registry.pymolAdapter.waitUntilCommandReady).toHaveBeenCalledTimes(3);
  });

  it("tracks session cost guardrails in the live session status", () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
        recipeId?: string,
        accessToken?: string,
        registerToken?: string,
      ) => {
        status: {
          usage: ReturnType<typeof createEmptySessionUsage>;
        };
        connectedAtMs: number | null;
      };
      sessions: Map<string, unknown>;
      refreshSessionUsageGuardrails: (sessionId: string) => void;
      getStatus: (sessionId: string) => {
        usageGuardrails: {
          warningActive: boolean;
          warningReason?: string;
        };
      };
    };

    const record = registry.createSessionRecord("session-guard", "", "pymol", "push_to_talk");
    record.connectedAtMs = Date.now() - 60_000;
    record.status.usage = {
      ...createEmptySessionUsage(),
      responseCount: 10,
      totalTokens: 20000,
    };
    registry.sessions.set("session-guard", record);
    registry.refreshSessionUsageGuardrails("session-guard");

    const status = registry.getStatus("session-guard");
    expect(status.usageGuardrails.warningActive).toBe(true);
    expect(status.usageGuardrails.warningReason).toBe("billable_tokens");
  });

  it("does not prune an established reconnecting session on the pending 30-second ttl", () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
        recipeId?: string,
        accessToken?: string,
        registerToken?: string,
        instructionContext?: string,
      ) => {
        callId: string;
        connectedAtMs: number | null;
        lastActivityAt: number;
        status: {
          status: "awaiting_call" | "connecting" | "connected" | "error" | "disconnected";
          sidebandStatus: "pending_call" | "connecting" | "connected" | "reconnecting" | "error" | "disconnected";
        };
      };
      sessions: Map<string, unknown>;
      pruneSessions: () => void;
    };

    const record = registry.createSessionRecord("session-reconnect", "", "pymol", "open_mic");
    record.callId = "call-reconnect";
    record.connectedAtMs = Date.now() - 60_000;
    record.lastActivityAt = Date.now() - 40_000;
    record.status = {
      ...record.status,
      status: "connecting",
      sidebandStatus: "reconnecting",
    };
    registry.sessions.set("session-reconnect", record);

    registry.pruneSessions();

    expect(registry.sessions.has("session-reconnect")).toBe(true);
  });

  it("uses conservative server-side VAD settings for open mic", () => {
    const registry = createRegistry() as never as {
      buildSessionConfig: (
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
        recipeId?: string,
        advancedMode?: boolean,
        instructionContext?: string,
      ) => {
        audio: {
          input: {
            turn_detection: Record<string, unknown> | null;
          };
        };
      };
    };

    const config = registry.buildSessionConfig("pymol", "open_mic");

    expect(config.audio.input.turn_detection).toMatchObject({
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 900,
      interrupt_response: false,
      create_response: true,
    });
  });
});
