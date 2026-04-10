import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { WebSocket } from "ws";
import type { Request, Response } from "express";
import {
  actionEnvelopeSchema,
  captureViewRequestSchema,
  chimeraXEnvelopeSchema,
  chimeraXExportSchema,
  pymolExportSchema,
  pymolEnvelopeSchema,
  scientificWorkflowRequestSchema,
  targetKindSchema,
  type ActionEnvelope,
  type ActionResult,
  type CaptureViewRequest,
  type ScientificWorkflowRequest,
  type ScientificWorkflowResult,
  type TargetKind,
  type VoiceMode,
} from "../schemas/index.js";
import { getRecipe, getRecipeStep } from "../examples/index.js";
import { buildSessionInstructions } from "../prompts/index.js";
import { TranscriptStore } from "../store/index.js";
import { buildRealtimeTools } from "./tool-definitions.js";
import { sessionStatusSchema, sessionUiEventSchema, type SessionStatus, type SessionUiEvent } from "./session-events.js";
import {
  accumulateResponseUsage,
  accumulateTranscriptionUsage,
  buildSessionUsageGuardState,
  createEmptySessionUsage,
  formatUsageSummary,
  type SessionUsageGuardrails,
} from "./usage.js";
import { prettyJson } from "../utils/json.js";
import { ChimeraXAdapter, type ChimeraXAdapterOptions } from "../adapters/chimerax-adapter.js";
import { PymolAdapter, type PymolAdapterOptions } from "../adapters/pymol-adapter.js";
import { runScientificWorkflow } from "../scientific/index.js";

export interface RealtimeRegistryOptions {
  openAiApiKey: string;
  realtimeModel: string;
  realtimeVoice: string;
  audioTranscriptionModel: string;
  realtimeOutputSpeed: number;
  realtimeMaxOutputTokens: number | "inf";
  realtimeTracing: "auto" | null;
  realtimeTruncation: {
    retentionRatio: number;
    postInstructions: number;
  } | null;
  sessionGuardrails: SessionUsageGuardrails;
  maxActiveSessions?: number;
  transcriptionPromptHint?: string;
  debugRawEvents?: boolean;
  expertCommandsEnabled?: boolean;
  persistSessionEvents?: boolean;
  pymol: PymolAdapterOptions;
  chimerax: ChimeraXAdapterOptions;
}

interface ConnectRequest {
  offerSdp: string;
  target: TargetKind;
  voiceMode: VoiceMode;
  recipeId?: string;
}

export interface PreparedRealtimeSession {
  sessionId: string;
  clientSecret: string;
  registerToken: string;
  sessionAccessToken: string;
}

interface LocalPreparedSession {
  sessionId: string;
  registerToken: string;
  sessionAccessToken: string;
}

export interface TargetRuntimeAvailability {
  ready: boolean;
  endpoint?: string;
  detail?: string;
  reachable?: boolean;
  commandReady?: boolean;
  busy?: boolean;
  warmupState?: "offline" | "warming" | "ready";
  lastRpcError?: string;
  validatedAt?: string;
}

export interface RealtimeRuntimeHealth {
  sessions: {
    total: number;
    awaitingCall: number;
    connecting: number;
    connected: number;
    error: number;
    disconnected: number;
  };
  targets: {
    pymol: TargetRuntimeAvailability;
    chimerax: TargetRuntimeAvailability;
  };
}

export class RealtimeSessionCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeSessionCapacityError";
  }
}

interface SessionRecord {
  emitter: EventEmitter;
  status: SessionStatus;
  ws: WebSocket | null;
  eventHistory: BufferedSessionEvent[];
  nextSseId: number;
  lastActivityAt: number;
  callId: string;
  accessToken: string;
  registerToken: string | null;
  disconnectRequested: boolean;
  connectedAtMs: number | null;
  sessionDeadlineTimer: NodeJS.Timeout | null;
  lastGuardrailNoticeKey: string | null;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  sidebandGeneration: number;
}

interface BufferedSessionEvent {
  sseId: number;
  event: SessionUiEvent;
}

const SESSION_EVENT_HISTORY_LIMIT = 250;
const SESSION_HEARTBEAT_INTERVAL_MS = 15_000;
const DISCONNECTED_SESSION_TTL_MS = 10 * 60 * 1000;
const PENDING_SESSION_TTL_MS = 2 * 60 * 1000;
const CONNECTED_SESSION_IDLE_TTL_MS = 60 * 60 * 1000;
const MAX_SIDEBAND_RECONNECT_ATTEMPTS = 4;
const REALTIME_CLIENT_SECRET_TTL_SECONDS = 600;
const MAX_TOOL_ARGUMENTS_JSON_BYTES = 48_000;

export class RealtimeSessionRegistry {
  private readonly openAiApiKey: string;
  private readonly realtimeModel: string;
  private readonly realtimeVoice: string;
  private readonly audioTranscriptionModel: string;
  private readonly realtimeOutputSpeed: number;
  private readonly realtimeMaxOutputTokens: number | "inf";
  private readonly realtimeTracing: "auto" | null;
  private readonly realtimeTruncation: {
    retentionRatio: number;
    postInstructions: number;
  } | null;
  private readonly sessionGuardrails: SessionUsageGuardrails;
  private readonly maxActiveSessions: number;
  private readonly transcriptionPromptHint?: string;
  private readonly debugRawEvents: boolean;
  private readonly expertCommandsEnabled: boolean;
  private readonly persistSessionEvents: boolean;
  private readonly transcriptStore = new TranscriptStore();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly pymolAdapter: PymolAdapter;
  private readonly chimeraXAdapter: ChimeraXAdapter;
  private readonly handledCalls = new Map<string, Set<string>>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(options: RealtimeRegistryOptions) {
    this.openAiApiKey = options.openAiApiKey;
    this.realtimeModel = options.realtimeModel;
    this.realtimeVoice = options.realtimeVoice;
    this.audioTranscriptionModel = options.audioTranscriptionModel;
    this.realtimeOutputSpeed = options.realtimeOutputSpeed;
    this.realtimeMaxOutputTokens = options.realtimeMaxOutputTokens;
    this.realtimeTracing = options.realtimeTracing;
    this.realtimeTruncation = options.realtimeTruncation;
    this.sessionGuardrails = options.sessionGuardrails;
    this.maxActiveSessions = Math.max(1, options.maxActiveSessions ?? 2);
    this.transcriptionPromptHint = options.transcriptionPromptHint;
    this.debugRawEvents = options.debugRawEvents ?? false;
    this.expertCommandsEnabled = options.expertCommandsEnabled ?? false;
    this.persistSessionEvents = options.persistSessionEvents ?? false;
    this.pymolAdapter = new PymolAdapter(options.pymol);
    this.chimeraXAdapter = new ChimeraXAdapter(options.chimerax);
    this.cleanupTimer = setInterval(() => {
      this.pruneSessions();
    }, 60_000);
    this.cleanupTimer.unref?.();
  }

  async createClientSecret(target: TargetKind, voiceMode: VoiceMode, recipeId?: string): Promise<string> {
    const prepared = await this.prepareSession(target, voiceMode, recipeId);
    return prepared.clientSecret;
  }

