import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { actionResultSchema, type ActionResult, type PymolAction } from "../schemas/index.js";
import { CommandQueue } from "../utils/command-queue.js";
import { normalizePymolColorSpec } from "../utils/colors.js";
import {
  defaultExportPath,
  ensureAllowedExportPath,
  ensureAllowedStructureInputPath,
  quoteCommandValue,
  resolveLocalStructureInputPath,
} from "../utils/path-policy.js";
import { isProcessLockActive, withProcessLock } from "../utils/process-lock.js";
import { compilePymolSelection, selectorUsesReference, type SelectorReferenceMap } from "../utils/selectors.js";
import { buildPymolReferenceSummary, type ReferenceHint, type SceneAnnotation } from "../utils/semantic-handles.js";

export interface PymolAdapterOptions {
  rpcUrl?: string;
  baseUrl: string;
  startPort: number;
  timeoutMs: number;
  renderTimeoutMs: number;
  autolaunch: boolean;
  enableExpertRawCommands?: boolean;
  allowMissingLocalInputsForDocumentation?: boolean;
}

export interface PymolAvailabilitySummary {
  ready: boolean;
  endpoint?: string;
  detail?: string;
  reachable: boolean;
  commandReady: boolean;
  busy: boolean;
  warmupState: "offline" | "warming" | "ready";
  lastRpcError?: string;
  validatedAt?: string;
}

interface PymolCommandBatch {
  command: string;
  timeoutMs: number;
  commandCount: number;
}

const TRANSIENT_VIEW_KEY = "__biovoice_preserve";

interface PymolEndpointProbe {
  rpcUrl: string;
  objectCount: number;
  port: number;
  reachable: boolean;
  commandReady: boolean;
  lastError?: string;
}

export class PymolAdapter {
  private readonly queue = new CommandQueue();
  private readonly configuredRpcUrl: string | null;
  private readonly baseUrl: string;
  private readonly startPort: number;
  private readonly timeoutMs: number;
  private readonly renderTimeoutMs: number;
  private readonly autolaunch: boolean;
  private readonly enableExpertRawCommands: boolean;
  private readonly allowMissingLocalInputsForDocumentation: boolean;
  private activeUrl: string | null = null;
  private lastReachableUrl: string | null = null;
  private lastCommandReadyUrl: string | null = null;
  private lastRpcError: string | undefined;
  private lastValidatedAt: string | undefined;
  private warmupState: "offline" | "warming" | "ready" = "offline";
  private cachedStateSummary: Record<string, unknown> | undefined;
  private cachedStateSummaryAt: string | undefined;
  private coldStartUntilMs = 0;
  private firstNonReadOnlyBatchPending = false;
  private lastReferenceHints: SelectorReferenceMap = {};
  private workflowReferenceHints: SelectorReferenceMap = {};
  private workflowState: Record<string, unknown> | undefined;
  private readonly sceneAnnotations: Record<string, SceneAnnotation> = {};

  constructor(options: PymolAdapterOptions) {
    this.configuredRpcUrl = options.rpcUrl?.replace(/\/$/, "") ?? null;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.startPort = options.startPort;
    this.timeoutMs = options.timeoutMs;
    this.renderTimeoutMs = options.renderTimeoutMs;
    this.autolaunch = options.autolaunch;
    this.enableExpertRawCommands = options.enableExpertRawCommands ?? false;
    this.allowMissingLocalInputsForDocumentation = options.allowMissingLocalInputsForDocumentation ?? false;
  }

  async ensureReady(): Promise<string> {
    if (this.activeUrl) {
      const recoveredActiveUrl = await this.recoverPinnedRpcUrl(this.activeUrl, 5_000);
      if (recoveredActiveUrl) {
        this.activeUrl = recoveredActiveUrl;
        return recoveredActiveUrl;
      }
      this.noteUnavailable(this.activeUrl, buildPinnedEndpointError(this.activeUrl));
      throw new Error(buildPinnedEndpointError(this.activeUrl));
    }

    if (this.configuredRpcUrl) {
      const recoveredConfiguredUrl = await this.recoverPinnedRpcUrl(this.configuredRpcUrl, 5_000);
      if (recoveredConfiguredUrl) {
        this.activeUrl = recoveredConfiguredUrl;
        return recoveredConfiguredUrl;
      }
      this.noteUnavailable(this.configuredRpcUrl, buildPinnedEndpointError(this.configuredRpcUrl));
      throw new Error(buildPinnedEndpointError(this.configuredRpcUrl));
    }

    const discoveredUrl = await this.waitForReadyRpcUrl(3_000, {
      requiredConsecutivePasses: 3,
      coldStartOnSuccess: true,
    });
    if (discoveredUrl) {
      this.activeUrl = discoveredUrl;
      return discoveredUrl;
    }

    if (!this.autolaunch) {
      throw new Error("PyMOL RPC server not found. Start PyMOL with -R or enable autolaunch.");
    }

    return withProcessLock("pymol.launch", 35_000, async () => {
      const rediscoveredUrl = await this.waitForReadyRpcUrl(3_000, {
        requiredConsecutivePasses: 3,
        coldStartOnSuccess: true,
      });
      if (rediscoveredUrl) {
        this.activeUrl = rediscoveredUrl;
        return rediscoveredUrl;
      }

      const warmingUrl = await this.waitForReadyRpcUrl(6_000, {
        requiredConsecutivePasses: 3,
        coldStartOnSuccess: true,
      });
      if (warmingUrl) {
        this.activeUrl = warmingUrl;
        return warmingUrl;
      }

      spawn("open", ["-na", "/Applications/PyMOL.app", "--args", "-R"], {
        detached: true,
        stdio: "ignore",
      }).unref();

      const launchedUrl = await this.waitForReadyRpcUrl(25_000, {
        requiredConsecutivePasses: 3,
        coldStartOnSuccess: true,
      });
      if (launchedUrl) {
        this.activeUrl = launchedUrl;
        return launchedUrl;
      }

      throw new Error("PyMOL launched, but no RPC endpoint answered on the expected port range.");
    }, {
      staleAfterMs: 60_000,
      pollMs: 500,
    });
  }

  async execute(
    actions: PymolAction[],
    dryRun = false,
    allowExpertRawCommands = this.enableExpertRawCommands,
    checkpointPath?: string,
  ): Promise<ActionResult> {
    const lockBudgetMs = Math.max(this.renderTimeoutMs * 3 + 60_000, 120_000);
    return this.queue.enqueue(async () => {
      const run = async () => {
        const startedAt = Date.now();
        const preparedActions = materializePymolActions(actions);
        const rpcUrl = dryRun ? null : await this.ensureReady();
        if (!dryRun && checkpointPath) {
          const safeCheckpointPath = ensureAllowedExportPath(checkpointPath);
          await fs.mkdir(path.dirname(safeCheckpointPath), { recursive: true });
          await this.callDo(rpcUrl!, `save ${quoteCommandValue(safeCheckpointPath)}`, this.renderTimeoutMs);
        }
        if (preparedActions.some((action) => action.type === "reset_workspace")) {
          this.clearWorkflowContext();
          this.clearTransientSceneState();
        }
        const referenceHints = await this.resolveReferenceHintsForActions(preparedActions, rpcUrl);
        const commands = preparedActions.flatMap((action) => compilePymolAction(
          action,
          referenceHints,
          allowExpertRawCommands,
          dryRun && this.allowMissingLocalInputsForDocumentation,
        ));
        const commandBatches = createPymolCommandBatches(commands, this.timeoutMs, this.renderTimeoutMs, {
          coldStart: !dryRun && this.isColdStartActive(),
        });
        const artifacts: ActionResult["artifacts"] = [];
        const shouldPreserveView = !dryRun && shouldPreservePymolViewForActions(preparedActions, referenceHints);
        const exportActions = preparedActions.filter((action) => action.type === "export");
        const warnings: string[] = [];

        for (const exportAction of exportActions) {
          const exportPath = exportAction.export.path!;
          await fs.mkdir(path.dirname(exportPath), { recursive: true });
          artifacts.push({
            kind: exportAction.export.format === "png" ? "image" : "session",
            path: exportPath,
            label: `PyMOL ${exportAction.export.format.toUpperCase()} export`,
          });
        }

        if (!dryRun) {
          if (shouldPreserveView) {
            await this.callDo(rpcUrl!, `view ${TRANSIENT_VIEW_KEY}, store`, Math.min(this.timeoutMs, 2_000));
          }
          for (const batch of commandBatches) {
            const pngExport = parsePymolPngCommand(batch.command);
            if (pngExport) {
              await this.callPngExport(rpcUrl!, pngExport, batch.timeoutMs);
              continue;
            }
            await this.callDo(rpcUrl!, batch.command, batch.timeoutMs);
          }
          if (shouldPreserveView) {
            try {
              await this.callDo(rpcUrl!, `view ${TRANSIENT_VIEW_KEY}, recall`, Math.min(this.timeoutMs, 2_000));
            } catch (error) {
              warnings.push(buildPostExecutionRecoveryWarning("view restore", error));
            }
          }
          if (commands.length > 0) {
            this.noteSuccessfulCommandExecution();
          }
        }

        const elapsedMs = Date.now() - startedAt;
        const postCommandRecovery = !dryRun ? getPymolPostCommandRecovery(commandBatches, this.renderTimeoutMs) : null;
        if (postCommandRecovery) {
          await this.waitForSpecificRpcUrl(rpcUrl!, postCommandRecovery.timeoutMs, {
            requiredConsecutivePasses: postCommandRecovery.requiredConsecutivePasses,
          });
        }

        let state: Record<string, unknown> | undefined;
        let metrics: ActionResult["metrics"] = [];
        if (!dryRun) {
          try {
            state = await this.collectStateSummary(rpcUrl!);
          } catch (error) {
            warnings.push(buildPostExecutionRecoveryWarning("state refresh", error));
          }

          try {
            metrics = await this.collectScientificMetrics(rpcUrl!, preparedActions);
          } catch (error) {
            warnings.push(buildPostExecutionRecoveryWarning("metric collection", error));
          }
        }

        return actionResultSchema.parse({
          target: "pymol",
          commandsExecuted: commands,
          logs: [
            `RPC endpoint: ${rpcUrl ?? "dry-run"}`,
            `${commands.length} commands across ${commandBatches.length} RPC batch${commandBatches.length === 1 ? "" : "es"}.`,
            dryRun ? "Dry run only." : "Commands executed in PyMOL.",
            `Elapsed: ${elapsedMs} ms.`,
          ],
          artifacts,
          metrics,
          warnings,
          state,
        });
      };

      if (dryRun) {
        return run();
      }

      return withProcessLock(
        "pymol.command",
        lockBudgetMs,
        run,
        {
          staleAfterMs: lockBudgetMs,
          pollMs: 250,
        },
      );
    });
  }

