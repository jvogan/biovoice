import { describe, expect, it } from "vitest";
import {
  accumulateResponseUsage,
  accumulateTranscriptionUsage,
  buildOrganizationUsageSummary,
  createEmptySessionUsage,
  getBillableTokenTotal,
} from "../../packages/runtime-and-adapters/src/index.js";

describe("realtime usage aggregation", () => {
  it("accumulates response.done usage totals", () => {
    const usage = accumulateResponseUsage(createEmptySessionUsage(), {
      total_tokens: 253,
      input_tokens: 132,
      output_tokens: 121,
      input_token_details: {
        text_tokens: 119,
        audio_tokens: 13,
        image_tokens: 0,
        cached_tokens: 64,
      },
      output_token_details: {
        text_tokens: 30,
        audio_tokens: 91,
      },
    });

    expect(usage.responseCount).toBe(1);
    expect(usage.inputTokens).toBe(132);
    expect(usage.outputTokens).toBe(121);
    expect(usage.cachedInputTokens).toBe(64);
    expect(usage.inputAudioTokens).toBe(13);
    expect(usage.outputAudioTokens).toBe(91);
  });

  it("accumulates transcription usage separately and computes a billable total", () => {
    const responseUsage = accumulateResponseUsage(createEmptySessionUsage(), {
      total_tokens: 100,
      input_tokens: 60,
      output_tokens: 40,
      input_token_details: { text_tokens: 50, audio_tokens: 10, image_tokens: 0, cached_tokens: 20 },
      output_token_details: { text_tokens: 15, audio_tokens: 25 },
    });

    const combinedUsage = accumulateTranscriptionUsage(responseUsage, {
      total_tokens: 26,
      input_tokens: 17,
      output_tokens: 9,
    });

    expect(combinedUsage.transcriptionCount).toBe(1);
    expect(combinedUsage.transcriptionInputTokens).toBe(17);
    expect(combinedUsage.transcriptionOutputTokens).toBe(9);
    expect(getBillableTokenTotal(combinedUsage)).toBe(126);
  });
});

describe("organization usage summary", () => {
  it("merges completions, transcription seconds, and costs into daily totals", () => {
    const summary = buildOrganizationUsageSummary({
      days: 7,
      startTime: 1_700_000_000,
      endTime: 1_700_604_800,
      projectId: "proj_123",
      realtimeModel: "gpt-realtime-1.5",
      transcriptionModel: "gpt-4o-mini-transcribe",
      completionsPage: {
        data: [
          {
            start_time: 1_700_000_000,
            results: [
              {
                input_tokens: 1000,
                output_tokens: 500,
                input_cached_tokens: 300,
                input_audio_tokens: 100,
                output_audio_tokens: 200,
                num_model_requests: 4,
              },
            ],
          },
        ],
      },
      transcriptionsPage: {
        data: [
          {
            start_time: 1_700_000_000,
            results: [
              {
                seconds: 45,
                num_model_requests: 3,
              },
            ],
          },
        ],
      },
      costsPage: {
        data: [
          {
            start_time: 1_700_000_000,
            results: [
              {
                amount: {
                  value: 1.23,
                  currency: "usd",
                },
              },
            ],
          },
        ],
      },
    });

    expect(summary.totals.requests).toBe(4);
    expect(summary.totals.inputTokens).toBe(1000);
    expect(summary.totals.transcriptionSeconds).toBe(45);
    expect(summary.totals.costUsd).toBe(1.23);
    expect(summary.scope.costsScope).toBe("project");
  });
});
