import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { prepareReceiptForApi } from "./receipt-response.js";
import { prepareTargetHealthDetail } from "./runtime-health-response.js";
import {
  actionEnvelopeSchema,
  captureViewRequestSchema,
  cleanupRuntimeArtifacts,
  fetchOrganizationUsageSummary,
  getAllowedExportRoots,
  getRuntimeCleanupOptions,
  OpenAiUsageError,
  getExampleCatalog,
  getScientificWorkflowCatalog,
  getRecipe,
  RealtimeSessionCapacityError,
  RealtimeSessionRegistry,
  resolveScientificAssetRequestSchema,
  resolvePublicBaseUrlOrigin,
  resolveFromRoot,
  responseLanguageModeSchema,
  scientificWorkflowRequestSchema,
  targetKindSchema,
  type RealtimeContextPruningOptions,
  type RealtimePromptConfig,
  type RealtimeReasoningEffort,
  voiceModeSchema,
} from "../../../packages/runtime-and-adapters/src/index.js";

dotenv.config();

const remoteAccessCookieName = "biovoice_remote_access";
const managedAgentStatePath = resolveFromRoot(".runtime", "agent-runtime", "state.json");

type ManagedAgentState = {
  target?: "pymol" | "chimerax";
  workflowId?: string;
  scientificInputs?: {
    uniprot?: string;
    experimentalPdbId?: string;
    emdbId?: string;
    structureFormat?: string;
    pdbFormat?: string;
    model?: string;
    experimental?: string;
    pae?: string;
    map?: string;
    bundle?: string;
    scorefile?: string;
    topN?: number;
    mutations?: Array<{ position: string; chain?: string; from?: string; to?: string }>;
    comparison?: string;
    ligand?: string;
    neighborhoodAngstroms?: number;
  };
};

function buildSessionAccessCookieName(sessionId: string): string {
  return `biovoice_session_${sessionId}`;
}

async function readManagedLaunchInstructionContext(target: "pymol" | "chimerax"): Promise<string | undefined> {
  const defaultContext = buildDefaultDemoAssetInstructionContext(target);
  const parsed = await readManagedAgentState();
  if (!parsed) {
    return defaultContext;
  }
  if (parsed.target !== target) {
    return defaultContext;
  }

  const context: string[] = [defaultContext];
  if (!parsed.scientificInputs) {
    return context.join(" ");
  }
  if (parsed.workflowId) {
    context.push(`Pinned workflow ${parsed.workflowId}.`);
  }
  if (parsed.scientificInputs.experimental) {
    context.push(`Use this exact local experimental structure path: ${parsed.scientificInputs.experimental}.`);
  }
  if (parsed.scientificInputs.model) {
    context.push(`Use this exact local model path: ${parsed.scientificInputs.model}.`);
  }
  if (parsed.scientificInputs.pae) {
    context.push(`Pinned local PAE file: ${parsed.scientificInputs.pae}.`);
  }
  if (parsed.scientificInputs.map) {
    context.push(`Pinned local map file: ${parsed.scientificInputs.map}.`);
  }
  if (parsed.scientificInputs.bundle) {
    context.push(`Pinned local design bundle: ${parsed.scientificInputs.bundle}.`);
  }
  if (parsed.scientificInputs.scorefile) {
    context.push(`Pinned local scorefile: ${parsed.scientificInputs.scorefile}.`);
  }
  if (parsed.scientificInputs.uniprot) {
    context.push(`Pinned UniProt id: ${parsed.scientificInputs.uniprot}.`);
  }
  if (parsed.scientificInputs.experimentalPdbId) {
    context.push(`Pinned experimental PDB id: ${parsed.scientificInputs.experimentalPdbId}.`);
  }
  if (parsed.scientificInputs.emdbId) {
    context.push(`Pinned EMDB id: ${parsed.scientificInputs.emdbId}.`);
  }
  if (parsed.scientificInputs.structureFormat) {
    context.push(`Preferred database structure format: ${parsed.scientificInputs.structureFormat}.`);
  }
  if (parsed.scientificInputs.pdbFormat) {
    context.push(`Preferred RCSB PDB format: ${parsed.scientificInputs.pdbFormat}.`);
  }
  if (typeof parsed.scientificInputs.topN === "number" && Number.isFinite(parsed.scientificInputs.topN)) {
    context.push(`Pinned top-N value: ${Math.max(1, Math.round(parsed.scientificInputs.topN))}.`);
  }
  if (parsed.scientificInputs.mutations?.length) {
    const sites = parsed.scientificInputs.mutations.map((mutation) => {
      const substitution = `${mutation.from ?? ""}${mutation.position}${mutation.to ?? ""}`;
      return mutation.chain ? `${mutation.chain}:${substitution}` : substitution;
    });
    context.push(`Pinned variant sites: ${sites.join(", ")}.`);
  }
  if (parsed.scientificInputs.comparison) {
    context.push(`Pinned local comparison structure: ${parsed.scientificInputs.comparison}.`);
  }
  if (parsed.scientificInputs.ligand) {
    context.push(`Pinned ligand residue code: ${parsed.scientificInputs.ligand}.`);
  }
  if (typeof parsed.scientificInputs.neighborhoodAngstroms === "number" && Number.isFinite(parsed.scientificInputs.neighborhoodAngstroms)) {
    context.push(`Pinned variant-neighborhood radius: ${parsed.scientificInputs.neighborhoodAngstroms} angstroms.`);
  }
  if (parsed.scientificInputs.experimental && parsed.scientificInputs.model) {
    const experimentalName = path.basename(parsed.scientificInputs.experimental, path.extname(parsed.scientificInputs.experimental));
    const modelName = path.basename(parsed.scientificInputs.model, path.extname(parsed.scientificInputs.model)).replace(/[^A-Za-z0-9_]+/g, "_");
    context.push(
      [
        "For local AlphaFold-versus-experiment requests, treat these as the canonical demo assets.",
        `Load the experimental structure first and keep the object name close to ${experimentalName}.`,
        `Load the predicted model second and keep the object name close to ${modelName}.`,
        "If the user asks to align the AlphaFold or predicted model to chain A/B/C/D, align the predicted model chain to the experimental model chain, not all-to-all and never predicted-to-predicted.",
        "Do not use selectors like `all` for overlay alignment when both structures are loaded.",
      ].join(" "),
    );
  }
  if (!context.length) {
    return undefined;
  }
  context.push("When the operator says local AlphaFold or local experimental model, prefer these pinned local inputs instead of web search.");
  return context.join(" ");
}

