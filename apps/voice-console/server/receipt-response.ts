import type {
  RunReceipt,
  RunReceiptArtifact,
  RunReceiptSummary,
} from "../../../packages/runtime-and-adapters/src/store/run-receipt-store.js";

export type ReceiptApiResponse = RunReceipt | RunReceiptSummary;

/**
 * Keep detailed receipts available to direct-local operators while preventing
 * authenticated LAN clients from learning local paths or replaying raw inputs.
 */
export function prepareReceiptForApi(
  receipt: ReceiptApiResponse,
  includeSensitive: boolean,
): ReceiptApiResponse {
  if (includeSensitive) {
    return {
      ...receipt,
      artifacts: receipt.artifacts.map(decorateLocalArtifact),
    };
  }

  // Construct the remote shape explicitly. Receipt summaries and artifact labels
  // can include user-provided paths or study names, so they are not safe merely
  // because the raw request/result fields were removed.
  return {
    id: receipt.id,
    createdAt: receipt.createdAt,
    target: receipt.target,
    summary: "BioVoice run completed.",
    source: "run",
    evidenceLevel: sanitizeEvidenceLevel(receipt.evidenceLevel),
    checkpointAvailable: receipt.checkpointAvailable,
    artifacts: receipt.artifacts.map(sanitizeRemoteArtifact),
    warnings: receipt.warnings.length > 0
      ? ["Run warnings are available only from the direct local console."]
      : [],
  };
}

function decorateLocalArtifact(artifact: RunReceiptArtifact): RunReceiptArtifact {
  return {
    ...artifact,
    ...(artifact.path
      ? { url: artifact.url ?? `/api/artifacts?path=${encodeURIComponent(artifact.path)}` }
      : {}),
  };
}

function sanitizeRemoteArtifact(artifact: RunReceiptArtifact): RunReceiptArtifact {
  return {
    kind: "artifact",
    label: "Run artifact",
  };
}

function sanitizeEvidenceLevel(value: string): string {
  const safeLevels = new Set([
    "artifact",
    "executed",
    "measured",
    "planned",
    "qualitative",
    "quantitative",
    "restored",
    "visual",
    "visualization",
  ]);
  return safeLevels.has(value) ? value : "executed";
}
