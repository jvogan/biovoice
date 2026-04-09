import { z } from "zod";

const counterSchema = z.number().int().min(0).default(0);

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
