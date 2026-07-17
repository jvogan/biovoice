import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { RealtimeSessionCapacityError, RealtimeSessionRegistry, type RealtimeRegistryOptions } from "../../packages/runtime-and-adapters/src/realtime/session-registry.js";
import { createEmptySessionUsage } from "../../packages/runtime-and-adapters/src/realtime/usage.js";
import { scientificTestFixturePath } from "../helpers/scientific-test-fixtures.js";

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
        recipeId?: string,
        advancedMode?: boolean,
        instructionContext?: string,
        responseLanguageMode?: "standard" | "klingon",
      ) => Record<string, unknown>;
    };

    const session = registry.buildSessionConfig("pymol", "push_to_talk");

    expect(session.model).toBe("gpt-realtime-2");
    expect(session.reasoning).toEqual({ effort: "low" });
    expect(session.parallel_tool_calls).toBe(false);

    const klingonSession = registry.buildSessionConfig("pymol", "push_to_talk", undefined, false, undefined, "klingon");
    expect(klingonSession.instructions).toContain("Klingon easter egg mode is active");
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

  it("lets Realtime tool calls persist response language mode", async () => {
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
        status: {
          responseLanguageMode: "standard" | "klingon";
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
    const record = registry.createSessionRecord("session-language", "call-language", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => {
        sent.push(payload);
      },
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-language", record);

    await registry.executeToolCall(
      "session-language",
      "tool-call-language",
      "set_response_language_mode",
      JSON.stringify({ mode: "klingon" }),
    );

    expect(record.status.responseLanguageMode).toBe("klingon");
    const messages = sent.map((payload) => JSON.parse(payload) as {
      type: string;
      session?: {
        instructions?: string;
      };
      item?: {
        type?: string;
        output?: string;
      };
    });
    expect(messages[0]).toMatchObject({
      type: "session.update",
      session: {
        instructions: expect.stringContaining("Klingon easter egg mode is active"),
      },
    });
    expect(messages.map((message) => message.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "response.create",
    ]);
    expect(JSON.parse(messages[1]?.item?.output ?? "{}")).toMatchObject({
      ok: true,
      tool: "set_response_language_mode",
      result: {
        action: "set_response_language_mode",
        responseLanguageMode: "klingon",
      },
    });

    registry.disposeSession("session-language");
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
    await expect(registry.prepareSession("pymol", "push_to_talk")).rejects.toThrow(/Local Realtime slots are full/);

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

  it("prunes stale setup records before reporting active runtime health", async () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (
        sessionId: string,
        callId: string,
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
      ) => {
        connectedAtMs: number | null;
        lastActivityAt: number;
        status: {
          status: "awaiting_call" | "connecting" | "connected" | "error" | "disconnected";
          sidebandStatus: "pending_call" | "connecting" | "connected" | "reconnecting" | "error" | "disconnected";
        };
      };
      sessions: Map<string, unknown>;
      pymolAdapter: {
        getAvailabilitySummary: () => Promise<{ ready: boolean }>;
      };
      chimeraXAdapter: {
        getAvailabilitySummary: () => Promise<{ ready: boolean }>;
      };
      getRuntimeHealth: () => Promise<{
        sessions: {
          total: number;
          active: number;
          awaitingCall: number;
          connected: number;
        };
      }>;
    };

    registry.pymolAdapter = { getAvailabilitySummary: vi.fn(async () => ({ ready: true })) };
    registry.chimeraXAdapter = { getAvailabilitySummary: vi.fn(async () => ({ ready: true })) };

    const staleSetup = registry.createSessionRecord("session-stale-setup", "", "pymol", "push_to_talk");
    staleSetup.lastActivityAt = Date.now() - 31_000;
    registry.sessions.set("session-stale-setup", staleSetup);

    const liveSession = registry.createSessionRecord("session-live", "call-live", "pymol", "push_to_talk");
    liveSession.connectedAtMs = Date.now();
    liveSession.status = {
      ...liveSession.status,
      status: "connected",
      sidebandStatus: "connected",
    };
    registry.sessions.set("session-live", liveSession);

    const health = await registry.getRuntimeHealth();

    expect(registry.sessions.has("session-stale-setup")).toBe(false);
    expect(health.sessions.total).toBe(1);
    expect(health.sessions.active).toBe(1);
    expect(health.sessions.awaitingCall).toBe(0);
    expect(health.sessions.connected).toBe(1);
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

  it("requires both global and per-session opt-in for raw expert commands", async () => {
    const globallyEnabled = createRegistry({ expertCommandsEnabled: true }) as never as {
      buildSessionConfig: (
        target: "pymol" | "chimerax",
        voiceMode: "push_to_talk" | "open_mic",
        recipeId?: string,
        advancedMode?: boolean,
      ) => { tools: Array<{ name: string; parameters: unknown }> };
      executeTargetActions: (
        target: "pymol" | "chimerax",
        actions: Array<Record<string, unknown>>,
        dryRun: boolean,
        allowRawCommands: boolean,
      ) => Promise<{ commandsExecuted: string[] }>;
    };
    const globallyDisabled = createRegistry({ expertCommandsEnabled: false }) as never as typeof globallyEnabled;

    const standardTool = globallyEnabled.buildSessionConfig("pymol", "push_to_talk").tools
      .find((tool) => tool.name === "run_pymol_actions");
    const advancedTool = globallyEnabled.buildSessionConfig("pymol", "push_to_talk", undefined, true).tools
      .find((tool) => tool.name === "run_pymol_actions");
    expect(JSON.stringify(standardTool)).not.toContain("raw_command");
    expect(JSON.stringify(advancedTool)).toContain("raw_command");

    await expect(globallyEnabled.executeTargetActions(
      "pymol",
      [{ type: "raw_command", command: "print('no confirmation')" }],
      true,
      true,
    )).rejects.toThrow(/explicit confirmation/i);
    await expect(globallyDisabled.executeTargetActions(
      "pymol",
      [{ type: "raw_command", command: "print('globally disabled')", requiresConfirmation: true }],
      true,
      true,
    )).rejects.toThrow(/disabled/i);

    const allowed = await globallyEnabled.executeTargetActions(
      "pymol",
      [{ type: "raw_command", command: "print('confirmed')", requiresConfirmation: true }],
      true,
      true,
    );
    expect(allowed.commandsExecuted).toContain("print('confirmed')");
  });

  it("hangs up the upstream Realtime call when a local session disconnects", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const registry = createRegistry({ openAiApiKey: "sk-test" });
    vi.spyOn(registry as any, "createEphemeralSession").mockResolvedValue({ value: "ephemeral-secret" });
    vi.spyOn(registry as any, "attachSideband").mockResolvedValue(undefined);

    const prepared = await registry.prepareSession("pymol", "push_to_talk");
    registry.registerCall(prepared.sessionId, "call_disconnect_test", prepared.registerToken);
    await registry.disconnect(prepared.sessionId);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/calls/call_disconnect_test/hangup",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("creates one-step checkpoints and consumes them after undo", async () => {
    const registry = createRegistry() as never as {
      executeTargetActions: (
        target: "pymol" | "chimerax",
        actions: Array<Record<string, unknown>>,
        dryRun?: boolean,
        allowRawCommands?: boolean,
      ) => Promise<unknown>;
      getUndoAvailability: (target: "pymol" | "chimerax") => { available: boolean };
      undoLastAction: (target: "pymol" | "chimerax") => Promise<unknown>;
      pymolAdapter: {
        execute: ReturnType<typeof vi.fn>;
        restoreCheckpoint: ReturnType<typeof vi.fn>;
      };
      receiptStore: {
        create: ReturnType<typeof vi.fn>;
        clearCheckpointAvailability: ReturnType<typeof vi.fn>;
      };
    };
    const actionResult = {
      target: "pymol",
      commandsExecuted: ["color cyan, all"],
      logs: [],
      artifacts: [],
      metrics: [],
      warnings: [],
      state: {},
    };
    registry.receiptStore = {
      create: vi.fn(async () => ({})),
      clearCheckpointAvailability: vi.fn(async () => {}),
    };
    registry.pymolAdapter = {
      execute: vi.fn(async (_actions, _dryRun, _raw, checkpointPath?: string) => {
        expect(checkpointPath).toMatch(/\.pse$/);
        await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(checkpointPath!), { recursive: true })
          .then(() => fs.writeFile(checkpointPath!, "checkpoint", "utf8")));
        return actionResult;
      }),
      restoreCheckpoint: vi.fn(async () => actionResult),
    };

    await registry.executeTargetActions("pymol", [{ type: "color", color: "cyan" }]);
    expect(registry.getUndoAvailability("pymol").available).toBe(true);

    await registry.undoLastAction("pymol");
    expect(registry.pymolAdapter.restoreCheckpoint).toHaveBeenCalledTimes(1);
    expect(registry.getUndoAvailability("pymol").available).toBe(false);
  });

  it("records dry-run action bundles as planned without claiming an undo checkpoint", async () => {
    const registry = createRegistry() as never as {
      runActionEnvelope: (request: Record<string, unknown>) => Promise<unknown>;
      pymolAdapter: { execute: ReturnType<typeof vi.fn> };
      receiptStore: {
        create: ReturnType<typeof vi.fn>;
        clearCheckpointAvailability: ReturnType<typeof vi.fn>;
      };
    };
    registry.receiptStore = {
      create: vi.fn(async () => ({})),
      clearCheckpointAvailability: vi.fn(async () => {}),
    };
    registry.pymolAdapter = {
      execute: vi.fn(async () => ({
        target: "pymol",
        commandsExecuted: [],
        logs: [],
        artifacts: [],
        metrics: [],
        warnings: [],
        state: {},
      })),
    };

    await registry.runActionEnvelope({
      target: "pymol",
      dryRun: true,
      actions: [{ type: "color", color: "cyan" }],
    });

    expect(registry.receiptStore.create).toHaveBeenCalledWith(expect.objectContaining({
      evidenceLevel: "planned",
      checkpointAvailable: false,
    }));
  });

  it("queues undo behind an in-flight target action and restores that action's checkpoint", async () => {
    const registry = createRegistry() as never as {
      executeTargetActions: (
        target: "pymol" | "chimerax",
        actions: Array<Record<string, unknown>>,
      ) => Promise<unknown>;
      undoLastAction: (target: "pymol" | "chimerax") => Promise<unknown>;
      getUndoAvailability: (target: "pymol" | "chimerax") => { available: boolean };
      pymolAdapter: {
        execute: ReturnType<typeof vi.fn>;
        restoreCheckpoint: ReturnType<typeof vi.fn>;
      };
      receiptStore: {
        create: ReturnType<typeof vi.fn>;
        clearCheckpointAvailability: ReturnType<typeof vi.fn>;
      };
    };
    const actionResult = {
      target: "pymol",
      commandsExecuted: ["color cyan, all"],
      logs: [],
      artifacts: [],
      metrics: [],
      warnings: [],
      state: {},
    };
    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    let createdCheckpointPath: string | undefined;
    registry.receiptStore = {
      create: vi.fn(async () => ({})),
      clearCheckpointAvailability: vi.fn(async () => {}),
    };
    registry.pymolAdapter = {
      execute: vi.fn(async (_actions, _dryRun, _raw, checkpointPath?: string) => {
        createdCheckpointPath = checkpointPath;
        await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(checkpointPath!), { recursive: true })
          .then(() => fs.writeFile(checkpointPath!, "pre-action scene", "utf8")));
        await actionGate;
        return actionResult;
      }),
      restoreCheckpoint: vi.fn(async () => actionResult),
    };

    const actionPromise = registry.executeTargetActions("pymol", [{ type: "color", color: "cyan" }]);
    await vi.waitFor(() => expect(createdCheckpointPath).toMatch(/\.pse$/));
    const undoPromise = registry.undoLastAction("pymol");
    await Promise.resolve();
    expect(registry.pymolAdapter.restoreCheckpoint).not.toHaveBeenCalled();

    releaseAction();
    await actionPromise;
    await undoPromise;

    expect(registry.pymolAdapter.restoreCheckpoint).toHaveBeenCalledWith(createdCheckpointPath);
    expect(registry.getUndoAvailability("pymol").available).toBe(false);
  });

  it("keeps one pre-run checkpoint across every step of a complete recipe", async () => {
    const registry = createRegistry() as never as {
      runRecipeDirect: (
        recipeId: string,
        target: "pymol" | "chimerax",
        dryRun?: boolean,
      ) => Promise<unknown>;
      getUndoAvailability: (target: "pymol" | "chimerax") => { available: boolean; summary?: string };
      undoLastAction: (target: "pymol" | "chimerax") => Promise<unknown>;
      pymolAdapter: {
        execute: ReturnType<typeof vi.fn>;
        restoreCheckpoint: ReturnType<typeof vi.fn>;
        waitUntilCommandReady: ReturnType<typeof vi.fn>;
      };
      receiptStore: {
        create: ReturnType<typeof vi.fn>;
        clearCheckpointAvailability: ReturnType<typeof vi.fn>;
      };
    };
    const actionResult = {
      target: "pymol",
      commandsExecuted: [],
      logs: [],
      artifacts: [],
      metrics: [],
      warnings: [],
      state: {},
    };
    registry.receiptStore = {
      create: vi.fn(async () => ({})),
      clearCheckpointAvailability: vi.fn(async () => {}),
    };
    registry.pymolAdapter = {
      execute: vi.fn(async (_actions, _dryRun, _raw, checkpointPath?: string) => {
        if (checkpointPath) {
          await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(checkpointPath), { recursive: true })
            .then(() => fs.writeFile(checkpointPath, "pre-recipe scene", "utf8")));
        }
        return { ...actionResult };
      }),
      restoreCheckpoint: vi.fn(async () => actionResult),
      waitUntilCommandReady: vi.fn(async () => {}),
    };

    await registry.runRecipeDirect("pymol-surface-and-presentation", "pymol");

    const checkpointPaths = registry.pymolAdapter.execute.mock.calls
      .map((call) => call[3] as string | undefined)
      .filter((value): value is string => Boolean(value));
    expect(registry.pymolAdapter.execute).toHaveBeenCalledTimes(4);
    expect(checkpointPaths).toHaveLength(1);
    expect(registry.getUndoAvailability("pymol")).toMatchObject({
      available: true,
      summary: expect.stringMatching(/surface.*presentation/i),
    });
    expect(registry.receiptStore.create).toHaveBeenCalledWith(expect.objectContaining({
      source: "recipe",
      checkpointAvailable: true,
    }));

    await registry.undoLastAction("pymol");
    expect(registry.pymolAdapter.restoreCheckpoint).toHaveBeenCalledWith(checkpointPaths[0]);
  });

  it("keeps one pre-run checkpoint across a multi-phase scientific workflow", async () => {
    const registry = createRegistry() as never as {
      runScientificWorkflowDirect: (request: Record<string, unknown>) => Promise<unknown>;
      getUndoAvailability: (target: "pymol" | "chimerax") => { available: boolean; summary?: string };
      undoLastAction: (target: "pymol" | "chimerax") => Promise<unknown>;
      pymolAdapter: {
        execute: ReturnType<typeof vi.fn>;
        restoreCheckpoint: ReturnType<typeof vi.fn>;
        getStateSummary: ReturnType<typeof vi.fn>;
      };
      receiptStore: {
        create: ReturnType<typeof vi.fn>;
        clearCheckpointAvailability: ReturnType<typeof vi.fn>;
      };
    };
    const actionResult = {
      target: "pymol",
      commandsExecuted: [],
      logs: [],
      artifacts: [],
      metrics: [],
      warnings: [],
      state: {},
    };
    registry.receiptStore = {
      create: vi.fn(async () => ({})),
      clearCheckpointAvailability: vi.fn(async () => {}),
    };
    registry.pymolAdapter.execute = vi.fn(async (actions, _dryRun, _raw, checkpointPath?: string) => {
      if (checkpointPath) {
        await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(checkpointPath), { recursive: true })
          .then(() => fs.writeFile(checkpointPath, "pre-workflow scene", "utf8")));
      }
      return {
        ...actionResult,
        commandsExecuted: (actions as Array<{ type?: string }>).map((action) => action.type ?? "action"),
      };
    });
    registry.pymolAdapter.restoreCheckpoint = vi.fn(async () => actionResult);
    registry.pymolAdapter.getStateSummary = vi.fn(async () => ({}));

    await registry.runScientificWorkflowDirect({
      target: "pymol",
      workflow: "alphafold_confidence_review",
      presentationMode: "demo",
      inputs: {
        modelPath: scientificTestFixturePath("af-p69905.pdb"),
        paePath: scientificTestFixturePath("af-p69905-pae.json"),
      },
    });

    const checkpointPaths = registry.pymolAdapter.execute.mock.calls
      .map((call) => call[3] as string | undefined)
      .filter((value): value is string => Boolean(value));
    expect(registry.pymolAdapter.execute.mock.calls.length).toBeGreaterThan(1);
    expect(checkpointPaths).toHaveLength(1);
    expect(registry.getUndoAvailability("pymol")).toMatchObject({
      available: true,
      summary: "Scientific workflow: alphafold_confidence_review",
    });
    expect(registry.receiptStore.create).toHaveBeenCalledWith(expect.objectContaining({
      source: "scientific-workflow",
      checkpointAvailable: true,
    }));

    registry.receiptStore.create.mockClear();
    await registry.runScientificWorkflowDirect({
      target: "pymol",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      inputs: {
        modelPath: scientificTestFixturePath("af-p69905.pdb"),
      },
    });
    expect(registry.receiptStore.create).toHaveBeenCalledWith(expect.objectContaining({
      source: "scientific-workflow",
      evidenceLevel: "planned",
      checkpointAvailable: false,
    }));

    await registry.undoLastAction("pymol");
    expect(registry.pymolAdapter.restoreCheckpoint).toHaveBeenCalledWith(checkpointPaths[0]);
  });

  it("requires a session-bound, unexpired, single-use grant before viewport upload", () => {
    const disabledRegistry = createRegistry() as never as {
      grantCaptureUploadConsent: (sessionId: string) => { expiresAt: string };
    };
    expect(() => disabledRegistry.grantCaptureUploadConsent("any-session")).toThrow(/ALLOW_CAPTURE_UPLOADS=true/);

    const registry = createRegistry({ captureUploadsEnabled: true }) as never as {
      createSessionRecord: (...args: unknown[]) => { captureUploadConsent: { expiresAtMs: number } | null };
      sessions: Map<string, unknown>;
      grantCaptureUploadConsent: (sessionId: string) => { expiresAt: string };
      consumeCaptureUploadConsent: (sessionId: string) => void;
      disposeSession: (sessionId: string) => void;
    };
    const first = registry.createSessionRecord("session-consent-a", "call-a", "pymol", "push_to_talk");
    const second = registry.createSessionRecord("session-consent-b", "call-b", "pymol", "push_to_talk");
    registry.sessions.set("session-consent-a", first);
    registry.sessions.set("session-consent-b", second);

    const grant = registry.grantCaptureUploadConsent("session-consent-a");
    expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
    expect(() => registry.consumeCaptureUploadConsent("session-consent-b")).toThrow(/fresh one-shot consent/i);
    expect(() => registry.consumeCaptureUploadConsent("session-consent-a")).not.toThrow();
    expect(() => registry.consumeCaptureUploadConsent("session-consent-a")).toThrow(/fresh one-shot consent/i);

    registry.grantCaptureUploadConsent("session-consent-a");
    first.captureUploadConsent = { expiresAtMs: Date.now() - 1 };
    expect(() => registry.consumeCaptureUploadConsent("session-consent-a")).toThrow(/fresh one-shot consent/i);

    registry.disposeSession("session-consent-a");
    registry.disposeSession("session-consent-b");
  });

  it("rejects capture attachment tool calls when the session has no user consent grant", async () => {
    const registry = createRegistry({ captureUploadsEnabled: true }) as never as {
      createSessionRecord: (...args: unknown[]) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
      };
      executeToolCall: (sessionId: string, callId: string, toolName: string, argumentsJson: string) => Promise<void>;
      captureViewDirect: ReturnType<typeof vi.fn>;
      sessions: Map<string, unknown>;
      disposeSession: (sessionId: string) => void;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-capture-no-consent", "call-capture", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-capture-no-consent", record);
    registry.captureViewDirect = vi.fn();

    await registry.executeToolCall(
      "session-capture-no-consent",
      "tool-call-capture",
      "capture_view",
      JSON.stringify({ target: "pymol", attachToConversation: true }),
    );

    expect(registry.captureViewDirect).not.toHaveBeenCalled();
    const outputMessage = sent
      .map((payload) => JSON.parse(payload) as { type: string; item?: { output?: string } })
      .find((message) => message.type === "conversation.item.create");
    expect(JSON.parse(outputMessage?.item?.output ?? "{}")).toMatchObject({
      ok: false,
      tool: "capture_view",
      error: expect.stringMatching(/one-shot consent grant/i),
    });

    registry.disposeSession("session-capture-no-consent");
  });

  it("keeps oversized consented captures local and reports the attachment limit", async () => {
    const scratchDir = path.join(process.cwd(), ".runtime", "tests", `capture-upload-${crypto.randomUUID()}`);
    const capturePath = path.join(scratchDir, "oversized-viewport.png");
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(capturePath, Buffer.from([0]));
    await fs.truncate(capturePath, 10 * 1024 * 1024 + 1);

    const registry = createRegistry({ captureUploadsEnabled: true }) as never as {
      createSessionRecord: (...args: unknown[]) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
      };
      executeToolCall: (sessionId: string, callId: string, toolName: string, argumentsJson: string) => Promise<void>;
      captureViewDirect: ReturnType<typeof vi.fn>;
      grantCaptureUploadConsent: (sessionId: string) => { expiresAt: string };
      sessions: Map<string, unknown>;
      disposeSession: (sessionId: string) => void;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-capture-oversized", "call-capture", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-capture-oversized", record);
    registry.captureViewDirect = vi.fn(async () => ({
      target: "pymol",
      commandsExecuted: [],
      logs: [],
      artifacts: [{ kind: "image", path: capturePath, label: "PyMOL PNG capture" }],
      metrics: [],
      warnings: [],
    }));

    try {
      registry.grantCaptureUploadConsent("session-capture-oversized");
      await registry.executeToolCall(
        "session-capture-oversized",
        "tool-call-capture-oversized",
        "capture_view",
        JSON.stringify({ target: "pymol", attachToConversation: true }),
      );

      const messages = sent.map((payload) => JSON.parse(payload) as {
        type: string;
        item?: { type?: string; output?: string; content?: Array<{ type?: string }> };
      });
      const outputMessage = messages.find((message) => (
        message.type === "conversation.item.create" && message.item?.type === "function_call_output"
      ));
      const output = JSON.parse(outputMessage?.item?.output ?? "{}") as { warnings?: string[] };
      expect(output.warnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/remained local.*10 MB conversation-attachment limit/i),
      ]));
      expect(messages.some((message) => (
        message.item?.type === "message"
        && message.item.content?.some((content) => content.type === "input_image")
      ))).toBe(false);
      await expect(fs.stat(capturePath)).resolves.toMatchObject({ size: 10 * 1024 * 1024 + 1 });
    } finally {
      registry.disposeSession("session-capture-oversized");
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("attaches a bounded capture after one-shot consent", async () => {
    const scratchDir = path.join(process.cwd(), ".runtime", "tests", `capture-upload-${crypto.randomUUID()}`);
    const capturePath = path.join(scratchDir, "viewport.png");
    const captureBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(capturePath, captureBytes);

    const registry = createRegistry({ captureUploadsEnabled: true }) as never as {
      createSessionRecord: (...args: unknown[]) => {
        ws: {
          readyState: number;
          send: (payload: string) => void;
          removeAllListeners: () => void;
          close: () => void;
        };
      };
      executeToolCall: (sessionId: string, callId: string, toolName: string, argumentsJson: string) => Promise<void>;
      captureViewDirect: ReturnType<typeof vi.fn>;
      grantCaptureUploadConsent: (sessionId: string) => { expiresAt: string };
      sessions: Map<string, unknown>;
      disposeSession: (sessionId: string) => void;
    };
    const sent: string[] = [];
    const record = registry.createSessionRecord("session-capture-bounded", "call-capture", "pymol", "push_to_talk");
    record.ws = {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      removeAllListeners: vi.fn(),
      close: vi.fn(),
    };
    registry.sessions.set("session-capture-bounded", record);
    registry.captureViewDirect = vi.fn(async () => ({
      target: "pymol",
      commandsExecuted: [],
      logs: [],
      artifacts: [{ kind: "image", path: capturePath, label: "PyMOL PNG capture" }],
      metrics: [],
      warnings: [],
    }));

    try {
      registry.grantCaptureUploadConsent("session-capture-bounded");
      await registry.executeToolCall(
        "session-capture-bounded",
        "tool-call-capture-bounded",
        "capture_view",
        JSON.stringify({ target: "pymol", attachToConversation: true }),
      );

      const messages = sent.map((payload) => JSON.parse(payload) as {
        type: string;
        item?: {
          type?: string;
          content?: Array<{ type?: string; image_url?: string }>;
        };
      });
      const captureMessage = messages.find((message) => message.item?.type === "message");
      const image = captureMessage?.item?.content?.find((content) => content.type === "input_image");
      expect(image?.image_url).toBe(`data:image/png;base64,${captureBytes.toString("base64")}`);
    } finally {
      registry.disposeSession("session-capture-bounded");
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  });

  it("disconnects a session when a server-side usage cap is breached", () => {
    const registry = createRegistry() as never as {
      createSessionRecord: (...args: unknown[]) => {
        status: { usage: ReturnType<typeof createEmptySessionUsage> };
        connectedAtMs: number | null;
      };
      sessions: Map<string, unknown>;
      refreshSessionUsageGuardrails: (sessionId: string) => void;
      disconnect: ReturnType<typeof vi.fn>;
    };
    const record = registry.createSessionRecord("session-breach", "call-breach", "pymol", "push_to_talk");
    record.connectedAtMs = Date.now();
    record.status.usage = {
      ...createEmptySessionUsage(),
      responseCount: 19,
    };
    registry.sessions.set("session-breach", record);
    registry.disconnect = vi.fn(async () => {});

    registry.refreshSessionUsageGuardrails("session-breach");

    expect(registry.disconnect).toHaveBeenCalledWith("session-breach");
  });
});
