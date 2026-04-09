interface FetchUsageSummaryOptions {
  apiKey: string;
  days: number;
  projectId?: string;
  realtimeModel?: string;
  transcriptionModel?: string;
}

export interface OrganizationUsageSummary {
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

interface EndpointPage {
  data?: Array<{
    start_time?: number;
    end_time?: number;
    results?: Array<Record<string, unknown>>;
  }>;
}

interface CachedSummary {
  expiresAt: number;
  payload: OrganizationUsageSummary;
}

export class OpenAiUsageError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "OpenAiUsageError";
  }
}

const cache = new Map<string, CachedSummary>();

export async function fetchOrganizationUsageSummary(options: FetchUsageSummaryOptions): Promise<OrganizationUsageSummary> {
  if (!options.apiKey) {
    throw new OpenAiUsageError("Missing OpenAI API key for usage monitoring.", 503);
  }

  const days = clampDays(options.days);
  const cacheKey = JSON.stringify({
    days,
    projectId: options.projectId ?? null,
    realtimeModel: options.realtimeModel ?? null,
    transcriptionModel: options.transcriptionModel ?? null,
  });
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * 86_400;

  const [completionsPage, transcriptionsPage, costsPage] = await Promise.all([
    fetchUsageEndpoint(options.apiKey, "/organization/usage/completions", {
      start_time: startTime,
      end_time: endTime,
      bucket_width: "1d",
      limit: days,
      project_ids: options.projectId ? [options.projectId] : undefined,
      models: options.realtimeModel ? [options.realtimeModel] : undefined,
    }),
    fetchUsageEndpoint(options.apiKey, "/organization/usage/audio_transcriptions", {
      start_time: startTime,
      end_time: endTime,
      bucket_width: "1d",
      limit: days,
      project_ids: options.projectId ? [options.projectId] : undefined,
      models: options.transcriptionModel ? [options.transcriptionModel] : undefined,
    }),
    fetchUsageEndpoint(options.apiKey, "/organization/costs", {
      start_time: startTime,
      end_time: endTime,
      bucket_width: "1d",
      limit: days,
      project_ids: options.projectId ? [options.projectId] : undefined,
    }),
  ]);

  const summary = buildOrganizationUsageSummary({
    days,
    startTime,
    endTime,
    completionsPage,
    transcriptionsPage,
    costsPage,
    projectId: options.projectId,
    realtimeModel: options.realtimeModel,
    transcriptionModel: options.transcriptionModel,
  });

  cache.set(cacheKey, {
    expiresAt: Date.now() + 60_000,
    payload: summary,
  });
  return summary;
}

export function buildOrganizationUsageSummary(input: {
  days: number;
  startTime: number;
  endTime: number;
  completionsPage: EndpointPage;
  transcriptionsPage: EndpointPage;
  costsPage: EndpointPage;
  projectId?: string;
  realtimeModel?: string;
  transcriptionModel?: string;
}): OrganizationUsageSummary {
  const bucketMap = new Map<string, OrganizationUsageSummary["daily"][number]>();

  for (const bucket of input.completionsPage.data ?? []) {
    const daily = ensureDailyBucket(bucketMap, bucket.start_time);
    for (const result of bucket.results ?? []) {
      daily.requests += readNumber(result.num_model_requests);
      daily.inputTokens += readNumber(result.input_tokens);
      daily.outputTokens += readNumber(result.output_tokens);
      daily.cachedInputTokens += readNumber(result.input_cached_tokens);
      daily.inputAudioTokens += readNumber(result.input_audio_tokens);
      daily.outputAudioTokens += readNumber(result.output_audio_tokens);
    }
  }

  for (const bucket of input.transcriptionsPage.data ?? []) {
    const daily = ensureDailyBucket(bucketMap, bucket.start_time);
    for (const result of bucket.results ?? []) {
      daily.transcriptionSeconds += readNumber(result.seconds);
      daily.transcriptionRequests += readNumber(result.num_model_requests);
    }
  }

  for (const bucket of input.costsPage.data ?? []) {
    const daily = ensureDailyBucket(bucketMap, bucket.start_time);
    for (const result of bucket.results ?? []) {
      const amount = asObject(result.amount);
      daily.costUsd += readNumber(amount.value);
    }
  }

  const daily = Array.from(bucketMap.values()).sort((left, right) => left.date.localeCompare(right.date));
  const totals = daily.reduce<OrganizationUsageSummary["totals"]>(
    (aggregate, bucket) => ({
      requests: aggregate.requests + bucket.requests,
      inputTokens: aggregate.inputTokens + bucket.inputTokens,
      outputTokens: aggregate.outputTokens + bucket.outputTokens,
      cachedInputTokens: aggregate.cachedInputTokens + bucket.cachedInputTokens,
      inputAudioTokens: aggregate.inputAudioTokens + bucket.inputAudioTokens,
      outputAudioTokens: aggregate.outputAudioTokens + bucket.outputAudioTokens,
      transcriptionSeconds: aggregate.transcriptionSeconds + bucket.transcriptionSeconds,
      transcriptionRequests: aggregate.transcriptionRequests + bucket.transcriptionRequests,
      costUsd: aggregate.costUsd + bucket.costUsd,
    }),
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      inputAudioTokens: 0,
      outputAudioTokens: 0,
      transcriptionSeconds: 0,
      transcriptionRequests: 0,
      costUsd: 0,
    },
  );

  const warnings: string[] = [];
  if (!input.projectId) {
    warnings.push("Cost totals are organization-wide because the costs API cannot filter by model. Set OPENAI_USAGE_PROJECT_ID for project-scoped cost tracking.");
  }
  if (input.realtimeModel) {
    warnings.push(`Completion usage is filtered to model ${input.realtimeModel}.`);
  }
  if (input.transcriptionModel) {
    warnings.push(`Audio transcription usage is filtered to model ${input.transcriptionModel}.`);
  }

  return {
    windowDays: input.days,
    startTime: input.startTime,
    endTime: input.endTime,
    scope: {
      projectId: input.projectId,
      realtimeModel: input.realtimeModel,
      transcriptionModel: input.transcriptionModel,
      costsScope: input.projectId ? "project" : "organization",
    },
    totals,
    daily,
    warnings,
  };
}

async function fetchUsageEndpoint(apiKey: string, pathname: string, params: Record<string, string | number | string[] | undefined>): Promise<EndpointPage> {
  const url = new URL(`https://api.openai.com/v1${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry);
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  const rawText = await response.text();
  const payload = rawText ? (JSON.parse(rawText) as EndpointPage | { error?: unknown }) : {};
  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? `OpenAI usage request failed with status ${response.status}.`;
    throw new OpenAiUsageError(message, response.status, rawText);
  }

  return payload as EndpointPage;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === "string") {
      return error.message;
    }
  }

  return undefined;
}

function ensureDailyBucket(
  bucketMap: Map<string, OrganizationUsageSummary["daily"][number]>,
  timestamp: number | undefined,
): OrganizationUsageSummary["daily"][number] {
  const date = new Date((timestamp ?? 0) * 1000).toISOString().slice(0, 10);
  const existing = bucketMap.get(date);
  if (existing) {
    return existing;
  }

  const next = {
    date,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    inputAudioTokens: 0,
    outputAudioTokens: 0,
    transcriptionSeconds: 0,
    transcriptionRequests: 0,
    costUsd: 0,
  };
  bucketMap.set(date, next);
  return next;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) {
    return 7;
  }
  return Math.max(1, Math.min(31, Math.round(days)));
}