  async restoreCheckpoint(checkpointPath: string): Promise<ActionResult> {
    const safeCheckpointPath = ensureAllowedStructureInputPath(checkpointPath, "PyMOL checkpoint");
    const lockBudgetMs = Math.max(this.renderTimeoutMs * 3 + 60_000, 120_000);
    return this.queue.enqueue(() => withProcessLock(
      "pymol.command",
      lockBudgetMs,
      async () => {
        const rpcUrl = await this.ensureReady();
        const command = `load ${quoteCommandValue(safeCheckpointPath)}`;
        await this.callDo(rpcUrl, command, this.renderTimeoutMs);
        this.clearWorkflowContext();
        this.clearTransientSceneState();
        this.noteSuccessfulCommandExecution();
        const state = await this.collectStateSummary(rpcUrl);
        return actionResultSchema.parse({
          target: "pymol",
          commandsExecuted: [command],
          logs: ["Restored the previous PyMOL checkpoint."],
          artifacts: [],
          metrics: [],
          warnings: [],
          state,
        });
      },
      {
        staleAfterMs: lockBudgetMs,
        pollMs: 250,
      },
    ));
  }

  async getStateSummary(): Promise<Record<string, unknown>> {
    if (await isProcessLockActive("pymol.command", {
      staleAfterMs: Math.max(this.renderTimeoutMs * 3 + 60_000, 120_000),
    })) {
      return this.buildDeferredStateSummary();
    }

    const rpcUrl = await this.ensureReady();
    return this.collectStateSummary(rpcUrl);
  }

  async waitUntilCommandReady(timeoutMs = 12_000): Promise<string> {
    const pinnedUrl = this.activeUrl ?? this.configuredRpcUrl ?? this.lastCommandReadyUrl;
    if (pinnedUrl) {
      const requiredConsecutivePasses = this.hasRecentCertification(pinnedUrl) ? 1 : 3;
      const readyUrl = await this.waitForSpecificRpcUrl(pinnedUrl, timeoutMs, {
        requiredConsecutivePasses,
      });
      if (readyUrl) {
        return readyUrl;
      }
      throw new Error(buildPinnedEndpointWarmupTimeoutError(pinnedUrl, timeoutMs));
    }

    const requiredConsecutivePasses = this.lastCommandReadyUrl && this.hasRecentCertification(this.lastCommandReadyUrl) ? 1 : 3;
    const readyUrl = await this.waitForReadyRpcUrl(timeoutMs, {
      requiredConsecutivePasses,
    });
    if (readyUrl) {
      return readyUrl;
    }

    throw new Error("No PyMOL RPC endpoint answered in the configured port range.");
  }

  private async recoverPinnedRpcUrl(rpcUrl: string, initialTimeoutMs: number): Promise<string | null> {
    const recoveredPinnedUrl = await this.waitForSpecificRpcUrl(rpcUrl, initialTimeoutMs, {
      requiredConsecutivePasses: this.hasRecentCertification(rpcUrl) ? 1 : 3,
    });
    if (recoveredPinnedUrl) {
      return recoveredPinnedUrl;
    }

    const probe = await this.probeEndpoint(rpcUrl);
    if (!probe?.reachable) {
      return null;
    }

    this.noteReachable(rpcUrl, probe.lastError);
    const extendedWarmupTimeoutMs = Math.min(Math.max(this.renderTimeoutMs, 10_000), 30_000);
    const warmedPinnedUrl = await this.waitForSpecificRpcUrl(rpcUrl, extendedWarmupTimeoutMs, {
      requiredConsecutivePasses: 1,
    });
    if (warmedPinnedUrl) {
      return warmedPinnedUrl;
    }

    const totalWarmupTimeoutMs = initialTimeoutMs + extendedWarmupTimeoutMs;
    this.noteReachable(rpcUrl, buildPinnedEndpointWarmupTimeoutError(rpcUrl, totalWarmupTimeoutMs));
    throw new Error(buildPinnedEndpointWarmupTimeoutError(rpcUrl, totalWarmupTimeoutMs));
  }

  setWorkflowContext(context: { referenceHints: Record<string, ReferenceHint>; workflowState: Record<string, unknown> }): void {
    this.workflowReferenceHints = context.referenceHints;
    this.workflowState = context.workflowState;
    this.lastReferenceHints = this.mergeReferenceHints(this.lastReferenceHints);
  }

  clearWorkflowContext(): void {
    this.workflowReferenceHints = {};
    this.workflowState = undefined;
    this.lastReferenceHints = {};
  }

  async getAvailabilitySummary(): Promise<PymolAvailabilitySummary> {
    const busy = await isProcessLockActive("pymol.command", {
      staleAfterMs: Math.max(this.renderTimeoutMs * 3 + 60_000, 120_000),
    });
    const pinnedUrl = this.activeUrl ?? this.configuredRpcUrl ?? this.lastCommandReadyUrl ?? this.lastReachableUrl;

    if (busy && pinnedUrl && this.lastCommandReadyUrl === pinnedUrl) {
      return {
        ready: this.lastCommandReadyUrl === pinnedUrl,
        endpoint: pinnedUrl,
        detail: "PyMOL is busy executing or rendering the current command batch.",
        reachable: this.lastReachableUrl === pinnedUrl || this.lastCommandReadyUrl === pinnedUrl,
        commandReady: this.lastCommandReadyUrl === pinnedUrl,
        busy: true,
        warmupState: this.lastCommandReadyUrl === pinnedUrl ? "ready" : this.warmupState,
        lastRpcError: this.lastRpcError,
        validatedAt: this.lastValidatedAt,
      };
    }

    if (this.activeUrl) {
      const readyUrl = await this.waitForSpecificRpcUrl(this.activeUrl, 1_500, {
        requiredConsecutivePasses: this.hasRecentCertification(this.activeUrl) ? 1 : 3,
      });
      if (readyUrl) {
        return {
          ready: true,
          endpoint: readyUrl,
          reachable: true,
          commandReady: true,
          busy: false,
          warmupState: "ready",
          validatedAt: this.lastValidatedAt,
        };
      }

      this.noteUnavailable(this.activeUrl, buildPinnedEndpointError(this.activeUrl));
      return {
        ready: false,
        endpoint: this.activeUrl,
        detail: buildPinnedEndpointError(this.activeUrl),
        reachable: false,
        commandReady: false,
        busy: false,
        warmupState: "offline",
        lastRpcError: this.lastRpcError,
        validatedAt: this.lastValidatedAt,
      };
    }

    if (this.configuredRpcUrl) {
      const readyUrl = await this.waitForSpecificRpcUrl(this.configuredRpcUrl, 1_500, {
        requiredConsecutivePasses: this.hasRecentCertification(this.configuredRpcUrl) ? 1 : 3,
      });
      if (readyUrl) {
        this.activeUrl = readyUrl;
        return {
          ready: true,
          endpoint: readyUrl,
          reachable: true,
          commandReady: true,
          busy: false,
          warmupState: "ready",
          validatedAt: this.lastValidatedAt,
        };
      }

      this.noteUnavailable(this.configuredRpcUrl, buildPinnedEndpointError(this.configuredRpcUrl));
      return {
        ready: false,
        endpoint: this.configuredRpcUrl,
        detail: buildPinnedEndpointError(this.configuredRpcUrl),
        reachable: false,
        commandReady: false,
        busy: false,
        warmupState: "offline",
        lastRpcError: this.lastRpcError,
        validatedAt: this.lastValidatedAt,
      };
    }

    const probes = await this.probeCandidateEndpoints();
    const readyCandidate = sortPymolEndpointProbes(probes.filter((probe) => probe.commandReady))[0];
    if (readyCandidate) {
      this.noteCommandReady(readyCandidate.rpcUrl, { coldStart: false });
      return {
        ready: true,
        endpoint: readyCandidate.rpcUrl,
        reachable: true,
        commandReady: true,
        busy: false,
        warmupState: "ready",
        validatedAt: this.lastValidatedAt,
      };
    }

    const reachableCandidate = sortPymolEndpointProbes(probes.filter((probe) => probe.reachable))[0];
    if (reachableCandidate) {
      this.noteReachable(reachableCandidate.rpcUrl, reachableCandidate.lastError);
      return {
        ready: false,
        endpoint: reachableCandidate.rpcUrl,
        detail: reachableCandidate.lastError ?? "PyMOL RPC is reachable but still warming up.",
        reachable: true,
        commandReady: false,
        busy: false,
        warmupState: "warming",
        lastRpcError: this.lastRpcError,
        validatedAt: this.lastValidatedAt,
      };
    }

    this.warmupState = "offline";
    return {
      ready: false,
      detail: "No PyMOL RPC endpoint answered in the configured port range.",
      reachable: false,
      commandReady: false,
      busy: false,
      warmupState: "offline",
      lastRpcError: this.lastRpcError,
      validatedAt: this.lastValidatedAt,
    };
  }

  private async ping(rpcUrl: string): Promise<boolean> {
    try {
      const response = await this.callXmlRpcProbe(rpcUrl, "ping", [], Math.min(this.timeoutMs, 1_500));
      return response === 1;
    } catch {
      return false;
    }
  }

