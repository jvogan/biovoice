import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import type { Request, Response } from "express";
import {
  actionEnvelopeSchema,
  captureViewRequestSchema,
  chimeraXEnvelopeSchema,
  chimeraXExportSchema,
  pymolExportSchema,
  pymolEnvelopeSchema,
  responseLanguageModeSchema,
  resolveScientificAssetRequestSchema,
  scientificWorkflowRequestSchema,
  targetKindSchema,
  type ActionEnvelope,
  type ActionResult,
  type CaptureViewRequest,
  type ChimeraXAction,
  type PymolAction,
  type ResponseLanguageMode,
  type ResolveScientificAssetRequest,
  type ScientificWorkflowRequest,
  type ScientificWorkflowResult,
  type TargetKind,
  type VoiceMode,
} from "../schemas/index.js";
import { getRecipe, getRecipeStep } from "../examples/index.js";
import { buildPinnedRecipeSummary, buildSessionInstructions } from "../prompts/index.js";
import {
  RunReceiptStore,
  TranscriptStore,
  type CreateRunReceiptInput,
  type RunReceipt,
  type RunReceiptSummary,
} from "../store/index.js";
import { defaultExportPath } from "../utils/path-policy.js";
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
import {
  resolveScientificAsset,
  runScientificWorkflow,
  type ScientificAssetFile,
  type ScientificAssetResolution,
} from "../scientific/index.js";

export interface RealtimeRegistryOptions {
  openAiApiKey: string;
  openAiSafetyIdentifier?: string | null;
  realtimeModel: string;
  realtimeVoice: string;
  realtimePrompt?: RealtimePromptConfig | null;
  realtimeReasoningEffort?: RealtimeReasoningEffort | null;
  realtimeContextPruning?: RealtimeContextPruningOptions | null;
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
  captureUploadsEnabled?: boolean;
  persistSessionEvents?: boolean;
  pymol: PymolAdapterOptions;
  chimerax: ChimeraXAdapterOptions;
}

export type RealtimeReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface RealtimePromptConfig {
  id: string;
  version?: string;
  variables?: Record<string, string | number | boolean>;
}

export interface RealtimeContextPruningOptions {
  enabled: boolean;
  maxItems: number;
  retainItems: number;
}

interface ConnectRequest {
  offerSdp: string;
  target: TargetKind;
  voiceMode: VoiceMode;
  responseLanguageMode?: ResponseLanguageMode;
  recipeId?: string;
  instructionContext?: string;
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
    active: number;
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

export interface TargetUndoAvailability {
  target: TargetKind;
  available: boolean;
  createdAt?: string;
  summary?: string;
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
  instructionContext?: string;
  disconnectRequested: boolean;
  connectedAtMs: number | null;
  sessionDeadlineTimer: NodeJS.Timeout | null;
  sidebandPingTimer: NodeJS.Timeout | null;
  lastGuardrailNoticeKey: string | null;
  conversationItems: TrackedConversationItem[];
  prunedConversationItemCount: number;
  lastContextPrunedAt: string | undefined;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  sidebandGeneration: number;
  captureUploadConsent: CaptureUploadConsentGrant | null;
}

interface TrackedConversationItem {
  id: string;
  type: string;
  role?: string;
  createdAtMs: number;
  prunable: boolean;
  deleteRequested: boolean;
  deleted: boolean;
}

interface BufferedSessionEvent {
  sseId: number;
  event: SessionUiEvent;
}

interface TargetCheckpoint {
  path: string;
  createdAt: string;
  summary: string;
}

interface TargetCheckpointScope {
  target: TargetKind;
  summary: string;
  checkpointClaimed: boolean;
  checkpointCreated: boolean;
  checkpointPath?: string;
}

interface CaptureUploadConsentGrant {
  expiresAtMs: number;
}

interface CaptureConversationAttachment {
  item: Record<string, unknown> | null;
  warning?: string;
}

const SESSION_EVENT_HISTORY_LIMIT = 250;
const SESSION_HEARTBEAT_INTERVAL_MS = 15_000;
const SIDEBAND_PING_INTERVAL_MS = 20_000;
const DISCONNECTED_SESSION_TTL_MS = 10 * 60 * 1000;
const PENDING_SESSION_TTL_MS = 30 * 1000;
const CONNECTED_SESSION_IDLE_TTL_MS = 60 * 60 * 1000;
const RECONNECTING_SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_PRUNE_INTERVAL_MS = 10 * 1000;
const MAX_INITIAL_SIDEBAND_RECONNECT_ATTEMPTS = 4;
const MAX_CONNECTED_SIDEBAND_RECONNECT_ATTEMPTS = 20;
const MAX_SIDEBAND_RECONNECT_DELAY_MS = 15_000;
const REALTIME_CLIENT_SECRET_TTL_SECONDS = 600;
const MAX_TOOL_ARGUMENTS_JSON_BYTES = 48_000;
const CAPTURE_UPLOAD_CONSENT_TTL_MS = 60_000;
const MAX_CAPTURE_CONVERSATION_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CONTEXT_PRUNING: RealtimeContextPruningOptions = {
  enabled: true,
  maxItems: 96,
  retainItems: 64,
};

export class RealtimeSessionRegistry {
  private readonly openAiApiKey: string;
  private readonly openAiSafetyIdentifier: string | null;
  private readonly realtimeModel: string;
  private readonly realtimeVoice: string;
  private readonly realtimePrompt: RealtimePromptConfig | null;
  private readonly realtimeReasoningEffort: RealtimeReasoningEffort | null;
  private readonly realtimeContextPruning: RealtimeContextPruningOptions;
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
  private readonly captureUploadsEnabled: boolean;
  private readonly persistSessionEvents: boolean;
  private readonly transcriptStore = new TranscriptStore();
  private readonly receiptStore = new RunReceiptStore();
  private readonly lastCheckpoints = new Map<TargetKind, TargetCheckpoint>();
  private readonly targetExecutionQueues = new Map<TargetKind, Promise<void>>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly pymolAdapter: PymolAdapter;
  private readonly chimeraXAdapter: ChimeraXAdapter;
  private readonly handledCalls = new Map<string, Set<string>>();
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly receiptStateReady: Promise<void>;

