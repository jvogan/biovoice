import { describe, expect, it } from "vitest";
import { PymolAdapter } from "../../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";

describe("PymolAdapter endpoint pinning", () => {
  it("prefers the lowest responsive RPC port when multiple PyMOL sessions are available", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      findReadyRpcUrl: () => Promise<string | null>;
      probeEndpoint: (rpcUrl: string) => Promise<{ rpcUrl: string; objectCount: number; port: number; reachable: boolean; commandReady: boolean } | null>;
    };

    adapter.probeEndpoint = async (rpcUrl: string) => {
      if (rpcUrl.endsWith("9123/RPC2")) {
        return { rpcUrl, objectCount: 4, port: 9123, reachable: true, commandReady: true };
      }
      if (rpcUrl.endsWith("9124/RPC2")) {
        return { rpcUrl, objectCount: 0, port: 9124, reachable: true, commandReady: true };
      }
      return null;
    };

    await expect(adapter.findReadyRpcUrl()).resolves.toBe("http://127.0.0.1:9123/RPC2");
  });

  it("refuses to drift to a different responsive RPC endpoint when a configured endpoint is pinned", async () => {
    const adapter = new PymolAdapter({
      rpcUrl: "http://127.0.0.1:9124/RPC2",
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      ensureReady: () => Promise<string>;
      isResponsive: (rpcUrl: string) => Promise<boolean>;
      findReadyRpcUrl: () => Promise<string | null>;
      waitForSpecificRpcUrl: (rpcUrl: string, timeoutMs: number) => Promise<string | null>;
    };

    adapter.isResponsive = async (rpcUrl: string) => rpcUrl.endsWith("9125/RPC2");
    adapter.findReadyRpcUrl = async () => "http://127.0.0.1:9125/RPC2";
    adapter.waitForSpecificRpcUrl = async (rpcUrl: string) => (rpcUrl.endsWith("9124/RPC2") ? null : rpcUrl);

    await expect(adapter.ensureReady()).rejects.toThrow(/Pinned PyMOL RPC endpoint http:\/\/127\.0\.0\.1:9124\/RPC2 stopped responding/i);
  });

  it("reports the pinned endpoint as unavailable instead of silently hopping to another port", async () => {
    const adapter = new PymolAdapter({
      rpcUrl: "http://127.0.0.1:9124/RPC2",
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      getAvailabilitySummary: () => Promise<{ ready: boolean; endpoint?: string; detail?: string }>;
      isResponsive: (rpcUrl: string) => Promise<boolean>;
      findReadyRpcUrl: () => Promise<string | null>;
      waitForSpecificRpcUrl: (rpcUrl: string, timeoutMs: number) => Promise<string | null>;
    };

    adapter.isResponsive = async (rpcUrl: string) => rpcUrl.endsWith("9125/RPC2");
    adapter.findReadyRpcUrl = async () => "http://127.0.0.1:9125/RPC2";
    adapter.waitForSpecificRpcUrl = async (rpcUrl: string) => (rpcUrl.endsWith("9124/RPC2") ? null : rpcUrl);

    const summary = await adapter.getAvailabilitySummary();

    expect(summary.ready).toBe(false);
    expect(summary.endpoint).toBe("http://127.0.0.1:9124/RPC2");
    expect(summary.detail).toMatch(/Pinned PyMOL RPC endpoint http:\/\/127\.0\.0\.1:9124\/RPC2 stopped responding/i);
  });
});
