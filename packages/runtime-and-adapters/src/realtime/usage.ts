import { z } from "zod";

const counterSchema = z.number().int().min(0).default(0);
const positiveCounterSchema = z.number().int().min(1);

export const sessionUsageGuardrailsSchema = z.object({
  maxSessionMinutes: positiveCounterSchema,
  maxResponsesPerSession: positiveCounterSchema,
  maxTranscriptionsPerSession: positiveCounterSchema,
  maxBillableTokensPerSession: positiveCounterSchema,
  warningRatio: z.number().min(0.5).max(0.95),
});

export const sessionUsageSchema = z.object({
  responseCount: counterSchema,
  transcriptionCount: counterSchema,
  totalTokens: counterSchema,
  inputTokens: counterSchema,
  outputTokens: counterSchema,
  cachedInputTokens: counterSchema,
  inputTextTokens: counterSchema,
  inputAudioTokens: counterSchema,
  inputImageTokens: counterSchema,
  outputTextTokens: counterSchema,
  outputAudioTokens: counterSchema,
  transcriptionTotalTokens: counterSchema,
  transcriptionInputTokens: counterSchema,
  transcriptionOutputTokens: counterSchema,
});

export type SessionUsage = z.infer<typeof sessionUsageSchema>;
export type SessionUsageGuardrails = z.infer<typeof sessionUsageGuardrailsSchema>;

const sessionUsageGuardEventReasonSchema = z.enum([
  "session_duration",
  "response_count",
  "transcription_count",
  "billable_tokens",
]);

export const sessionUsageGuardStateSchema = z.object({
  maxSessionMinutes: positiveCounterSchema,
  maxResponsesPerSession: positiveCounterSchema,
  maxTranscriptionsPerSession: positiveCounterSchema,
  maxBillableTokensPerSession: positiveCounterSchema,
  warningRatio: z.number().min(0.5).max(0.95),
  sessionSecondsElapsed: counterSchema,
  sessionSecondsRemaining: z.number().int().min(0).nullable(),
  responsesRemaining: z.number().int().min(0).nullable(),
  transcriptionsRemaining: z.number().int().min(0).nullable(),
  billableTokens: counterSchema,
  billableTokensRemaining: z.number().int().min(0).nullable(),
  warningActive: z.boolean().default(false),
  warningReason: sessionUsageGuardEventReasonSchema.optional(),
  warningMessage: z.string().optional(),
  breachReason: sessionUsageGuardEventReasonSchema.optional(),
  breachMessage: z.string().optional(),
});

export type SessionUsageGuardState = z.infer<typeof sessionUsageGuardStateSchema>;

export function createEmptySessionUsage(): SessionUsage {
  return sessionUsageSchema.parse({});
}

export function accumulateResponseUsage(current: SessionUsage, rawUsage: unknown): SessionUsage {
  const usage = asObject(rawUsage);
  const inputDetails = asObject(usage.input_token_details);
  const outputDetails = asObject(usage.output_token_details);

  return sessionUsageSchema.parse({
    responseCount: current.responseCount + 1,
    transcriptionCount: current.transcriptionCount,
    totalTokens: current.totalTokens + readCount(usage.total_tokens),
    inputTokens: current.inputTokens + readCount(usage.input_tokens),
    outputTokens: current.outputTokens + readCount(usage.output_tokens),
    cachedInputTokens: current.cachedInputTokens + readCount(inputDetails.cached_tokens),
    inputTextTokens: current.inputTextTokens + readCount(inputDetails.text_tokens),
    inputAudioTokens: current.inputAudioTokens + readCount(inputDetails.audio_tokens),
    inputImageTokens: current.inputImageTokens + readCount(inputDetails.image_tokens),
    outputTextTokens: current.outputTextTokens + readCount(outputDetails.text_tokens),
    outputAudioTokens: current.outputAudioTokens + readCount(outputDetails.audio_tokens),
    transcriptionTotalTokens: current.transcriptionTotalTokens,
    transcriptionInputTokens: current.transcriptionInputTokens,
    transcriptionOutputTokens: current.transcriptionOutputTokens,
  });
}

export function accumulateTranscriptionUsage(current: SessionUsage, rawUsage: unknown): SessionUsage {
  const usage = asObject(rawUsage);
  return sessionUsageSchema.parse({
    responseCount: current.responseCount,
    transcriptionCount: current.transcriptionCount + 1,
    totalTokens: current.totalTokens,
    inputTokens: current.inputTokens,
    outputTokens: current.outputTokens,
    cachedInputTokens: current.cachedInputTokens,
    inputTextTokens: current.inputTextTokens,
    inputAudioTokens: current.inputAudioTokens,
    inputImageTokens: current.inputImageTokens,
    outputTextTokens: current.outputTextTokens,
    outputAudioTokens: current.outputAudioTokens,
    transcriptionTotalTokens: current.transcriptionTotalTokens + readCount(usage.total_tokens),
    transcriptionInputTokens: current.transcriptionInputTokens + readCount(usage.input_tokens),
    transcriptionOutputTokens: current.transcriptionOutputTokens + readCount(usage.output_tokens),
  });
}

export function getBillableTokenTotal(usage: SessionUsage): number {
  return usage.totalTokens + usage.transcriptionTotalTokens;
}

