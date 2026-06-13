import dotenv from "dotenv";
import { fetchOrganizationUsageSummary } from "../packages/runtime-and-adapters/src/index.js";

dotenv.config();

const days = Number(process.argv[2] ?? process.env.OPENAI_USAGE_DAYS ?? 7);
const apiKey = process.env.OPENAI_USAGE_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const realtimeModel = process.env.REALTIME_MODEL ?? "gpt-realtime-2";
const transcriptionModel = process.env.REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";

async function main() {
  const summary = await fetchOrganizationUsageSummary({
    apiKey,
    days,
    projectId: process.env.OPENAI_USAGE_PROJECT_ID,
    realtimeModel,
    transcriptionModel,
  });

  console.log(`OpenAI usage summary for last ${summary.windowDays} day(s)`);
  console.log(`Scope: ${summary.scope.projectId ? `project ${summary.scope.projectId}` : "organization"} | realtime=${summary.scope.realtimeModel ?? "all"} | transcription=${summary.scope.transcriptionModel ?? "all"}`);
  console.log("");
  console.log(`Requests: ${formatInt(summary.totals.requests)}`);
  console.log(`Input tokens: ${formatInt(summary.totals.inputTokens)}`);
  console.log(`Output tokens: ${formatInt(summary.totals.outputTokens)}`);
  console.log(`Cached input tokens: ${formatInt(summary.totals.cachedInputTokens)}`);
  console.log(`Input audio tokens: ${formatInt(summary.totals.inputAudioTokens)}`);
  console.log(`Output audio tokens: ${formatInt(summary.totals.outputAudioTokens)}`);
  console.log(`Transcription seconds: ${formatFloat(summary.totals.transcriptionSeconds)}`);
  console.log(`Transcription requests: ${formatInt(summary.totals.transcriptionRequests)}`);
  console.log(`Cost (USD): ${formatCurrency(summary.totals.costUsd)}`);

  if (summary.warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log("");
  console.log("Daily buckets:");
  for (const bucket of summary.daily) {
    console.log(
      `${bucket.date} | req ${formatInt(bucket.requests)} | in ${formatInt(bucket.inputTokens)} | out ${formatInt(bucket.outputTokens)} | tx ${formatFloat(bucket.transcriptionSeconds)}s | cost ${formatCurrency(bucket.costUsd)}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatFloat(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
