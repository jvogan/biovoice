import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareReceiptForApi } from "../../apps/voice-console/server/receipt-response.js";
import type { RunReceipt } from "../../packages/runtime-and-adapters/src/store/run-receipt-store.js";

function buildDetailedReceipt(): RunReceipt {
  const artifactPath = path.resolve("output", "hero.png");
  return {
    id: "2b641a4d-f1b0-4eec-a08e-9bf87a86efcc",
    createdAt: "2026-07-17T12:00:00.000Z",
    target: "pymol",
    summary: "Captured a hero view",
    source: "capture",
    evidenceLevel: "visual",
    checkpointAvailable: false,
    artifacts: [{
      kind: "image",
      label: "Hero view",
      path: artifactPath,
      mimeType: "image/png",
    }],
    warnings: [`Could not inspect ${artifactPath}.`],
    request: { target: "pymol", path: artifactPath },
    result: { artifacts: [{ path: artifactPath }] },
  };
}

describe("receipt API privacy", () => {
  it("preserves detailed receipt data and artifact links for direct-local clients", () => {
    const receipt = buildDetailedReceipt();
    const response = prepareReceiptForApi(receipt, true);
    const artifactPath = receipt.artifacts[0]!.path!;

    expect(response).toMatchObject({
      request: receipt.request,
      result: receipt.result,
      artifacts: [{
        path: artifactPath,
        url: `/api/artifacts?path=${encodeURIComponent(artifactPath)}`,
      }],
    });
    expect(receipt.artifacts[0]).not.toHaveProperty("url");
  });

  it("removes local paths, artifact URLs, and raw payloads for non-local clients", () => {
    const receipt = buildDetailedReceipt();
    const privateLabel = `${path.sep}Users${path.sep}alice${path.sep}private-study${path.sep}hero.png`;
    receipt.summary = `Captured ${privateLabel}`;
    receipt.source = "private-study";
    receipt.evidenceLevel = privateLabel;
    receipt.artifacts[0]!.label = privateLabel;
    receipt.artifacts[0]!.url = "/api/artifacts?path=already-present";

    const response = prepareReceiptForApi(receipt, false);

    expect(response).not.toHaveProperty("request");
    expect(response).not.toHaveProperty("result");
    expect(response.summary).toBe("BioVoice run completed.");
    expect(response.source).toBe("run");
    expect(response.evidenceLevel).toBe("executed");
    expect(response.artifacts).toEqual([{
      kind: "artifact",
      label: "Run artifact",
    }]);
    expect(response.warnings).toEqual(["Run warnings are available only from the direct local console."]);
    expect(JSON.stringify(response)).not.toContain(path.resolve("output", "hero.png"));
    expect(JSON.stringify(response)).not.toContain("/api/artifacts");
    expect(JSON.stringify(response)).not.toContain("private-study");
  });
});