export function buildSessionUsageGuardState(
  usage: SessionUsage,
  guardrails: SessionUsageGuardrails,
  sessionStartedAtMs: number,
  nowMs = Date.now(),
): SessionUsageGuardState {
  const parsedGuardrails = sessionUsageGuardrailsSchema.parse(guardrails);
  const safeStartedAtMs = Number.isFinite(sessionStartedAtMs) ? sessionStartedAtMs : nowMs;
  const sessionSecondsElapsed = Math.max(0, Math.floor((nowMs - safeStartedAtMs) / 1000));
  const maxSessionSeconds = parsedGuardrails.maxSessionMinutes * 60;
  const billableTokens = getBillableTokenTotal(usage);
  const dimensions = [
    createGuardDimension(
      "billable_tokens",
      billableTokens,
      parsedGuardrails.maxBillableTokensPerSession,
      `${formatCount(billableTokens)} / ${formatCount(parsedGuardrails.maxBillableTokensPerSession)} billable tokens`,
    ),
    createGuardDimension(
      "transcription_count",
      usage.transcriptionCount,
      parsedGuardrails.maxTranscriptionsPerSession,
      `${usage.transcriptionCount} / ${parsedGuardrails.maxTranscriptionsPerSession} transcriptions`,
    ),
    createGuardDimension(
      "response_count",
      usage.responseCount,
      parsedGuardrails.maxResponsesPerSession,
      `${usage.responseCount} / ${parsedGuardrails.maxResponsesPerSession} responses`,
    ),
    createGuardDimension(
      "session_duration",
      sessionSecondsElapsed,
      maxSessionSeconds,
      `${formatDuration(sessionSecondsElapsed)} / ${parsedGuardrails.maxSessionMinutes}m session duration`,
    ),
  ];

  const breached = chooseMostUrgentDimension(dimensions, 1);
  const warning = breached ? null : chooseMostUrgentDimension(dimensions, parsedGuardrails.warningRatio);

  return sessionUsageGuardStateSchema.parse({
    maxSessionMinutes: parsedGuardrails.maxSessionMinutes,
    maxResponsesPerSession: parsedGuardrails.maxResponsesPerSession,
    maxTranscriptionsPerSession: parsedGuardrails.maxTranscriptionsPerSession,
    maxBillableTokensPerSession: parsedGuardrails.maxBillableTokensPerSession,
    warningRatio: parsedGuardrails.warningRatio,
    sessionSecondsElapsed,
    sessionSecondsRemaining: Math.max(0, maxSessionSeconds - sessionSecondsElapsed),
    responsesRemaining: Math.max(0, parsedGuardrails.maxResponsesPerSession - usage.responseCount),
    transcriptionsRemaining: Math.max(0, parsedGuardrails.maxTranscriptionsPerSession - usage.transcriptionCount),
    billableTokens,
    billableTokensRemaining: Math.max(0, parsedGuardrails.maxBillableTokensPerSession - billableTokens),
    warningActive: Boolean(warning),
    warningReason: warning?.reason,
    warningMessage: warning ? buildGuardrailMessage("Approaching", warning) : undefined,
    breachReason: breached?.reason,
    breachMessage: breached ? buildGuardrailMessage("Reached", breached) : undefined,
  });
}

export function formatUsageSummary(usage: SessionUsage): string {
  return [
    `${usage.responseCount} responses`,
    `${usage.transcriptionCount} transcriptions`,
    `${formatCount(getBillableTokenTotal(usage))} billable tokens`,
    `${formatCount(usage.cachedInputTokens)} cached`,
  ].join(" · ");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }

  return 0;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

interface GuardDimension {
  reason: SessionUsageGuardState["warningReason"];
  progress: number;
  detail: string;
}

function createGuardDimension(
  reason: SessionUsageGuardState["warningReason"],
  used: number,
  limit: number,
  detail: string,
): GuardDimension {
  return {
    reason,
    progress: limit > 0 ? used / limit : 0,
    detail,
  };
}

function chooseMostUrgentDimension(
  dimensions: GuardDimension[],
  threshold: number,
): GuardDimension | null {
  const matching = dimensions
    .filter((dimension) => dimension.progress >= threshold)
    .sort((left, right) => right.progress - left.progress);
  return matching[0] ?? null;
}

function buildGuardrailMessage(prefix: "Approaching" | "Reached", dimension: GuardDimension): string {
  switch (dimension.reason) {
    case "billable_tokens":
      return `${prefix} the per-session billable token cap. ${dimension.detail}. BioVoice will disconnect this session to keep Realtime costs bounded.`;
    case "transcription_count":
      return `${prefix} the per-session transcription cap. ${dimension.detail}. Open mic can create billable turns quickly.`;
    case "response_count":
      return `${prefix} the per-session response cap. ${dimension.detail}. Start a fresh session if you want more voice turns.`;
    case "session_duration":
      return `${prefix} the per-session duration cap. ${dimension.detail}. Start a fresh session if you need more time.`;
    default:
      return `${prefix} a Realtime session guardrail. ${dimension.detail}.`;
  }
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "0s";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) {
    return `${seconds}s`;
  }
  if (!seconds) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}
