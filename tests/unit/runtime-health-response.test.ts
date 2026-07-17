import { describe, expect, it } from "vitest";
import { prepareTargetHealthDetail } from "../../apps/voice-console/server/runtime-health-response.js";

describe("runtime health API privacy", () => {
  it("keeps detailed readiness errors available to direct-local clients", () => {
    const detail = "PyMOL RPC at http://127.0.0.1:9123/RPC2 is unavailable.";
    expect(prepareTargetHealthDetail("PyMOL", false, detail, true)).toBe(detail);
  });

  it("replaces target details for non-local clients", () => {
    const privateEndpoint = "http://operator:secret@10.0.0.12:9123/RPC2";
    const response = prepareTargetHealthDetail(
      "PyMOL",
      false,
      `PyMOL RPC at ${privateEndpoint} is unavailable.`,
      false,
    );

    expect(response).toBe("PyMOL is not currently command-ready.");
    expect(response).not.toContain(privateEndpoint);
  });

  it("uses the same generic ready text for local and non-local clients", () => {
    expect(prepareTargetHealthDetail("ChimeraX", true, "private detail", false))
      .toBe("ChimeraX is command-ready.");
  });
});
