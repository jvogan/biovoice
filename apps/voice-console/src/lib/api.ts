export interface RealtimeSessionGuardrails {
  maxSessionMinutes: number;
  maxResponsesPerSession: number;
  maxTranscriptionsPerSession: number;
  maxBillableTokensPerSession: number;
  maxActiveSessions: number;
  warningRatio: number;
}

export interface RuntimeHealthResponse {
  appId: string;
  instanceId: string;
  pid?: number;
  projectRoot?: string;
  serverMode: "built-static" | "dev-api" | "api-only";
  startedAt: string;
  publicBaseUrl: string;
  realtimeModel: string;
  realtimeVoice: string;
  realtimeIdleWarningSeconds: number;
  realtimePttIdleDisconnectSeconds: number;
  realtimeOpenMicIdleDisconnectSeconds: number;
  realtimeSessionGuardrails: RealtimeSessionGuardrails;
  defaultTarget: "pymol" | "chimerax";
  exampleCount: number;
  openAiKeyPresent: boolean;
  usageKeyPresent: boolean;
  expertCommandsGloballyEnabled: boolean;
  persistSessionEvents: boolean;
  realtimeReady: boolean;
  usageReady: boolean;
  realtimeCredentialValidated: boolean;
  realtimeCredentialLastCheckedAt?: string;
  realtimeCredentialLastError?: string;
  usageScopeValidated: boolean;
  usageScopeLastCheckedAt?: string;
  usageScopeLastError?: string;
  runtime: {
    sessions: {
      total: number;
      awaitingCall: number;
      connecting: number;
      connected: number;
      error: number;
      disconnected: number;
    };
    targets: {
      pymol: {
        ready: boolean;
        endpoint?: string;
        detail?: string;
        reachable?: boolean;
        commandReady?: boolean;
        busy?: boolean;
        warmupState?: "offline" | "warming" | "ready";
        lastRpcError?: string;
        validatedAt?: string;
      };
      chimerax: {
        ready: boolean;
        endpoint?: string;
        detail?: string;
        reachable?: boolean;
        commandReady?: boolean;
        busy?: boolean;
        warmupState?: "offline" | "warming" | "ready";
        lastRpcError?: string;
        validatedAt?: string;
      };
    };
  };
}