async function readManagedAgentState(): Promise<ManagedAgentState | null> {
  const raw = await fs.readFile(managedAgentStatePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ManagedAgentState;
    return parsed && (parsed.target === "pymol" || parsed.target === "chimerax") ? parsed : null;
  } catch {
    return null;
  }
}

function buildDefaultDemoAssetInstructionContext(target: "pymol" | "chimerax"): string {
  const loadVerb = target === "pymol" ? "load" : "open";
  return [
    "Default local demo assets are available; do not ask the operator for full file paths for these built-in assets.",
    `For 4HHB or the local hemoglobin tetramer, ${loadVerb} source local with id 4hhb; the local action adapter resolves the safe repo-local file path.`,
    `For the local AlphaFold hemoglobin alpha chain, ${loadVerb} source local with id P69905; the local action adapter resolves the safe repo-local file path.`,
    target === "pymol"
      ? "In PyMOL, use object 4hhb for a plain tetramer load, or hb_exp plus hb_af_alpha for the AlphaFold overlay demo."
      : "In ChimeraX, keep the 4HHB model first and the AlphaFold alpha-chain model second for overlay demos.",
  ].join(" ");
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function isLoopbackHost(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function requestHasForwardingHeaders(req: Request): boolean {
  return Boolean(
    req.get("forwarded")
    || req.get("x-forwarded-for")
    || req.get("x-forwarded-host")
    || req.get("x-forwarded-proto")
    || req.get("x-real-ip"),
  );
}

function requestTargetsLoopbackHost(req: Request): boolean {
  const hostHeader = req.get("host");
  if (!hostHeader) {
    return true;
  }

  try {
    const parsed = new URL(`http://${hostHeader}`);
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function requestIsLocal(req: Request): boolean {
  return isLoopbackAddress(req.ip) || isLoopbackAddress(req.socket.remoteAddress);
}

function requestIsDirectLocal(req: Request): boolean {
  return requestIsLocal(req) && requestTargetsLoopbackHost(req) && !requestHasForwardingHeaders(req);
}

function parseCookies(req: Request): Map<string, string> {
  const cookieHeader = req.get("cookie");
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const chunk of cookieHeader.split(";")) {
    const separatorIndex = chunk.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

function buildCookie(name: string, value: string, options?: {
  maxAgeSeconds?: number;
  path?: string;
}): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${options?.path ?? "/"}`,
  ];
  if (typeof options?.maxAgeSeconds === "number") {
    attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  return attributes.join("; ");
}

function setCookie(res: Response, name: string, value: string, options?: {
  maxAgeSeconds?: number;
  path?: string;
}): void {
  res.append("Set-Cookie", buildCookie(name, value, options));
}

function clearCookie(res: Response, name: string, pathValue = "/"): void {
  res.append("Set-Cookie", buildCookie(name, "", { maxAgeSeconds: 0, path: pathValue }));
}

function readRemoteAccessToken(req: Request): string {
  const headerToken = req.get("X-Remote-Access-Token");
  if (headerToken?.trim()) {
    return headerToken.trim();
  }

  const authorization = req.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const bearerToken = authorization.slice("Bearer ".length).trim();
    if (bearerToken) {
      return bearerToken;
    }
  }

  const cookieToken = parseCookies(req).get(remoteAccessCookieName);
  if (cookieToken?.trim()) {
    return cookieToken.trim();
  }

  const queryToken = typeof req.query.access_token === "string" ? req.query.access_token : "";
  if (queryToken.trim()) {
    return queryToken.trim();
  }

  return "";
}

function buildAllowedBrowserOrigins(port: number, publicBaseUrl: string): Set<string> {
  const configured = (process.env.LOCAL_BROWSER_ORIGINS ?? "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
  const publicOrigin = normalizeOrigin(publicBaseUrl);

  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    ...(publicOrigin ? [publicOrigin] : []),
    ...configured,
  ]);
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function createRateLimit(label: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${label}:${req.ip ?? "local"}`;
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    if (bucket.count >= limit) {
      console.warn(`[realtime-rate-limit] ${label} blocked for ${req.ip ?? "local"}`);
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: `Rate limit exceeded for ${label}.` });
      return;
    }

    bucket.count += 1;
    next();
  };
}

function readSessionAccessToken(req: Request, sessionId: string): string {
  const headerToken = req.get("X-Session-Access-Token");
  if (headerToken?.trim()) {
    return headerToken.trim();
  }

  if (req.body && typeof req.body === "object") {
    const bodyToken = (req.body as Record<string, unknown>).sessionAccessToken;
    if (typeof bodyToken === "string" && bodyToken.trim()) {
      return bodyToken.trim();
    }
  }

  const cookieToken = parseCookies(req).get(buildSessionAccessCookieName(sessionId));
  if (cookieToken?.trim()) {
    return cookieToken.trim();
  }

  return "";
}

const projectRoot = resolveFromRoot();
const builtWebDir = path.join(projectRoot, "dist", "web");
const artifactRoots = getAllowedExportRoots();
const builtAssetsAvailable = await fs.access(builtWebDir).then(() => true).catch(() => false);
const devServerMode = process.env.DEV_SERVER === "true";
const serverMode = devServerMode ? "dev-api" : builtAssetsAvailable ? "built-static" : "api-only";
const appId = "biovoice";
const serverInstanceId = crypto.randomUUID();
const serverStartedAt = new Date().toISOString();

const port = Number(process.env.PORT ?? 3000);
const listenHost = process.env.HOST ?? "127.0.0.1";
const publicBaseUrl = resolvePublicBaseUrlOrigin({
  configuredPublicBaseUrl: process.env.PUBLIC_BASE_URL,
  listenHost,
  port,
});
const allowRemoteClients = process.env.ALLOW_REMOTE_CLIENTS === "true";
const remoteAccessToken = allowRemoteClients
  ? (process.env.REMOTE_ACCESS_TOKEN?.trim() || crypto.randomUUID())
  : "";
const realtimeModel = process.env.REALTIME_MODEL ?? "gpt-realtime-2";
const realtimeVoice = process.env.REALTIME_VOICE ?? "marin";
const realtimePrompt = parseRealtimePromptConfig({
  id: process.env.REALTIME_PROMPT_ID,
  version: process.env.REALTIME_PROMPT_VERSION,
  variablesJson: process.env.REALTIME_PROMPT_VARIABLES_JSON,
});
const realtimeReasoningEffort = parseRealtimeReasoningEffort(process.env.REALTIME_REASONING_EFFORT ?? "low");
const realtimeContextPruning = parseRealtimeContextPruning({
  enabled: process.env.REALTIME_CONTEXT_PRUNING,
  maxItems: process.env.REALTIME_CONTEXT_MAX_ITEMS,
  retainItems: process.env.REALTIME_CONTEXT_RETAIN_ITEMS,
});
const realtimeTranscriptionModel = process.env.REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";
const realtimeOutputSpeed = Number(process.env.REALTIME_OUTPUT_SPEED ?? 1);
const realtimeMaxOutputTokens = parseRealtimeMaxOutputTokens(process.env.REALTIME_MAX_OUTPUT_TOKENS ?? "1536");
const realtimeIdleWarningSeconds = readNonNegativeInteger(process.env.REALTIME_IDLE_WARNING_SECONDS, 30);
const realtimePttIdleDisconnectSeconds = readNonNegativeInteger(process.env.REALTIME_PTT_IDLE_DISCONNECT_SECONDS, 900);
const realtimeOpenMicIdleDisconnectSeconds = readNonNegativeInteger(process.env.REALTIME_OPEN_MIC_IDLE_DISCONNECT_SECONDS, 180);
const realtimeMaxSessionMinutes = readPositiveInteger(process.env.REALTIME_MAX_SESSION_MINUTES, 25);
const realtimeMaxResponsesPerSession = readPositiveInteger(process.env.REALTIME_MAX_RESPONSES_PER_SESSION, 18);
const realtimeMaxTranscriptionsPerSession = readPositiveInteger(process.env.REALTIME_MAX_TRANSCRIPTIONS_PER_SESSION, 36);
const realtimeMaxBillableTokensPerSession = readPositiveInteger(process.env.REALTIME_MAX_BILLABLE_TOKENS_PER_SESSION, 120000);
const realtimeMaxActiveSessions = readPositiveInteger(process.env.REALTIME_MAX_ACTIVE_SESSIONS, 2);
const realtimeUsageWarningRatio = readUnitInterval(process.env.REALTIME_USAGE_WARNING_RATIO, 0.8, 0.5, 0.95);
const realtimeTracing = process.env.REALTIME_TRACING === "false" ? null : "auto";
const realtimeRetentionRatio = Number(process.env.REALTIME_RETENTION_RATIO ?? 0.4);
const realtimePostInstructionsTokens = Number(process.env.REALTIME_POST_INSTRUCTIONS_TOKENS ?? 2000);
const realtimeTruncation =
  process.env.REALTIME_ENABLE_TRUNCATION === "false"
    ? null
    : {
        retentionRatio: realtimeRetentionRatio,
        postInstructions: realtimePostInstructionsTokens,
      };
const defaultTarget = targetKindSchema.parse(process.env.DEFAULT_TARGET ?? "pymol");
const enableAutolaunch = process.env.ENABLE_AUTOLAUNCH !== "false";
const usageApiKey = process.env.OPENAI_USAGE_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const usageProjectId = process.env.OPENAI_USAGE_PROJECT_ID;
const openAiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
const openAiSafetyIdentifier = sanitizeOpenAiSafetyIdentifier(process.env.OPENAI_SAFETY_IDENTIFIER);
const usageKeyPresent = Boolean(usageApiKey);
const expertCommandsGloballyEnabled = process.env.ENABLE_EXPERT_RAW_COMMANDS === "true";
const captureUploadsEnabled = process.env.ALLOW_CAPTURE_UPLOADS === "true";
const persistSessionEvents = process.env.PERSIST_SESSION_EVENT_LOGS === "true";
const allowedBrowserOrigins = buildAllowedBrowserOrigins(port, publicBaseUrl);
const realtimeCredentialStatus: {
  validated: boolean;
  lastCheckedAt?: string;
  lastError?: string;
} = {
  validated: false,
};
const usageScopeStatus: {
  validated: boolean;
  lastCheckedAt?: string;
  lastError?: string;
} = {
  validated: false,
};

if (!allowRemoteClients && !isLoopbackHost(listenHost)) {
  throw new Error(
    `Refusing to bind HOST=${listenHost} without ALLOW_REMOTE_CLIENTS=true. Keep the server on localhost by default, or explicitly opt into remote clients and set LOCAL_BROWSER_ORIGINS/Public Base URL for LAN access.`,
  );
}

const app = express();
const registry = new RealtimeSessionRegistry({
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiSafetyIdentifier,
  realtimeModel,
  realtimeVoice,
  realtimePrompt,
  realtimeReasoningEffort,
  realtimeContextPruning,
  audioTranscriptionModel: realtimeTranscriptionModel,
  realtimeOutputSpeed,
  realtimeMaxOutputTokens,
  realtimeTracing,
  realtimeTruncation,
  sessionGuardrails: {
    maxSessionMinutes: realtimeMaxSessionMinutes,
    maxResponsesPerSession: realtimeMaxResponsesPerSession,
    maxTranscriptionsPerSession: realtimeMaxTranscriptionsPerSession,
    maxBillableTokensPerSession: realtimeMaxBillableTokensPerSession,
    warningRatio: realtimeUsageWarningRatio,
  },
  maxActiveSessions: realtimeMaxActiveSessions,
  transcriptionPromptHint: process.env.REALTIME_TRANSCRIPTION_PROMPT_HINT,
  debugRawEvents: process.env.REALTIME_DEBUG_RAW_EVENTS === "true",
  expertCommandsEnabled: expertCommandsGloballyEnabled,
  captureUploadsEnabled,
  persistSessionEvents,
  pymol: {
    rpcUrl: process.env.PYMOL_RPC_URL,
    baseUrl: process.env.PYMOL_RPC_BASE_URL ?? "http://127.0.0.1",
    startPort: Number(process.env.PYMOL_RPC_START_PORT ?? 9123),
    timeoutMs: Number(process.env.PYMOL_TIMEOUT_MS ?? 8000),
    renderTimeoutMs: Number(process.env.PYMOL_RENDER_TIMEOUT_MS ?? 120000),
    autolaunch: enableAutolaunch,
  },
  chimerax: {
    port: Number(process.env.CHIMERAX_REST_PORT ?? 60958),
    timeoutMs: Number(process.env.CHIMERAX_TIMEOUT_MS ?? 30000),
    autolaunch: enableAutolaunch,
  },
});

function requireSessionAccess(req: Request, res: Response, next: NextFunction): void {
  try {
    const sessionId = String(req.params.sessionId ?? "");
    const token = readSessionAccessToken(req, sessionId);
    if (!sessionId.trim()) {
      res.status(400).json({ error: "Missing sessionId." });
      return;
    }
    if (!token) {
      res.status(401).json({ error: "Missing realtime session access token." });
      return;
    }

    registry.validateSessionAccess(sessionId, token);
    next();
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

await cleanupRuntimeArtifacts(getRuntimeCleanupOptions());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.path.startsWith("/api/") || req.path.startsWith("/session-events/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  const directLocalRequest = requestIsDirectLocal(req);
  if (!allowRemoteClients && !directLocalRequest) {
    res.status(403).json({
      error: "Remote clients are disabled for this local service. Use a direct localhost request, or set ALLOW_REMOTE_CLIENTS=true and LOCAL_BROWSER_ORIGINS explicitly if you intend LAN access.",
    });
    return;
  }

  const remoteRequest = !directLocalRequest;
  if (allowRemoteClients && remoteRequest) {
    const presentedRemoteAccessToken = readRemoteAccessToken(req);
    const validRemoteAccess = Boolean(remoteAccessToken) && presentedRemoteAccessToken === remoteAccessToken;

    if (validRemoteAccess) {
      setCookie(res, remoteAccessCookieName, remoteAccessToken, { maxAgeSeconds: 43_200 });
      if (
        typeof req.query.access_token === "string"
        && (req.method === "GET" || req.method === "HEAD")
      ) {
        const cleanUrl = new URL(req.originalUrl, publicBaseUrl);
        cleanUrl.searchParams.delete("access_token");
        const redirectTarget = `${cleanUrl.pathname}${cleanUrl.search}`;
        res.redirect(302, redirectTarget || "/");
        return;
      }
    } else {
      const wantsHtml = req.accepts(["html", "json"]) === "html";
      const htmlNavigation = wantsHtml && !req.path.startsWith("/api/") && !req.path.startsWith("/session-events/");
      if (htmlNavigation) {
        res.status(401).type("text/plain").send(
          "Remote access requires a valid access token. Open the published URL with ?access_token=<REMOTE_ACCESS_TOKEN> to authorize this browser.",
        );
        return;
      }
      res.status(401).json({
        error: "Remote access requires a valid access token. Present it with the access_token query parameter for the initial browser load, or X-Remote-Access-Token / Authorization: Bearer for scripted requests.",
      });
      return;
    }
  }

  const origin = req.get("origin");
  if (!origin) {
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
    return;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin || !allowedBrowserOrigins.has(normalizedOrigin)) {
    res.status(403).json({ error: "Browser origin is not allowed for this localhost service." });
    return;
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID, X-Remote-Access-Token, X-Session-Access-Token");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: "2mb" }));

function sanitizeRuntimeHealth(
  runtimeHealth: Awaited<ReturnType<typeof registry.getRuntimeHealth>>,
  includeSensitive: boolean,
) {
  if (includeSensitive) {
    return runtimeHealth;
  }

  return {
    sessions: runtimeHealth.sessions,
    targets: {
      pymol: {
        ready: runtimeHealth.targets.pymol.ready,
      },
      chimerax: {
        ready: runtimeHealth.targets.chimerax.ready,
      },
    },
  };
}

app.get("/api/health", async (req, res) => {
  const runtimeHealth = await registry.getRuntimeHealth();
  const includeSensitiveRuntime = requestIsDirectLocal(req);
  const localDiagnostics = includeSensitiveRuntime
    ? {
        pid: process.pid,
        projectRoot,
      }
    : {};
  res.json({
    ok: true,
    appId,
    instanceId: serverInstanceId,
    ...localDiagnostics,
    serverMode,
    startedAt: serverStartedAt,
    publicBaseUrl,
    realtimeModel,
    realtimeVoice,
    realtimePromptPresent: Boolean(realtimePrompt),
    realtimePromptVersion: realtimePrompt?.version,
    realtimeReasoningEffort,
    realtimeContextPruning,
    realtimeIdleWarningSeconds,
    realtimePttIdleDisconnectSeconds,
    realtimeOpenMicIdleDisconnectSeconds,
    realtimeSessionGuardrails: {
      maxSessionMinutes: realtimeMaxSessionMinutes,
      maxResponsesPerSession: realtimeMaxResponsesPerSession,
      maxTranscriptionsPerSession: realtimeMaxTranscriptionsPerSession,
      maxBillableTokensPerSession: realtimeMaxBillableTokensPerSession,
      maxActiveSessions: realtimeMaxActiveSessions,
      warningRatio: realtimeUsageWarningRatio,
    },
    defaultTarget,
    exampleCount: getExampleCatalog().length,
    scientificWorkflowCount: getScientificWorkflowCatalog().length,
    openAiKeyPresent,
    openAiSafetyIdentifierPresent: Boolean(openAiSafetyIdentifier),
    usageKeyPresent,
    expertCommandsGloballyEnabled,
    captureUploadsEnabled,
    persistSessionEvents,
    allowRemoteClients,
    realtimeReady: openAiKeyPresent,
    usageReady: usageKeyPresent,
    realtimeCredentialValidated: realtimeCredentialStatus.validated,
    realtimeCredentialLastCheckedAt: realtimeCredentialStatus.lastCheckedAt,
    realtimeCredentialLastError: realtimeCredentialStatus.lastError,
    usageScopeValidated: usageScopeStatus.validated,
    usageScopeLastCheckedAt: usageScopeStatus.lastCheckedAt,
    usageScopeLastError: usageScopeStatus.lastError,
    runtime: sanitizeRuntimeHealth(runtimeHealth, includeSensitiveRuntime),
  });
});

app.get("/api/doctor", async (req, res) => {
  const runtimeHealth = await registry.getRuntimeHealth();
  const includeSensitiveRuntime = requestIsDirectLocal(req);
  const requestedTarget = targetKindSchema.safeParse(req.query.target);
  const selectedTarget = requestedTarget.success ? requestedTarget.data : defaultTarget;
  const selectedTargetLabel = selectedTarget === "pymol" ? "PyMOL" : "ChimeraX";
  const selectedTargetHealth = runtimeHealth.targets[selectedTarget];
  const pymolUndo = registry.getUndoAvailability("pymol");
  const chimeraxUndo = registry.getUndoAvailability("chimerax");
  const checks = [
    {
      id: "local-service",
      label: "BioVoice service",
      status: "ready" as const,
      detail: `Listening on ${publicBaseUrl}.`,
    },
    {
      id: "realtime-key",
      label: "Realtime credential",
      status: !openAiKeyPresent || realtimeCredentialStatus.lastError
        ? "blocked" as const
        : realtimeCredentialStatus.validated
          ? "ready" as const
          : "warning" as const,
      detail: !openAiKeyPresent
        ? "Voice sessions need OPENAI_API_KEY; offline rehearsals still work without it."
        : realtimeCredentialStatus.lastError
          ? "The configured Realtime credential failed its most recent live check."
          : realtimeCredentialStatus.validated
            ? "The Realtime credential passed a live check."
            : "A Realtime credential is configured but has not completed a live check yet.",
      ...(!openAiKeyPresent
        ? { action: "Add OPENAI_API_KEY to your untracked local .env, then restart BioVoice." }
        : realtimeCredentialStatus.lastError
          ? { action: "Check the local credential and restart BioVoice before another live session." }
          : {}),
    },
    {
      id: "selected-target",
      label: `${selectedTargetLabel} controller`,
      status: selectedTargetHealth.ready ? "ready" as const : "warning" as const,
      detail: prepareTargetHealthDetail(
        selectedTargetLabel,
        selectedTargetHealth.ready,
        selectedTargetHealth.detail,
        includeSensitiveRuntime,
      ),
      ...(!selectedTargetHealth.ready
        ? { action: `Launch the ${selectedTargetLabel} target or use npm run launch:${selectedTarget}.` }
        : {}),
    },
    {
      id: "capture-privacy",
      label: "Viewport privacy",
      status: "ready" as const,
      detail: captureUploadsEnabled
        ? "Conversation image upload is enabled, but each upload still requires a fresh single-use consent grant from the user."
        : "Viewport captures stay on this machine by default.",
    },
  ];

  res.json({
    ok: checks.every((check) => check.status === "ready"),
    checks,
    targets: {
      pymol: {
        ready: runtimeHealth.targets.pymol.ready,
        undoAvailable: pymolUndo.available,
      },
      chimerax: {
        ready: runtimeHealth.targets.chimerax.ready,
        undoAvailable: chimeraxUndo.available,
      },
    },
  });
});

app.get("/api/config", async (req, res) => {
  const runtimeHealth = await registry.getRuntimeHealth();
  const includeSensitiveRuntime = requestIsDirectLocal(req);
  const managedLaunch = includeSensitiveRuntime ? await readManagedAgentState() : null;
  res.json({
    appId,
    instanceId: serverInstanceId,
    serverMode,
    startedAt: serverStartedAt,
    publicBaseUrl,
    realtimeModel,
    realtimeVoice,
    realtimePromptPresent: Boolean(realtimePrompt),
    realtimePromptVersion: realtimePrompt?.version,
    realtimeReasoningEffort,
    realtimeContextPruning,
    realtimeIdleWarningSeconds,
    realtimePttIdleDisconnectSeconds,
    realtimeOpenMicIdleDisconnectSeconds,
    realtimeSessionGuardrails: {
      maxSessionMinutes: realtimeMaxSessionMinutes,
      maxResponsesPerSession: realtimeMaxResponsesPerSession,
      maxTranscriptionsPerSession: realtimeMaxTranscriptionsPerSession,
      maxBillableTokensPerSession: realtimeMaxBillableTokensPerSession,
      maxActiveSessions: realtimeMaxActiveSessions,
      warningRatio: realtimeUsageWarningRatio,
    },
    defaultTarget,
    openAiKeyPresent,
    openAiSafetyIdentifierPresent: Boolean(openAiSafetyIdentifier),
    usageKeyPresent,
    expertCommandsGloballyEnabled,
    captureUploadsEnabled,
    persistSessionEvents,
    allowRemoteClients,
    realtimeReady: openAiKeyPresent,
    usageReady: usageKeyPresent,
    realtimeCredentialValidated: realtimeCredentialStatus.validated,
    realtimeCredentialLastCheckedAt: realtimeCredentialStatus.lastCheckedAt,
    realtimeCredentialLastError: realtimeCredentialStatus.lastError,
    usageScopeValidated: usageScopeStatus.validated,
    usageScopeLastCheckedAt: usageScopeStatus.lastCheckedAt,
    usageScopeLastError: usageScopeStatus.lastError,
    realtimeTranscriptionModel,
    realtimeOutputSpeed,
    realtimeMaxOutputTokens,
    realtimeTracing: Boolean(realtimeTracing),
    realtimeTruncation,
    runtime: sanitizeRuntimeHealth(runtimeHealth, includeSensitiveRuntime),
    ...(managedLaunch ? {
      managedScientificLaunch: {
        target: managedLaunch.target,
        workflowId: managedLaunch.workflowId,
        scientificInputs: managedLaunch.scientificInputs ?? {},
      },
    } : {}),
    scientificWorkflows: getScientificWorkflowCatalog(),
    examples: getExampleCatalog().map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      category: recipe.category,
      apps: recipe.apps,
      goal: recipe.goal,
      difficulty: recipe.difficulty,
      estimatedMinutes: recipe.estimatedMinutes,
    })),
  });
});

app.get("/api/examples", (_req, res) => {
  res.json(getExampleCatalog());
});

app.get("/api/workflows", (_req, res) => {
  res.json(getScientificWorkflowCatalog());
});

app.post("/api/actions", createRateLimit("actions", 120, 60_000), async (req, res) => {
  try {
    const result = await registry.runActionEnvelope(actionEnvelopeSchema.parse(req.body));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/workflows/run", createRateLimit("workflows", 60, 60_000), async (req, res) => {
  try {
    const result = await registry.runScientificWorkflowDirect(scientificWorkflowRequestSchema.parse(req.body));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/assets/resolve", createRateLimit("assets", 60, 60_000), async (req, res) => {
  try {
    const result = await registry.resolveStructureAssetDirect(resolveScientificAssetRequestSchema.parse(req.body));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/recipes/:recipeId/run", createRateLimit("recipes", 60, 60_000), async (req, res) => {
  try {
    const recipeId = String(req.params.recipeId ?? "");
    const recipe = getRecipe(recipeId);
    const target = targetKindSchema.parse(req.body.target ?? recipe.apps[0]);
    const stepId = typeof req.body.stepId === "string" ? req.body.stepId : undefined;
    const dryRun = Boolean(req.body.dryRun);
    const result = stepId
      ? await registry.runRecipeStepDirect(recipe.id, stepId, target, dryRun)
      : await registry.runRecipeDirect(recipe.id, target, dryRun);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/capture", createRateLimit("capture", 60, 60_000), async (req, res) => {
  try {
    const request = captureViewRequestSchema.parse(req.body);
    if (request.attachToConversation) {
      res.status(400).json({
        error: "The direct capture route is local-only. Conversation attachment requires a live session and a fresh one-shot user consent grant.",
      });
      return;
    }
    const result = await registry.captureViewDirect(request);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/targets/:target/state", async (req, res) => {
  try {
    const target = targetKindSchema.parse(String(req.params.target ?? ""));
    const state = await registry.getTargetState(target);
    res.json({
      target,
      refreshedAt: new Date().toISOString(),
      state,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

async function handleUndoRequest(targetValue: unknown, res: Response): Promise<void> {
  try {
    const target = targetKindSchema.parse(targetValue);
    const result = await registry.undoLastAction(target);
    res.json({
      ok: true,
      target,
      undoAvailable: registry.getUndoAvailability(target).available,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(/no .* checkpoint/i.test(message) ? 409 : 500).json({ error: message });
  }
}

app.post("/api/targets/:target/undo", createRateLimit("undo", 60, 60_000), async (req, res) => {
  await handleUndoRequest(String(req.params.target ?? ""), res);
});

app.post("/api/undo", createRateLimit("undo", 60, 60_000), async (req, res) => {
  await handleUndoRequest(req.body?.target, res);
});

app.get("/api/receipts", async (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 20;
  const receipts = await registry.listRunReceipts(limit);
  const includeSensitive = requestIsDirectLocal(req);
  res.json({ receipts: receipts.map((receipt) => prepareReceiptForApi(receipt, includeSensitive)) });
});

app.get("/api/receipts/:receiptId", async (req, res) => {
  const receipt = await registry.getRunReceipt(String(req.params.receiptId ?? ""));
  if (!receipt) {
    res.status(404).json({ error: "Run receipt not found." });
    return;
  }
  res.json({ receipt: prepareReceiptForApi(receipt, requestIsDirectLocal(req)) });
});

app.get("/api/artifacts", async (req, res) => {
  try {
    const requestedPath = String(req.query.path ?? "");
    if (!requestedPath.trim()) {
      res.status(400).json({ error: "Missing path." });
      return;
    }

    const resolvedPath = await fs.realpath(requestedPath).catch(() => path.resolve(requestedPath));
    const allowed = artifactRoots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`));
    if (!allowed) {
      res.status(403).json({ error: "Artifact path is outside the allowed roots." });
      return;
    }

    await fs.access(resolvedPath);
    res.type(path.extname(resolvedPath));
    res.sendFile(resolvedPath, { dotfiles: "allow" });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/usage/organization", async (req, res) => {
  try {
    const requestedDays = Number(req.query.days ?? 7);
    const summary = await fetchOrganizationUsageSummary({
      apiKey: usageApiKey,
      days: Number.isFinite(requestedDays) ? requestedDays : 7,
      projectId: usageProjectId,
      realtimeModel,
      transcriptionModel: realtimeTranscriptionModel,
    });
    markUsageScopeValidated();
    res.json(summary);
  } catch (error) {
    markUsageScopeFailed(error);
    if (error instanceof OpenAiUsageError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/realtime/client-secret", createRateLimit("client-secret", 12, 60_000), async (req, res) => {
  try {
    const target = targetKindSchema.parse(req.body.target ?? defaultTarget);
    const voiceMode = voiceModeSchema.parse(req.body.voiceMode ?? "push_to_talk");
    const responseLanguageMode = responseLanguageModeSchema.parse(req.body.responseLanguageMode ?? "standard");
    const instructionContext =
      typeof req.body.instructionContext === "string" && req.body.instructionContext.trim()
        ? req.body.instructionContext.trim()
        : await readManagedLaunchInstructionContext(target);
    const prepared = await registry.prepareSession(target, voiceMode, req.body.recipeId, instructionContext, responseLanguageMode);
    setCookie(res, buildSessionAccessCookieName(prepared.sessionId), prepared.sessionAccessToken, { maxAgeSeconds: 43_200 });
    markRealtimeCredentialValidated();
    res.json(prepared);
  } catch (error) {
    if (error instanceof RealtimeSessionCapacityError) {
      console.warn(`[realtime-guardrail] ${error.message}`);
      res.status(429).json({ error: error.message });
      return;
    }
    markRealtimeCredentialFailed(error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/realtime/connect", createRateLimit("realtime-connect", 12, 60_000), async (req, res) => {
  try {
    const target = targetKindSchema.parse(req.body.target ?? defaultTarget);
    const voiceMode = voiceModeSchema.parse(req.body.voiceMode ?? "push_to_talk");
    const responseLanguageMode = responseLanguageModeSchema.parse(req.body.responseLanguageMode ?? "standard");
    const instructionContext =
      typeof req.body.instructionContext === "string" && req.body.instructionContext.trim()
        ? req.body.instructionContext.trim()
        : await readManagedLaunchInstructionContext(target);
    const offerSdp = String(req.body.offerSdp ?? "");
    if (!offerSdp.trim()) {
      res.status(400).json({ error: "Missing offerSdp." });
      return;
    }

    const result = await registry.connect({
      offerSdp,
      target,
      voiceMode,
      responseLanguageMode,
      recipeId: req.body.recipeId,
      instructionContext,
    });
    setCookie(res, buildSessionAccessCookieName(result.sessionId), result.sessionAccessToken, { maxAgeSeconds: 43_200 });
    markRealtimeCredentialValidated();
    res.json(result);
  } catch (error) {
    if (error instanceof RealtimeSessionCapacityError) {
      console.warn(`[realtime-guardrail] ${error.message}`);
      res.status(429).json({ error: error.message });
      return;
    }
    markRealtimeCredentialFailed(error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/realtime/register-call", createRateLimit("register-call", 16, 60_000), async (req, res) => {
  try {
    const sessionId = String(req.body.sessionId ?? "");
    const callId = String(req.body.callId ?? "");
    const registerToken = String(req.body.registerToken ?? "");
    if (!sessionId.trim()) {
      res.status(400).json({ error: "Missing sessionId." });
      return;
    }
    if (!callId.trim()) {
      res.status(400).json({ error: "Missing callId." });
      return;
    }
    if (!registerToken.trim()) {
      res.status(400).json({ error: "Missing registerToken." });
      return;
    }

    registry.registerCall(sessionId, callId, registerToken);
    res.json({ sessionId, callId });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/sessions/:sessionId/status", requireSessionAccess, (req, res) => {
  try {
    res.json(registry.getStatus(String(req.params.sessionId ?? "")));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/session-events/:sessionId", requireSessionAccess, (req, res) => {
  try {
    registry.subscribe(String(req.params.sessionId ?? ""), req, res);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/sessions/:sessionId/target", requireSessionAccess, async (req, res) => {
  try {
    const status = await registry.updateTarget(String(req.params.sessionId ?? ""), targetKindSchema.parse(req.body.target));
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/sessions/:sessionId/voice-mode", requireSessionAccess, async (req, res) => {
  try {
    const status = await registry.updateVoiceMode(String(req.params.sessionId ?? ""), voiceModeSchema.parse(req.body.voiceMode));
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/sessions/:sessionId/response-language-mode", requireSessionAccess, async (req, res) => {
  try {
    const status = await registry.updateResponseLanguageMode(
      String(req.params.sessionId ?? ""),
      responseLanguageModeSchema.parse(req.body.responseLanguageMode),
    );
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/sessions/:sessionId/advanced-mode", requireSessionAccess, async (req, res) => {
  try {
    const status = await registry.updateAdvancedMode(String(req.params.sessionId ?? ""), Boolean(req.body.advancedMode));
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/sessions/:sessionId/recipe", requireSessionAccess, async (req, res) => {
  try {
    const status = await registry.updateRecipe(String(req.params.sessionId ?? ""), req.body.recipeId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post(
  "/api/sessions/:sessionId/capture-upload-consent",
  createRateLimit("capture-upload-consent", 12, 60_000),
  requireSessionAccess,
  (req, res) => {
    try {
      if (req.body?.confirmation !== "share_next_viewport_once") {
        res.status(400).json({
          error: "Explicit confirmation is required to share the next viewport once.",
        });
        return;
      }
      const sessionId = String(req.params.sessionId ?? "");
      const grant = registry.grantCaptureUploadConsent(sessionId);
      res.json({
        ok: true,
        scope: "next_viewport_only",
        expiresAt: grant.expiresAt,
      });
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : String(error) });
    }
  },
);

app.post("/api/sessions/:sessionId/disconnect", requireSessionAccess, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId ?? "");
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim()
      : "unspecified";
    console.warn(`[realtime-disconnect] session=${sessionId} reason=${reason}`);
    await registry.disconnect(sessionId);
    clearCookie(res, buildSessionAccessCookieName(sessionId));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

if (builtAssetsAvailable && !devServerMode) {
  app.use(express.static(builtWebDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(builtWebDir, "index.html"));
  });
}

const httpServer = app.listen(port, listenHost, () => {
  console.log(`BioVoice backend listening on ${publicBaseUrl} (bound to ${listenHost})`);
  if (allowRemoteClients) {
    console.log(`Remote browser access URL: ${publicBaseUrl}?access_token=${remoteAccessToken}`);
  }
});

let shutdownStarted = false;
async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  console.warn(`[shutdown] ${signal}: ending active Realtime calls before exit.`);
  const serverClose = new Promise<void>((resolve) => {
    let settled = false;
    let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;
    let closeDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      if (closeDeadlineTimer) clearTimeout(closeDeadlineTimer);
      resolve();
    };
    httpServer.close(finish);
    httpServer.closeIdleConnections();
    forceCloseTimer = setTimeout(() => {
      // SSE and other long-lived connections get a short drain, then are closed.
      httpServer.closeAllConnections();
    }, 750);
    closeDeadlineTimer = setTimeout(() => {
      httpServer.closeAllConnections();
      finish();
    }, 3_000);
  });
  const registryShutdown = registry.shutdown();
  await Promise.all([
    serverClose,
    Promise.race([
      registryShutdown,
      new Promise<void>((resolve) => setTimeout(() => {
        console.warn("[shutdown] Realtime cleanup exceeded the 7-second shutdown budget.");
        resolve();
      }, 7_000)),
    ]),
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0)).catch((error) => {
      console.error(`[shutdown-error] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
  });
}

function parseRealtimePromptConfig(options: {
  id?: string;
  version?: string;
  variablesJson?: string;
}): RealtimePromptConfig | null {
  const id = options.id?.trim();
  if (!id) {
    return null;
  }

  const version = options.version?.trim();
  const variables = parseRealtimePromptVariables(options.variablesJson);
  return {
    id,
    ...(version ? { version } : {}),
    ...(variables ? { variables } : {}),
  };
}

function parseRealtimePromptVariables(value: string | undefined): Record<string, string | number | boolean> | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Invalid REALTIME_PROMPT_VARIABLES_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid REALTIME_PROMPT_VARIABLES_JSON: expected a JSON object.");
  }

  const variables: Record<string, string | number | boolean> = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (!key.trim()) {
      throw new Error("Invalid REALTIME_PROMPT_VARIABLES_JSON: variable names must be non-empty strings.");
    }
    if (typeof rawValue === "string" || typeof rawValue === "boolean") {
      variables[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      variables[key] = rawValue;
      continue;
    }
    throw new Error(`Invalid REALTIME_PROMPT_VARIABLES_JSON: ${key} must be a string, finite number, or boolean.`);
  }

  return variables;
}

function parseRealtimeContextPruning(options: {
  enabled?: string;
  maxItems?: string;
  retainItems?: string;
}): RealtimeContextPruningOptions {
  const enabled = options.enabled?.trim().toLowerCase() === "false"
    ? false
    : options.enabled?.trim().toLowerCase() === "off"
      ? false
      : options.enabled?.trim().toLowerCase() === "0"
        ? false
        : true;
  const maxItems = readPositiveInteger(options.maxItems, 96);
  const retainItems = readPositiveInteger(options.retainItems, 64);
  if (maxItems < 2) {
    throw new Error("Invalid REALTIME_CONTEXT_MAX_ITEMS: value must be at least 2.");
  }
  if (retainItems >= maxItems) {
    throw new Error("Invalid REALTIME_CONTEXT_RETAIN_ITEMS: value must be lower than REALTIME_CONTEXT_MAX_ITEMS.");
  }

  return {
    enabled,
    maxItems,
    retainItems,
  };
}

function sanitizeOpenAiSafetyIdentifier(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error("Invalid OPENAI_SAFETY_IDENTIFIER: header values cannot contain newlines.");
  }
  if (trimmed.length > 512) {
    throw new Error("Invalid OPENAI_SAFETY_IDENTIFIER: keep the value under 512 characters.");
  }
  return trimmed;
}

function parseRealtimeMaxOutputTokens(value: string): number | "inf" {
  if (value === "inf") {
    return "inf";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 4096) {
    throw new Error(`Invalid REALTIME_MAX_OUTPUT_TOKENS: ${value}`);
  }

  return Math.floor(parsed);
}

function parseRealtimeReasoningEffort(value: string): RealtimeReasoningEffort | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "off" || normalized === "false") {
    return null;
  }

  if (
    normalized === "minimal"
    || normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "xhigh"
  ) {
    return normalized;
  }

  throw new Error(`Invalid REALTIME_REASONING_EFFORT: ${value}`);
}

function readPositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function readUnitInterval(
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function markRealtimeCredentialValidated(): void {
  realtimeCredentialStatus.validated = true;
  realtimeCredentialStatus.lastCheckedAt = new Date().toISOString();
  realtimeCredentialStatus.lastError = undefined;
}

function markRealtimeCredentialFailed(error: unknown): void {
  realtimeCredentialStatus.validated = false;
  realtimeCredentialStatus.lastCheckedAt = new Date().toISOString();
  realtimeCredentialStatus.lastError = error instanceof Error ? error.message : String(error);
}

function markUsageScopeValidated(): void {
  usageScopeStatus.validated = true;
  usageScopeStatus.lastCheckedAt = new Date().toISOString();
  usageScopeStatus.lastError = undefined;
}

function markUsageScopeFailed(error: unknown): void {
  usageScopeStatus.validated = false;
  usageScopeStatus.lastCheckedAt = new Date().toISOString();
  usageScopeStatus.lastError = error instanceof Error ? error.message : String(error);
}
