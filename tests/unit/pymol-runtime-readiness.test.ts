import path from "node:path";
import { describe, expect, it } from "vitest";
import { PymolAdapter, createPymolCommandBatches, shouldPreservePymolViewForActions } from "../../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";

describe("PymolAdapter readiness and cold-start policy", () => {
  it("fails closed until a reachable endpoint becomes command-ready", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      getAvailabilitySummary: () => Promise<{
        ready: boolean;
        endpoint?: string;
        detail?: string;
        reachable: boolean;
        commandReady: boolean;
        busy: boolean;
        warmupState: "offline" | "warming" | "ready";
        lastRpcError?: string;
      }>;
      probeCandidateEndpoints: () => Promise<Array<{
        rpcUrl: string;
        objectCount: number;
        port: number;
        reachable: boolean;
        commandReady: boolean;
        lastError?: string;
      }>>;
    };

    adapter.probeCandidateEndpoints = async () => [
      {
        rpcUrl: "http://127.0.0.1:9123/RPC2",
        objectCount: 0,
        port: 9123,
        reachable: true,
        commandReady: false,
        lastError: "PyMOL RPC is reachable, but the command-ready probes did not all succeed yet.",
      },
    ];

    const summary = await adapter.getAvailabilitySummary();

    expect(summary.ready).toBe(false);
    expect(summary.reachable).toBe(true);
    expect(summary.commandReady).toBe(false);
    expect(summary.warmupState).toBe("warming");
    expect(summary.lastRpcError).toMatch(/command-ready probes/i);
  });

  it("preserves the current view for overlay steps unless camera work was explicitly requested", () => {
    expect(shouldPreservePymolViewForActions(
      [
        { type: "load", source: "local", path: "/tmp/af.pdb", object: "af_prediction" },
        { type: "align", method: "super", mobile: { reference: "predictedModel" }, target: { reference: "experimentalModel" } },
      ],
      {
        wholeComplex: { selector: { object: "exp_complex" } },
        predictedModel: { selector: { object: "af_prediction" } },
        experimentalModel: { selector: { object: "exp_complex" } },
      },
    )).toBe(true);

    expect(shouldPreservePymolViewForActions(
      [
        { type: "align", method: "super", mobile: "af_prediction", target: "exp_complex" },
        { type: "camera", action: "zoom", selection: "all" },
      ],
      {
        wholeComplex: { selector: { object: "exp_complex" } },
      },
    )).toBe(false);

    expect(shouldPreservePymolViewForActions(
      [
        { type: "load", source: "local", path: "/tmp/af.pdb", object: "af_prediction" },
      ],
      {},
    )).toBe(false);
  });

  it("raises timeouts during the cold-start window", () => {
    expect(createPymolCommandBatches(
      ["hide everything, all", "show cartoon, polymer.protein"],
      8_000,
      45_000,
      { coldStart: true },
    )[0]?.timeoutMs).toBe(20_000);

    expect(createPymolCommandBatches(
      ["fetch 1hsg, 1hsg, async=0"],
      8_000,
      45_000,
      { coldStart: true },
    )[0]?.timeoutMs).toBe(45_000);

    expect(createPymolCommandBatches(
      [
        "show surface, pocket",
        "set transparency, 0.42, pocket",
        "bg_color gray98",
      ],
      8_000,
      45_000,
      { coldStart: true },
    )[0]?.timeoutMs).toBe(45_000);
  });

  it("returns warnings instead of failing when post-command probes time out", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      execute: (actions: Array<Record<string, unknown>>, dryRun?: boolean) => Promise<{
        commandsExecuted: string[];
        warnings: string[];
      }>;
      ensureReady: () => Promise<string>;
      resolveReferenceHintsForActions: () => Promise<Record<string, never>>;
      callDo: () => Promise<void>;
      collectStateSummary: () => Promise<Record<string, unknown>>;
      collectScientificMetrics: () => Promise<unknown[]>;
    };

    adapter.ensureReady = async () => "http://127.0.0.1:9123/RPC2";
    adapter.resolveReferenceHintsForActions = async () => ({});
    adapter.callDo = async () => {};
    adapter.collectStateSummary = async () => {
      throw new Error("state refresh timed out");
    };
    adapter.collectScientificMetrics = async () => {
      throw new Error("metric collection timed out");
    };

    const result = await adapter.execute([
      {
        type: "show",
        representations: ["cartoon"],
        selection: "polymer.protein",
      },
    ]);

    expect(result.commandsExecuted).toContain("show cartoon, polymer.protein");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/state refresh/i),
      expect.stringMatching(/metric collection/i),
    ]));
  });

  it("uses an extended post-export recovery window for ray-traced surface renders", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      execute: (actions: Array<Record<string, unknown>>, dryRun?: boolean) => Promise<{
        commandsExecuted: string[];
        warnings: string[];
      }>;
      ensureReady: () => Promise<string>;
      resolveReferenceHintsForActions: () => Promise<Record<string, never>>;
      callDo: () => Promise<void>;
      callPngExport: () => Promise<void>;
      waitForSpecificRpcUrl: (
        rpcUrl: string,
        timeoutMs: number,
        options?: { requiredConsecutivePasses?: number; coldStartOnSuccess?: boolean },
      ) => Promise<string | null>;
      collectStateSummary: () => Promise<Record<string, unknown>>;
      collectScientificMetrics: () => Promise<unknown[]>;
    };

    let recoveryTimeoutMs = 0;
    let recoveryPasses = 0;
    adapter.ensureReady = async () => "http://127.0.0.1:9123/RPC2";
    adapter.resolveReferenceHintsForActions = async () => ({});
    adapter.callDo = async () => {};
    adapter.callPngExport = async () => {};
    adapter.waitForSpecificRpcUrl = async (_rpcUrl, timeoutMs, options) => {
      recoveryTimeoutMs = timeoutMs;
      recoveryPasses = options?.requiredConsecutivePasses ?? 0;
      return "http://127.0.0.1:9123/RPC2";
    };
    adapter.collectStateSummary = async () => ({});
    adapter.collectScientificMetrics = async () => [];

    const result = await adapter.execute([
      { type: "surface", selection: "polymer.protein", transparency: 0.55, color: "gray70" },
      { type: "scene", key: "F6", action: "store", message: "Hemoglobin presentation view" },
      { type: "export", export: { format: "png", width: 2200, height: 1600, rayTrace: true } },
    ]);

    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      "show surface, polymer.protein",
      "scene F6, store, Hemoglobin presentation view",
    ]));
    expect(recoveryTimeoutMs).toBe(30_000);
    expect(recoveryPasses).toBe(2);
  });

  it("waits for post-command recovery after surface-heavy presentation steps", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      execute: (actions: Array<Record<string, unknown>>, dryRun?: boolean) => Promise<{
        commandsExecuted: string[];
        warnings: string[];
      }>;
      ensureReady: () => Promise<string>;
      resolveReferenceHintsForActions: () => Promise<Record<string, never>>;
      callDo: () => Promise<void>;
      waitForSpecificRpcUrl: (
        rpcUrl: string,
        timeoutMs: number,
        options?: { requiredConsecutivePasses?: number; coldStartOnSuccess?: boolean },
      ) => Promise<string | null>;
      collectStateSummary: () => Promise<Record<string, unknown>>;
      collectScientificMetrics: () => Promise<unknown[]>;
    };

    let recoveryTimeoutMs = 0;
    let recoveryPasses = 0;
    adapter.ensureReady = async () => "http://127.0.0.1:9123/RPC2";
    adapter.resolveReferenceHintsForActions = async () => ({});
    adapter.callDo = async () => {};
    adapter.waitForSpecificRpcUrl = async (_rpcUrl, timeoutMs, options) => {
      recoveryTimeoutMs = timeoutMs;
      recoveryPasses = options?.requiredConsecutivePasses ?? 0;
      return "http://127.0.0.1:9123/RPC2";
    };
    adapter.collectStateSummary = async () => ({});
    adapter.collectScientificMetrics = async () => [];

    const result = await adapter.execute([
      { type: "surface", selection: "polymer.protein", transparency: 0.55, color: "gray70" },
      { type: "label", selection: "chain A and resi 20 and name CA", text: "Chain A" },
      { type: "label", selection: "chain B and resi 20 and name CA", text: "Chain B" },
      { type: "label", selection: "chain C and resi 20 and name CA", text: "Chain C" },
      { type: "label", selection: "chain D and resi 20 and name CA", text: "Chain D" },
    ]);

    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      "show surface, polymer.protein",
      "label chain A and resi 20 and name CA, \"Chain A\"",
    ]));
    expect(recoveryTimeoutMs).toBe(30_000);
    expect(recoveryPasses).toBe(2);
  });

  it("reports stabilization timeouts without falsely declaring the pinned endpoint dead", async () => {
    const adapter = new PymolAdapter({
      rpcUrl: "http://127.0.0.1:9123/RPC2",
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      waitUntilCommandReady: (timeoutMs?: number) => Promise<string>;
      waitForSpecificRpcUrl: (
        rpcUrl: string,
        timeoutMs: number,
        options?: { requiredConsecutivePasses?: number; coldStartOnSuccess?: boolean },
      ) => Promise<string | null>;
    };

    adapter.waitForSpecificRpcUrl = async () => null;

    await expect(adapter.waitUntilCommandReady(30_000)).rejects.toThrow(
      /did not become command-ready within 30000 ms/i,
    );
    await expect(adapter.waitUntilCommandReady(30_000)).rejects.not.toThrow(
      /stopped responding|restart the managed pymol target/i,
    );
  });

  it("treats a reachable pinned endpoint as warming before declaring it dead", async () => {
    const adapter = new PymolAdapter({
      rpcUrl: "http://127.0.0.1:9123/RPC2",
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      ensureReady: () => Promise<string>;
      waitForSpecificRpcUrl: (
        rpcUrl: string,
        timeoutMs: number,
        options?: { requiredConsecutivePasses?: number; coldStartOnSuccess?: boolean },
      ) => Promise<string | null>;
      probeEndpoint: (rpcUrl: string) => Promise<{
        rpcUrl: string;
        objectCount: number;
        port: number;
        reachable: boolean;
        commandReady: boolean;
        lastError?: string;
      } | null>;
    };

    let waitCallCount = 0;
    let finalTimeoutMs = 0;
    adapter.waitForSpecificRpcUrl = async (_rpcUrl, timeoutMs) => {
      waitCallCount += 1;
      finalTimeoutMs = timeoutMs;
      return null;
    };
    adapter.probeEndpoint = async (rpcUrl) => ({
      rpcUrl,
      objectCount: 4,
      port: 9123,
      reachable: true,
      commandReady: false,
      lastError: "PyMOL RPC is reachable, but the command-ready probes did not all succeed yet.",
    });

    await expect(adapter.ensureReady()).rejects.toThrow(/did not become command-ready within 35000 ms/i);
    await expect(adapter.ensureReady()).rejects.not.toThrow(/stopped responding|restart the managed pymol target/i);
    expect(waitCallCount).toBeGreaterThanOrEqual(2);
    expect(finalTimeoutMs).toBe(30_000);
  });

  it("uses a single certification pass when the pinned endpoint was recently validated", async () => {
    const adapter = new PymolAdapter({
      rpcUrl: "http://127.0.0.1:9123/RPC2",
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      waitUntilCommandReady: (timeoutMs?: number) => Promise<string>;
      waitForSpecificRpcUrl: (
        rpcUrl: string,
        timeoutMs: number,
        options?: { requiredConsecutivePasses?: number; coldStartOnSuccess?: boolean },
      ) => Promise<string | null>;
      lastCommandReadyUrl?: string;
      lastValidatedAt?: string;
    };

    let requestedPasses = 0;
    adapter.lastCommandReadyUrl = "http://127.0.0.1:9123/RPC2";
    adapter.lastValidatedAt = new Date().toISOString();
    adapter.waitForSpecificRpcUrl = async (_rpcUrl, _timeoutMs, options) => {
      requestedPasses = options?.requiredConsecutivePasses ?? 0;
      return "http://127.0.0.1:9123/RPC2";
    };

    await expect(adapter.waitUntilCommandReady(30_000)).resolves.toBe("http://127.0.0.1:9123/RPC2");
    expect(requestedPasses).toBe(1);
  });

  it("collects a lightweight state summary without issuing atom-count probes", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    }) as unknown as {
      collectStateSummary: (rpcUrl: string) => Promise<Record<string, unknown>>;
      callOptionalXmlRpcProbe: (
        rpcUrl: string,
        methodName: string,
        params: unknown[],
        timeoutMs: number,
      ) => Promise<unknown | undefined>;
    };

    const methods: string[] = [];
    adapter.callOptionalXmlRpcProbe = async (_rpcUrl, methodName, params) => {
      methods.push(methodName);
      if (methodName === "get_names" && params[0] === "objects" && params[1] === 0) {
        return ["4hhb"];
      }
      if (methodName === "get_names" && params[0] === "objects" && params[1] === 1) {
        return ["4hhb"];
      }
      if (methodName === "get_names" && params[0] === "public_selections") {
        return ["heme"];
      }
      if (methodName === "get_scene_list") {
        return ["F6"];
      }
      if (methodName === "get_view") {
        return Array.from({ length: 18 }, (_, index) => index);
      }
      if (methodName === "get_viewport") {
        return [1600, 1200];
      }
      if (methodName === "get_chains" && params[0] === "visible") {
        return ["A", "B", "C", "D"];
      }
      if (methodName === "get_chains" && params[0] === "4hhb") {
        return ["A", "B", "C", "D"];
      }
      if (methodName === "get_state") {
        return 1;
      }
      if (methodName === "get_type") {
        return "object:molecule";
      }
      return undefined;
    };

    const summary = await adapter.collectStateSummary("http://127.0.0.1:9123/RPC2");

    expect(methods).not.toContain("count_atoms");
    expect(summary.objectNames).toEqual(["4hhb"]);
    expect(summary.sceneNames).toEqual(["F6"]);
    expect(summary.visibleChains).toEqual(["A", "B", "C", "D"]);
  });

  it("replaces an existing object before loading it again", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });

    const result = await adapter.execute([
      {
        type: "load",
        source: "local",
        object: "repeatable_model",
        path: path.join(process.cwd(), "examples", "data", "local", "1hsg.pdb"),
      },
    ], true);

    expect(result.commandsExecuted).toEqual([
      "delete repeatable_model",
      expect.stringMatching(/^load /),
    ]);
  });
});
