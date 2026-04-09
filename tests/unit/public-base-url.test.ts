import { describe, expect, it } from "vitest";
import { resolvePublicBaseUrlOrigin } from "../../packages/runtime-and-adapters/src/index.js";

describe("resolvePublicBaseUrlOrigin", () => {
  it("falls back to the active localhost port when no override is configured", () => {
    expect(resolvePublicBaseUrlOrigin({
      listenHost: "127.0.0.1",
      port: 3010,
    })).toBe("http://127.0.0.1:3010");
  });

  it("normalizes loopback overrides to the active port", () => {
    expect(resolvePublicBaseUrlOrigin({
      configuredPublicBaseUrl: "http://localhost:3000",
      listenHost: "127.0.0.1",
      port: 3010,
    })).toBe("http://localhost:3010");
  });

  it("preserves non-local public origins exactly", () => {
    expect(resolvePublicBaseUrlOrigin({
      configuredPublicBaseUrl: "https://demo.example.com/app",
      listenHost: "0.0.0.0",
      port: 3010,
    })).toBe("https://demo.example.com");
  });
});