  async prepareSession(target: TargetKind, voiceMode: VoiceMode, recipeId?: string): Promise<PreparedRealtimeSession> {
    const prepared = this.prepareLocalSession(target, voiceMode, recipeId);
    try {
      const clientSecret = await this.createEphemeralSession(target, voiceMode, recipeId);
      return {
        sessionId: prepared.sessionId,
        clientSecret: clientSecret.value,
        registerToken: prepared.registerToken,
        sessionAccessToken: prepared.sessionAccessToken,
      };
    } catch (error) {
      this.disposeSession(prepared.sessionId);
      throw error;
    }
  }

  async connect(request: ConnectRequest): Promise<{ answerSdp: string; sessionId: string; callId: string; sessionAccessToken: string }> {
    this.requireOpenAiApiKey();
    const prepared = this.prepareLocalSession(request.target, request.voiceMode, request.recipeId);
    try {
      const formData = new FormData();
      formData.set("sdp", request.offerSdp);
      formData.set("session", JSON.stringify(this.buildSessionConfig(request.target, request.voiceMode, request.recipeId, false)));

      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
        },
        body: formData,
      });

      const answerSdp = await response.text();
      if (!response.ok) {
        throw new Error(`Failed to start realtime call: ${answerSdp}`);
      }

      const location = response.headers.get("Location");
      const callId = location?.split("/").pop();
      if (!callId) {
        throw new Error("OpenAI did not return a call_id in the Location header.");
      }

      this.registerCall(prepared.sessionId, callId, prepared.registerToken);
      return {
        answerSdp,
        sessionId: prepared.sessionId,
        callId,
        sessionAccessToken: prepared.sessionAccessToken,
      };
    } catch (error) {
      this.disposeSession(prepared.sessionId);
      throw error;
    }
  }

  private prepareLocalSession(target: TargetKind, voiceMode: VoiceMode, recipeId?: string): LocalPreparedSession {
    this.ensureSessionCapacity();
    const sessionId = crypto.randomUUID();
    const sessionAccessToken = crypto.randomUUID();
    const registerToken = crypto.randomUUID();
    const record = this.createSessionRecord(sessionId, "", target, voiceMode, recipeId, sessionAccessToken, registerToken);
    this.sessions.set(sessionId, record);
    this.broadcast(sessionId, {
      kind: "status",
      text: "Realtime session prepared. Waiting for browser call setup.",
      payload: record.status,
    });

    return {
      sessionId,
      registerToken,
      sessionAccessToken,
    };
  }

  private ensureSessionCapacity(): void {
    this.pruneSessions();
    const activeSessions = this.countActiveSessions();
    if (activeSessions < this.maxActiveSessions) {
      return;
    }

    throw new RealtimeSessionCapacityError(
      `Refusing to start another Realtime session because ${activeSessions} active session${activeSessions === 1 ? " is" : "s are"} already open. Disconnect an existing session or wait for a stale setup attempt to expire before starting a new call.`,
    );
  }

  private countActiveSessions(now = Date.now()): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (this.isSessionActive(record, now)) {
        count += 1;
      }
    }
    return count;
  }

  private isSessionActive(record: SessionRecord, now: number): boolean {
    if (record.status.status === "disconnected") {
      return false;
    }
    if (record.status.status === "connected") {
      return now - record.lastActivityAt < CONNECTED_SESSION_IDLE_TTL_MS;
    }

    const ttlMs = record.status.status === "awaiting_call" ? PENDING_SESSION_TTL_MS : DISCONNECTED_SESSION_TTL_MS;
    return now - record.lastActivityAt < ttlMs;
  }

  registerCall(sessionId: string, callId: string, registerToken: string): string {
    const record = this.requireSession(sessionId);
    if (!record.registerToken) {
      throw new Error("Realtime call already registered for this session.");
    }
    if (registerToken !== record.registerToken) {
      throw new Error("Invalid realtime call registration token.");
    }
    record.registerToken = null;
    record.callId = callId;
    record.status = sessionStatusSchema.parse({
      ...record.status,
      callId,
      status: "connecting",
      sidebandStatus: "connecting",
      controllerReady: false,
      configSyncPending: true,
      lastError: undefined,
    });
    this.broadcast(sessionId, {
      kind: "status",
      text: "Connecting sideband controller.",
      payload: record.status,
    });

    this.attachSideband(sessionId, callId).catch((error) => {
      this.setStatus(sessionId, {
        status: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      this.broadcast(sessionId, {
        kind: "log",
        level: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    });

    return sessionId;
  }

  private createSessionRecord(
    sessionId: string,
    callId: string,
    target: TargetKind,
    voiceMode: VoiceMode,
    recipeId?: string,
    accessToken?: string,
    registerToken?: string,
  ): SessionRecord {
    const createdAtMs = Date.now();
    const status = sessionStatusSchema.parse({
      sessionId,
      callId,
      status: "awaiting_call",
      sidebandStatus: "pending_call",
      target,
      voiceMode,
      advancedMode: false,
      recipeId,
      controllerReady: false,
      controllerReadyAt: undefined,
      configSyncPending: false,
      lastSidebandEventAt: undefined,
      eventSubscribers: 0,
      toolBusy: false,
      usage: createEmptySessionUsage(),
      usageGuardrails: buildSessionUsageGuardState(
        createEmptySessionUsage(),
        this.sessionGuardrails,
        createdAtMs,
        createdAtMs,
      ),
    });

    return {
      emitter: new EventEmitter(),
      status,
      ws: null,
      eventHistory: [],
      nextSseId: 1,
      lastActivityAt: Date.now(),
      callId,
      accessToken: accessToken ?? crypto.randomUUID(),
      registerToken: registerToken ?? null,
      disconnectRequested: false,
      connectedAtMs: null,
      sessionDeadlineTimer: null,
      lastGuardrailNoticeKey: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      sidebandGeneration: 0,
    };
  }

  validateSessionAccess(sessionId: string, accessToken: string): void {
    const record = this.requireSession(sessionId);
    if (!accessToken || accessToken !== record.accessToken) {
      throw new Error("Invalid realtime session access token.");
    }
  }

  async updateTarget(sessionId: string, target: TargetKind): Promise<SessionStatus> {
    const record = this.requireSession(sessionId);
    record.status = sessionStatusSchema.parse({
      ...record.status,
      target,
      targetState: undefined,
    });
    await this.pushSessionUpdate(sessionId);
    this.broadcast(sessionId, {
      kind: "status",
      text: `Active target set to ${target}.`,
      payload: record.status,
    });
    return record.status;
  }

  async updateVoiceMode(sessionId: string, voiceMode: VoiceMode): Promise<SessionStatus> {
    const record = this.requireSession(sessionId);
    record.status = sessionStatusSchema.parse({
      ...record.status,
      voiceMode,
    });
    await this.pushSessionUpdate(sessionId);
    this.broadcast(sessionId, {
      kind: "status",
      text: `Voice mode set to ${voiceMode}.`,
      payload: record.status,
    });
    return record.status;
  }

  async updateAdvancedMode(sessionId: string, advancedMode: boolean): Promise<SessionStatus> {
    const record = this.requireSession(sessionId);
    const effectiveAdvancedMode = advancedMode && this.expertCommandsEnabled;
    record.status = sessionStatusSchema.parse({
      ...record.status,
      advancedMode: effectiveAdvancedMode,
    });
    await this.pushSessionUpdate(sessionId);
    this.broadcast(sessionId, {
      kind: "status",
      text:
        advancedMode && !this.expertCommandsEnabled
          ? "Advanced expert commands remain disabled because ENABLE_EXPERT_RAW_COMMANDS is off on the backend."
          : effectiveAdvancedMode
          ? "Advanced expert commands enabled."
          : "Advanced expert commands disabled.",
      payload: record.status,
    });
    return record.status;
  }

  async updateRecipe(sessionId: string, recipeId?: string): Promise<SessionStatus> {
    const record = this.requireSession(sessionId);
    record.status = sessionStatusSchema.parse({
      ...record.status,
      recipeId,
    });
    await this.pushSessionUpdate(sessionId);
    this.broadcast(sessionId, {
      kind: "status",
      text: recipeId ? `Pinned recipe ${recipeId}.` : "Cleared pinned recipe.",
      payload: record.status,
    });
    return record.status;
  }

  getStatus(sessionId: string): SessionStatus {
    return this.requireSession(sessionId).status;
  }

  async getRuntimeHealth(): Promise<RealtimeRuntimeHealth> {
    const sessionCounts: RealtimeRuntimeHealth["sessions"] = {
      total: this.sessions.size,
      awaitingCall: 0,
      connecting: 0,
      connected: 0,
      error: 0,
      disconnected: 0,
    };

    for (const record of this.sessions.values()) {
      switch (record.status.status) {
        case "awaiting_call":
          sessionCounts.awaitingCall += 1;
          break;
        case "connecting":
          sessionCounts.connecting += 1;
          break;
        case "connected":
          sessionCounts.connected += 1;
          break;
        case "error":
          sessionCounts.error += 1;
          break;
        case "disconnected":
          sessionCounts.disconnected += 1;
          break;
      }
    }

    const [pymol, chimerax] = await Promise.all([
      this.pymolAdapter.getAvailabilitySummary(),
      this.chimeraXAdapter.getAvailabilitySummary(),
    ]);

    return {
      sessions: sessionCounts,
      targets: {
        pymol,
        chimerax,
      },
    };
  }

  subscribe(sessionId: string, request: Request, response: Response): void {
    const record = this.requireSession(sessionId);
    this.setStatus(sessionId, {
      eventSubscribers: record.status.eventSubscribers + 1,
    });
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const lastEventIdHeader = request.headers["last-event-id"];
    const lastEventId = typeof lastEventIdHeader === "string" ? Number(lastEventIdHeader) : Number.NaN;
    const replayFrom = Number.isFinite(lastEventId) ? lastEventId : 0;

    for (const entry of record.eventHistory) {
      if (entry.sseId > replayFrom) {
        this.writeSseEvent(response, entry);
      }
    }

    if (!record.eventHistory.length) {
      this.writeSseEvent(response, {
        sseId: 0,
        event: this.makeEvent({
          kind: "status",
          payload: record.status,
          text: "Subscribed to session stream.",
        }),
      });
    }

    const heartbeat = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, SESSION_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    const onEvent = (entry: BufferedSessionEvent) => {
      this.writeSseEvent(response, entry);
    };

    record.emitter.on("event", onEvent);

    response.on("close", () => {
      clearInterval(heartbeat);
      record.emitter.off("event", onEvent);
      const latest = this.sessions.get(sessionId);
      if (latest) {
        this.setStatus(sessionId, {
          eventSubscribers: Math.max(0, latest.status.eventSubscribers - 1),
        });
      }
    });
  }

  async disconnect(sessionId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    record.disconnectRequested = true;
    if (record.sessionDeadlineTimer) {
      clearTimeout(record.sessionDeadlineTimer);
      record.sessionDeadlineTimer = null;
    }
    if (record.reconnectTimer) {
      clearTimeout(record.reconnectTimer);
      record.reconnectTimer = null;
    }
    record.sidebandGeneration += 1;
    record.ws?.close();
    record.ws = null;
    this.handledCalls.delete(sessionId);
    this.setStatus(sessionId, {
      status: "disconnected",
      sidebandStatus: "disconnected",
      controllerReady: false,
      configSyncPending: false,
    });
    this.broadcast(sessionId, {
      kind: "status",
      text: "Disconnected session.",
      payload: record.status,
    });
    // Revoke the bearer so copied SSE/status URLs stop working after disconnect.
    record.accessToken = crypto.randomUUID();
    record.lastActivityAt = 0;
  }

  async getTargetState(target: TargetKind): Promise<unknown> {
    if (target === "pymol") {
      return this.pymolAdapter.getStateSummary();
    }
    return this.chimeraXAdapter.getStateSummary();
  }

  async runActionEnvelope(envelope: ActionEnvelope): Promise<ActionResult> {
    const parsed = actionEnvelopeSchema.parse(envelope);
    return this.executeTargetActions(parsed.target, parsed.actions as never, parsed.dryRun, this.expertCommandsEnabled);
  }

  async runRecipeStepDirect(
    recipeId: string,
    stepId: string,
    target: TargetKind,
    dryRun = false,
  ): Promise<ActionResult> {
    const step = getRecipeStep(recipeId, stepId, target);
    return this.executeTargetActions(target, step.actions as never, dryRun, this.expertCommandsEnabled);
  }

  async runRecipeDirect(
    recipeId: string,
    target: TargetKind,
    dryRun = false,
  ): Promise<{
    recipeId: string;
    target: TargetKind;
    dryRun: boolean;
    stepResults: Array<{
      stepId: string;
      title: string;
      summary: string;
      result: ActionResult;
    }>;
  }> {
    const recipe = getRecipe(recipeId);
    if (!recipe.apps.includes(target)) {
      throw new Error(`Recipe ${recipeId} is not available for ${target}.`);
    }

    const stepResults: Array<{
      stepId: string;
      title: string;
      summary: string;
      result: ActionResult;
    }> = [];

    for (const [index, step] of recipe.steps.entries()) {
      let result: ActionResult;
      try {
        result = await this.executeTargetActions(target, step.actions as never, dryRun, this.expertCommandsEnabled);
      } catch (error) {
        throw new Error(
          `Recipe ${recipeId} failed at step ${step.id} (${step.title}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!dryRun && target === "pymol" && index < recipe.steps.length - 1) {
        try {
          await this.pymolAdapter.waitUntilCommandReady(30_000);
        } catch (error) {
          result.warnings = [
            ...result.warnings,
            `PyMOL was slow to stabilize after step ${step.id} (${step.title}): ${error instanceof Error ? error.message : String(error)}`,
          ];
        }
      }

      stepResults.push({
        stepId: step.id,
        title: step.title,
        summary: step.summary,
        result,
      });
    }

    return {
      recipeId,
      target,
      dryRun,
      stepResults,
    };
  }

  async runScientificWorkflowDirect(request: ScientificWorkflowRequest): Promise<ScientificWorkflowResult> {
    const parsed = scientificWorkflowRequestSchema.parse(request);
    const allowRawCommands = this.expertCommandsEnabled;
    return runScientificWorkflow(parsed, {
      clearWorkflowContext: (target) => {
        this.clearTargetWorkflowContext(target);
      },
      setWorkflowContext: (target, context) => {
        this.setTargetWorkflowContext(target, context);
      },
      executeActions: async (target, actions, dryRun) => this.executeTargetActions(target, actions as never, dryRun, allowRawCommands),
      getTargetState: async (target) => {
        const state = await this.getTargetState(target);
        return state && typeof state === "object" ? state as Record<string, unknown> : {};
      },
    });
  }

  async captureViewDirect(request: CaptureViewRequest): Promise<ActionResult> {
    const parsed = captureViewRequestSchema.parse(request);
    return this.captureTargetView(parsed);
  }

  private async captureTargetView(request: {
    target: TargetKind;
    path?: string;
    width?: number;
    height?: number;
  }): Promise<ActionResult> {
    const currentState = await this.getTargetState(request.target);
    const dimensions = resolveCaptureDimensions(request.target, currentState, request.width, request.height);

    if (request.target === "pymol") {
      return this.pymolAdapter.execute([
        {
          type: "export",
          export: pymolExportSchema.parse({
            format: "png",
            path: request.path,
            width: dimensions.width,
            height: dimensions.height,
            rayTrace: false,
          }),
        } as never,
      ], false);
    }

    return this.chimeraXAdapter.execute([
      {
        type: "export",
        export: chimeraXExportSchema.parse({
          format: "png",
          path: request.path,
          width: dimensions.width,
          height: dimensions.height,
        }),
      } as never,
    ], false);
  }

  private async executeTargetActions(
    target: TargetKind,
    actions: Array<Record<string, unknown>>,
    dryRun = false,
    allowRawCommands = false,
  ): Promise<ActionResult> {
    const rawCommandsAllowed = allowRawCommands || this.expertCommandsEnabled;
    assertToolActionsAllowed(actions, rawCommandsAllowed);
    if (target === "pymol") {
      return this.pymolAdapter.execute(actions as never, dryRun, rawCommandsAllowed);
    }

    return this.chimeraXAdapter.execute(actions as never, dryRun, rawCommandsAllowed);
  }

  private setTargetWorkflowContext(
    target: TargetKind,
    context: { referenceHints: Record<string, unknown>; workflowState: Record<string, unknown> },
  ): void {
    if (target === "pymol") {
      this.pymolAdapter.setWorkflowContext(context as never);
      return;
    }
    this.chimeraXAdapter.setWorkflowContext(context as never);
  }

  private clearTargetWorkflowContext(target: TargetKind): void {
    if (target === "pymol") {
      this.pymolAdapter.clearWorkflowContext();
      return;
    }
    this.chimeraXAdapter.clearWorkflowContext();
  }

  private async attachSideband(sessionId: string, callId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    record.callId = callId;
    record.sidebandGeneration += 1;
    const generation = record.sidebandGeneration;
    const previousWs = record.ws;
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${callId}`, {
      headers: {
        Authorization: `Bearer ${this.openAiApiKey}`,
      },
    });

    record.ws = ws;
    if (previousWs && previousWs !== ws) {
      previousWs.removeAllListeners();
      previousWs.close();
    }

    ws.on("open", () => {
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      record.disconnectRequested = false;
      record.reconnectAttempts = 0;
      if (record.reconnectTimer) {
        clearTimeout(record.reconnectTimer);
        record.reconnectTimer = null;
      }
      this.setStatus(sessionId, {
        status: "connecting",
        sidebandStatus: "connecting",
        controllerReady: false,
        configSyncPending: true,
        lastError: undefined,
      });
      this.broadcast(sessionId, {
        kind: "status",
        text: "Sideband controller connected. Syncing controller configuration.",
        payload: record.status,
      });
      void this.pushSessionUpdate(sessionId);
    });

    ws.on("message", (buffer: WebSocket.RawData) => {
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      const raw = buffer.toString();
      void this.handleSidebandMessage(sessionId, raw);
    });

    ws.on("close", () => {
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      record.ws = null;
      if (record.disconnectRequested) {
        if (record.status.status !== "disconnected") {
          this.setStatus(sessionId, {
            status: "disconnected",
            sidebandStatus: "disconnected",
            controllerReady: false,
            configSyncPending: false,
          });
          this.broadcast(sessionId, {
            kind: "status",
            text: "Sideband controller closed.",
            payload: record.status,
          });
        }
        return;
      }

      this.scheduleSidebandReconnect(sessionId);
    });

    ws.on("error", (error: Error) => {
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      record.ws = null;
      this.setStatus(sessionId, {
        sidebandStatus: "error",
        controllerReady: false,
      });
      this.broadcast(sessionId, {
        kind: "log",
        level: "warn",
        text: `Sideband controller error: ${error.message}`,
      });
      if (!record.disconnectRequested) {
        this.scheduleSidebandReconnect(sessionId);
      }
    });
  }

  private async handleSidebandMessage(sessionId: string, raw: string): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.broadcast(sessionId, {
        kind: "log",
        level: "error",
        text: error instanceof Error ? error.message : "Failed to parse Realtime sideband payload.",
        payload: { raw },
      });
      return;
    }
    const eventType = String(payload.type ?? "unknown");
    const nowIso = new Date().toISOString();
    this.setStatus(sessionId, {
      lastSidebandEventAt: nowIso,
      lastRealtimeEventType: eventType,
      lastRealtimeEventAt: nowIso,
    });

    if (this.shouldMirrorRawEvent(eventType)) {
      if (this.persistSessionEvents) {
        void this.transcriptStore.append(sessionId, payload).catch(() => {});
      }
      this.broadcast(sessionId, {
        kind: "raw",
        eventType,
        payload,
      });
    }

    if (eventType === "session.created") {
      const current = this.requireSession(sessionId).status;
      const expected = this.buildSessionConfig(current.target, current.voiceMode, current.recipeId, current.advancedMode);
      const sessionPayload = (payload.session && typeof payload.session === "object")
        ? payload.session as Record<string, unknown>
        : {};
      const configRequiresSync = doesRealtimeSessionRequireSync(sessionPayload, expected);

      this.setStatus(sessionId, {
        status: configRequiresSync ? "connecting" : "connected",
        sidebandStatus: configRequiresSync ? "connecting" : "connected",
        controllerReady: !configRequiresSync,
        controllerReadyAt: !configRequiresSync ? nowIso : current.controllerReadyAt,
        configSyncPending: configRequiresSync,
        lastError: undefined,
      });
      this.broadcast(sessionId, {
        kind: "status",
        text: configRequiresSync
          ? "Realtime session created. Applying a follow-up controller sync."
          : "Realtime session created from the client-secret configuration. Session ready.",
        payload: this.requireSession(sessionId).status,
      });
      if (configRequiresSync) {
        void this.pushSessionUpdate(sessionId);
      }
      this.ensureSessionConnectedAt(sessionId);
      this.refreshSessionUsageGuardrails(sessionId);
      this.scheduleSessionDeadline(sessionId);
      if (!configRequiresSync) {
        this.broadcastGuardrailSummary(sessionId);
      }
      return;
    }

    if (eventType === "session.updated") {
      this.ensureSessionConnectedAt(sessionId);
      this.setStatus(sessionId, {
        status: "connected",
        sidebandStatus: "connected",
        controllerReady: true,
        controllerReadyAt: nowIso,
        configSyncPending: false,
        lastSessionUpdatedAt: nowIso,
        lastError: undefined,
      });
      this.broadcast(sessionId, {
        kind: "status",
        text: "Controller update applied. Session ready.",
        payload: this.requireSession(sessionId).status,
      });
      this.refreshSessionUsageGuardrails(sessionId);
      this.scheduleSessionDeadline(sessionId);
      this.broadcastGuardrailSummary(sessionId);
      return;
    }

    if (eventType === "conversation.item.input_audio_transcription.completed") {
      const usage = accumulateTranscriptionUsage(this.requireSession(sessionId).status.usage, payload.usage);
      this.setStatus(sessionId, { usage });
      this.refreshSessionUsageGuardrails(sessionId);
      if (this.persistSessionEvents) {
        void this.transcriptStore.writeUsage(sessionId, usage).catch(() => {});
      }
      this.broadcast(sessionId, {
        kind: "usage",
        text: formatUsageSummary(usage),
        payload: this.requireSession(sessionId).status,
      });
      this.broadcast(sessionId, {
        kind: "transcript",
        speaker: "user",
        text: String(payload.transcript ?? ""),
        payload,
      });
      return;
    }

    if (eventType === "response.output_audio_transcript.done" || eventType === "response.output_text.done") {
      this.broadcast(sessionId, {
        kind: "transcript",
        speaker: "assistant",
        text: String(payload.transcript ?? payload.text ?? ""),
        payload,
      });
      return;
    }

    if (eventType === "response.function_call_arguments.done") {
      const item = payload.item as Record<string, unknown> | undefined;
      const callId = typeof item?.call_id === "string" ? item.call_id : undefined;
      const toolName = typeof item?.name === "string" ? item.name : undefined;
      const argumentsJson =
        typeof item?.arguments === "string"
          ? item.arguments
          : undefined;

      if (callId && toolName && argumentsJson) {
        const sessionCalls = this.getHandledCalls(sessionId);
        if (!sessionCalls.has(callId)) {
          sessionCalls.add(callId);
          await this.executeToolCall(sessionId, callId, toolName, argumentsJson);
        }
        return;
      }
    }

    if (eventType === "error") {
      const errorPayload = (payload.error && typeof payload.error === "object")
        ? payload.error as Record<string, unknown>
        : {};
      const errorCode = typeof errorPayload.code === "string" ? errorPayload.code : "";
      if (errorCode === "response_cancel_not_active") {
        this.broadcast(sessionId, {
          kind: "log",
          level: "warn",
          text: "Ignored a response cancel because no active response was running.",
          payload,
        });
        return;
      }
      this.broadcast(sessionId, {
        kind: "log",
        level: "error",
        text: prettyJson(payload),
        payload,
      });
      return;
    }

    if (eventType === "response.done") {
      const usage = accumulateResponseUsage(this.requireSession(sessionId).status.usage, (payload.response as { usage?: unknown })?.usage);
      this.setStatus(sessionId, { usage });
      this.refreshSessionUsageGuardrails(sessionId);
      if (this.persistSessionEvents) {
        void this.transcriptStore.writeUsage(sessionId, usage).catch(() => {});
      }
      this.broadcast(sessionId, {
        kind: "usage",
        text: formatUsageSummary(usage),
        payload: this.requireSession(sessionId).status,
      });
      const outputs = Array.isArray((payload.response as { output?: unknown[] })?.output)
        ? ((payload.response as { output?: unknown[] }).output ?? [])
        : [];

      for (const output of outputs) {
        const item = output as Record<string, unknown>;
        if (item.type === "function_call" && item.call_id && typeof item.call_id === "string") {
          const callId = item.call_id;
          const sessionCalls = this.getHandledCalls(sessionId);
          if (sessionCalls.has(callId)) {
            continue;
          }

          sessionCalls.add(callId);
          await this.executeToolCall(
            sessionId,
            callId,
            String(item.name),
            typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
          );
        }
      }
    }
  }

  private async executeToolCall(sessionId: string, callId: string, toolName: string, argumentsJson: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (argumentsJson.length > MAX_TOOL_ARGUMENTS_JSON_BYTES) {
      throw new Error(`Tool arguments exceeded the ${MAX_TOOL_ARGUMENTS_JSON_BYTES}-byte safety limit.`);
    }
    this.setStatus(sessionId, { toolBusy: true });
    this.broadcast(sessionId, {
      kind: "tool_call",
      text: `${toolName}(${argumentsJson})`,
      payload: { toolName, argumentsJson },
    });

    let result: ActionResult | ScientificWorkflowResult | Record<string, unknown>;
    let resultLevel: SessionUiEvent["level"] | undefined;
    let nextTargetState: Record<string, unknown> | undefined;
    let captureInspectionPrompt: string | undefined;
    let attachCaptureToConversation = false;
    const allowSessionRawCommands = record.status.advancedMode && this.expertCommandsEnabled;

    try {
      switch (toolName) {
        case "run_pymol_actions": {
          const parsed = pymolEnvelopeSchema.parse(JSON.parse(argumentsJson));
          result = await this.executeTargetActions(parsed.target, parsed.actions as never, parsed.dryRun, allowSessionRawCommands);
          nextTargetState = (result as ActionResult).state;
          break;
        }
        case "run_chimerax_actions": {
          const parsed = chimeraXEnvelopeSchema.parse(JSON.parse(argumentsJson));
          result = await this.executeTargetActions(parsed.target, parsed.actions as never, parsed.dryRun, allowSessionRawCommands);
          nextTargetState = (result as ActionResult).state;
          break;
        }
        case "get_target_state": {
          const parsed = targetKindSchema.parse(JSON.parse(argumentsJson).target);
          const state = await this.getTargetState(parsed);
          nextTargetState = state as Record<string, unknown>;
          result = { target: parsed, state };
          break;
        }
        case "run_recipe_step": {
          const payload = JSON.parse(argumentsJson) as { recipeId: string; stepId: string; target: TargetKind; dryRun?: boolean };
          result = await this.runRecipeStepDirect(payload.recipeId, payload.stepId, payload.target, payload.dryRun);
          nextTargetState = (result as ActionResult).state;
          break;
        }
        case "run_scientific_workflow": {
          const payload = scientificWorkflowRequestSchema.parse(JSON.parse(argumentsJson));
          result = await this.runScientificWorkflowDirect(payload);
          nextTargetState = result.state && typeof result.state === "object"
            ? result.state as Record<string, unknown>
            : undefined;
          break;
        }
        case "export_artifact": {
          const payload = JSON.parse(argumentsJson) as { target: TargetKind; format: string; path?: string; width?: number; height?: number; rayTrace?: boolean };
          if (payload.target === "pymol") {
            const exportAction = { type: "export", export: pymolExportSchema.parse(payload) } as never;
            result = await this.executeTargetActions("pymol", [exportAction] as never, false, allowSessionRawCommands);
          } else {
            const exportAction = { type: "export", export: chimeraXExportSchema.parse(payload) } as never;
            result = await this.executeTargetActions("chimerax", [exportAction] as never, false, allowSessionRawCommands);
          }
          nextTargetState = (result as ActionResult).state;
          break;
        }
        case "capture_view": {
          const payload = captureViewRequestSchema.parse(JSON.parse(argumentsJson));
          result = await this.captureViewDirect(payload);
          captureInspectionPrompt = payload.inspectionPrompt;
          attachCaptureToConversation = payload.attachToConversation !== false;
          nextTargetState = (result as ActionResult).state;
          break;
        }
        default:
          throw new Error(`Unsupported tool call: ${toolName}`);
      }
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
      resultLevel = "error";
    }

    if (isActionResultPayload(result)) {
      const actionResult = this.decorateActionResult(result);
      result = actionResult;
      if (toolName === "capture_view") {
        const captureArtifact = actionResult.artifacts.find((artifact) => artifact.kind === "image");
        if (captureArtifact) {
          const captureState = {
            ...((actionResult.state && typeof actionResult.state === "object") ? actionResult.state : {}),
            lastCapture: captureArtifact,
          } as Record<string, unknown>;
          result = {
            ...actionResult,
            metrics: [
              ...actionResult.metrics,
              {
                kind: "capture",
                label: "Viewport capture",
                valueText: captureArtifact.label,
                source: "rpc",
              },
            ],
            state: captureState,
          };
          nextTargetState = captureState;
        }
      }
    }

    const resultText =
      resultLevel === "error"
        ? String((result as { error?: string }).error ?? "Tool call failed.")
        : prettyJson(result);

    if (nextTargetState) {
      this.setStatus(sessionId, {
        targetState: nextTargetState,
      });
    }

    const ws = record.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.broadcast(sessionId, {
        kind: "tool_result",
        level: resultLevel,
        text: resultText,
        payload: result,
      });
      this.setStatus(sessionId, { toolBusy: false });
      return;
    }

    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        },
      }),
    );
    if (toolName === "capture_view" && attachCaptureToConversation && isActionResultPayload(result)) {
      const captureArtifact = result.artifacts.find((artifact) => artifact.kind === "image");
      if (captureArtifact) {
        const captureItem = await this.buildCaptureConversationItem(
          record.status.target,
          captureArtifact.path,
          captureInspectionPrompt,
        );
        if (captureItem) {
          ws.send(JSON.stringify({
            type: "conversation.item.create",
            item: captureItem,
          }));
        }
      }
    }
    ws.send(JSON.stringify({ type: "response.create" }));

    this.broadcast(sessionId, {
      kind: "tool_result",
      level: resultLevel,
      text: resultText,
      payload: result,
    });
    this.setStatus(sessionId, { toolBusy: false });
  }

  private ensureSessionConnectedAt(sessionId: string): void {
    const record = this.requireSession(sessionId);
    if (record.connectedAtMs) {
      return;
    }
    record.connectedAtMs = Date.now();
  }

  private refreshSessionUsageGuardrails(sessionId: string): void {
    const record = this.requireSession(sessionId);
    const baselineMs = record.connectedAtMs ?? Date.now();
    const nextState = buildSessionUsageGuardState(
      record.status.usage,
      this.sessionGuardrails,
      baselineMs,
      Date.now(),
    );
    const previousState = record.status.usageGuardrails;
    this.setStatus(sessionId, {
      usageGuardrails: nextState,
    });

    const warningNoticeKey = nextState.warningReason ? `warn:${nextState.warningReason}` : null;
    if (nextState.warningActive && nextState.warningMessage && record.lastGuardrailNoticeKey !== warningNoticeKey) {
      record.lastGuardrailNoticeKey = warningNoticeKey;
      this.broadcast(sessionId, {
        kind: "log",
        level: "warn",
        text: nextState.warningMessage,
        payload: { usageGuardrails: nextState },
      });
    }

    const breachNoticeKey = nextState.breachReason ? `breach:${nextState.breachReason}` : null;
    if (nextState.breachMessage && record.lastGuardrailNoticeKey !== breachNoticeKey) {
      record.lastGuardrailNoticeKey = breachNoticeKey;
      this.broadcast(sessionId, {
        kind: "log",
        level: "error",
        text: nextState.breachMessage,
        payload: { usageGuardrails: nextState },
      });
      this.broadcast(sessionId, {
        kind: "status",
        text: nextState.breachMessage,
        payload: this.requireSession(sessionId).status,
      });
      return;
    }

    if (!nextState.warningActive && !nextState.breachMessage) {
      record.lastGuardrailNoticeKey = null;
      if (previousState.warningActive || previousState.breachMessage) {
        this.broadcast(sessionId, {
          kind: "status",
          text: "Realtime session guardrails are back in a safe range.",
          payload: this.requireSession(sessionId).status,
        });
      }
    }
  }

  private scheduleSessionDeadline(sessionId: string): void {
    const record = this.requireSession(sessionId);
    if (!record.connectedAtMs) {
      return;
    }
    if (record.sessionDeadlineTimer) {
      clearTimeout(record.sessionDeadlineTimer);
      record.sessionDeadlineTimer = null;
    }

    const deadlineMs = record.connectedAtMs + this.sessionGuardrails.maxSessionMinutes * 60_000;
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      this.refreshSessionUsageGuardrails(sessionId);
      return;
    }

    record.sessionDeadlineTimer = setTimeout(() => {
      record.sessionDeadlineTimer = null;
      this.refreshSessionUsageGuardrails(sessionId);
    }, remainingMs);
    record.sessionDeadlineTimer.unref?.();
  }

  private broadcastGuardrailSummary(sessionId: string): void {
    const record = this.requireSession(sessionId);
    const summary = `Realtime session guardrails active: ${this.sessionGuardrails.maxSessionMinutes}m max session, ${this.sessionGuardrails.maxResponsesPerSession} responses, ${this.sessionGuardrails.maxTranscriptionsPerSession} transcriptions, ${new Intl.NumberFormat("en-US").format(this.sessionGuardrails.maxBillableTokensPerSession)} billable tokens. Push-to-talk remains the lowest-risk default.`;
    if (record.lastGuardrailNoticeKey === "summary") {
      return;
    }
    record.lastGuardrailNoticeKey = "summary";
    this.broadcast(sessionId, {
      kind: "log",
      level: "info",
      text: summary,
      payload: { usageGuardrails: record.status.usageGuardrails },
    });
  }

  private decorateActionResult(result: ActionResult): ActionResult {
    return {
      ...result,
      artifacts: result.artifacts.map((artifact) => ({
        ...artifact,
        url: this.buildArtifactUrl(artifact.path),
        mimeType: artifact.mimeType ?? inferArtifactMimeType(artifact.path, artifact.kind),
      })),
    };
  }

  private buildArtifactUrl(filePath: string): string {
    return `/api/artifacts?path=${encodeURIComponent(filePath)}`;
  }

  private async buildCaptureConversationItem(
    target: TargetKind,
    filePath: string,
    inspectionPrompt?: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const bytes = await fs.readFile(filePath);
      const mimeType = inferArtifactMimeType(filePath, "image");
      const base64 = bytes.toString("base64");
      const text = [
        inspectionPrompt?.trim() || `Inspect this ${target} viewport capture for clarity, framing, pocket visibility, labels, and presentation polish.`,
        "If the scene still needs work, call another visualization tool. Otherwise give one short spoken update.",
      ].join(" ");

      return {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text,
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${base64}`,
          },
        ],
      };
    } catch {
      return null;
    }
  }

  private async pushSessionUpdate(sessionId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (!record.ws || record.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.setStatus(sessionId, {
      status: "connecting",
      sidebandStatus: record.status.sidebandStatus === "reconnecting" ? "reconnecting" : "connecting",
      controllerReady: false,
      controllerReadyAt: record.status.controllerReadyAt,
      configSyncPending: true,
    });
    this.broadcast(sessionId, {
      kind: "status",
      text: "Pushing session update to the sideband controller.",
      payload: this.requireSession(sessionId).status,
    });

    record.ws.send(
      JSON.stringify({
        type: "session.update",
        session: this.buildSessionConfig(record.status.target, record.status.voiceMode, record.status.recipeId, record.status.advancedMode),
      }),
    );
  }

  private buildSessionConfig(target: TargetKind, voiceMode: VoiceMode, recipeId?: string, advancedMode = false) {
    const recipe = this.safeGetRecipe(recipeId);
    const recipeSummary = recipe ? `${recipe.title}: ${recipe.goal}` : undefined;
    const expertModeEnabled = advancedMode || this.expertCommandsEnabled;
    const session = {
      type: "realtime",
      model: this.realtimeModel,
      output_modalities: ["audio"],
      instructions: buildSessionInstructions(target, voiceMode, recipeSummary, expertModeEnabled),
      tool_choice: "auto",
      tools: buildRealtimeTools(target, { advancedMode: expertModeEnabled }),
      max_output_tokens: this.realtimeMaxOutputTokens,
      tracing: this.realtimeTracing,
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: {
            model: this.audioTranscriptionModel,
            language: "en",
            prompt: this.buildTranscriptionPrompt(target, recipe?.sampleData.map((item) => item.id)),
          },
          turn_detection:
            voiceMode === "open_mic"
              ? {
                  type: "semantic_vad",
                  eagerness: "medium",
                  interrupt_response: true,
                  create_response: true,
                }
              : null,
        },
        output: {
          voice: this.realtimeVoice,
          speed: this.realtimeOutputSpeed,
        },
      },
    };

    if (!this.realtimeTruncation) {
      return session;
    }

    return {
      ...session,
      truncation: {
        type: "retention_ratio",
        retention_ratio: this.realtimeTruncation.retentionRatio,
        token_limits: {
          post_instructions: this.realtimeTruncation.postInstructions,
        },
      },
    };
  }

  private async createEphemeralSession(target: TargetKind, voiceMode: VoiceMode, recipeId?: string): Promise<{ value: string }> {
    this.requireOpenAiApiKey();
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: REALTIME_CLIENT_SECRET_TTL_SECONDS,
        },
        session: this.buildSessionConfig(target, voiceMode, recipeId, false),
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Failed to create realtime client secret: ${prettyJson(payload)}`);
    }

    const value = payload.client_secret?.value ?? payload.client_secret ?? payload.value;
    if (!value || typeof value !== "string") {
      throw new Error(`Realtime client secret response did not include a usable token: ${prettyJson(payload)}`);
    }

    return { value };
  }

  private getHandledCalls(sessionId: string): Set<string> {
    const existing = this.handledCalls.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = new Set<string>();
    this.handledCalls.set(sessionId, created);
    return created;
  }

  private safeGetRecipe(recipeId?: string) {
    if (!recipeId) {
      return undefined;
    }

    try {
      return getRecipe(recipeId);
    } catch {
      return undefined;
    }
  }

  private buildTranscriptionPrompt(target: TargetKind, sampleIds: string[] = []): string {
    const targetTerms =
      target === "pymol"
        ? "PyMOL, cealign, super, isomesh, isosurface, ray trace, cartoon, sticks, surface, polar contacts, angle, dihedral, translate, rotate, pocket hero, comparison hero"
        : "ChimeraX, matchmaker, orthoplanes, hbonds, clashes, contacts, volume, silhouette, torsion, move, turn, view name, presentation light, map hero";
    const structureTerms = [
      "protein structure visualization",
      "PDB",
      "AlphaFold",
      "Rosetta",
      "EMDB",
      "ligand",
      "binding pocket",
      "whole complex",
      "full assembly",
      "experimental model",
      "predicted model",
      "reference model",
      "scaffold",
      "binder",
      "receptor",
      "partner",
      "chain A",
      "chain B",
      "residue numbers",
      "hydrogen bonds",
      "angles",
      "dihedrals",
      "torsions",
      "cartoon",
      "sticks",
      "surface",
      "mesh",
      "labels",
      "hero frame",
      "pocket frame",
      "export PNG",
    ].join(", ");
    const sampleTermBlock = sampleIds.length ? ` Common structure IDs: ${sampleIds.slice(0, 6).join(", ")}.` : "";
    const extraHint = this.transcriptionPromptHint ? ` ${this.transcriptionPromptHint.trim()}` : "";
    return `Expect molecular-graphics vocabulary for ${target}. Terms include ${targetTerms}. General terms: ${structureTerms}.${sampleTermBlock}${extraHint}`.trim();
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`Unknown realtime session: ${sessionId}`);
    }
    return record;
  }

  private disposeSession(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }
    record.sidebandGeneration += 1;
    if (record.sessionDeadlineTimer) {
      clearTimeout(record.sessionDeadlineTimer);
      record.sessionDeadlineTimer = null;
    }
    record.ws?.removeAllListeners();
    record.ws?.close();
    if (record.reconnectTimer) {
      clearTimeout(record.reconnectTimer);
    }
    this.sessions.delete(sessionId);
    this.handledCalls.delete(sessionId);
  }

  private requireOpenAiApiKey(): void {
    if (!this.openAiApiKey) {
      throw new Error("Missing OPENAI_API_KEY. The voice console can load without it, but Realtime connections cannot start until it is set.");
    }
  }

  private setStatus(sessionId: string, patch: Partial<SessionStatus>): void {
    const record = this.requireSession(sessionId);
    record.status = sessionStatusSchema.parse({
      ...record.status,
      ...patch,
    });
    record.lastActivityAt = Date.now();
  }

  private broadcast(sessionId: string, partial: Omit<SessionUiEvent, "id" | "timestamp">): void {
    const record = this.requireSession(sessionId);
    const event = this.makeEvent(partial);
    const entry: BufferedSessionEvent = {
      sseId: record.nextSseId,
      event,
    };
    record.nextSseId += 1;
    record.lastActivityAt = Date.now();
    record.eventHistory.push(entry);
    if (record.eventHistory.length > SESSION_EVENT_HISTORY_LIMIT) {
      record.eventHistory.splice(0, record.eventHistory.length - SESSION_EVENT_HISTORY_LIMIT);
    }
    record.emitter.emit("event", entry);
  }

  private makeEvent(partial: Omit<SessionUiEvent, "id" | "timestamp">): SessionUiEvent {
    return sessionUiEventSchema.parse({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...partial,
    });
  }

  private writeSseEvent(response: Response, entry: BufferedSessionEvent): void {
    response.write(`id: ${entry.sseId}\n`);
    response.write(`data: ${JSON.stringify(entry.event)}\n\n`);
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [sessionId, record] of this.sessions.entries()) {
      if (!this.isSessionActive(record, now)) {
        this.disposeSession(sessionId);
      }
    }
  }

  private scheduleSidebandReconnect(sessionId: string): void {
    const record = this.requireSession(sessionId);
    if (record.disconnectRequested) {
      return;
    }

    if (record.reconnectAttempts >= MAX_SIDEBAND_RECONNECT_ATTEMPTS) {
      this.setStatus(sessionId, {
        status: "disconnected",
        sidebandStatus: "error",
        controllerReady: false,
        configSyncPending: false,
        lastError: "Sideband controller dropped and reconnect attempts were exhausted.",
      });
      this.broadcast(sessionId, {
        kind: "status",
        text: "Sideband controller disconnected.",
        payload: record.status,
      });
      return;
    }

    record.reconnectAttempts += 1;
    const delayMs = Math.min(1_000 * 2 ** (record.reconnectAttempts - 1), 8_000);
    this.setStatus(sessionId, {
      status: "connecting",
      sidebandStatus: "reconnecting",
      controllerReady: false,
      configSyncPending: true,
      lastError: `Sideband reconnect attempt ${record.reconnectAttempts} scheduled in ${delayMs}ms.`,
    });
    this.broadcast(sessionId, {
      kind: "status",
      text: `Sideband controller reconnecting in ${Math.round(delayMs / 1000)}s.`,
      payload: record.status,
    });

    if (record.reconnectTimer) {
      clearTimeout(record.reconnectTimer);
    }

    record.reconnectTimer = setTimeout(() => {
      record.reconnectTimer = null;
      void this.attachSideband(sessionId, record.callId).catch((error) => {
        this.broadcast(sessionId, {
          kind: "log",
          level: "error",
          text: error instanceof Error ? error.message : String(error),
        });
        this.scheduleSidebandReconnect(sessionId);
      });
    }, delayMs);
    record.reconnectTimer.unref?.();
  }

  private shouldMirrorRawEvent(eventType: string): boolean {
    if (this.debugRawEvents) {
      return true;
    }

    return !/\.delta$|^rate_limits\.updated$/i.test(eventType);
  }
}