export interface AppConfigResponse {
  appId: string;
  instanceId: string;
  serverMode: "built-static" | "dev-api" | "api-only";
  startedAt: string;
  publicBaseUrl: string;
  realtimeModel: string;
  realtimeVoice: string;
  realtimeIdleWarningSeconds: number;
  realtimePttIdleDisconnectSeconds: number;
  realtimeOpenMicIdleDisconnectSeconds: number;
  realtimeSessionGuardrails: RealtimeSessionGuardrails;
  realtimeTranscriptionModel: string;
  defaultTarget: "pymol" | "chimerax";
  openAiKeyPresent: boolean;
  usageKeyPresent: boolean;
  expertCommandsGloballyEnabled: boolean;
  persistSessionEvents: boolean;
  allowRemoteClients: boolean;
  realtimeReady: boolean;
  usageReady: boolean;
  realtimeCredentialValidated: boolean;
  realtimeCredentialLastCheckedAt?: string;
  realtimeCredentialLastError?: string;
  usageScopeValidated: boolean;
  usageScopeLastCheckedAt?: string;
  usageScopeLastError?: string;
  runtime: RuntimeHealthResponse["runtime"];
  examples: Array<{
    id: string;
    title: string;
    category: string;
    apps: string[];
    goal: string;
    difficulty: string;
    estimatedMinutes: number;
  }>;
  scientificWorkflows?: Array<{
    id: string;
    title: string;
    goal: string;
    category: "alphafold" | "rosetta";
    apps: Array<"pymol" | "chimerax">;
    estimatedMinutes: number;
    starterPrompts: string[];
    docsSlug: string;
    inputHints: string[];
  }>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Request failed (${response.status})`));
  }
  return payload as T;
}

function withSessionHeaders(sessionAccessToken: string, headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set("X-Session-Access-Token", sessionAccessToken);
  return merged;
}

export async function fetchConfig(): Promise<AppConfigResponse> {
  return requestJson<AppConfigResponse>("/api/config");
}

export async function fetchHealth(): Promise<RuntimeHealthResponse> {
  return requestJson<RuntimeHealthResponse>("/api/health");
}

export async function fetchExamples<T>(): Promise<T> {
  return requestJson<T>("/api/examples");
}

export async function createRealtimeClientSecret(body: {
  target: "pymol" | "chimerax";
  voiceMode: "push_to_talk" | "open_mic";
  recipeId?: string;
}) {
  const prepared = await requestJson<{ clientSecret: string; sessionId: string; registerToken: string; sessionAccessToken: string }>("/api/realtime/client-secret", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return prepared;
}

export async function connectRealtimeCall(body: {
  target: "pymol" | "chimerax";
  voiceMode: "push_to_talk" | "open_mic";
  recipeId?: string;
  offerSdp: string;
}) {
  return requestJson<{ answerSdp: string; sessionId: string; callId: string; sessionAccessToken: string }>("/api/realtime/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export function buildSessionEventStreamUrl(sessionId: string): string {
  return `/session-events/${sessionId}`;
}

export async function registerRealtimeCall(body: {
  sessionId: string;
  callId: string;
  registerToken: string;
}) {
  const registration = await requestJson<{ sessionId: string; callId: string }>("/api/realtime/register-call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    sessionId: registration.sessionId,
    callId: registration.callId,
  };
}

export async function fetchTargetState(target: "pymol" | "chimerax") {
  return requestJson<{ target: "pymol" | "chimerax"; state: unknown; refreshedAt: string }>(`/api/targets/${target}/state`);
}

export async function runTargetActions(body: {
  target: "pymol" | "chimerax";
  summary?: string;
  dryRun?: boolean;
  actions: Array<Record<string, unknown>>;
}) {
  return requestJson<ManualActionResult>("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface OrganizationUsageSummaryResponse {
  windowDays: number;
  startTime: number;
  endTime: number;
  scope: {
    projectId?: string;
    realtimeModel?: string;
    transcriptionModel?: string;
    costsScope: "project" | "organization";
  };
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    inputAudioTokens: number;
    outputAudioTokens: number;
    transcriptionSeconds: number;
    transcriptionRequests: number;
    costUsd: number;
  };
  daily: Array<{
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    inputAudioTokens: number;
    outputAudioTokens: number;
    transcriptionSeconds: number;
    transcriptionRequests: number;
    costUsd: number;
  }>;
  warnings: string[];
}

export interface ManualActionResult {
  target: "pymol" | "chimerax";
  commandsExecuted: string[];
  logs: string[];
  artifacts: Array<{
    kind: "image" | "session" | "model";
    path: string;
    label: string;
    url?: string;
    mimeType?: string;
  }>;
  metrics: Array<{
    kind: string;
    label: string;
    name?: string;
    value?: number;
    valueText?: string;
    unit?: string;
    source?: string;
  }>;
  warnings: string[];
  state?: Record<string, unknown>;
  error?: string;
}

export interface ScientificWorkflowRunResult {
  target: "pymol" | "chimerax";
  workflow: string;
  resolvedInputs: Record<string, unknown>;
  actionsExecuted: string[];
  commandsExecuted: string[];
  logs: string[];
  artifacts: Array<{
    kind: "image" | "session" | "model";
    path: string;
    label: string;
    url?: string;
    mimeType?: string;
  }>;
  metrics: Array<{
    kind: string;
    label: string;
    name?: string;
    value?: number;
    valueText?: string;
    unit?: string;
    source?: string;
  }>;
  warnings: string[];
  workflowState: Record<string, unknown>;
  referenceHints: Record<string, unknown>;
  rankedCandidates?: Array<{
    rank: number;
    tag: string;
    score?: number;
    scoreLabel?: string;
    path?: string;
    matched: boolean;
    warnings: string[];
    metadata?: Record<string, unknown>;
  }>;
  state?: Record<string, unknown>;
  error?: string;
}

export interface ManualRecipeRunResponse {
  recipeId: string;
  target: "pymol" | "chimerax";
  dryRun: boolean;
  stepResults: Array<{
    stepId: string;
    title: string;
    summary: string;
    result: ManualActionResult;
  }>;
}

export async function runRecipeWorkflow(body: {
  recipeId: string;
  target: "pymol" | "chimerax";
  dryRun?: boolean;
  stepId?: string;
}) {
  return requestJson<ManualRecipeRunResponse | ManualActionResult>(`/api/recipes/${body.recipeId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target: body.target,
      dryRun: body.dryRun,
      stepId: body.stepId,
    }),
  });
}