  constructor(options: RealtimeRegistryOptions) {
    this.openAiApiKey = options.openAiApiKey;
    this.openAiSafetyIdentifier = options.openAiSafetyIdentifier?.trim() || null;
    this.realtimeModel = options.realtimeModel;
    this.realtimeVoice = options.realtimeVoice;
    this.realtimePrompt = options.realtimePrompt ?? null;
    this.realtimeReasoningEffort = options.realtimeReasoningEffort ?? null;
    this.realtimeContextPruning = normalizeRealtimeContextPruning(options.realtimeContextPruning);
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
    this.captureUploadsEnabled = options.captureUploadsEnabled ?? false;
    this.persistSessionEvents = options.persistSessionEvents ?? false;
    this.pymolAdapter = new PymolAdapter(options.pymol);
    this.chimeraXAdapter = new ChimeraXAdapter(options.chimerax);
    this.receiptStateReady = Promise.all([
      this.receiptStore.clearCheckpointAvailability("pymol"),
      this.receiptStore.clearCheckpointAvailability("chimerax"),
    ]).then(() => undefined).catch((error) => {
      console.warn(`[run-receipt-startup-warning] ${error instanceof Error ? error.message : String(error)}`);
    });
    this.cleanupTimer = setInterval(() => {
      this.pruneSessions();
    }, SESSION_PRUNE_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  async createClientSecret(
    target: TargetKind,
    voiceMode: VoiceMode,
    recipeId?: string,
    instructionContext?: string,
    responseLanguageMode: ResponseLanguageMode = "standard",
  ): Promise<string> {
    const prepared = await this.prepareSession(target, voiceMode, recipeId, instructionContext, responseLanguageMode);
    return prepared.clientSecret;
  }

  async prepareSession(
    target: TargetKind,
    voiceMode: VoiceMode,
    recipeId?: string,
    instructionContext?: string,
    responseLanguageMode: ResponseLanguageMode = "standard",
  ): Promise<PreparedRealtimeSession> {
    const prepared = this.prepareLocalSession(target, voiceMode, recipeId, instructionContext, responseLanguageMode);
    try {
      const clientSecret = await this.createEphemeralSession(target, voiceMode, recipeId, instructionContext, responseLanguageMode);
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
    const responseLanguageMode = request.responseLanguageMode ?? "standard";
    const prepared = this.prepareLocalSession(request.target, request.voiceMode, request.recipeId, request.instructionContext, responseLanguageMode);
    try {
      const formData = new FormData();
      formData.set("sdp", request.offerSdp);
      formData.set(
        "session",
        JSON.stringify(this.buildSessionConfig(
          request.target,
          request.voiceMode,
          request.recipeId,
          false,
          request.instructionContext,
          responseLanguageMode,
        )),
      );

      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: this.buildOpenAiHeaders(),
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

  private prepareLocalSession(
    target: TargetKind,
    voiceMode: VoiceMode,
    recipeId?: string,
    instructionContext?: string,
    responseLanguageMode: ResponseLanguageMode = "standard",
  ): LocalPreparedSession {
    this.ensureSessionCapacity();
    const sessionId = crypto.randomUUID();
    const sessionAccessToken = crypto.randomUUID();
    const registerToken = crypto.randomUUID();
    const record = this.createSessionRecord(
      sessionId,
      "",
      target,
      voiceMode,
      recipeId,
      sessionAccessToken,
      registerToken,
      instructionContext,
      responseLanguageMode,
    );
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
      `Local Realtime slots are full because ${activeSessions} active session${activeSessions === 1 ? " is" : "s are"} already open. End another session or wait for stale setup cleanup before starting a new call.`,
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
    if (record.connectedAtMs) {
      const ttlMs = record.status.status === "connected"
        ? CONNECTED_SESSION_IDLE_TTL_MS
        : RECONNECTING_SESSION_TTL_MS;
      return now - record.lastActivityAt < ttlMs;
    }
    if (record.status.status === "connected") {
      return now - record.lastActivityAt < CONNECTED_SESSION_IDLE_TTL_MS;
    }

    const ttlMs =
      record.status.status === "awaiting_call" || record.status.status === "connecting"
        ? PENDING_SESSION_TTL_MS
        : DISCONNECTED_SESSION_TTL_MS;
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
    instructionContext?: string,
    responseLanguageMode: ResponseLanguageMode = "standard",
  ): SessionRecord {
    const createdAtMs = Date.now();
    const status = sessionStatusSchema.parse({
      sessionId,
      callId,
      status: "awaiting_call",
      sidebandStatus: "pending_call",
      target,
      voiceMode,
      responseLanguageMode,
      advancedMode: false,
      recipeId,
      controllerReady: false,
      controllerReadyAt: undefined,
      configSyncPending: false,
      lastSidebandEventAt: undefined,
      eventSubscribers: 0,
      toolBusy: false,
      contextWindow: {
        pruningEnabled: this.realtimeContextPruning.enabled,
        trackedItems: 0,
        prunableItems: 0,
        deletePendingItems: 0,
        prunedItems: 0,
        maxItems: this.realtimeContextPruning.maxItems,
        retainItems: this.realtimeContextPruning.retainItems,
      },
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
      instructionContext,
      disconnectRequested: false,
      connectedAtMs: null,
      sessionDeadlineTimer: null,
      sidebandPingTimer: null,
      lastGuardrailNoticeKey: null,
      conversationItems: [],
      prunedConversationItemCount: 0,
      lastContextPrunedAt: undefined,
      reconnectAttempts: 0,
      reconnectTimer: null,
      sidebandGeneration: 0,
      captureUploadConsent: null,
    };
  }

  validateSessionAccess(sessionId: string, accessToken: string): void {
    const record = this.requireSession(sessionId);
    if (!accessToken || accessToken !== record.accessToken) {
      throw new Error("Invalid realtime session access token.");
    }
  }

  grantCaptureUploadConsent(sessionId: string): { expiresAt: string } {
    if (!this.captureUploadsEnabled) {
      throw new Error(
        "Viewport upload is disabled. Set ALLOW_CAPTURE_UPLOADS=true before a user can grant one-shot sharing consent.",
      );
    }
    const record = this.requireSession(sessionId);
    const expiresAtMs = Date.now() + CAPTURE_UPLOAD_CONSENT_TTL_MS;
    record.captureUploadConsent = { expiresAtMs };
    return { expiresAt: new Date(expiresAtMs).toISOString() };
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

  async updateResponseLanguageMode(sessionId: string, responseLanguageMode: ResponseLanguageMode): Promise<SessionStatus> {
    const record = this.requireSession(sessionId);
    record.status = sessionStatusSchema.parse({
      ...record.status,
      responseLanguageMode,
    });
    await this.pushSessionUpdate(sessionId);
    this.broadcast(sessionId, {
      kind: "status",
      text: responseLanguageMode === "klingon"
        ? "Klingon response mode enabled."
        : "Klingon response mode disabled.",
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
    this.pruneSessions();
    const now = Date.now();
    const sessionCounts: RealtimeRuntimeHealth["sessions"] = {
      total: this.sessions.size,
      active: 0,
      awaitingCall: 0,
      connecting: 0,
      connected: 0,
      error: 0,
      disconnected: 0,
    };

    for (const record of this.sessions.values()) {
      if (this.isSessionActive(record, now)) {
        sessionCounts.active += 1;
      }
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
    if (record.disconnectRequested && record.status.status === "disconnected") {
      return;
    }
    const callId = record.callId;
    record.disconnectRequested = true;
    record.captureUploadConsent = null;
    if (record.sessionDeadlineTimer) {
      clearTimeout(record.sessionDeadlineTimer);
      record.sessionDeadlineTimer = null;
    }
    if (record.reconnectTimer) {
      clearTimeout(record.reconnectTimer);
      record.reconnectTimer = null;
    }
    this.stopSidebandPing(record);
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
    if (callId) {
      try {
        await this.hangupRealtimeCall(callId);
      } catch (error) {
        console.warn(
          `[realtime-hangup-warning] callId=${callId} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.cleanupTimer);
    const sessionIds = [...this.sessions.keys()];
    await Promise.all(sessionIds.map(async (sessionId) => {
      await this.disconnect(sessionId).catch(() => {});
      this.disposeSession(sessionId);
    }));
  }

  getUndoAvailability(target: TargetKind): TargetUndoAvailability {
    const checkpoint = this.lastCheckpoints.get(target);
    return {
      target,
      available: Boolean(checkpoint),
      ...(checkpoint ? { createdAt: checkpoint.createdAt, summary: checkpoint.summary } : {}),
    };
  }

  async undoLastAction(target: TargetKind): Promise<ActionResult> {
    return this.withTargetExecutionLock(target, async () => {
      const checkpoint = this.lastCheckpoints.get(target);
      if (!checkpoint) {
        throw new Error(`No ${target === "pymol" ? "PyMOL" : "ChimeraX"} checkpoint is available to undo.`);
      }

      const result = target === "pymol"
        ? await this.pymolAdapter.restoreCheckpoint(checkpoint.path)
        : await this.chimeraXAdapter.restoreCheckpoint(checkpoint.path);
      this.lastCheckpoints.delete(target);
      await this.receiptStore.clearCheckpointAvailability(target).catch(() => {});
      await fs.rm(checkpoint.path, { force: true }).catch(() => {});
      await this.writeRunReceipt({
        target,
        summary: `Undid: ${checkpoint.summary}`,
        source: "undo",
        evidenceLevel: "restored",
        checkpointAvailable: false,
        result,
      });
      return result;
    });
  }

  async listRunReceipts(limit = 20): Promise<RunReceiptSummary[]> {
    await this.receiptStateReady;
    return this.receiptStore.list(limit);
  }

  async getRunReceipt(id: string): Promise<RunReceipt | null> {
    await this.receiptStateReady;
    return this.receiptStore.get(id);
  }

  async getTargetState(target: TargetKind): Promise<unknown> {
    if (target === "pymol") {
      return this.pymolAdapter.getStateSummary();
    }
    return this.chimeraXAdapter.getStateSummary();
  }

  async runActionEnvelope(envelope: ActionEnvelope): Promise<ActionResult> {
    const parsed = actionEnvelopeSchema.parse(envelope);
    return this.executeTargetActionsWithReceipt({
      target: parsed.target,
      actions: parsed.actions as Array<Record<string, unknown>>,
      dryRun: parsed.dryRun ?? false,
      allowRawCommands: false,
      summary: parsed.summary ?? summarizeActions(parsed.actions),
      source: "actions",
      request: parsed,
    });
  }

  async runRecipeStepDirect(
    recipeId: string,
    stepId: string,
    target: TargetKind,
    dryRun = false,
  ): Promise<ActionResult> {
    const step = getRecipeStep(recipeId, stepId, target);
    return this.executeTargetActionsWithReceipt({
      target,
      actions: step.actions as Array<Record<string, unknown>>,
      dryRun,
      allowRawCommands: false,
      summary: `${step.title} (${recipeId})`,
      source: "recipe-step",
      request: { recipeId, stepId, target, dryRun },
    });
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

    return this.withTargetExecutionLock(target, async () => {
      const checkpointScope = this.createTargetCheckpointScope(target, recipe.title);
      const stepResults: Array<{
        stepId: string;
        title: string;
        summary: string;
        result: ActionResult;
      }> = [];
      let checkpointAvailable = false;

      try {
        for (const [index, step] of recipe.steps.entries()) {
          let result: ActionResult;
          try {
            result = await this.executeTargetActions(
              target,
              step.actions as never,
              dryRun,
              false,
              checkpointScope,
              true,
            );
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
      } finally {
        checkpointAvailable = await this.finalizeTargetCheckpointScope(checkpointScope);
      }

      const runResult = {
        recipeId,
        target,
        dryRun,
        stepResults,
      };
      await this.writeRunReceipt({
        target,
        summary: recipe.title,
        source: "recipe",
        evidenceLevel: dryRun ? "planned" : undefined,
        checkpointAvailable,
        request: { recipeId, target, dryRun },
        result: runResult,
      });
      return runResult;
    });
  }

  async runScientificWorkflowDirect(request: ScientificWorkflowRequest): Promise<ScientificWorkflowResult> {
    const parsed = scientificWorkflowRequestSchema.parse(request);
    const summary = parsed.summary ?? `Scientific workflow: ${parsed.workflow}`;
    return this.withTargetExecutionLock(parsed.target, async () => {
      const checkpointScope = this.createTargetCheckpointScope(parsed.target, summary);
      let checkpointAvailable = false;
      let result: ScientificWorkflowResult;
      try {
        result = await runScientificWorkflow(parsed, {
          clearWorkflowContext: (target) => {
            this.clearTargetWorkflowContext(target);
          },
          setWorkflowContext: (target, context) => {
            this.setTargetWorkflowContext(target, context);
          },
          executeActions: async (target, actions, dryRun) => this.executeTargetActions(
            target,
            actions as never,
            dryRun,
            false,
            checkpointScope,
            true,
          ),
          getTargetState: async (target) => {
            const state = await this.getTargetState(target);
            return state && typeof state === "object" ? state as Record<string, unknown> : {};
          },
        });
      } finally {
        checkpointAvailable = await this.finalizeTargetCheckpointScope(checkpointScope);
      }
      await this.writeRunReceipt({
        target: parsed.target,
        summary,
        source: "scientific-workflow",
        evidenceLevel: parsed.dryRun ? "planned" : result.evidenceLevel,
        checkpointAvailable,
        request: parsed,
        result,
      });
      return result;
    });
  }

  async resolveStructureAssetDirect(request: ResolveScientificAssetRequest): Promise<{
    resolution: ScientificAssetResolution;
    loaded: boolean;
    loadResult?: ActionResult;
    warnings: string[];
  }> {
    const parsed = resolveScientificAssetRequestSchema.parse(request);
    const resolution = await resolveScientificAsset(parsed);
    const warnings = [...resolution.warnings];
    const buildResult = (loadResult?: ActionResult) => this.removeUndefined({
      resolution: {
        ...resolution,
        warnings,
      },
      loaded: Boolean(loadResult),
      loadResult,
      warnings,
    }) as {
      resolution: ScientificAssetResolution;
      loaded: boolean;
      loadResult?: ActionResult;
      warnings: string[];
    };

    if (!parsed.loadIntoTarget) {
      return buildResult();
    }
    const target = parsed.target;
    if (!target) {
      warnings.push("target is required when loadIntoTarget is true.");
      return buildResult();
    }

    return this.withTargetExecutionLock(target, async () => {
      const summary = `Resolved and loaded ${resolution.source} asset ${resolution.id}`;
      const checkpointScope = this.createTargetCheckpointScope(target, summary);
      let checkpointAvailable = false;
      let loadResult: ActionResult | undefined;
      try {
        const file = this.pickLoadableResolvedAssetFile(resolution);
        if (!file) {
          warnings.push("No loadable model or map file was produced by this resolver request.");
        } else {
          loadResult = await this.executeTargetActions(
            target,
            this.buildResolvedAssetLoadActions(parsed, resolution, file) as never,
            false,
            false,
            checkpointScope,
            true,
          );
        }
      } finally {
        checkpointAvailable = await this.finalizeTargetCheckpointScope(checkpointScope);
      }
      const result = buildResult(loadResult);
      await this.writeRunReceipt({
        target,
        summary,
        source: "asset-resolution",
        checkpointAvailable,
        request: parsed,
        result,
      });
      return result;
    });
  }

  async captureViewDirect(request: CaptureViewRequest): Promise<ActionResult> {
    const parsed = captureViewRequestSchema.parse(request);
    return this.withTargetExecutionLock(parsed.target, async () => {
      const result = await this.captureTargetView(parsed);
      await this.writeRunReceipt({
        target: parsed.target,
        summary: "Captured the current molecular viewport",
        source: "capture",
        evidenceLevel: "visual",
        checkpointAvailable: false,
        request: { ...parsed, attachToConversation: undefined },
        result,
      });
      return result;
    });
  }

  private pickLoadableResolvedAssetFile(resolution: ScientificAssetResolution): ScientificAssetFile | undefined {
    return resolution.files.find((file) => file.kind === "model" || file.kind === "map");
  }

  private buildResolvedAssetLoadActions(
    request: ResolveScientificAssetRequest,
    resolution: ScientificAssetResolution,
    file: ScientificAssetFile,
  ): Array<PymolAction | ChimeraXAction> {
    if (!request.target) {
      throw new Error("target is required to build a resolved asset load action.");
    }

    const objectName = request.object ?? this.buildResolvedAssetObjectName(request, resolution, file);
    const semanticRole = "semanticRole" in request ? request.semanticRole : undefined;
    const aliases = "aliases" in request ? request.aliases : undefined;

    if (request.target === "pymol") {
      const loadAction = this.removeUndefined({
        type: "load",
        source: "local",
        path: file.path,
        object: objectName,
        id: objectName,
        semanticRole,
        aliases,
      }) as PymolAction;
      if (file.kind !== "map") {
        return [loadAction];
      }
      return [
        loadAction,
        {
          type: "map_display",
          mapName: objectName,
          displayAs: "mesh",
          level: 1,
          color: "cyan",
        } as PymolAction,
      ];
    }

    const openAction = this.removeUndefined({
      type: "open",
      source: "local",
      path: file.path,
      id: objectName,
      semanticRole,
      aliases,
    }) as ChimeraXAction;
    if (file.kind !== "map") {
      return [openAction];
    }
    return [
      openAction,
      {
        type: "volume",
        action: "mesh",
        level: 0.02,
        showOutlineBox: false,
      } as ChimeraXAction,
    ];
  }

  private buildResolvedAssetObjectName(
    request: ResolveScientificAssetRequest,
    resolution: ScientificAssetResolution,
    file: ScientificAssetFile,
  ): string {
    const sourceId = request.source === "alphafold"
      ? `af_${request.uniprotId}`
      : request.source === "rcsb"
      ? `rcsb_${request.pdbId}`
      : request.source === "emdb"
      ? `emdb_${request.emdbId}`
      : request.source === "uniprot" && request.accession
      ? `uniprot_${request.accession}`
      : `${resolution.source}_${resolution.id || path.basename(file.path, path.extname(file.path))}`;
    const safe = sourceId
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    return safe || "resolved_asset";
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
            rayTrace: true,
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

  private async executeTargetActionsWithReceipt(input: {
    target: TargetKind;
    actions: Array<Record<string, unknown>>;
    dryRun: boolean;
    allowRawCommands: boolean;
    summary: string;
    source: string;
    request?: unknown;
    evidenceLevel?: string;
  }): Promise<ActionResult> {
    return this.withTargetExecutionLock(input.target, async () => {
      const checkpointScope = this.createTargetCheckpointScope(input.target, input.summary);
      let checkpointAvailable = false;
      let result: ActionResult;
      try {
        result = await this.executeTargetActions(
          input.target,
          input.actions,
          input.dryRun,
          input.allowRawCommands,
          checkpointScope,
          true,
        );
      } finally {
        checkpointAvailable = await this.finalizeTargetCheckpointScope(checkpointScope);
      }
      await this.writeRunReceipt({
        target: input.target,
        summary: input.summary,
        source: input.source,
        evidenceLevel: input.dryRun ? "planned" : input.evidenceLevel,
        checkpointAvailable,
        request: input.request,
        result,
      });
      return result;
    });
  }

  private async executeTargetActions(
    target: TargetKind,
    actions: Array<Record<string, unknown>>,
    dryRun = false,
    allowRawCommands = false,
    checkpointScope?: TargetCheckpointScope,
    lockAlreadyHeld = false,
  ): Promise<ActionResult> {
    const execute = async (): Promise<ActionResult> => {
      if (checkpointScope && checkpointScope.target !== target) {
        throw new Error(`Checkpoint scope for ${checkpointScope.target} cannot execute ${target} actions.`);
      }
      const rawCommandsAllowed = allowRawCommands && this.expertCommandsEnabled;
      assertToolActionsAllowed(actions, rawCommandsAllowed);
      const shouldCheckpoint = !dryRun && shouldCheckpointActions(actions);
      let checkpointPath: string | undefined;
      if (shouldCheckpoint && checkpointScope) {
        if (!checkpointScope.checkpointClaimed) {
          checkpointScope.checkpointClaimed = true;
          checkpointScope.checkpointPath = defaultExportPath(target, target === "pymol" ? "pse" : "cxs");
          checkpointPath = checkpointScope.checkpointPath;
        }
      } else if (shouldCheckpoint) {
        checkpointPath = defaultExportPath(target, target === "pymol" ? "pse" : "cxs");
      }
      const summary = summarizeActions(actions);
      try {
        if (target === "pymol") {
          return await this.pymolAdapter.execute(actions as never, dryRun, rawCommandsAllowed, checkpointPath);
        }

        return await this.chimeraXAdapter.execute(actions as never, dryRun, rawCommandsAllowed, checkpointPath);
      } finally {
        if (checkpointPath && await fs.access(checkpointPath).then(() => true).catch(() => false)) {
          if (checkpointScope) {
            checkpointScope.checkpointCreated = true;
          } else {
            await this.publishTargetCheckpoint(target, checkpointPath, summary);
          }
        }
      }
    };

    if (lockAlreadyHeld) {
      return execute();
    }
    return this.withTargetExecutionLock(target, execute);
  }

  private createTargetCheckpointScope(target: TargetKind, summary: string): TargetCheckpointScope {
    return {
      target,
      summary,
      checkpointClaimed: false,
      checkpointCreated: false,
    };
  }

  private async finalizeTargetCheckpointScope(scope: TargetCheckpointScope): Promise<boolean> {
    if (!scope.checkpointCreated || !scope.checkpointPath) {
      return false;
    }
    const exists = await fs.access(scope.checkpointPath).then(() => true).catch(() => false);
    if (!exists) {
      return false;
    }
    await this.publishTargetCheckpoint(scope.target, scope.checkpointPath, scope.summary);
    return true;
  }

  private async publishTargetCheckpoint(target: TargetKind, checkpointPath: string, summary: string): Promise<void> {
    await this.receiptStateReady;
    const previous = this.lastCheckpoints.get(target);
    this.lastCheckpoints.set(target, {
      path: checkpointPath,
      createdAt: new Date().toISOString(),
      summary,
    });
    await this.receiptStore.clearCheckpointAvailability(target).catch(() => {});
    if (previous && previous.path !== checkpointPath) {
      await fs.rm(previous.path, { force: true }).catch(() => {});
    }
  }

  private async withTargetExecutionLock<T>(target: TargetKind, operation: () => Promise<T>): Promise<T> {
    const previous = this.targetExecutionQueues.get(target) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.targetExecutionQueues.set(target, current);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.targetExecutionQueues.get(target) === current) {
        this.targetExecutionQueues.delete(target);
      }
    }
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
      headers: this.buildOpenAiHeaders(),
    });

    record.ws = ws;
    if (previousWs && previousWs !== ws) {
      previousWs.removeAllListeners();
      previousWs.close();
    }

    ws.on("open", () => {
      if (!this.hasSession(sessionId)) {
        return;
      }
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      record.disconnectRequested = false;
      record.reconnectAttempts = 0;
      if (record.reconnectTimer) {
        clearTimeout(record.reconnectTimer);
        record.reconnectTimer = null;
      }
      this.startSidebandPing(record, ws, sessionId, generation);
      console.warn(`[realtime-sideband-open] session=${sessionId} callId=${callId}`);
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
      if (!this.hasSession(sessionId)) {
        return;
      }
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      const raw = buffer.toString();
      void this.handleSidebandMessage(sessionId, raw).catch((error) => {
        if (isUnknownRealtimeSessionError(error)) {
          return;
        }
        if (!this.hasSession(sessionId)) {
          return;
        }
        this.broadcast(sessionId, {
          kind: "log",
          level: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      });
    });

    ws.on("pong", () => {
      if (!this.hasSession(sessionId)) {
        return;
      }
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      record.lastActivityAt = Date.now();
    });

    ws.on("close", (code: number, reasonBuffer: Buffer) => {
      if (!this.hasSession(sessionId)) {
        return;
      }
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      this.stopSidebandPing(record);
      const reason = reasonBuffer.toString("utf8");
      console.warn(
        `[realtime-sideband-close] session=${sessionId} callId=${record.callId || "none"} code=${code} reason=${reason || "none"} requested=${String(record.disconnectRequested)}`,
      );
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
      if (!this.hasSession(sessionId)) {
        return;
      }
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        return;
      }
      this.stopSidebandPing(record);
      record.ws = null;
      console.warn(
        `[realtime-sideband-error] session=${sessionId} callId=${record.callId || "none"} message=${error.message}`,
      );
      if (isTerminalSidebandReconnectError(error)) {
        if (record.reconnectTimer) {
          clearTimeout(record.reconnectTimer);
          record.reconnectTimer = null;
        }
        this.broadcast(sessionId, {
          kind: "log",
          level: "error",
          text: `Sideband controller dropped permanently: ${error.message}`,
        });
        void this.disconnect(sessionId).catch(() => {});
        return;
      }
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
    if (!this.hasSession(sessionId)) {
      return;
    }
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

    this.observeConversationEvent(sessionId, eventType, payload);

    if (eventType === "rate_limits.updated") {
      const summary = summarizeRealtimeRateLimits(payload.rate_limits);
      if (summary) {
        this.broadcast(sessionId, {
          kind: "log",
          level: summary.low ? "warn" : "info",
          text: summary.text,
          payload,
        });
      }
      return;
    }

    if (eventType === "session.created") {
      const current = this.requireSession(sessionId).status;
      const expected = this.buildSessionConfig(
        current.target,
        current.voiceMode,
        current.recipeId,
        current.advancedMode,
        undefined,
        current.responseLanguageMode,
      );
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

  private observeConversationEvent(sessionId: string, eventType: string, payload: Record<string, unknown>): void {
    if (!this.hasSession(sessionId)) {
      return;
    }

    if (eventType === "conversation.item.created") {
      const item = payload.item && typeof payload.item === "object"
        ? payload.item as Record<string, unknown>
        : {};
      const itemId = typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : typeof payload.item_id === "string" && payload.item_id.trim()
          ? payload.item_id.trim()
          : "";
      if (!itemId) {
        return;
      }
      const record = this.requireSession(sessionId);
      if (record.conversationItems.some((tracked) => tracked.id === itemId)) {
        return;
      }
      const type = typeof item.type === "string" ? item.type : "unknown";
      const role = typeof item.role === "string" ? item.role : undefined;
      record.conversationItems.push({
        id: itemId,
        type,
        role,
        createdAtMs: Date.now(),
        prunable: isPrunableConversationItem(type, role),
        deleteRequested: false,
        deleted: false,
      });
      this.refreshContextWindowStatus(sessionId);
      this.maybePruneConversationContext(sessionId);
      return;
    }

    if (eventType === "conversation.item.deleted") {
      const itemId = typeof payload.item_id === "string" && payload.item_id.trim()
        ? payload.item_id.trim()
        : typeof payload.item === "string" && payload.item.trim()
          ? payload.item.trim()
          : "";
      if (!itemId) {
        return;
      }
      const record = this.requireSession(sessionId);
      const tracked = record.conversationItems.find((item) => item.id === itemId);
      if (tracked && !tracked.deleted) {
        tracked.deleted = true;
        tracked.deleteRequested = false;
        record.prunedConversationItemCount += 1;
        record.lastContextPrunedAt = new Date().toISOString();
      }
      this.refreshContextWindowStatus(sessionId);
    }
  }

  private maybePruneConversationContext(sessionId: string): void {
    const record = this.requireSession(sessionId);
    if (!this.realtimeContextPruning.enabled) {
      return;
    }

    const ws = record.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const activePrunable = record.conversationItems
      .filter((item) => item.prunable && !item.deleted && !item.deleteRequested)
      .sort((left, right) => left.createdAtMs - right.createdAtMs);
    if (activePrunable.length <= this.realtimeContextPruning.maxItems) {
      return;
    }

    const deleteCount = Math.max(0, activePrunable.length - this.realtimeContextPruning.retainItems);
    const itemsToDelete = activePrunable.slice(0, deleteCount);
    if (!itemsToDelete.length) {
      return;
    }

    let requestedDeleteCount = 0;
    for (const item of itemsToDelete) {
      try {
        ws.send(JSON.stringify({
          type: "conversation.item.delete",
          item_id: item.id,
        }));
        item.deleteRequested = true;
        requestedDeleteCount += 1;
      } catch (error) {
        this.broadcast(sessionId, {
          kind: "log",
          level: "warn",
          text: `Failed to prune old Realtime conversation item ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (requestedDeleteCount === 0) {
      return;
    }

    this.refreshContextWindowStatus(sessionId);
    this.broadcast(sessionId, {
      kind: "log",
      level: "info",
      text: `Pruned ${requestedDeleteCount} old Realtime conversation item${requestedDeleteCount === 1 ? "" : "s"} to keep the live context responsive.`,
      payload: {
        requestedDeleteCount,
        contextWindow: this.requireSession(sessionId).status.contextWindow,
      },
    });
  }

  private refreshContextWindowStatus(sessionId: string): void {
    const record = this.requireSession(sessionId);
    const trackedItems = record.conversationItems.filter((item) => !item.deleted).length;
    const prunableItems = record.conversationItems.filter((item) => item.prunable && !item.deleted && !item.deleteRequested).length;
    const deletePendingItems = record.conversationItems.filter((item) => item.deleteRequested && !item.deleted).length;
    this.setStatus(sessionId, {
      contextWindow: {
        pruningEnabled: this.realtimeContextPruning.enabled,
        trackedItems,
        prunableItems,
        deletePendingItems,
        prunedItems: record.prunedConversationItemCount,
        maxItems: this.realtimeContextPruning.maxItems,
        retainItems: this.realtimeContextPruning.retainItems,
        lastPrunedAt: record.lastContextPrunedAt,
      },
    });
  }

  private async executeToolCall(sessionId: string, callId: string, toolName: string, argumentsJson: string): Promise<void> {
    if (!this.hasSession(sessionId)) {
      return;
    }
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
    let captureConversationItem: Record<string, unknown> | null = null;
    let createFollowUpResponse = true;
    const allowSessionRawCommands = record.status.advancedMode && this.expertCommandsEnabled;

    try {
      switch (toolName) {
        case "wait_for_user": {
          result = {
            ok: true,
            action: "wait_for_user",
            message: "Quiet turn acknowledged. Continue listening without a spoken response.",
          };
          createFollowUpResponse = false;
          break;
        }
        case "set_response_language_mode": {
          const parsed = responseLanguageModeSchema.parse(JSON.parse(argumentsJson).mode);
          this.setStatus(sessionId, { responseLanguageMode: parsed });
          await this.pushSessionUpdate(sessionId);
          result = {
            ok: true,
            action: "set_response_language_mode",
            responseLanguageMode: parsed,
            message: parsed === "klingon"
              ? "Klingon response mode is now active until the user asks to stop Klingon mode."
              : "Standard response mode is now active.",
          };
          break;
        }
        case "run_pymol_actions": {
          const parsed = pymolEnvelopeSchema.parse(JSON.parse(argumentsJson));
          result = await this.executeTargetActionsWithReceipt({
            target: parsed.target,
            actions: parsed.actions as Array<Record<string, unknown>>,
            dryRun: parsed.dryRun ?? false,
            allowRawCommands: allowSessionRawCommands,
            summary: parsed.summary ?? summarizeActions(parsed.actions),
            source: "voice-actions",
            request: parsed,
          });
          nextTargetState = (result as ActionResult).state;
          break;
        }
        case "run_chimerax_actions": {
          const parsed = chimeraXEnvelopeSchema.parse(JSON.parse(argumentsJson));
          result = await this.executeTargetActionsWithReceipt({
            target: parsed.target,
            actions: parsed.actions as Array<Record<string, unknown>>,
            dryRun: parsed.dryRun ?? false,
            allowRawCommands: allowSessionRawCommands,
            summary: parsed.summary ?? summarizeActions(parsed.actions),
            source: "voice-actions",
            request: parsed,
          });
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
        case "undo_last_action": {
          const parsed = targetKindSchema.parse(JSON.parse(argumentsJson).target);
          result = await this.undoLastAction(parsed);
          nextTargetState = (result as ActionResult).state;
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
        case "resolve_structure_asset": {
          const payload = resolveScientificAssetRequestSchema.parse(JSON.parse(argumentsJson));
          result = await this.resolveStructureAssetDirect(payload);
          const loadResult = (result as { loadResult?: unknown }).loadResult;
          nextTargetState = loadResult && typeof loadResult === "object" && "state" in loadResult
            ? (loadResult as { state?: Record<string, unknown> }).state
            : undefined;
          break;
        }
        case "export_artifact": {
          const payload = JSON.parse(argumentsJson) as { target: TargetKind; format: string; path?: string; width?: number; height?: number; rayTrace?: boolean };
          if (payload.target === "pymol") {
            const exportAction = { type: "export", export: pymolExportSchema.parse(payload) } as never;
            result = await this.executeTargetActionsWithReceipt({
              target: "pymol",
              actions: [exportAction],
              dryRun: false,
              allowRawCommands: allowSessionRawCommands,
              summary: `Exported a ${payload.format} artifact`,
              source: "export",
              request: payload,
              evidenceLevel: "artifact",
            });
          } else {
            const exportAction = { type: "export", export: chimeraXExportSchema.parse(payload) } as never;
            result = await this.executeTargetActionsWithReceipt({
              target: "chimerax",
              actions: [exportAction],
              dryRun: false,
              allowRawCommands: allowSessionRawCommands,
              summary: `Exported a ${payload.format} artifact`,
              source: "export",
              request: payload,
              evidenceLevel: "artifact",
            });
          }
          nextTargetState = (result as ActionResult).state;
          break;
        }
        case "capture_view": {
          const payload = captureViewRequestSchema.parse(JSON.parse(argumentsJson));
          if (payload.attachToConversation) {
            this.consumeCaptureUploadConsent(sessionId);
          }
          result = await this.captureViewDirect(payload);
          captureInspectionPrompt = payload.inspectionPrompt;
          attachCaptureToConversation = payload.attachToConversation === true;
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

    if (toolName === "capture_view" && attachCaptureToConversation && isActionResultPayload(result)) {
      const captureArtifact = result.artifacts.find((artifact) => artifact.kind === "image");
      const attachment = captureArtifact
        ? await this.buildCaptureConversationItem(
          record.status.target,
          captureArtifact.path,
          captureInspectionPrompt,
        )
        : {
          item: null,
          warning: "Viewport attachment was requested, but no image artifact was produced. Nothing was sent to the model conversation.",
        } satisfies CaptureConversationAttachment;
      captureConversationItem = attachment.item;
      if (attachment.warning) {
        result = {
          ...result,
          warnings: [attachment.warning, ...result.warnings],
        };
        resultLevel = "warn";
        this.broadcast(sessionId, {
          kind: "log",
          level: "warn",
          text: attachment.warning,
        });
      }
    }

    if (!this.hasSession(sessionId)) {
      return;
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
          output: JSON.stringify(this.buildConversationToolOutput(toolName, result)),
        },
      }),
    );
    if (captureConversationItem) {
      ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: captureConversationItem,
      }));
    }
    if (createFollowUpResponse) {
      ws.send(JSON.stringify({ type: "response.create" }));
    }

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

  private consumeCaptureUploadConsent(sessionId: string): void {
    if (!this.captureUploadsEnabled) {
      throw new Error(
        "Viewport upload is disabled. The capture remains local unless ALLOW_CAPTURE_UPLOADS=true is explicitly configured.",
      );
    }
    const record = this.requireSession(sessionId);
    const grant = record.captureUploadConsent;
    // Consume before any capture or upload work so one grant can authorize at most one attempt.
    record.captureUploadConsent = null;
    if (!grant || grant.expiresAtMs <= Date.now()) {
      throw new Error(
        "Viewport upload requires a fresh one-shot consent grant from an explicit user action. The capture remains local by default.",
      );
    }
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
      if (!record.disconnectRequested) {
        void this.disconnect(sessionId).catch((error) => {
          console.warn(
            `[realtime-guardrail-disconnect-warning] session=${sessionId} ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
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
    const summary = `Realtime session guardrails active: ${this.sessionGuardrails.maxSessionMinutes}m max session, ${this.sessionGuardrails.maxResponsesPerSession} responses, ${this.sessionGuardrails.maxTranscriptionsPerSession} transcriptions, ${new Intl.NumberFormat("en-US").format(this.sessionGuardrails.maxBillableTokensPerSession)} cost-guard tokens. Push-to-talk remains the lowest-risk default.`;
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

  private async writeRunReceipt(input: CreateRunReceiptInput): Promise<void> {
    try {
      await this.receiptStateReady;
      await this.receiptStore.create(input);
    } catch (error) {
      console.warn(`[run-receipt-warning] ${error instanceof Error ? error.message : String(error)}`);
    }
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

  private buildConversationToolOutput(
    toolName: string,
    result: ActionResult | ScientificWorkflowResult | Record<string, unknown>,
  ): Record<string, unknown> {
    if ("error" in result && typeof result.error === "string" && result.error.trim()) {
      return { ok: false, tool: toolName, error: result.error.trim() };
    }

    if (toolName === "get_target_state") {
      return {
        ok: true,
        tool: toolName,
        state: this.compactTargetStateForConversation((result as { state?: unknown }).state),
      };
    }

    if (toolName === "resolve_structure_asset") {
      const payload = result as {
        resolution?: ScientificAssetResolution;
        loaded?: boolean;
        warnings?: string[];
        loadResult?: ActionResult;
      };
      return {
        ok: true,
        tool: toolName,
        resolution: payload.resolution ? this.compactScientificAssetResolutionForConversation(payload.resolution) : undefined,
        loaded: payload.loaded,
        warnings: (payload.warnings ?? []).slice(0, 4),
        load: payload.loadResult ? {
          target: payload.loadResult.target,
          warnings: payload.loadResult.warnings.slice(0, 4),
          metrics: payload.loadResult.metrics.slice(0, 4).map((metric) => this.compactMetricForConversation(metric)),
        } : undefined,
      };
    }

    if (this.isScientificWorkflowResult(result)) {
      return {
        ok: true,
        tool: toolName,
        target: result.target,
        workflow: result.workflow,
        warnings: result.warnings.slice(0, 4),
        metrics: result.metrics.slice(0, 8).map((metric) => this.compactMetricForConversation(metric)),
        artifacts: result.artifacts.slice(0, 4).map((artifact) => this.compactArtifactForConversation(artifact)),
        rankedCandidates: result.rankedCandidates?.slice(0, 3).map((candidate) => ({
          rank: candidate.rank,
          tag: candidate.tag,
          score: candidate.score,
          scoreLabel: candidate.scoreLabel,
          matched: candidate.matched,
          warnings: candidate.warnings.slice(0, 2),
          path: candidate.path ? path.basename(candidate.path) : undefined,
        })),
        referenceHints: this.compactReferenceHintsForConversation(result.referenceHints),
      };
    }

    if (this.isActionResult(result)) {
      return {
        ok: true,
        tool: toolName,
        target: result.target,
        warnings: result.warnings.slice(0, 4),
        metrics: result.metrics.slice(0, 8).map((metric) => this.compactMetricForConversation(metric)),
        artifacts: result.artifacts.slice(0, 4).map((artifact) => this.compactArtifactForConversation(artifact)),
      };
    }

    return {
      ok: true,
      tool: toolName,
      result: this.compactUnknownForConversation(result),
    };
  }

  private compactMetricForConversation(metric: ActionResult["metrics"][number]): Record<string, unknown> {
    return {
      kind: metric.kind,
      label: metric.label,
      value: metric.value,
      valueText: metric.valueText,
      unit: metric.unit,
    };
  }

  private compactScientificAssetResolutionForConversation(resolution: ScientificAssetResolution): Record<string, unknown> {
    return this.removeUndefined({
      source: resolution.source,
      id: resolution.id,
      label: resolution.label,
      files: resolution.files.slice(0, 4).map((file) => this.removeUndefined({
        kind: file.kind,
        label: file.label,
        file: path.basename(file.path),
        path: file.path,
        format: file.format,
        bytes: file.bytes,
        sha256: file.sha256.slice(0, 12),
        cacheHit: file.cacheHit,
      })),
      metadata: this.compactUnknownForConversation(resolution.metadata),
      searchResults: resolution.searchResults?.slice(0, 5).map((entry) => this.compactUnknownForConversation(entry)),
      warnings: resolution.warnings.slice(0, 4),
    });
  }

  private compactArtifactForConversation(artifact: ActionResult["artifacts"][number]): Record<string, unknown> {
    return {
      kind: artifact.kind,
      label: artifact.label,
      file: path.basename(artifact.path),
    };
  }

  private compactReferenceHintsForConversation(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) {
      return undefined;
    }
    return Object.fromEntries(entries.slice(0, 20).map(([key, raw]) => {
      const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return [key, {
        label: typeof record.label === "string" ? record.label : key,
      }];
    }));
  }

  private compactTargetStateForConversation(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    return this.removeUndefined({
      objectNames: this.compactStringArray(record.objectNames, 16),
      molecularObjectNames: this.compactStringArray(record.molecularObjectNames, 12),
      mapObjectNames: this.compactStringArray(record.mapObjectNames, 8),
      measurementObjectNames: this.compactStringArray(record.measurementObjectNames, 8),
      selectionNames: this.compactStringArray(record.selectionNames, 12),
      sceneNames: this.compactStringArray(record.sceneNames, 12),
      namedViews: this.compactStringArray(record.namedViews, 12),
      visibleChains: this.compactStringArray(record.visibleChains, 12),
      modelNames: this.compactStringArray(record.modelNames, 12),
      openModels: this.compactStringArray(record.openModels, 12),
      currentState: typeof record.currentState === "number" ? record.currentState : undefined,
      viewport: this.compactUnknownForConversation(record.viewport),
      referenceHints: this.compactReferenceHintsForConversation(record.referenceHints),
    });
  }

  private compactStringArray(value: unknown, limit: number): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const compact = value.filter((item): item is string => typeof item === "string").slice(0, limit);
    return compact.length ? compact : undefined;
  }

  private compactUnknownForConversation(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.slice(0, 8).map((item) => this.compactUnknownForConversation(item));
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return this.removeUndefined(Object.fromEntries(
        Object.entries(record).slice(0, 12).map(([key, entry]) => [key, this.compactUnknownForConversation(entry)]),
      ));
    }
    return value;
  }

  private removeUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
  }

  private isActionResult(value: unknown): value is ActionResult {
    return Boolean(value && typeof value === "object" && "target" in value && "commandsExecuted" in value);
  }

  private isScientificWorkflowResult(value: unknown): value is ScientificWorkflowResult {
    return Boolean(value && typeof value === "object" && "workflow" in value && "actionsExecuted" in value);
  }

  private buildArtifactUrl(filePath: string): string {
    return `/api/artifacts?path=${encodeURIComponent(filePath)}`;
  }

  private async buildCaptureConversationItem(
    target: TargetKind,
    filePath: string,
    inspectionPrompt?: string,
  ): Promise<CaptureConversationAttachment> {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return {
          item: null,
          warning: "Viewport capture remained local because the generated artifact is not a regular file. Nothing was sent to the model conversation.",
        };
      }
      if (stat.size > MAX_CAPTURE_CONVERSATION_IMAGE_BYTES) {
        return {
          item: null,
          warning: `Viewport capture remained local because it is ${formatCaptureImageBytes(stat.size)}, above the ${formatCaptureImageBytes(MAX_CAPTURE_CONVERSATION_IMAGE_BYTES)} conversation-attachment limit. Reduce the capture dimensions and approve the next viewport again.`,
        };
      }
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > MAX_CAPTURE_CONVERSATION_IMAGE_BYTES) {
        return {
          item: null,
          warning: `Viewport capture remained local because it exceeded the ${formatCaptureImageBytes(MAX_CAPTURE_CONVERSATION_IMAGE_BYTES)} conversation-attachment limit while being read. Reduce the capture dimensions and approve the next viewport again.`,
        };
      }
      const mimeType = inferArtifactMimeType(filePath, "image");
      const base64 = bytes.toString("base64");
      const text = [
        inspectionPrompt?.trim() || `Inspect this ${target} viewport capture for clarity, framing, pocket visibility, labels, and presentation polish.`,
        "If the scene still needs work, call another visualization tool. Otherwise give one short spoken update.",
      ].join(" ");

      return {
        item: {
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
        },
      };
    } catch {
      return {
        item: null,
        warning: "Viewport capture remained local because BioVoice could not read the generated image for attachment. Nothing was sent to the model conversation.",
      };
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
        session: this.buildSessionConfig(
          record.status.target,
          record.status.voiceMode,
          record.status.recipeId,
          record.status.advancedMode,
          record.instructionContext,
          record.status.responseLanguageMode,
        ),
      }),
    );
  }

  private buildSessionConfig(
    target: TargetKind,
    voiceMode: VoiceMode,
    recipeId?: string,
    advancedMode = false,
    instructionContext?: string,
    responseLanguageMode: ResponseLanguageMode = "standard",
  ) {
    const recipe = this.safeGetRecipe(recipeId);
    const recipeSummary = recipe ? buildPinnedRecipeSummary(recipe, target) : undefined;
    const expertModeEnabled = advancedMode && this.expertCommandsEnabled;
    const reasoningModel = isRealtimeReasoningModel(this.realtimeModel);
    const session = {
      type: "realtime",
      model: this.realtimeModel,
      prompt: this.buildRealtimePromptField(),
      output_modalities: ["audio"],
      reasoning: reasoningModel && this.realtimeReasoningEffort
        ? {
            effort: this.realtimeReasoningEffort,
          }
        : undefined,
      parallel_tool_calls: reasoningModel ? false : undefined,
      instructions: buildSessionInstructions(
        target,
        voiceMode,
        recipeSummary,
        expertModeEnabled,
        instructionContext,
        responseLanguageMode,
      ),
      tool_choice: "auto",
      tools: buildRealtimeTools(target, { advancedMode: expertModeEnabled }),
      max_output_tokens: this.realtimeMaxOutputTokens,
      tracing: this.realtimeTracing,
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription:
            voiceMode === "open_mic"
              ? null
              : {
                  model: this.audioTranscriptionModel,
                  language: "en",
                  prompt: this.buildTranscriptionPrompt(target, recipe?.sampleData.map((item) => item.id)),
                },
          turn_detection:
            voiceMode === "open_mic"
              ? {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 900,
                  interrupt_response: false,
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

  private async createEphemeralSession(
    target: TargetKind,
    voiceMode: VoiceMode,
    recipeId?: string,
    instructionContext?: string,
    responseLanguageMode: ResponseLanguageMode = "standard",
  ): Promise<{ value: string }> {
    this.requireOpenAiApiKey();
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: this.buildOpenAiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: REALTIME_CLIENT_SECRET_TTL_SECONDS,
        },
        session: this.buildSessionConfig(target, voiceMode, recipeId, false, instructionContext, responseLanguageMode),
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

  private buildOpenAiHeaders(headers: Record<string, string> = {}): Record<string, string> {
    const openAiHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.openAiApiKey}`,
      ...headers,
    };

    if (this.openAiSafetyIdentifier) {
      openAiHeaders["OpenAI-Safety-Identifier"] = this.openAiSafetyIdentifier;
    }

    return openAiHeaders;
  }

  private async hangupRealtimeCall(callId: string): Promise<void> {
    if (!this.openAiApiKey) {
      return;
    }
    const response = await fetch(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`,
      {
        method: "POST",
        headers: this.buildOpenAiHeaders(),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI Realtime hangup failed (${response.status}): ${body.slice(0, 200)}`);
    }
  }

  private buildRealtimePromptField(): RealtimePromptConfig | undefined {
    if (!this.realtimePrompt) {
      return undefined;
    }

    return {
      id: this.realtimePrompt.id,
      ...(this.realtimePrompt.version ? { version: this.realtimePrompt.version } : {}),
      ...(this.realtimePrompt.variables ? { variables: this.realtimePrompt.variables } : {}),
    };
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

  private hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
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
        ? "PyMOL, cealign, super, isomesh, isosurface, ray trace, cartoon, cartoon only, cartoon overview, cartoon tube, cartoon pipe, cartoon putty, sticks, surface, polar contacts, angle, dihedral, translate, rotate, pocket hero, comparison hero"
        : "ChimeraX, matchmaker, orthoplanes, hbonds, clashes, contacts, volume, silhouette, cartoon only, cartoon overview, cartoon style, cartoon tube, cartoon pipe, torsion, move, turn, view name, presentation light, map hero";
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
    this.stopSidebandPing(record);
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
        console.warn(
          `[realtime-prune] session=${sessionId} status=${record.status.status} sideband=${record.status.sidebandStatus} ageMs=${now - record.lastActivityAt} callId=${record.callId || "none"}`,
        );
        if (record.callId && !record.disconnectRequested) {
          record.disconnectRequested = true;
          void this.hangupRealtimeCall(record.callId).catch((error) => {
            console.warn(
              `[realtime-prune-hangup-warning] callId=${record.callId} ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
        this.disposeSession(sessionId);
      }
    }
  }

  private scheduleSidebandReconnect(sessionId: string): void {
    const record = this.requireSession(sessionId);
    if (record.disconnectRequested) {
      return;
    }

    const maxAttempts = record.connectedAtMs
      ? MAX_CONNECTED_SIDEBAND_RECONNECT_ATTEMPTS
      : MAX_INITIAL_SIDEBAND_RECONNECT_ATTEMPTS;
    if (record.reconnectAttempts >= maxAttempts) {
      this.setStatus(sessionId, {
        status: "disconnected",
        sidebandStatus: "error",
        controllerReady: false,
        configSyncPending: false,
        lastError: "Sideband controller dropped and reconnect attempts were exhausted.",
      });
      console.warn(
        `[realtime-sideband-giveup] session=${sessionId} callId=${record.callId || "none"} attempts=${record.reconnectAttempts}`,
      );
      this.broadcast(sessionId, {
        kind: "status",
        text: "Sideband controller disconnected.",
        payload: record.status,
      });
      return;
    }

    record.reconnectAttempts += 1;
    const delayMs = Math.min(1_000 * 2 ** (record.reconnectAttempts - 1), MAX_SIDEBAND_RECONNECT_DELAY_MS);
    this.setStatus(sessionId, {
      status: "connecting",
      sidebandStatus: "reconnecting",
      controllerReady: false,
      configSyncPending: true,
      lastError: `Sideband reconnect attempt ${record.reconnectAttempts} scheduled in ${delayMs}ms.`,
    });
    console.warn(
      `[realtime-sideband-reconnect] session=${sessionId} callId=${record.callId || "none"} attempt=${record.reconnectAttempts} delayMs=${delayMs}`,
    );
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

  private startSidebandPing(
    record: SessionRecord,
    ws: WebSocket,
    sessionId: string,
    generation: number,
  ): void {
    this.stopSidebandPing(record);
    record.sidebandPingTimer = setInterval(() => {
      if (!this.hasSession(sessionId)) {
        this.stopSidebandPing(record);
        return;
      }
      if (record.ws !== ws || record.sidebandGeneration !== generation) {
        this.stopSidebandPing(record);
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        ws.ping();
      } catch {
        // Let the normal close/error path handle reconnect scheduling.
      }
    }, SIDEBAND_PING_INTERVAL_MS);
    record.sidebandPingTimer.unref?.();
  }

  private stopSidebandPing(record: SessionRecord): void {
    if (!record.sidebandPingTimer) {
      return;
    }
    clearInterval(record.sidebandPingTimer);
    record.sidebandPingTimer = null;
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
  const actualReasoningEffort = readNestedString(actual, ["reasoning", "effort"]);
  const expectedReasoningEffort = readNestedString(expected, ["reasoning", "effort"]);
  const actualTurnDetection = readNestedValue(actual, ["audio", "input", "turn_detection"]);
  const expectedTurnDetection = readNestedValue(expected, ["audio", "input", "turn_detection"]);

  return String(actual.model ?? "") !== String(expected.model ?? "")
    || String(actual.instructions ?? "") !== String(expected.instructions ?? "")
    || String(actual.tool_choice ?? "") !== String(expected.tool_choice ?? "")
    || String(actual.max_output_tokens ?? "") !== String(expected.max_output_tokens ?? "")
    || actualVoice !== expectedVoice
    || actualReasoningEffort !== expectedReasoningEffort
    || Boolean(actual.parallel_tool_calls) !== Boolean(expected.parallel_tool_calls)
    || JSON.stringify(actualOutputModalities) !== JSON.stringify(expectedOutputModalities)
    || JSON.stringify(actualTurnDetection ?? null) !== JSON.stringify(expectedTurnDetection ?? null)
    || JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames);
}

function isRealtimeReasoningModel(model: string): boolean {
  return model === "gpt-realtime-2" || model.startsWith("gpt-realtime-2-");
}

function normalizeRealtimeContextPruning(options?: RealtimeContextPruningOptions | null): RealtimeContextPruningOptions {
  const raw = options ?? DEFAULT_CONTEXT_PRUNING;
  const maxItems = Math.max(2, Math.floor(raw.maxItems));
  const retainItems = Math.max(1, Math.floor(raw.retainItems));
  return {
    enabled: raw.enabled,
    maxItems,
    retainItems: Math.min(retainItems, maxItems - 1),
  };
}

function isPrunableConversationItem(type: string, role?: string): boolean {
  const normalizedType = type.trim().toLowerCase();
  const normalizedRole = role?.trim().toLowerCase();
  if (normalizedType === "message") {
    return normalizedRole === "user" || normalizedRole === "assistant";
  }
  return normalizedType === "function_call" || normalizedType === "function_call_output";
}

function summarizeRealtimeRateLimits(rateLimits: unknown): { text: string; low: boolean } | null {
  if (!Array.isArray(rateLimits)) {
    return null;
  }

  const summaries: string[] = [];
  let low = false;
  for (const rateLimit of rateLimits) {
    if (!rateLimit || typeof rateLimit !== "object") {
      continue;
    }
    const entry = rateLimit as Record<string, unknown>;
    const name = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : "limit";
    const remaining = readFiniteNumber(entry.remaining);
    const limit = readFiniteNumber(entry.limit);
    const resetSeconds = readFiniteNumber(entry.reset_seconds);
    if (remaining === null && limit === null) {
      continue;
    }

    const remainingText =
      remaining !== null && limit !== null
        ? `${remaining}/${limit} remaining`
        : remaining !== null
          ? `${remaining} remaining`
          : `${limit} limit`;
    const resetText = resetSeconds !== null ? `, resets in ${Math.ceil(resetSeconds)}s` : "";
    summaries.push(`${name}: ${remainingText}${resetText}`);
    if (remaining !== null && (remaining <= 0 || (limit !== null && limit > 0 && remaining / limit <= 0.1))) {
      low = true;
    }
  }

  if (!summaries.length) {
    return null;
  }

  return {
    text: `Realtime rate limits: ${summaries.join("; ")}.`,
    low,
  };
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function isTerminalSidebandReconnectError(error: Error): boolean {
  return /Unexpected server response:\s*(401|403|404|410)\b/i.test(error.message);
}

function isUnknownRealtimeSessionError(error: unknown): boolean {
  return error instanceof Error && /^Unknown realtime session: /i.test(error.message);
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

function formatCaptureImageBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Math.ceil(megabytes * 10) / 10} MB`;
}

function assertToolActionsAllowed(actions: Array<Record<string, unknown>>, allowRawCommands: boolean): void {
  const rawCommands = actions.filter((action) => action?.type === "raw_command");
  if (!rawCommands.length) {
    return;
  }

  if (!allowRawCommands) {
    throw new Error("Raw expert commands are disabled for this session. Enable Advanced Expert Commands before using raw_command.");
  }

  if (rawCommands.some((action) => action.requiresConfirmation !== true)) {
    throw new Error("Raw expert commands require explicit confirmation before execution.");
  }
}

function shouldCheckpointActions(actions: Array<Record<string, unknown>>): boolean {
  return actions.some((action) => action?.type !== "export");
}

function summarizeActions(actions: ReadonlyArray<Record<string, unknown>>): string {
  const types = actions
    .map((action) => typeof action?.type === "string" ? action.type : "action")
    .slice(0, 8);
  if (!types.length) {
    return "BioVoice action run";
  }
  const extraCount = Math.max(0, actions.length - types.length);
  return `Ran ${types.join(", ")}${extraCount ? ` and ${extraCount} more` : ""}`;
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