function doesRealtimeSessionRequireSync(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const actualToolNames = extractToolNames(actual.tools);
  const expectedToolNames = extractToolNames(expected.tools);
  const actualOutputModalities = normalizeStringList(actual.output_modalities);
  const expectedOutputModalities = normalizeStringList(expected.output_modalities);
  const actualVoice = readNestedString(actual, ["audio", "output", "voice"]);
  const expectedVoice = readNestedString(expected, ["audio", "output", "voice"]);
  const actualTurnDetection = readNestedValue(actual, ["audio", "input", "turn_detection"]);
  const expectedTurnDetection = readNestedValue(expected, ["audio", "input", "turn_detection"]);

  return String(actual.model ?? "") !== String(expected.model ?? "")
    || String(actual.instructions ?? "") !== String(expected.instructions ?? "")
    || String(actual.tool_choice ?? "") !== String(expected.tool_choice ?? "")
    || String(actual.max_output_tokens ?? "") !== String(expected.max_output_tokens ?? "")
    || actualVoice !== expectedVoice
    || JSON.stringify(actualOutputModalities) !== JSON.stringify(expectedOutputModalities)
    || JSON.stringify(actualTurnDetection ?? null) !== JSON.stringify(expectedTurnDetection ?? null)
    || JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames);
}