  private async isResponsive(rpcUrl: string): Promise<boolean> {
    if (!await this.ping(rpcUrl)) {
      return false;
    }

    try {
      const viewport = await this.callXmlRpcProbe(rpcUrl, "get_viewport", [], Math.min(this.timeoutMs, 1_500));
      return Array.isArray(viewport) && viewport.length >= 2;
    } catch {
      return false;
    }
  }

  private async findReadyRpcUrl(): Promise<string | null> {
    const probes = await this.probeCandidateEndpoints();
    const readyCandidates = sortPymolEndpointProbes(probes.filter((probe) => probe.commandReady));
    return readyCandidates[0]?.rpcUrl ?? null;
  }

  private async probeEndpoint(rpcUrl: string): Promise<PymolEndpointProbe | null> {
    if (!await this.ping(rpcUrl)) {
      return null;
    }

    this.noteReachable(rpcUrl);

    const certificationTimeoutMs = Math.max(2_000, Math.min(this.timeoutMs, 4_000));
    try {
      const names = await this.callXmlRpcProbe(rpcUrl, "get_names", ["objects", 0], certificationTimeoutMs);
      const objectCount = Array.isArray(names) ? names.length : 0;

      const viewport = await this.callXmlRpcProbe(rpcUrl, "get_viewport", [], certificationTimeoutMs);
      const viewportReady = Array.isArray(viewport) && viewport.length >= 2;
      if (!viewportReady) {
        return {
          rpcUrl,
          objectCount,
          port: getPortFromRpcUrl(rpcUrl),
          reachable: true,
          commandReady: false,
          lastError: "PyMOL RPC is reachable, but the command-ready probes did not all succeed yet.",
        };
      }

      const scenes = await this.callXmlRpcProbe(rpcUrl, "get_scene_list", [], certificationTimeoutMs);
      const scenesReady = Array.isArray(scenes);
      if (!scenesReady) {
        return {
          rpcUrl,
          objectCount,
          port: getPortFromRpcUrl(rpcUrl),
          reachable: true,
          commandReady: false,
          lastError: "PyMOL RPC is reachable, but the command-ready probes did not all succeed yet.",
        };
      }

      const atomCount = await this.callXmlRpcProbe(rpcUrl, "count_atoms", ["all"], certificationTimeoutMs);
      const atomCountReady = typeof atomCount === "number";
      if (!atomCountReady) {
        return {
          rpcUrl,
          objectCount,
          port: getPortFromRpcUrl(rpcUrl),
          reachable: true,
          commandReady: false,
          lastError: "PyMOL RPC is reachable, but the command-ready probes did not all succeed yet.",
        };
      }

      return {
        rpcUrl,
        objectCount,
        port: getPortFromRpcUrl(rpcUrl),
        reachable: true,
        commandReady: true,
      };
    } catch (error) {
      return {
        rpcUrl,
        objectCount: 0,
        port: getPortFromRpcUrl(rpcUrl),
        reachable: true,
        commandReady: false,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async probeCandidateEndpoints(): Promise<PymolEndpointProbe[]> {
    const candidates = [
      ...(this.configuredRpcUrl ? [this.configuredRpcUrl] : []),
      ...Array.from({ length: 6 }, (_, index) => `${this.baseUrl}:${this.startPort + index}/RPC2`),
    ];
    const probes = await Promise.all([...new Set(candidates)].map((rpcUrl) => this.probeEndpoint(rpcUrl)));
    return probes.filter((probe): probe is PymolEndpointProbe => Boolean(probe));
  }

  private async waitForReadyRpcUrl(
    timeoutMs: number,
    options?: {
      requiredConsecutivePasses?: number;
      coldStartOnSuccess?: boolean;
    },
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    const requiredConsecutivePasses = options?.requiredConsecutivePasses ?? 1;
    const readyCounts = new Map<string, number>();

    while (Date.now() < deadline) {
      const probes = sortPymolEndpointProbes(await this.probeCandidateEndpoints());
      const readyCandidate = probes.find((probe) => probe.commandReady);
      if (readyCandidate) {
        const readyCount = (readyCounts.get(readyCandidate.rpcUrl) ?? 0) + 1;
        readyCounts.set(readyCandidate.rpcUrl, readyCount);
        if (readyCount >= requiredConsecutivePasses) {
          this.noteCommandReady(readyCandidate.rpcUrl, {
            coldStart: options?.coldStartOnSuccess ?? false,
          });
          return readyCandidate.rpcUrl;
        }
      } else {
        for (const probe of probes) {
          this.noteReachable(probe.rpcUrl, probe.lastError);
        }
      }

      await sleep(500);
    }

    return null;
  }

  private async waitForSpecificRpcUrl(
    rpcUrl: string,
    timeoutMs: number,
    options?: {
      requiredConsecutivePasses?: number;
      coldStartOnSuccess?: boolean;
    },
  ): Promise<string | null> {
    const requiredConsecutivePasses = options?.requiredConsecutivePasses ?? 1;
    let consecutiveReadyPasses = 0;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const probe = await this.probeEndpoint(rpcUrl);
      if (probe?.commandReady) {
        consecutiveReadyPasses += 1;
        if (consecutiveReadyPasses >= requiredConsecutivePasses) {
          this.noteCommandReady(rpcUrl, {
            coldStart: options?.coldStartOnSuccess ?? false,
          });
          return rpcUrl;
        }
      } else {
        consecutiveReadyPasses = 0;
        if (probe?.reachable) {
          this.noteReachable(rpcUrl, probe.lastError);
        }
      }

      await sleep(500);
    }

    return null;
  }

  private async callDo(rpcUrl: string, command: string, timeoutMs: number): Promise<void> {
    await this.callXmlRpc(rpcUrl, "do", [command], timeoutMs);
  }

  private async callPngExport(
    rpcUrl: string,
    request: { path: string; width: number; height: number; dpi: number; ray: number },
    timeoutMs: number,
  ): Promise<void> {
    await this.callXmlRpc(
      rpcUrl,
      "png",
      [request.path, request.width, request.height, request.dpi, request.ray],
      timeoutMs,
    );

    const deadline = Date.now() + Math.min(timeoutMs, 5_000);
    while (Date.now() < deadline) {
      try {
        await fs.access(request.path);
        return;
      } catch {
        await sleep(100);
      }
    }

    throw new Error(`PyMOL reported a successful PNG export, but the file was not written: ${request.path}`);
  }

  private async callXmlRpcProbe(
    rpcUrl: string,
    methodName: string,
    params: unknown[],
    timeoutMs: number,
  ): Promise<unknown> {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
      },
      body: buildXmlRpcCall(methodName, params),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`PyMOL RPC failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const fault = parseFault(body);
    if (fault) {
      throw new Error(`PyMOL RPC fault: ${fault}`);
    }

    return parseXmlRpcResponseValue(body);
  }

  private async callOptionalXmlRpcProbe(
    rpcUrl: string,
    methodName: string,
    params: unknown[],
    timeoutMs: number,
  ): Promise<unknown | undefined> {
    try {
      return await this.callXmlRpcProbe(rpcUrl, methodName, params, timeoutMs);
    } catch {
      return undefined;
    }
  }

  private async collectStateSummary(rpcUrl: string): Promise<Record<string, unknown>> {
    const summaryTimeoutMs = Math.max(1_500, Math.min(this.timeoutMs, 3_000));
    const objects = await this.callOptionalXmlRpcProbe(rpcUrl, "get_names", ["objects", 0], summaryTimeoutMs);
    const enabledObjects = await this.callOptionalXmlRpcProbe(rpcUrl, "get_names", ["objects", 1], summaryTimeoutMs);
    const selections = await this.callOptionalXmlRpcProbe(rpcUrl, "get_names", ["public_selections", 1], summaryTimeoutMs);
    const scenes = await this.callOptionalXmlRpcProbe(rpcUrl, "get_scene_list", [], summaryTimeoutMs);
    const view = await this.callOptionalXmlRpcProbe(rpcUrl, "get_view", [], summaryTimeoutMs);
    const viewport = await this.callOptionalXmlRpcProbe(rpcUrl, "get_viewport", [], summaryTimeoutMs);
    const chains = await this.callOptionalXmlRpcProbe(rpcUrl, "get_chains", ["visible"], summaryTimeoutMs);
    const currentState = await this.callOptionalXmlRpcProbe(rpcUrl, "get_state", [], summaryTimeoutMs);
    const ligandAtomCount = await this.callOptionalXmlRpcProbe(rpcUrl, "count_atoms", ["organic"], summaryTimeoutMs);

    const objectNames = normalizeStringArray(objects);
    const objectTypeEntries: Array<readonly [string, string]> = [];
    for (const name of objectNames) {
      const type = await this.callOptionalXmlRpcProbe(rpcUrl, "get_type", [name], summaryTimeoutMs);
      objectTypeEntries.push([name, typeof type === "string" ? type : "unknown"] as const);
    }
    const objectTypes = Object.fromEntries(objectTypeEntries);
    const molecularObjectNames = objectNames.filter((name) => objectTypes[name] === "object:molecule");
    const mapObjectNames = objectNames.filter((name) => objectTypes[name] === "object:map");
    const measurementObjectNames = objectNames.filter((name) => objectTypes[name] === "object:measurement");
    const otherObjectNames = objectNames.filter(
      (name) => !molecularObjectNames.includes(name) && !mapObjectNames.includes(name) && !measurementObjectNames.includes(name),
    );
    const chainsByObjectEntries: Array<readonly [string, string[]]> = [];
    for (const name of molecularObjectNames) {
      const chainsForObject = await this.callOptionalXmlRpcProbe(rpcUrl, "get_chains", [name], summaryTimeoutMs);
      chainsByObjectEntries.push([name, normalizeStringArray(chainsForObject)] as const);
    }
    const chainsByObject = Object.fromEntries(chainsByObjectEntries);
    const viewValues = Array.isArray(view) ? view : [];
    const viewportValues = Array.isArray(viewport) ? viewport : [];
    const referenceSummary = buildPymolReferenceSummary({
      molecularObjectNames,
      mapObjectNames,
      selectionNames: normalizeStringArray(selections),
      visibleChains: normalizeStringArray(chains),
      chainsByObject,
      ligandAtomCount: typeof ligandAtomCount === "number" ? ligandAtomCount : undefined,
      annotations: this.sceneAnnotations,
    });
    const mergedReferenceHints = this.mergeReferenceHints(referenceSummary.handles);
    this.lastReferenceHints = mergedReferenceHints;

    const summary = {
      rpcUrl,
      objectNames,
      molecularObjectNames,
      mapObjectNames,
      measurementObjectNames,
      otherObjectNames,
      objectTypes,
      enabledObjectNames: normalizeStringArray(enabledObjects),
      selectionNames: normalizeStringArray(selections),
      sceneNames: normalizeStringArray(scenes),
      visibleChains: normalizeStringArray(chains),
      ligandAtomCount: typeof ligandAtomCount === "number" ? ligandAtomCount : undefined,
      currentState: typeof currentState === "number" ? currentState : undefined,
      referenceHints: mergedReferenceHints,
      semanticDescriptors: referenceSummary.descriptors,
      chainHandles: referenceSummary.chainHandles,
      selectionHandles: referenceSummary.selectionHandles,
      chainsByObject,
      workflowState: this.workflowState,
      viewport:
        viewportValues.length >= 2 && typeof viewportValues[0] === "number" && typeof viewportValues[1] === "number"
          ? {
              width: viewportValues[0],
              height: viewportValues[1],
            }
          : undefined,
      cameraDistance: typeof viewValues[11] === "number" ? viewValues[11] : undefined,
      view: viewValues,
    };
    this.cachedStateSummary = summary;
    this.cachedStateSummaryAt = new Date().toISOString();
    return summary;
  }

  private async collectScientificMetrics(rpcUrl: string, actions: PymolAction[]): Promise<ActionResult["metrics"]> {
    const metrics: ActionResult["metrics"] = [];

    for (const action of actions) {
      if (action.type === "measure") {
        const name = action.name ?? undefined;
        if (action.mode === "angle") {
          if (!action.selection3) {
            continue;
          }
          const value = await this.getRpcScalarMetric(rpcUrl, "get_angle", [
            compilePymolSelection(action.selection1, this.lastReferenceHints),
            compilePymolSelection(action.selection2, this.lastReferenceHints),
            compilePymolSelection(action.selection3, this.lastReferenceHints),
          ]);
          if (value == null) {
            continue;
          }
          metrics.push({
            kind: "angle",
            name,
            label: name ? `PyMOL angle ${name}` : "PyMOL angle",
            value,
            unit: "deg",
            source: "rpc",
          });
          continue;
        }

        if (action.mode === "dihedral") {
          if (!action.selection3 || !action.selection4) {
            continue;
          }
          const value = await this.getRpcScalarMetric(rpcUrl, "get_dihedral", [
            compilePymolSelection(action.selection1, this.lastReferenceHints),
            compilePymolSelection(action.selection2, this.lastReferenceHints),
            compilePymolSelection(action.selection3, this.lastReferenceHints),
            compilePymolSelection(action.selection4, this.lastReferenceHints),
          ]);
          if (value == null) {
            continue;
          }
          metrics.push({
            kind: "dihedral",
            name,
            label: name ? `PyMOL dihedral ${name}` : "PyMOL dihedral",
            value,
            unit: "deg",
            source: "rpc",
          });
          continue;
        }

        if (action.mode === "polar_contacts") {
          metrics.push({
            kind: "contacts",
            name,
            label: name ? `PyMOL contact cutoff ${name}` : "PyMOL contact cutoff",
            value: action.cutoff ?? 3.5,
            unit: "A",
            source: "rpc",
          });
          continue;
        }

        const value = await this.getRpcScalarMetric(rpcUrl, "get_distance", [
          compilePymolSelection(action.selection1, this.lastReferenceHints),
          compilePymolSelection(action.selection2, this.lastReferenceHints),
        ]);
        if (value == null) {
          continue;
        }
        metrics.push({
          kind: "distance",
          name,
          label: name ? `PyMOL distance ${name}` : "PyMOL distance",
          value,
          unit: "A",
          source: "rpc",
        });
        continue;
      }

      if (action.type === "distance") {
        const value = await this.getRpcScalarMetric(rpcUrl, "get_distance", [
          compilePymolSelection(action.selection1, this.lastReferenceHints),
          compilePymolSelection(action.selection2, this.lastReferenceHints),
        ]);
        if (value == null) {
          continue;
        }
        metrics.push({
          kind: "distance",
          name: action.name ?? undefined,
          label: action.name ? `PyMOL distance ${action.name}` : "PyMOL distance",
          value,
          unit: "A",
          source: "rpc",
        });
      }

      if (action.type === "contacts") {
        const mode = action.mode ?? "polar_contacts";
        const cutoff = getPymolContactsCutoff(action);
        metrics.push({
          kind: "contacts",
          name: action.name ?? undefined,
          label: action.name ? `PyMOL contacts ${action.name}` : `PyMOL ${formatPymolContactsMode(mode)} cutoff`,
          value: cutoff,
          unit: "A",
          source: "rpc",
          details: {
            mode,
          },
        });
        continue;
      }

      if (action.type === "align") {
        const alignmentMetric = await this.getAlignmentMetric(rpcUrl, action);
        if (alignmentMetric) {
          metrics.push(alignmentMetric);
        }
      }
    }

    return metrics;
  }

  private async getRpcScalarMetric(rpcUrl: string, methodName: string, params: string[]): Promise<number | null> {
    try {
      const response = await this.callXmlRpc(rpcUrl, methodName, params, this.timeoutMs);
      return typeof response === "number" && Number.isFinite(response)
        ? roundMetric(response)
        : null;
    } catch {
      return null;
    }
  }

  private async getAlignmentMetric(rpcUrl: string, action: Extract<PymolAction, { type: "align" }>): Promise<ActionResult["metrics"][number] | null> {
    const mobile = compilePymolSelection(action.mobile, this.lastReferenceHints);
    const target = compilePymolSelection(action.target, this.lastReferenceHints);

    try {
      if (action.method === "cealign") {
        const response = await this.callXmlRpc(
          rpcUrl,
          "cealign",
          [target, mobile, 1, 1, 1, 1, 3.0, 4.0, 8, 30, 0],
          this.renderTimeoutMs,
        );
        if (response && typeof response === "object" && "RMSD" in response) {
          const rmsd = Number((response as Record<string, unknown>).RMSD);
          const alignmentLength = Number((response as Record<string, unknown>).alignment_length ?? 0);
          if (Number.isFinite(rmsd)) {
            return {
              kind: "alignment",
              label: "PyMOL cealign RMSD",
              value: roundMetric(rmsd),
              unit: "A",
              source: "rpc",
              details: Number.isFinite(alignmentLength) ? { alignmentLength } : undefined,
            };
          }
        }
        return null;
      }

      const methodName = action.method === "super" ? "super" : "align";
      const response = await this.callXmlRpc(
        rpcUrl,
        methodName,
        methodName === "super"
          ? [mobile, target, 2.0, 5, -1.5, -0.7, 50, "", "BLOSUM62", 0, 0, 1, 0, 0, 0, 0.0, 12.0, 17.0, 0.65, 0.0, 6.0, 3, -1.0]
          : [mobile, target, 2.0, 5, -10.0, -0.5, 50, "", "BLOSUM62", 0, 0, 1, 0, 0, 0],
        this.renderTimeoutMs,
      );
      if (!Array.isArray(response) || typeof response[0] !== "number") {
        return null;
      }

      return {
        kind: "alignment",
        label: `PyMOL ${action.method} RMSD`,
        value: roundMetric(response[0]),
        unit: "A",
        source: "rpc",
        details: typeof response[1] === "number" ? { alignedAtomCount: response[1] } : undefined,
      };
    } catch {
      return null;
    }
  }

  private async callXmlRpc(
    rpcUrl: string,
    methodName: string,
    params: unknown[],
    timeoutMs = this.timeoutMs,
    attempt = 0,
  ): Promise<unknown> {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
        },
        body: buildXmlRpcCall(methodName, params),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(`PyMOL RPC failed (${response.status}): ${body.slice(0, 200)}`);
      }

      const fault = parseFault(body);
      if (fault) {
        throw new Error(`PyMOL RPC fault: ${fault}`);
      }

      return parseXmlRpcResponseValue(body);
    } catch (error) {
      if (attempt === 0 && methodName !== "ping") {
        await sleep(750);
        if (await this.isResponsive(rpcUrl)) {
          return this.callXmlRpc(rpcUrl, methodName, params, timeoutMs, attempt + 1);
        }
      }

      if (attempt < 2 && methodName !== "ping") {
        const pinnedRetryUrl = await this.waitForSpecificRpcUrl(rpcUrl, 2_500, {
          requiredConsecutivePasses: 1,
        });
        if (pinnedRetryUrl) {
          return this.callXmlRpc(pinnedRetryUrl, methodName, params, timeoutMs, attempt + 1);
        }

        if (this.activeUrl === rpcUrl || this.configuredRpcUrl === rpcUrl) {
          this.noteUnavailable(rpcUrl, buildPinnedEndpointError(rpcUrl));
          throw new Error(buildPinnedEndpointError(rpcUrl));
        }

        this.activeUrl = null;
        const retryUrl = await this.ensureReady();
        return this.callXmlRpc(retryUrl, methodName, params, timeoutMs, attempt + 1);
      }

      throw error;
    }
  }

  private async resolveReferenceHintsForActions(actions: PymolAction[], rpcUrl: string | null): Promise<SelectorReferenceMap> {
    this.registerActionAnnotations(actions);

    const predictedHints = predictPymolReferenceHintsFromActions(actions, this.sceneAnnotations);
    if (Object.keys(predictedHints).length) {
      this.lastReferenceHints = {
        ...this.lastReferenceHints,
        ...predictedHints,
      };
    }

    if (!actions.some((action) => selectorUsesReference(action))) {
      return this.mergeReferenceHints(this.lastReferenceHints);
    }

    if (Object.keys(predictedHints).length) {
      return this.mergeReferenceHints(this.lastReferenceHints);
    }

    if (Object.keys(this.lastReferenceHints).length) {
      return this.mergeReferenceHints(this.lastReferenceHints);
    }

    if (!rpcUrl) {
      return this.mergeReferenceHints(this.lastReferenceHints);
    }

    await this.collectStateSummary(rpcUrl);
    return this.mergeReferenceHints(this.lastReferenceHints);
  }

  private mergeReferenceHints(base: SelectorReferenceMap): SelectorReferenceMap {
    return {
      ...base,
      ...this.workflowReferenceHints,
    };
  }

  private clearTransientSceneState(): void {
    this.lastReferenceHints = {};
    for (const key of Object.keys(this.sceneAnnotations)) {
      delete this.sceneAnnotations[key];
    }
  }

  private hasRecentCertification(rpcUrl: string): boolean {
    if (this.lastCommandReadyUrl !== rpcUrl || !this.lastValidatedAt) {
      return false;
    }

    const validatedAtMs = Date.parse(this.lastValidatedAt);
    return Number.isFinite(validatedAtMs) && Date.now() - validatedAtMs < 2 * 60_000;
  }

  private noteReachable(rpcUrl: string, lastError?: string): void {
    this.lastReachableUrl = rpcUrl;
    this.warmupState = this.lastCommandReadyUrl === rpcUrl ? "ready" : "warming";
    if (lastError) {
      this.lastRpcError = lastError;
    }
  }

  private noteCommandReady(rpcUrl: string, options?: { coldStart?: boolean }): void {
    this.lastReachableUrl = rpcUrl;
    this.lastCommandReadyUrl = rpcUrl;
    this.lastValidatedAt = new Date().toISOString();
    this.lastRpcError = undefined;
    this.warmupState = "ready";
    if (options?.coldStart) {
      this.coldStartUntilMs = Date.now() + 60_000;
      this.firstNonReadOnlyBatchPending = true;
    }
  }

  private noteUnavailable(rpcUrl: string | null, error: string): void {
    this.warmupState = "offline";
    this.lastRpcError = error;
  }

  private isColdStartActive(): boolean {
    return this.firstNonReadOnlyBatchPending || Date.now() < this.coldStartUntilMs;
  }

  private noteSuccessfulCommandExecution(): void {
    this.firstNonReadOnlyBatchPending = false;
  }

  private buildDeferredStateSummary(): Record<string, unknown> {
    if (this.cachedStateSummary) {
      return {
        ...this.cachedStateSummary,
        busy: true,
        refreshDeferred: true,
        cachedAt: this.cachedStateSummaryAt,
      };
    }

    return {
      rpcUrl: this.activeUrl ?? this.configuredRpcUrl ?? this.lastCommandReadyUrl ?? undefined,
      busy: true,
      refreshDeferred: true,
      cachedAt: this.cachedStateSummaryAt,
      referenceHints: this.mergeReferenceHints(this.lastReferenceHints),
      workflowState: this.workflowState,
    };
  }

  private registerActionAnnotations(actions: PymolAction[]): void {
    for (const action of actions) {
      if (action.type !== "load") {
        continue;
      }

      const annotation = createSceneAnnotation(action.semanticRole, action.aliases);
      if (!annotation) {
        continue;
      }

      const keys = new Set<string>([inferPymolLoadObjectName(action)]);
      if (action.id) {
        keys.add(action.id);
      }
      if (action.path) {
        keys.add(path.basename(action.path));
      }

      for (const key of keys) {
        this.sceneAnnotations[key] = annotation;
      }
    }
  }

}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPinnedEndpointError(rpcUrl: string): string {
  return `Pinned PyMOL RPC endpoint ${rpcUrl} stopped responding. Restart the managed PyMOL target instead of switching to a different session.`;
}

export function createPymolCommandBatches(
  commands: string[],
  timeoutMs: number,
  renderTimeoutMs: number,
  options?: {
    coldStart?: boolean;
  },
): PymolCommandBatch[] {
  const batches: PymolCommandBatch[] = [];
  let pending: string[] = [];

  const flushPending = () => {
    if (!pending.length) {
      return;
    }
    batches.push({
      command: pending.join("\n"),
      timeoutMs: getPymolBatchTimeout(pending, timeoutMs, renderTimeoutMs, options?.coldStart ?? false),
      commandCount: pending.length,
    });
    pending = [];
  };

  for (const command of commands) {
    if (isBatchBarrierCommand(command)) {
      flushPending();
      batches.push({
        command,
        timeoutMs: getPymolBarrierTimeout(command, renderTimeoutMs, options?.coldStart ?? false),
        commandCount: 1,
      });
      continue;
    }

    pending.push(command);
  }

  flushPending();
  return batches;
}

function isBatchBarrierCommand(command: string): boolean {
  return /^(fetch|load|ray|png|save|map_new|isomesh|isosurface|align|super|cealign)\b/i.test(command.trim());
}

function getPymolBarrierTimeout(command: string, renderTimeoutMs: number, coldStart: boolean): number {
  const rayCommand = parsePymolRayCommand(command);
  if (rayCommand) {
    return getScaledPymolRenderTimeout(rayCommand.width, rayCommand.height, renderTimeoutMs);
  }

  const pngCommand = parsePymolPngCommand(command);
  if (pngCommand?.ray) {
    return getScaledPymolRenderTimeout(pngCommand.width, pngCommand.height, renderTimeoutMs);
  }

  if (coldStart && /^(fetch|load|map_new|isomesh|isosurface)\b/i.test(command.trim())) {
    return Math.max(renderTimeoutMs, 45_000);
  }

  return renderTimeoutMs;
}

function parsePymolRayCommand(command: string): { width: number; height: number } | null {
  const match = /^ray\s+(\d+)\s*,\s*(\d+)$/i.exec(command.trim());
  if (!match) {
    return null;
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function getScaledPymolRenderTimeout(width: number, height: number, renderTimeoutMs: number): number {
  const baselinePixels = 1_600 * 1_100;
  const pixelCount = Math.max(width * height, baselinePixels);
  const scale = Math.min(3, Math.ceil(pixelCount / baselinePixels));
  return renderTimeoutMs * scale;
}

function parsePymolPngCommand(command: string): { path: string; width: number; height: number; dpi: number; ray: number } | null {
  const match = /^png\s+"((?:[^"\\]|\\.)+)",\s*width=(\d+),\s*height=(\d+),\s*dpi=(\d+),\s*ray=(\d+)$/i.exec(command.trim());
  if (!match) {
    return null;
  }

  return {
    path: match[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\"),
    width: Number(match[2]),
    height: Number(match[3]),
    dpi: Number(match[4]),
    ray: Number(match[5]),
  };
}

function requiresPymolPostCommandRecovery(command: string): boolean {
  return /^(ray|png|save|map_new|isomesh|isosurface)\b/i.test(command.trim())
    || /\b(show surface|set surface_|scene\b)\b/i.test(command.trim());
}

function getPymolPostCommandRecovery(
  commandBatches: PymolCommandBatch[],
  renderTimeoutMs: number,
): { timeoutMs: number; requiredConsecutivePasses: number } | null {
  if (!commandBatches.some((batch) => requiresPymolPostCommandRecovery(batch.command))) {
    return null;
  }

  const joined = commandBatches.map((batch) => batch.command).join("\n");
  const hasSurfaceWork = /\b(show surface|set surface_|isomesh\b|isosurface\b)\b/i.test(joined);
  const hasSceneWork = /\bscene\b/i.test(joined);
  const hasRayCommand = commandBatches.some((batch) => /^ray\b/i.test(batch.command.trim()));
  const hasRayTracedPng = commandBatches.some((batch) => (parsePymolPngCommand(batch.command)?.ray ?? 0) > 0);

  if (hasRayCommand || hasRayTracedPng) {
    return {
      timeoutMs: Math.min(renderTimeoutMs, hasSurfaceWork || hasSceneWork ? 30_000 : 20_000),
      requiredConsecutivePasses: hasSurfaceWork || hasSceneWork ? 2 : 1,
    };
  }

  if (hasSurfaceWork) {
    return {
      timeoutMs: Math.min(renderTimeoutMs, 30_000),
      requiredConsecutivePasses: 2,
    };
  }

  if (hasSceneWork) {
    return {
      timeoutMs: Math.min(renderTimeoutMs, 20_000),
      requiredConsecutivePasses: 1,
    };
  }

  return {
    timeoutMs: Math.min(renderTimeoutMs, 10_000),
    requiredConsecutivePasses: 1,
  };
}

function buildPostExecutionRecoveryWarning(phase: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `PyMOL ${phase} did not complete before the export route returned. The artifact was created, but the immediate ${phase} probe was skipped: ${detail}`;
}

function buildPinnedEndpointWarmupTimeoutError(rpcUrl: string, timeoutMs: number): string {
  return `Pinned PyMOL RPC endpoint ${rpcUrl} did not become command-ready within ${timeoutMs} ms. The session may still recover, but the next step should wait for stabilization or retry.`;
}

function getPymolBatchTimeout(commands: string[], timeoutMs: number, renderTimeoutMs: number, coldStart: boolean): number {
  const joined = commands.join("\n");
  const hasSurfaceOrSceneWork = /\b(show surface|set surface_|scene\b|cartoon putty|spectrum\b|distance\b)\b/i.test(joined);
  if (!hasSurfaceOrSceneWork && commands.length <= 6) {
    return coldStart ? Math.max(timeoutMs, 20_000) : timeoutMs;
  }
  if (hasSurfaceOrSceneWork && commands.length >= 6) {
    return coldStart ? Math.max(renderTimeoutMs, 45_000) : renderTimeoutMs;
  }

  const scaledTimeout = timeoutMs + Math.max(0, commands.length - 1) * 750;
  const computed = Math.min(renderTimeoutMs, Math.max(timeoutMs, scaledTimeout));
  if (!coldStart) {
    return computed;
  }
  if (hasSurfaceOrSceneWork) {
    return Math.max(computed, 45_000);
  }
  return Math.max(computed, 20_000);
}

function sortPymolEndpointProbes(probes: PymolEndpointProbe[]): PymolEndpointProbe[] {
  return [...probes].sort((left, right) => {
    if (left.commandReady !== right.commandReady) {
      return left.commandReady ? -1 : 1;
    }
    if (left.port !== right.port) {
      return left.port - right.port;
    }
    return right.objectCount - left.objectCount;
  });
}

function compilePymolAction(
  action: PymolAction,
  referenceHints?: SelectorReferenceMap,
  allowExpertRawCommands = false,
  allowMissingLocalInputsForDocumentation = false,
): string[] {
  switch (action.type) {
    case "reset_workspace":
      return [
        "reinitialize",
        "scene *, clear",
        ...compilePymolAction({ type: "preset", name: "presentation_light" }, referenceHints),
      ];
    case "load": {
      const objectName = inferPymolLoadObjectName(action);
      if (action.source === "pdb" || action.source === "alphafold") {
        if (!action.id) throw new Error("PyMOL load action requires an id.");
        return [
          `delete ${objectName}`,
          `fetch ${action.id}, ${objectName}, async=0`,
        ];
      }
      if (action.source === "local") {
        const localPath = resolveLocalStructureInputPath(
          action.path,
          [action.id, action.object, objectName],
          objectName,
          { allowMissingExplicitPath: allowMissingLocalInputsForDocumentation },
        );
        return [
          `delete ${objectName}`,
          `load ${quoteCommandValue(localPath)}, ${objectName}`,
        ];
      }
      throw new Error(`Unsupported PyMOL load source: ${action.source}`);
    }
    case "select":
      return [`select ${action.name}, ${compilePymolSelection(action.selection, referenceHints)}`];
    case "show":
      return action.representations.map((representation) => `show ${representation}, ${compilePymolSelection(action.selection, referenceHints)}`);
    case "hide":
      return action.representations.map((representation) => `hide ${representation}, ${compilePymolSelection(action.selection, referenceHints)}`);
    case "color":
      if (action.scheme === "by_chain") return [`util.cbc ${compilePymolSelection(action.selection, referenceHints)}`];
      if (action.scheme === "by_element") return [`util.cnc ${compilePymolSelection(action.selection, referenceHints)}`];
      if (action.scheme === "rainbow") return [`spectrum count, rainbow, ${compilePymolSelection(action.selection, referenceHints)}`];
      if (action.scheme === "b_factor") return [`spectrum b, red_yellow_green_cyan_blue, ${compilePymolSelection(action.selection, referenceHints)}`];
      return [`color ${normalizePymolColorSpec(action.color ?? "tv_orange")}, ${compilePymolSelection(action.selection, referenceHints)}`];
    case "cartoon": {
      const selection = compilePymolSelection(action.selection, referenceHints);
      const style = normalizePymolCartoonStyle(action.style);
      const commands = [
        `show cartoon, ${selection}`,
        `cartoon ${style}, ${selection}`,
      ];
      if (typeof action.radius === "number") {
        const setting = style === "putty" ? "cartoon_putty_radius" : style === "tube" ? "cartoon_tube_radius" : null;
        if (setting) {
          commands.push(`set ${setting}, ${action.radius}, ${selection}`);
        }
      }
      return commands;
    }
    case "camera": {
      const selection = compilePymolSelection(action.selection, referenceHints);
      switch (action.action) {
        case "orient":
          return [`orient ${selection}`];
        case "zoom":
          return [`zoom ${selection}${action.buffer ? `, ${action.buffer}` : ""}`];
        case "center":
          return [`center ${selection}`];
        case "turn":
          return [`turn ${action.axis ?? "y"}, ${action.degrees ?? 30}`];
        case "move":
          return [`move ${action.axis ?? "y"}, ${action.amount ?? 10}`];
        case "clip":
          return [`clip ${action.clipMode ?? "slab"}, ${action.amount ?? 5}${selection !== "all" ? `, ${selection}` : ""}`];
        case "hero_frame":
          return buildPymolCameraFrame(selection, "hero", action.buffer);
        case "pocket_frame":
          return buildPymolCameraFrame(selection, "pocket", action.buffer);
        case "comparison_frame":
          return buildPymolCameraFrame(selection, "comparison", action.buffer);
        case "map_cutaway":
          return buildPymolCameraFrame(selection, "map", action.buffer);
      }
      break;
    }
    case "transform":
      return buildPymolTransformCommands(action, referenceHints);
    case "measure": {
      const selection1 = compilePymolSelection(action.selection1, referenceHints);
      const selection2 = compilePymolSelection(action.selection2, referenceHints);
      if (action.mode === "angle") {
        if (!action.selection3) {
          throw new Error("PyMOL angle measurement requires selection3.");
        }
        return [`angle ${action.name ?? "angle_measurement"}, ${selection1}, ${selection2}, ${compilePymolSelection(action.selection3, referenceHints)}`];
      }
      if (action.mode === "dihedral") {
        if (!action.selection3 || !action.selection4) {
          throw new Error("PyMOL dihedral measurement requires selection3 and selection4.");
        }
        return [
          `dihedral ${action.name ?? "dihedral_measurement"}, ${selection1}, ${selection2}, ${compilePymolSelection(action.selection3, referenceHints)}, ${compilePymolSelection(action.selection4, referenceHints)}`,
        ];
      }
      if (action.mode === "polar_contacts") {
        return [`distance ${action.name ?? "polar_contacts"}, ${selection1}, ${selection2}, ${action.cutoff ?? 3.5}, 2`];
      }
      return [`distance ${action.name ?? "measurement"}, ${selection1}, ${selection2}${action.cutoff ? `, ${action.cutoff}` : ""}`];
    }
    case "distance":
      return [
        `distance ${action.name ?? "measurement"}, ${compilePymolSelection(action.selection1, referenceHints)}, ${compilePymolSelection(action.selection2, referenceHints)}${action.cutoff ? `, ${action.cutoff}` : ""}${typeof action.mode === "number" ? `, ${action.mode}` : ""}`,
      ];
    case "contacts":
      return buildPymolContactsCommands(action, referenceHints);
    case "label":
      if (action.action === "clear") {
        return [`hide labels, ${compilePymolSelection(action.selection, referenceHints)}`];
      }
      if (!action.text) {
        throw new Error("PyMOL label action requires text unless action is clear.");
      }
      return [`label ${compilePymolSelection(action.selection, referenceHints)}, "${escapeDoubleQuotes(normalizePymolLabelText(action.text, action.selection))}"`];
    case "align": {
      const mobileSelection = compilePymolSelection(action.mobile, referenceHints).trim();
      const targetSelection = compilePymolSelection(action.target, referenceHints).trim();
      if (mobileSelection === targetSelection) {
        throw new Error(
          "PyMOL align requires distinct mobile and target selections. Call get_target_state and align the predicted model to the experimental model instead of retrying the same selection.",
        );
      }
      return [`${action.method} ${mobileSelection}, ${targetSelection}`];
    }
    case "surface": {
      const selection = compilePymolSelection(action.selection, referenceHints);
      const commands = [`show surface, ${selection}`];
      if (action.color) commands.push(`set surface_color, ${normalizePymolColorSpec(action.color)}, ${selection}`);
      if (typeof action.transparency === "number") {
        commands.push(`set transparency, ${action.transparency}, ${selection}`);
      }
      return commands;
    }
    case "map": {
      const selection = compilePymolSelection(action.selection, referenceHints);
      const mapName = action.mapName;
      const meshName = `${mapName}_${action.displayAs}`;
      const commands = [
        `map_new ${mapName}, gaussian, ${action.grid}, ${selection}, ${action.buffer}`,
      ];
      if (action.displayAs === "mesh") {
        commands.push(`isomesh ${meshName}, ${mapName}, ${action.level}, ${selection}, ${action.buffer}${action.carve ? `, 1, ${action.carve}` : ""}`);
      } else {
        commands.push(`isosurface ${meshName}, ${mapName}, ${action.level}, ${selection}, ${action.buffer}${action.carve ? `, 1, ${action.carve}` : ""}`);
      }
      return commands;
    }
    case "map_display": {
      const selection = action.selection ? compilePymolSelection(action.selection, referenceHints) : null;
      const displayName = `${action.mapName}_${action.displayAs}`;
      const commands = [
        action.displayAs === "mesh"
          ? selection
            ? `isomesh ${displayName}, ${action.mapName}, ${action.level}, ${selection}, ${action.buffer}${action.carve ? `, 1, ${action.carve}` : ""}`
            : `isomesh ${displayName}, ${action.mapName}, ${action.level}`
          : selection
            ? `isosurface ${displayName}, ${action.mapName}, ${action.level}, ${selection}, ${action.buffer}${action.carve ? `, 1, ${action.carve}` : ""}`
            : `isosurface ${displayName}, ${action.mapName}, ${action.level}`,
      ];
      if (action.color) {
        commands.push(`color ${normalizePymolColorSpec(action.color)}, ${displayName}`);
      }
      return commands;
    }
    case "symmetry":
      return [`symexp ${action.prefix}, ${action.object}, ${compilePymolSelection(action.selection, referenceHints)}, ${action.cutoff}${action.segi ? ", 1" : ""}`];
    case "scene":
      if (action.action === "view_store") return [`view ${action.key}, store`];
      if (action.action === "view_recall") return [`view ${action.key}, recall`];
      return [`scene ${action.key}, ${action.action}${action.message ? `, ${escapeDoubleQuotes(action.message)}` : ""}`];
    case "object":
      if (action.action === "create") {
        return [`create ${action.name}, ${compilePymolSelection(action.selection, referenceHints)}`];
      }
      return [`${action.action} ${action.name}`];
    case "preset":
      if (action.name === "cartoon_overview") {
        return [
          "hide everything, polymer.protein",
          "show cartoon, polymer.protein",
          "show sticks, organic",
          "show spheres, inorganic",
        ];
      }
      if (action.name === "presentation_light") {
        return [
          "bg_color gray99",
          "set auto_zoom, 0",
          "set ray_opaque_background, off",
          "set orthoscopic, on",
          "set depth_cue, 0",
          "set ray_shadows, 0",
          "set antialias, 2",
          "set antialias_shader, 2",
          "set specular, 0.15",
          "set specular_intensity, 0.2",
          "set spec_direct, 0",
          "set ambient, 0.22",
          "set direct, 0.48",
          "set two_sided_lighting, 1",
          "set cartoon_fancy_helices, 1",
          "set cartoon_flat_sheets, 1",
          "set cartoon_smooth_loops, 1",
          "set stick_radius, 0.16",
          "set surface_quality, 2",
          "set valence, 0",
          "set label_color, gray20",
          "set label_size, 18",
          "set label_outline_color, gray98",
          "set dash_color, gray45",
          "set dash_radius, 0.05",
          "set dash_gap, 0.18",
        ];
      }
      if (action.name === "ligand_editorial") {
        return [
          ...compilePymolAction({ type: "preset", name: "presentation_light" }, referenceHints),
          "set stick_radius, 0.2",
          "set dash_radius, 0.06",
          "set dash_gap, 0.16",
          "set transparency, 0.5",
          "set label_size, 20",
        ];
      }
      if (action.name === "assembly_editorial") {
        return [
          ...compilePymolAction({ type: "preset", name: "presentation_light" }, referenceHints),
          "set cartoon_transparency, 0.04",
          "set stick_radius, 0.13",
          "set label_size, 16",
          "set dash_radius, 0.04",
        ];
      }
      if (action.name === "cryo_atomic_hero") {
        return [
          ...compilePymolAction({ type: "preset", name: "presentation_light" }, referenceHints),
          "set mesh_width, 0.24",
          "set transparency, 0.55",
          "set dash_color, teal",
          "set dash_radius, 0.06",
        ];
      }
      if (action.name === "pocket_hero") {
        return [
          ...compilePymolAction({ type: "preset", name: "ligand_editorial" }, referenceHints),
          "set transparency, 0.42",
          "set mesh_width, 0.35",
          "set label_outline_color, gray98",
        ];
      }
      if (action.name === "comparison_hero") {
        return [
          ...compilePymolAction({ type: "preset", name: "assembly_editorial" }, referenceHints),
          "set cartoon_transparency, 0.08",
          "set stick_radius, 0.15",
          "set dash_gap, 0.2",
        ];
      }
      if (action.name === "map_hero") {
        return [
          ...compilePymolAction({ type: "preset", name: "cryo_atomic_hero" }, referenceHints),
          "set mesh_width, 0.4",
          "set surface_quality, 2",
          "set two_sided_lighting, 1",
        ];
      }
      if (action.name === "confidence_putty") {
        return [
          ...compilePymolAction({ type: "preset", name: "presentation_light" }, referenceHints),
          "cartoon putty, polymer.protein",
          "spectrum b, red_yellow_green_cyan_blue, polymer.protein",
        ];
      }
      return [
        "bg_color gray98",
        "set ray_opaque_background, off",
        "set orthoscopic, on",
        "set depth_cue, 0",
        "set antialias, 2",
      ];
    case "setting":
      {
        const settingName = normalizePymolSettingName(action.name);
        const selection = action.selection && !isGlobalOnlyPymolSetting(settingName)
          ? `, ${compilePymolSelection(action.selection, referenceHints)}`
          : "";
        return [
          `set ${settingName}, ${String(action.value)}${selection}`,
        ];
      }
    case "export": {
      const exportPath = resolveExportPath(action.export.path, action.export.format, "pymol");
      if (action.export.format === "png") {
        const width = action.export.width ?? 3200;
        const height = action.export.height ?? 2100;
        const ray = action.export.rayTrace === false ? 0 : 1;
        return [`png ${quoteCommandValue(exportPath)}, width=${width}, height=${height}, dpi=350, ray=${ray}`];
      }
      if (action.export.format === "pse") {
        return [`save ${quoteCommandValue(exportPath)}`];
      }
      return [`save ${quoteCommandValue(exportPath)}`];
    }
    case "raw_command":
      if (!allowExpertRawCommands) {
        throw new Error("PyMOL raw_command is disabled. Enable advanced expert commands before using raw command passthrough.");
      }
      return [action.command];
  }
}

function normalizePymolSettingName(name: string): string {
  return name === "surface_transparency" ? "transparency" : name;
}

function normalizePymolCartoonStyle(style: string): string {
  return style === "pipe" ? "tube" : style;
}

function isGlobalOnlyPymolSetting(name: string): boolean {
  return name.startsWith("label_");
}

function buildXmlRpcCall(methodName: string, params: unknown[]): string {
  return [
    "<?xml version=\"1.0\"?>",
    "<methodCall>",
    `<methodName>${escapeXml(methodName)}</methodName>`,
    "<params>",
    ...params.map((param) => `<param>${serializeValue(param)}</param>`),
    "</params>",
    "</methodCall>",
  ].join("");
}

function serializeValue(value: unknown): string {
  if (typeof value === "boolean") {
    return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return `<value><int>${value}</int></value>`;
  }
  if (typeof value === "number") {
    return `<value><double>${value}</double></value>`;
  }
  return `<value><string>${escapeXml(String(value ?? ""))}</string></value>`;
}

function parseFault(xml: string): string | null {
  const match =
    xml.match(/<name>\s*faultString\s*<\/name>\s*<value>\s*<string>([\s\S]*?)<\/string>\s*<\/value>/i) ??
    xml.match(/<faultString>([\s\S]*?)<\/faultString>/i);
  return match ? match[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&") : null;
}

export function parseXmlRpcResponseValue(xml: string): unknown {
  const paramNode = extractFirstXmlNode(xml, "param");
  const valueNode = extractFirstXmlNode(paramNode?.inner ?? xml, "value");
  if (!valueNode) {
    return null;
  }
  return parseXmlRpcValueNode(valueNode.inner);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeDoubleQuotes(value: string): string {
  return value.replaceAll("\"", "\\\"");
}

function normalizePymolLabelText(text: string, selection: unknown): string {
  const trimmed = text.trim();
  if (!isBarePymolPlaceholderLabel(trimmed)) {
    return trimmed;
  }
  return inferPlainLabelText(selection) ?? "label";
}

function isBarePymolPlaceholderLabel(value: string): boolean {
  return /^%[A-Za-z]$/.test(value);
}

function inferPlainLabelText(selection: unknown): string | null {
  if (typeof selection === "string") {
    const atomMatch = /\bname\s+([A-Za-z][A-Za-z0-9]*)\b/i.exec(selection);
    if (atomMatch?.[1]) {
      return formatAtomLabel(atomMatch[1]);
    }
    if (/\bresn\s+HEM\b/i.test(selection)) {
      return "heme";
    }
    return null;
  }
  if (!selection || typeof selection !== "object") {
    return null;
  }

  const candidate = selection as Record<string, unknown>;
  if (typeof candidate.atom === "string" && candidate.atom.trim()) {
    return formatAtomLabel(candidate.atom);
  }
  const residueName = typeof candidate.residueName === "string" ? candidate.residueName : typeof candidate.ligand === "string" ? candidate.ligand : null;
  if (residueName?.trim().toUpperCase() === "HEM") {
    return "heme";
  }
  return null;
}

function formatAtomLabel(atom: string): string {
  const trimmed = atom.trim();
  if (/^[A-Za-z]{1,2}$/.test(trimmed)) {
    return trimmed[0]!.toUpperCase() + trimmed.slice(1).toLowerCase();
  }
  return trimmed;
}

function buildPymolTransformCommands(
  action: Extract<PymolAction, { type: "transform" }>,
  referenceHints?: SelectorReferenceMap,
): string[] {
  const commands: string[] = [];
  const selection = action.selection ? compilePymolSelection(action.selection, referenceHints) : "all";
  const inferredObject = action.object ?? inferPymolObjectTransformTarget(action.selection, referenceHints);
  const camera = action.camera === false ? 0 : 1;

  const origin = action.origin ?? action.center;
  if (origin) {
    commands.push(`origin ${compilePymolSelection(origin, referenceHints)}`);
  }

  if (action.mode === "rotate") {
    const axis = action.axis ?? "y";
    const amount = action.amount ?? 25;
    if (inferredObject) {
      commands.push(`rotate ${axis}, ${amount}, object=${inferredObject}, camera=${camera}`);
      return commands;
    }
    commands.push(`rotate ${axis}, ${amount}, ${selection}, -1, ${camera}`);
    return commands;
  }

  const vector = action.vector ?? axisAmountToVector(action.axis ?? "x", action.amount ?? 10);
  const vectorText = `[${vector.map((value) => trimFloat(value)).join(",")}]`;
  if (inferredObject) {
    commands.push(`translate ${vectorText}, object=${inferredObject}, camera=${camera}`);
    return commands;
  }
  commands.push(`translate ${vectorText}, ${selection}, -1, ${camera}`);
  return commands;
}

function buildPymolContactsCommands(
  action: Extract<PymolAction, { type: "contacts" }>,
  referenceHints?: SelectorReferenceMap,
): string[] {
  const mode = action.mode ?? "polar_contacts";
  const name = action.name ?? getDefaultPymolContactsName(mode);
  const selection1 = compilePymolSelection(action.selection1, referenceHints);
  const selection2 = action.selection2
    ? compilePymolSelection(action.selection2, referenceHints)
    : `not (${selection1})`;
  const cutoff = getPymolContactsCutoff(action);
  const distanceMode = mode === "polar_contacts" || mode === "hbonds" ? 2 : 0;
  const commands = [
    `distance ${name}, ${selection1}, ${selection2}, ${cutoff}, ${distanceMode}`,
    `hide labels, ${name}`,
  ];

  if (mode === "clashes") {
    commands.push(`color red, ${name}`);
    commands.push(`set dash_color, red, ${name}`);
  }

  return commands;
}

function getDefaultPymolContactsName(mode: "polar_contacts" | "hbonds" | "contacts" | "clashes"): string {
  if (mode === "clashes") {
    return "clashes";
  }
  if (mode === "contacts") {
    return "contacts";
  }
  return "polar_contacts";
}

function getPymolContactsCutoff(action: Extract<PymolAction, { type: "contacts" }>): number {
  if (typeof action.cutoff === "number") {
    return action.cutoff;
  }
  if (typeof action.distance === "number") {
    return action.distance;
  }
  if (action.mode === "clashes") {
    return 2.2;
  }
  if (action.mode === "contacts") {
    return 4;
  }
  return 3.5;
}

function formatPymolContactsMode(mode: "polar_contacts" | "hbonds" | "contacts" | "clashes"): string {
  if (mode === "hbonds") {
    return "hydrogen-bond";
  }
  return mode.replaceAll("_", " ");
}

function buildPymolCameraFrame(selection: string, frame: "hero" | "pocket" | "comparison" | "map", buffer?: number): string[] {
  const target = selection === "all" ? "visible" : selection;

  if (frame === "pocket") {
    return [
      `center ${target}`,
      `orient ${target}`,
      "turn y, 18",
      "turn x, -10",
      `zoom ${target}, ${buffer ?? 7}`,
      "clip slab, 40",
    ];
  }

  if (frame === "comparison") {
    return [
      `center ${target}`,
      `orient ${target}`,
      "turn y, 12",
      "turn x, 6",
      `zoom ${target}, ${buffer ?? 10}`,
    ];
  }

  if (frame === "map") {
    return [
      `center ${target}`,
      `orient ${target}`,
      "turn y, 20",
      "turn x, 12",
      `zoom ${target}, ${buffer ?? 8}`,
      "clip slab, 14",
    ];
  }

  return [
    `center ${target}`,
    `orient ${target}`,
    "turn y, 14",
    "turn x, 8",
    `zoom ${target}, ${buffer ?? 8}`,
  ];
}

function inferPymolObjectTransformTarget(selection: unknown, referenceHints?: SelectorReferenceMap): string | null {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return null;
  }

  const candidate = resolvePymolTransformReference(selection as Record<string, unknown>, referenceHints);
  const objectName = typeof candidate.object === "string"
    ? candidate.object
    : typeof candidate.model === "string"
    ? candidate.model
    : null;

  if (!objectName) {
    return null;
  }

  const extraKeys = ["chain", "chains", "residue", "residues", "residueName", "residueNames", "atom", "ligand", "entity", "around", "withinAngstroms", "byResidue"];
  const hasScopedSelection = extraKeys.some((key) => candidate[key] !== undefined);
  return hasScopedSelection ? null : objectName;
}

export function shouldPreservePymolViewForActions(
  actions: PymolAction[],
  referenceHints: SelectorReferenceMap,
): boolean {
  const wholeComplexSelector = referenceHints.wholeComplex?.selector;
  const hasVisibleSceneContent = typeof wholeComplexSelector === "string"
    || Boolean(wholeComplexSelector && typeof wholeComplexSelector === "object");
  if (!hasVisibleSceneContent) {
    return false;
  }

  const touchesLoadedModels = actions.some((action) => action.type === "load" || action.type === "align");
  if (!touchesLoadedModels) {
    return false;
  }

  return !actions.some((action) => action.type === "camera" || (action.type === "scene" && action.action === "view_recall"));
}

function axisAmountToVector(axis: "x" | "y" | "z", amount: number): [number, number, number] {
  if (axis === "y") return [0, amount, 0];
  if (axis === "z") return [0, 0, amount];
  return [amount, 0, 0];
}

function resolvePymolTransformReference(
  selection: Record<string, unknown>,
  referenceHints?: SelectorReferenceMap,
): Record<string, unknown> {
  if (typeof selection.reference !== "string" || !referenceHints?.[selection.reference]) {
    return selection;
  }

  const hint = referenceHints[selection.reference]?.selector;
  if (!hint || typeof hint !== "object" || Array.isArray(hint)) {
    return selection;
  }

  return {
    ...hint,
    ...selection,
  };
}

function createSceneAnnotation(
  semanticRole: PymolAction extends { type: "load"; semanticRole?: infer Role } ? Role : string | undefined,
  aliases: string[] | undefined,
): SceneAnnotation | null {
  if (!semanticRole && !aliases?.length) {
    return null;
  }

  const classifications = semanticRole
    ? [semanticRole === "partner" ? "binder" : semanticRole]
    : [];
  const aliasTerms = aliases?.filter(Boolean) ?? [];
  if (semanticRole) {
    aliasTerms.push(semanticRole.replaceAll("_", " "));
  }

  return {
    classifications,
    aliases: aliasTerms,
  };
}

function predictPymolReferenceHintsFromActions(
  actions: PymolAction[],
  sceneAnnotations: Record<string, SceneAnnotation>,
): SelectorReferenceMap {
  const loadActions = actions.filter((action): action is Extract<PymolAction, { type: "load" }> => action.type === "load");
  if (!loadActions.length) {
    return {};
  }

  const molecularObjectNames = loadActions.map((action) => inferPymolLoadObjectName(action));
  const referenceSummary = buildPymolReferenceSummary({
    molecularObjectNames,
    mapObjectNames: [],
    selectionNames: [],
    visibleChains: [],
    chainsByObject: {},
    annotations: sceneAnnotations,
  });
  return referenceSummary.handles;
}

function trimFloat(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function inferPymolLoadObjectName(action: Extract<PymolAction, { type: "load" }>): string {
  if (action.object?.trim()) {
    return action.object.trim();
  }
  if (action.id?.trim()) {
    return action.id.trim();
  }
  if (action.path?.trim()) {
    const basename = path.basename(action.path, path.extname(action.path)).replace(/[^A-Za-z0-9_]+/g, "_");
    const normalized = basename.replace(/^_+|_+$/g, "");
    if (normalized) {
      return normalized;
    }
  }
  return "structure";
}

function resolveExportPath(candidate: string | undefined, format: string, target: string): string {
  if (candidate) {
    return ensureAllowedExportPath(candidate);
  }
  return defaultExportPath(target, format);
}

function materializePymolActions(actions: PymolAction[]): PymolAction[] {
  return actions.map((action) => {
    if (action.type !== "export" || action.export.path) {
      return action;
    }

    return {
      ...action,
      export: {
        ...action.export,
        path: resolveExportPath(undefined, action.export.format, "pymol"),
      },
    };
  });
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getPortFromRpcUrl(rpcUrl: string): number {
  try {
    return Number(new URL(rpcUrl).port || 0);
  } catch {
    return 0;
  }
}

function parseXmlRpcValueNode(xml: string): unknown {
  const trimmed = xml.trim();

  if (trimmed.startsWith("<array")) {
    const dataNode = extractFirstXmlNode(trimmed, "data");
    return extractXmlNodes(dataNode?.inner ?? "", "value").map((valueNode) => parseXmlRpcValueNode(valueNode.inner));
  }

  if (trimmed.startsWith("<struct")) {
    const result: Record<string, unknown> = {};
    const structNode = extractFirstXmlNode(trimmed, "struct");
    for (const memberNode of extractXmlNodes(structNode?.inner ?? "", "member")) {
      const nameNode = extractFirstXmlNode(memberNode.inner, "name");
      const valueNode = extractFirstXmlNode(memberNode.inner, "value");
      if (!nameNode) {
        continue;
      }
      result[decodeXml(nameNode.inner.trim())] = valueNode ? parseXmlRpcValueNode(valueNode.inner) : null;
    }
    return result;
  }

  const stringNode = extractFirstXmlNode(trimmed, "string");
  if (stringNode) return decodeXml(stringNode.inner);
  const intNode = extractFirstXmlNode(trimmed, "int") ?? extractFirstXmlNode(trimmed, "i4");
  if (intNode) return Number(intNode.inner.trim());
  const doubleNode = extractFirstXmlNode(trimmed, "double");
  if (doubleNode) return Number(doubleNode.inner.trim());
  const booleanNode = extractFirstXmlNode(trimmed, "boolean");
  if (booleanNode) return booleanNode.inner.trim() === "1";

  return decodeXml(trimmed.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim()) || null;
}

function extractFirstXmlNode(xml: string, tag: string): { inner: string; outer: string; end: number } | null {
  return extractXmlNode(xml, tag, 0);
}

function extractXmlNodes(xml: string, tag: string): Array<{ inner: string; outer: string; end: number }> {
  const nodes: Array<{ inner: string; outer: string; end: number }> = [];
  let offset = 0;

  while (offset < xml.length) {
    const node = extractXmlNode(xml, tag, offset);
    if (!node) {
      break;
    }
    nodes.push(node);
    offset = node.end;
  }

  return nodes;
}

function extractXmlNode(xml: string, tag: string, offset: number): { inner: string; outer: string; end: number } | null {
  const openExpression = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "ig");
  openExpression.lastIndex = offset;
  const openMatch = openExpression.exec(xml);
  if (!openMatch) {
    return null;
  }

  const tokenExpression = new RegExp(`<\\/?${tag}(?:\\s[^>]*)?>`, "ig");
  tokenExpression.lastIndex = openMatch.index + openMatch[0].length;

  let depth = 1;
  let closeMatch: RegExpExecArray | null = null;
  while ((closeMatch = tokenExpression.exec(xml))) {
    if (closeMatch[0].startsWith(`</${tag}`)) {
      depth -= 1;
    } else {
      depth += 1;
    }

    if (depth === 0) {
      const end = closeMatch.index + closeMatch[0].length;
      return {
        inner: xml.slice(openMatch.index + openMatch[0].length, closeMatch.index),
        outer: xml.slice(openMatch.index, end),
        end,
      };
    }
  }

  return null;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}