export async function runScientificWorkflow(body: {
  target: "pymol" | "chimerax";
  workflow: string;
  summary?: string;
  recipeId?: string;
  dryRun?: boolean;
  presentationMode?: "analysis" | "demo" | "publication";
  export?: {
    format?: "png" | "pse" | "cxs" | "session";
    path?: string;
    width?: number;
    height?: number;
    rayTrace?: boolean;
  };
  inputs: Record<string, unknown>;
}) {
  return requestJson<ScientificWorkflowRunResult>("/api/workflows/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function captureTargetView(body: {
  target: "pymol" | "chimerax";
  path?: string;
  width?: number;
  height?: number;
  inspectionPrompt?: string;
  attachToConversation?: boolean;
}) {
  return requestJson<ManualActionResult>("/api/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateSessionTarget(sessionId: string, sessionAccessToken: string, target: "pymol" | "chimerax") {
  return requestJson(`/api/sessions/${sessionId}/target`, {
    method: "POST",
    headers: withSessionHeaders(sessionAccessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ target }),
  });
}

export async function updateSessionVoiceMode(sessionId: string, sessionAccessToken: string, voiceMode: "push_to_talk" | "open_mic") {
  return requestJson(`/api/sessions/${sessionId}/voice-mode`, {
    method: "POST",
    headers: withSessionHeaders(sessionAccessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ voiceMode }),
  });
}

export async function updateSessionAdvancedMode(sessionId: string, sessionAccessToken: string, advancedMode: boolean) {
  return requestJson(`/api/sessions/${sessionId}/advanced-mode`, {
    method: "POST",
    headers: withSessionHeaders(sessionAccessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ advancedMode }),
  });
}

export async function updateSessionRecipe(sessionId: string, sessionAccessToken: string, recipeId?: string) {
  return requestJson(`/api/sessions/${sessionId}/recipe`, {
    method: "POST",
    headers: withSessionHeaders(sessionAccessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ recipeId }),
  });
}

export async function disconnectSession(sessionId: string, sessionAccessToken: string) {
  return requestJson(`/api/sessions/${sessionId}/disconnect`, {
    method: "POST",
    headers: withSessionHeaders(sessionAccessToken),
  });
}

export function disconnectSessionBeacon(sessionId: string, sessionAccessToken: string): void {
  const url = `/api/sessions/${sessionId}/disconnect`;
  const payload = JSON.stringify({ sessionAccessToken });
  try {
    const body = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(url, body)) {
      return;
    }
  } catch {
    // Fall through to keepalive fetch below.
  }

  void fetch(url, {
    method: "POST",
    keepalive: true,
    headers: withSessionHeaders(sessionAccessToken, { "Content-Type": "application/json" }),
    body: payload,
  }).catch(() => {});
}

export async function fetchOrganizationUsage(days = 7) {
  return requestJson<OrganizationUsageSummaryResponse>(`/api/usage/organization?days=${days}`);
}