function resolveCaptureDimensions(
  target: TargetKind,
  state: unknown,
  requestedWidth?: number,
  requestedHeight?: number,
): { width: number; height: number } {
  const payload = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  const explicitDimensions = typeof requestedWidth === "number" || typeof requestedHeight === "number";

  if (target === "pymol") {
    const viewport = payload.viewport && typeof payload.viewport === "object"
      ? payload.viewport as Record<string, unknown>
      : {};
    return normalizeCaptureDimensions(
      requestedWidth ?? (typeof viewport.width === "number" ? viewport.width : 1600),
      requestedHeight ?? (typeof viewport.height === "number" ? viewport.height : 1000),
      explicitDimensions,
    );
  }

  const windowSize = Array.isArray(payload.windowSize) ? payload.windowSize : [];
  return normalizeCaptureDimensions(
    requestedWidth ?? (typeof windowSize[0] === "number" ? windowSize[0] : 1600),
    requestedHeight ?? (typeof windowSize[1] === "number" ? windowSize[1] : 1000),
    explicitDimensions,
  );
}

function normalizeCaptureDimensions(width: number, height: number, preserveRequestedSize: boolean): { width: number; height: number } {
  const safeWidth = Math.max(320, Math.round(width));
  const safeHeight = Math.max(240, Math.round(height));

  if (preserveRequestedSize) {
    return {
      width: safeWidth,
      height: safeHeight,
    };
  }

  const maxInspectionWidth = 1280;
  if (safeWidth <= maxInspectionWidth) {
    return {
      width: safeWidth,
      height: safeHeight,
    };
  }

  const scale = maxInspectionWidth / safeWidth;
  return {
    width: maxInspectionWidth,
    height: Math.max(240, Math.round(safeHeight * scale)),
  };
}

function isActionResultPayload(value: ActionResult | Record<string, unknown>): value is ActionResult {
  return Boolean(
    value
    && typeof value === "object"
    && "target" in value
    && "commandsExecuted" in value
    && Array.isArray((value as ActionResult).commandsExecuted),
  );
}

function inferArtifactMimeType(filePath: string, kind: ActionResult["artifacts"][number]["kind"]): string {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "pse") return "application/octet-stream";
  if (extension === "cxs" || extension === "session") return "application/octet-stream";
  return kind === "image" ? "image/png" : "application/octet-stream";
}

function assertToolActionsAllowed(actions: Array<Record<string, unknown>>, allowRawCommands: boolean): void {
  if (allowRawCommands) {
    return;
  }

  if (actions.some((action) => action?.type === "raw_command")) {
    throw new Error("Raw expert commands are disabled for this session. Enable Advanced Expert Commands before using raw_command.");
  }
}

function extractToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const payload = entry as Record<string, unknown>;
      return typeof payload.name === "string" ? [payload.name] : [];
    })
    .sort();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string").sort();
}

function readNestedString(value: unknown, path: string[]): string {
  const nested = readNestedValue(value, path);
  return typeof nested === "string" ? nested : "";
}

function readNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
