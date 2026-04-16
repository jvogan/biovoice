import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { actionResultSchema, type ActionResult, type ChimeraXAction } from "../schemas/index.js";
import { CommandQueue } from "../utils/command-queue.js";
import { normalizeChimeraXColorSpec } from "../utils/colors.js";
import { defaultExportPath, ensureAllowedExportPath, quoteCommandValue, resolveLocalStructureInputPath } from "../utils/path-policy.js";
import { withProcessLock } from "../utils/process-lock.js";
import { compileChimeraXAtomspec, selectorUsesReference, type SelectorReferenceMap } from "../utils/selectors.js";
import { buildChimeraXReferenceSummary, type ReferenceHint, type SceneAnnotation } from "../utils/semantic-handles.js";

export interface ChimeraXAdapterOptions {
  port: number;
  timeoutMs: number;
  autolaunch: boolean;
  enableExpertRawCommands?: boolean;
}

export interface ChimeraXAvailabilitySummary {
  ready: boolean;
  endpoint?: string;
  detail?: string;
  reachable?: boolean;
  commandReady?: boolean;
  busy?: boolean;
  warmupState?: "offline" | "warming" | "ready";
  lastRpcError?: string;
  validatedAt?: string;
}

interface ChimeraXJsonResponse {
  error: null | { type: string; message: string };
  "json values"?: unknown[];
  "python values"?: unknown[];
  "log messages"?: Record<string, string[]>;
}

interface ChimeraXCommandBatch {
  commands: string[];
}

interface ChimeraXCompileContext {
  nextGeneratedModelId: number;
}

export class ChimeraXAdapter {
  private readonly queue = new CommandQueue();
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly autolaunch: boolean;
  private readonly enableExpertRawCommands: boolean;
  private ready = false;
  private lastReferenceHints: SelectorReferenceMap = {};
  private workflowReferenceHints: SelectorReferenceMap = {};
  private workflowState: Record<string, unknown> | undefined;
  private lastChainsByModel: Record<string, string[]> = {};
  private readonly sceneAnnotations: Record<string, SceneAnnotation> = {};

  constructor(options: ChimeraXAdapterOptions) {
    this.port = options.port;
    this.timeoutMs = options.timeoutMs;
    this.autolaunch = options.autolaunch;
    this.enableExpertRawCommands = options.enableExpertRawCommands ?? false;
  }

  async ensureReady(): Promise<string> {
    const baseUrl = `http://127.0.0.1:${this.port}`;
    const endpointProbe = await this.probeEndpoint(baseUrl);
    if (endpointProbe.ready) {
      this.ready = true;
      return baseUrl;
    }

    if (endpointProbe.reachable && !endpointProbe.ready) {
      throw new Error(
        endpointProbe.detail
          ?? "ChimeraX REST endpoint is reachable but not in JSON mode. Start ChimeraX with `remotecontrol rest start port 60958 json true log false`.",
      );
    }

    if (!this.autolaunch) {
      throw new Error("ChimeraX REST server not found. Start ChimeraX and run remotecontrol rest start.");
    }

    const warmingInstance = await hasExistingChimeraXProcess();
    if (warmingInstance) {
      const warmedUpUrl = await this.waitForReadyEndpoint(baseUrl, 10_000);
      if (warmedUpUrl) {
        this.ready = true;
        return warmedUpUrl;
      }
    }

    return withProcessLock("chimerax.launch", 40_000, async () => {
      const rediscoveredUrl = await this.waitForReadyEndpoint(baseUrl, 3_000);
      if (rediscoveredUrl) {
        this.ready = true;
        return rediscoveredUrl;
      }

      const binaryPath = await resolveChimeraXBinary();
      spawn(
        binaryPath,
        ["--cmd", `remotecontrol rest start port ${this.port} json true log false`],
        {
          detached: true,
          stdio: "ignore",
        },
      ).unref();

      const launchedUrl = await this.waitForReadyEndpoint(baseUrl, 30_000);
      if (launchedUrl) {
        this.ready = true;
        return launchedUrl;
      }

      throw new Error(`ChimeraX launched, but REST did not answer on port ${this.port}.`);
    }, {
      staleAfterMs: 60_000,
      pollMs: 500,
    });
  }

  async execute(actions: ChimeraXAction[], dryRun = false, allowExpertRawCommands = this.enableExpertRawCommands): Promise<ActionResult> {
    return this.queue.enqueue(async () => {
      const run = async () => {
        const startedAt = Date.now();
        const preparedActions = materializeChimeraXActions(actions);
        if (preparedActions.some((action) => action.type === "reset_workspace" || (action.type === "close" && action.target === "all"))) {
          this.clearWorkflowContext();
          this.clearTransientSceneState();
        }
        const baseUrl = dryRun ? null : await this.ensureReady();
        const referenceHints = await this.resolveReferenceHintsForActions(preparedActions, baseUrl);
        validateChimeraXMeasurementSelectors(preparedActions, referenceHints, this.lastChainsByModel);
        const compileContext = {
          nextGeneratedModelId: dryRun ? 1 : await this.getNextAvailableModelId(baseUrl!),
        } satisfies ChimeraXCompileContext;
        const executeSequentially = preparedActions.some((action) => action.type === "volume" && action.action === "molmap" && Boolean(action.mapName));
        const commands: string[] = [];
        const logs: string[] = [`REST endpoint: ${baseUrl ?? "dry-run"}`, `${commands.length} commands queued.`];
        const artifacts: ActionResult["artifacts"] = [];
        const commandResponses: Array<{ commands: string[]; response: ChimeraXJsonResponse }> = [];
        const exportActions = preparedActions.filter((action) => action.type === "export");

        for (const exportAction of exportActions) {
          const exportPath = exportAction.export.path!;
          await fs.mkdir(path.dirname(exportPath), { recursive: true });
          artifacts.push({
            kind: exportAction.export.format === "png" ? "image" : "session",
            path: exportPath,
            label: `ChimeraX ${exportAction.export.format.toUpperCase()} export`,
          });
        }

        if (!dryRun) {
          if (executeSequentially) {
            for (const action of preparedActions) {
              const actionCommands = compileChimeraXAction(action, compileContext, referenceHints, allowExpertRawCommands);
              commands.push(...actionCommands);
              const result = await this.runCommands(baseUrl!, actionCommands);
              commandResponses.push({ commands: actionCommands, response: result });
              logs.push(...summarizeChimeraXLogs(result["log messages"]));
            }
            logs[1] = `${commands.length} commands queued.`;
          } else {
            commands.push(...compileChimeraXActions(preparedActions, compileContext, referenceHints, allowExpertRawCommands));
            logs[1] = `${commands.length} commands queued.`;
            const commandBatches = createChimeraXCommandBatches(commands);
            for (const batch of commandBatches) {
              if (batch.commands.length === 1) {
                const result = await this.runCommands(baseUrl!, batch.commands);
                commandResponses.push({ commands: batch.commands, response: result });
                logs.push(...summarizeChimeraXLogs(result["log messages"]));
                continue;
              }

              try {
                const result = await this.runCommands(baseUrl!, batch.commands);
                commandResponses.push({ commands: batch.commands, response: result });
                logs.push(...summarizeChimeraXLogs(result["log messages"]));
              } catch (error) {
                logs.push(`Batch fallback for ${batch.commands.length} commands: ${error instanceof Error ? error.message : String(error)}`);
                for (const command of batch.commands) {
                  const result = await this.runCommands(baseUrl!, [command]);
                  commandResponses.push({ commands: [command], response: result });
                  logs.push(...summarizeChimeraXLogs(result["log messages"]));
                }
              }
            }
          }
        } else {
          commands.push(...compileChimeraXActions(preparedActions, compileContext, undefined, allowExpertRawCommands));
          logs[1] = `${commands.length} commands queued.`;
          logs.push("Dry run only.");
        }

        logs.push(`Elapsed: ${Date.now() - startedAt} ms.`);
        const state = dryRun ? undefined : await this.collectStateSummary(baseUrl!);
        const metrics = dryRun ? [] : extractChimeraXMetrics(commandResponses);
        return actionResultSchema.parse({
          target: "chimerax",
          commandsExecuted: commands,
          logs,
          artifacts,
          metrics,
          warnings: [],
          state,
        });
      };

      if (dryRun) {
        return run();
      }

      return withProcessLock(
        "chimerax.command",
        Math.max(this.timeoutMs + 60_000, 120_000),
        run,
        {
          staleAfterMs: Math.max(this.timeoutMs + 60_000, 120_000),
          pollMs: 250,
        },
      );
    });
  }

  async getStateSummary(): Promise<Record<string, unknown>> {
    const baseUrl = await this.ensureReady();
    return this.collectStateSummary(baseUrl);
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

  async getAvailabilitySummary(): Promise<ChimeraXAvailabilitySummary> {
    const baseUrl = `http://127.0.0.1:${this.port}`;
    const probe = await this.probeEndpoint(baseUrl);
    if (probe.ready) {
      return {
        ready: true,
        endpoint: baseUrl,
        reachable: true,
        commandReady: true,
        busy: false,
        warmupState: "ready",
      };
    }

    if (this.ready && await this.portAcceptsConnections()) {
      return {
        ready: true,
        endpoint: baseUrl,
        detail: "ChimeraX REST is busy but the last confirmed JSON endpoint is still accepting connections.",
        reachable: true,
        commandReady: true,
        busy: true,
        warmupState: "ready",
      };
    }

    if (probe.reachable) {
      return {
        ready: false,
        endpoint: baseUrl,
        detail: probe.detail ?? "ChimeraX REST is reachable but not in JSON mode.",
        reachable: true,
        commandReady: false,
        busy: false,
        warmupState: "warming",
        lastRpcError: probe.detail,
      };
    }

    return {
      ready: false,
      endpoint: baseUrl,
      detail: "No ChimeraX REST endpoint answered on the configured port.",
      reachable: false,
      commandReady: false,
      busy: false,
      warmupState: "offline",
    };
  }

  private async probeEndpoint(baseUrl: string): Promise<{ reachable: boolean; ready: boolean; detail?: string }> {
    try {
      const response = await fetch(`${baseUrl}/run?command=windowsize`, {
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 1_500)),
      });
      if (!response.ok) {
        return { reachable: false, ready: false };
      }

      const text = await response.text();
      if (!text.trim()) {
        return { reachable: true, ready: false };
      }

      try {
        const parsed = JSON.parse(text) as ChimeraXJsonResponse;
        return {
          reachable: true,
          ready: parsed.error === null,
          detail: parsed.error ? `${parsed.error.type}: ${parsed.error.message}` : undefined,
        };
      } catch {
        return { reachable: true, ready: false };
      }
    } catch {
      return { reachable: false, ready: false };
    }
  }

  private async waitForReadyEndpoint(baseUrl: string, timeoutMs: number): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const probe = await this.probeEndpoint(baseUrl);
      if (probe.ready) {
        return baseUrl;
      }
    }
    return null;
  }

  private async portAcceptsConnections(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const socket = net.connect({
        host: "127.0.0.1",
        port: this.port,
      });

      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(750);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }

  private async runCommands(baseUrl: string, commands: string[], attempt = 0): Promise<ChimeraXJsonResponse> {
    const command = commands.join("; ");
    const url = new URL("/run", baseUrl);
    url.searchParams.set("command", command);

    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutForCommands(commands)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 0 && /abort|timeout/i.test(message)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return this.runCommands(baseUrl, commands, attempt + 1);
      }
      throw new Error(`ChimeraX command failed [${command}]: ${message}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`ChimeraX REST failed for [${command}] (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = text ? JSON.parse(text) as ChimeraXJsonResponse : { error: null };
    if (data.error) {
      throw new Error(`${data.error.type} for [${command}]: ${data.error.message}`);
    }
    return data;
  }

  private timeoutForCommands(commands: string[]): number {
    return commands.some((command) => isHighLatencyChimeraXCommand(command))
      ? Math.max(this.timeoutMs, 120_000)
      : this.timeoutMs;
  }

  private async collectStateSummary(baseUrl: string): Promise<Record<string, unknown>> {
    const response = await this.runCommands(baseUrl, ["info models", "info chains", "view list", "lighting", "windowsize"]);
    const logLines = flattenChimeraXLogs(response["log messages"]);
    const models = parseChimeraXModelLines(logLines);
    const chains = parseChimeraXChainLines(logLines);
    const chainsByModel = groupChimeraXChains(chains);
    const namedViews = parseChimeraXNamedViews(logLines);
    const lighting = parseChimeraXLighting(logLines);
    const windowSize = parseChimeraXWindowSize(logLines);
    const referenceSummary = buildChimeraXReferenceSummary({
      models,
      chains,
      namedViews,
      annotations: this.sceneAnnotations,
    });
    const mergedReferenceHints = this.mergeReferenceHints(referenceSummary.handles);
    this.lastReferenceHints = mergedReferenceHints;
    this.lastChainsByModel = chainsByModel;
    return {
      baseUrl,
      models,
      chains,
      chainsByModel,
      namedViews,
      lighting,
      windowSize,
      referenceHints: mergedReferenceHints,
      semanticDescriptors: referenceSummary.descriptors,
      chainHandles: referenceSummary.chainHandles,
      selectionHandles: referenceSummary.selectionHandles,
      workflowState: this.workflowState,
      logLines,
      rawInfo: response["log messages"] ?? {},
    };
  }

  private async getNextAvailableModelId(baseUrl: string): Promise<number> {
    const response = await this.runCommands(baseUrl, ["info models"]);
    const logLines = flattenChimeraXLogs(response["log messages"]);
    const modelIds = parseChimeraXModelLines(logLines)
      .map((model) => extractTopLevelModelId(model.id))
      .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
    return (modelIds.length ? Math.max(...modelIds) : 0) + 1;
  }

  private async resolveReferenceHintsForActions(actions: ChimeraXAction[], baseUrl: string | null): Promise<SelectorReferenceMap> {
    this.registerActionAnnotations(actions);

    const openActions = actions.filter((action): action is Extract<ChimeraXAction, { type: "open" }> => action.type === "open");
    const resetsScene = actions.some((action) => action.type === "reset_workspace" || (action.type === "close" && action.target === "all"));
    const nextModelId = openActions.length
      ? resetsScene
        ? 1
        : baseUrl
        ? await this.getNextAvailableModelId(baseUrl)
        : 1
      : 1;
    const predictedHints = openActions.length
      ? buildChimeraXReferenceSummary({
          models: openActions.map((action, index) => ({
            id: `#${nextModelId + index}`,
            type: inferChimeraXModelType(action),
            name: inferChimeraXOpenedName(action),
          })),
          chains: [],
          namedViews: [],
          annotations: this.sceneAnnotations,
        }).handles
      : {};
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

    if (!baseUrl) {
      return this.mergeReferenceHints(this.lastReferenceHints);
    }

    await this.collectStateSummary(baseUrl);
    return this.mergeReferenceHints(this.lastReferenceHints);
  }

  private registerActionAnnotations(actions: ChimeraXAction[]): void {
    for (const action of actions) {
      if (action.type !== "open") {
        continue;
      }

      const annotation = createSceneAnnotation(action.semanticRole, action.aliases);
      if (!annotation) {
        continue;
      }

      const keys = new Set<string>();
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

  private mergeReferenceHints(base: SelectorReferenceMap): SelectorReferenceMap {
    return {
      ...base,
      ...this.workflowReferenceHints,
    };
  }

  private clearTransientSceneState(): void {
    this.lastChainsByModel = {};
    for (const key of Object.keys(this.sceneAnnotations)) {
      delete this.sceneAnnotations[key];
    }
  }
}

function compileChimeraXActions(
  actions: ChimeraXAction[],
  context: ChimeraXCompileContext,
  referenceHints?: SelectorReferenceMap,
  allowExpertRawCommands = false,
): string[] {
  return actions.flatMap((action) => compileChimeraXAction(action, context, referenceHints, allowExpertRawCommands));
}

function compileChimeraXAction(
  action: ChimeraXAction,
  context?: ChimeraXCompileContext,
  referenceHints?: SelectorReferenceMap,
  allowExpertRawCommands = false,
): string[] {
  switch (action.type) {
    case "reset_workspace":
      if (context) {
        context.nextGeneratedModelId = 1;
      }
      return [
        "close all",
        "view delete all",
        ...compileChimeraXAction({ type: "preset", name: "presentation_light" }, context, referenceHints),
      ];
    case "open": {
      if (context) {
        context.nextGeneratedModelId += 1;
      }
      if (action.source === "pdb") return [`open ${action.id}`];
      if (action.source === "alphafold") return [`alphafold fetch ${action.id}`];
      if (action.source === "local") {
        const localPath = resolveLocalStructureInputPath(action.path, [action.id], action.id ?? "structure");
        return [`open ${quoteCommandValue(localPath)}`];
      }
      throw new Error(`Unsupported ChimeraX open source: ${action.source}`);
    }
    case "close":
      if (context && action.target === "all") {
        context.nextGeneratedModelId = 1;
      }
      return [`close ${action.target}`];
    case "visibility": {
      const selection = action.selection ? compileChimeraXAtomspec(action.selection, referenceHints) : "";
      return [`${action.mode} ${selection}`.trim()];
    }
    case "select":
      return [`select ${compileChimeraXAtomspec(action.selection, referenceHints)}`];
    case "style": {
      const selection = action.selection ? compileChimeraXAtomspec(action.selection, referenceHints) : "";
      const commands: string[] = [];
      if (action.ribbon) commands.push(`cartoon ${selection}`.trim());
      if (action.atoms) commands.push(`style ${selection} ${action.atoms}`.trim());
      if (action.surface) {
        commands.push(`surface ${selection}`.trim());
        if (action.zoneNear) {
          commands.push(
            `surface zone ${selection || "#1"} nearAtoms ${compileChimeraXAtomspec(action.zoneNear, referenceHints)} distance ${action.zoneDistance ?? 5}${action.zoneMaxComponents ? ` maxComponents ${action.zoneMaxComponents}` : ""}`.trim(),
          );
        }
      }
      if (typeof action.transparency === "number") {
        commands.push(`transparency ${selection} ${action.transparency} target s`.trim());
      }
      return commands;
    }
    case "color":
      if (action.scheme === "bychain") return [`color ${compileChimeraXAtomspec(action.selection, referenceHints)} bychain cartoons`];
      if (action.scheme === "byelement") return [`color ${compileChimeraXAtomspec(action.selection, referenceHints)} byelement atoms`];
      if (action.scheme === "bfactor") return [`color byattribute bfactor ${compileChimeraXAtomspec(action.selection, referenceHints)}`];
      if (action.scheme === "confidence") return [`color bfactor ${compileChimeraXAtomspec(action.selection, referenceHints)} palette alphafold`];
      return [`color ${compileChimeraXAtomspec(action.selection, referenceHints)} ${normalizeChimeraXColorSpec(action.color ?? "goldenrod")}`];
    case "camera": {
      const selection = action.selection ? compileChimeraXAtomspec(action.selection, referenceHints) : "";
      switch (action.action) {
        case "view":
          return [selection ? `view ${selection} orient` : "view orient"];
        case "turn":
          return [`turn ${action.axis ?? "y"} ${action.amount ?? 30}`];
        case "move":
          return [`move ${action.axis ?? "y"} ${action.amount ?? 2}`];
        case "zoom":
          return selection
            ? [`view ${selection} orient`, `zoom ${action.amount ?? 1.5}`]
            : [`zoom ${action.amount ?? 1.5}`];
        case "clip":
          if (action.clipMode === "off" || action.clipMode === "list") {
            return [`clip ${action.clipMode}`];
          }
          return [`clip ${action.clipMode ?? "front"} ${action.amount ?? 10}`];
        case "hero_frame":
          return buildChimeraXCameraFrame(selection, "hero");
        case "pocket_frame":
          return buildChimeraXCameraFrame(selection, "pocket");
        case "comparison_frame":
          return buildChimeraXCameraFrame(selection, "comparison");
        case "map_cutaway":
          return buildChimeraXCameraFrame(selection, "map");
      }
      break;
    }
    case "transform":
      return buildChimeraXTransformCommands(action, referenceHints);
    case "measure":
      if (action.mode === "angle") {
        if (!action.selection3) {
          throw new Error("ChimeraX angle measurement requires selection3.");
        }
        return [`angle ${compileChimeraXAtomspec(action.selection1, referenceHints)} ${compileChimeraXAtomspec(action.selection2, referenceHints)} ${compileChimeraXAtomspec(action.selection3, referenceHints)}`];
      }
      if (action.mode === "torsion") {
        if (!action.selection3 || !action.selection4) {
          throw new Error("ChimeraX torsion measurement requires selection3 and selection4.");
        }
        return [
          `torsion ${compileChimeraXAtomspec(action.selection1, referenceHints)} ${compileChimeraXAtomspec(action.selection2, referenceHints)} ${compileChimeraXAtomspec(action.selection3, referenceHints)} ${compileChimeraXAtomspec(action.selection4, referenceHints)}`,
        ];
      }
      return [`distance ${compileChimeraXAtomspec(action.selection1, referenceHints)} ${compileChimeraXAtomspec(action.selection2, referenceHints)}`];
    case "distance":
      return [`distance ${compileChimeraXAtomspec(action.selection1, referenceHints)} ${compileChimeraXAtomspec(action.selection2, referenceHints)}`];
    case "label":
      if (action.action === "clear") {
        return [`label delete ${compileChimeraXAtomspec(action.selection, referenceHints)}`];
      }
      if (action.text) return [`label ${compileChimeraXAtomspec(action.selection, referenceHints)} text "${escapeDoubleQuotes(action.text)}"`];
      return [`label ${compileChimeraXAtomspec(action.selection, referenceHints)}`];
    case "contacts": {
      const sel1 = compileChimeraXAtomspec(action.selection1, referenceHints);
      const sel2 = action.selection2 ? compileChimeraXAtomspec(action.selection2, referenceHints) : "";
      const restrictTarget = quoteChimeraXSpecifier(sel2 || sel1);
      const distanceOnly = typeof action.distance === "number" && action.mode !== "hbonds"
        ? ` distanceOnly ${action.distance}`
        : "";
      if (action.mode === "hbonds") return [`hbonds ${quoteChimeraXSpecifier(sel1)} restrict ${restrictTarget} reveal true showDist true`];
      if (action.mode === "clashes") return [`clashes ${quoteChimeraXSpecifier(sel1)} restrict ${restrictTarget}${distanceOnly} reveal true showDist true`];
      if (action.mode === "contacts") return [`contacts ${quoteChimeraXSpecifier(sel1)} restrict ${restrictTarget}${distanceOnly} reveal true showDist true`];
      return [`alphafold contacts ${sel1}${action.distance ? ` distance ${action.distance}` : ""}`];
    }
    case "align":
      if (action.method === "align") {
        return [`align ${compileChimeraXAtomspec(action.mobile, referenceHints)} to ${compileChimeraXAtomspec(action.target, referenceHints)}`];
      }
      return [`matchmaker ${compileChimeraXAtomspec(action.mobile, referenceHints)} to ${compileChimeraXAtomspec(action.target, referenceHints)}`];
    case "fit":
      return [`fitmap ${compileChimeraXAtomspec(action.mobile, referenceHints)} inMap ${action.map}`];
    case "symmetry": {
      const target = action.selection ? compileChimeraXAtomspec(action.selection, referenceHints) : "#1";
      if (action.action === "clear") {
        return [`sym clear ${target}`];
      }
      return [`sym ${target} assembly ${action.assemblyId ?? "1"}${typeof action.copies === "boolean" ? ` copies ${action.copies ? "true" : "false"}` : ""}`];
    }
    case "layout":
      return [action.mode === "tile" ? "tile" : "tile off"];
    case "volume": {
      const selection = action.selection ? compileChimeraXAtomspec(action.selection, referenceHints) : "";
      if (action.action === "molmap") {
        const commands = [`molmap ${selection} ${action.resolution ?? 4}`.trim()];
        if (context) {
          const generatedModelId = `#${context.nextGeneratedModelId}`;
          context.nextGeneratedModelId += 1;
          if (action.mapName && action.mapName !== generatedModelId) {
            commands.push(`rename ${generatedModelId} id ${action.mapName}`);
          }
        }
        return commands;
      }
      if (action.action === "surface") {
        return [
          `volume ${action.mapName ?? "#100"} style surface level ${action.level ?? 0.02}`,
          ...(typeof action.transparency === "number" ? [`transparency ${action.mapName ?? "#100"} ${action.transparency}`] : []),
        ];
      }
      if (action.action === "mesh") {
        return [`volume ${action.mapName ?? "#100"} style mesh level ${action.level ?? 0.02}`];
      }
      return [`volume ${action.mapName ?? "#100"} style image orthoplanes xyz`];
    }
    case "graphics": {
      const commands: string[] = [];
      if (action.background) {
        commands.push(`graphics bgColor ${action.background}`);
      }
      if (typeof action.silhouettes === "boolean") {
        const extras = [
          action.silhouetteColor ? `color ${action.silhouetteColor}` : "",
          action.silhouetteWidth ? `width ${action.silhouetteWidth}` : "",
        ].filter(Boolean).join(" ");
        commands.push(`graphics silhouettes ${action.silhouettes ? "true" : "false"}${extras ? ` ${extras}` : ""}`.trim());
      }
      if (action.quality) {
        commands.push(`graphics quality ${action.quality}`);
      }
      return commands;
    }
    case "cartoon": {
      const selection = action.selection ? compileChimeraXAtomspec(action.selection, referenceHints) : "";
      const options = [
        action.width ? `width ${action.width}` : "",
        action.thickness ? `thick ${action.thickness}` : "",
        action.xsection ? `xsection ${action.xsection}` : "",
      ].filter(Boolean).join(" ");
      return [`cartoon style${selection ? ` ${selection}` : ""}${options ? ` ${options}` : ""}`.trim()];
    }
    case "preset":
      if (action.name === "cartoon_overview") {
        return [
          "hide protein atoms",
          "hide protein surfaces",
          "cartoon protein",
          "style ligand stick",
          "show ligand atoms",
        ];
      }
      if (action.name === "publication") return ["preset publication 1"];
      if (action.name === "interactive") return ["preset interactive 1"];
      if (action.name === "presentation_light") {
        return [
          "preset publication 1",
          "graphics bgColor #FBFBF7",
          "graphics silhouettes true color #3A3A3A width 1.6",
          "graphics quality 2.2",
          "cartoon style width 1.5 thick 0.3",
          "lighting soft",
        ];
      }
      if (action.name === "ligand_editorial") {
        return [
          ...compileChimeraXAction({ type: "preset", name: "presentation_light" }, context, referenceHints),
          "graphics silhouettes true color #2F2F2F width 1.75",
          "cartoon style width 1.45 thick 0.28",
          "lighting full",
        ];
      }
      if (action.name === "assembly_editorial") {
        return [
          ...compileChimeraXAction({ type: "preset", name: "presentation_light" }, context, referenceHints),
          "graphics silhouettes true color #282828 width 2",
          "cartoon style width 1.72 thick 0.34",
          "lighting full",
        ];
      }
      if (action.name === "cryo_atomic_hero") {
        return [
          ...compileChimeraXAction({ type: "preset", name: "presentation_light" }, context, referenceHints),
          "graphics silhouettes true color #5A5A5A width 1.35",
          "graphics quality 2.4",
          "lighting simple",
        ];
      }
      if (action.name === "comparison_hero") {
        return [
          ...compileChimeraXAction({ type: "preset", name: "assembly_editorial" }, context, referenceHints),
          "graphics silhouettes true color #222222 width 2.1",
          "lighting full",
        ];
      }
      if (action.name === "map_hero") {
        return [
          ...compileChimeraXAction({ type: "preset", name: "cryo_atomic_hero" }, context, referenceHints),
          "graphics silhouettes true color #5A5A5A width 1.4",
          "lighting simple",
        ];
      }
      if (action.name === "confidence_hero") {
        return [
          ...compileChimeraXAction({ type: "preset", name: "presentation_light" }, context, referenceHints),
          "lighting soft",
          "graphics silhouettes true color #333333 width 1.5",
        ];
      }
      if (action.name === "soft-light") return ["lighting soft"];
      if (action.name === "outline" || action.name === "silhouette") return ["graphics silhouettes true"];
      return ["lighting full"];
    case "view":
      if (action.action === "save") {
        if (!action.name) {
          throw new Error("ChimeraX view save requires a name.");
        }
        return [`view name ${action.name}`];
      }
      if (action.action === "recall") {
        if (!action.name) {
          throw new Error("ChimeraX view recall requires a name.");
        }
        return [`view ${action.name}${action.frames ? ` ${action.frames}` : ""}`];
      }
      if (action.action === "delete") {
        return [`view delete ${action.name ?? "all"}`];
      }
      return ["view orient", "view initial"];
    case "lighting":
      return [`lighting ${action.mode}`];
    case "export": {
      const exportPath = resolveExportPath(action.export.path, action.export.format, "chimerax");
      if (action.export.format === "png") {
        return [`save ${quoteCommandValue(exportPath)} width ${action.export.width ?? 3200} height ${action.export.height ?? 2100}`];
      }
      return [`save ${quoteCommandValue(exportPath)}`];
    }
    case "raw_command":
      if (!allowExpertRawCommands) {
        throw new Error("ChimeraX raw_command is disabled. Enable advanced expert commands before using raw command passthrough.");
      }
      return [action.command];
  }

  throw new Error(`Unsupported ChimeraX action: ${JSON.stringify(action)}`);
}

function escapeDoubleQuotes(value: string): string {
  return value.replaceAll("\"", "\\\"");
}

function quoteChimeraXSpecifier(value: string): string {
  return /[\s&|:<>()]/.test(value) ? `"${value.replaceAll("\"", "\\\"")}"` : value;
}

function resolveChimeraXTransformTarget(
  selection: unknown,
  referenceHints?: SelectorReferenceMap,
): { keyword: "models" | "atoms" | null; spec: string; centerSpec?: string } {
  if (!selection) {
    return { keyword: null, spec: "" };
  }

  if (typeof selection === "string") {
    const trimmed = selection.trim();
    if (isSimpleChimeraXModelSpec(trimmed)) {
      return {
        keyword: "models",
        spec: quoteChimeraXSpecifier(trimmed),
        centerSpec: quoteChimeraXSpecifier(trimmed),
      };
    }
    return {
      keyword: "atoms",
      spec: quoteChimeraXSpecifier(trimmed),
      centerSpec: quoteChimeraXSpecifier(trimmed),
    };
  }

  if (typeof selection === "object" && !Array.isArray(selection)) {
    const candidate = resolveChimeraXTransformReference(selection as Record<string, unknown>, referenceHints);
    const modelName = typeof candidate.model === "string"
      ? candidate.model
      : typeof candidate.object === "string"
      ? candidate.object
      : "";
    const extraKeys = ["chain", "chains", "residue", "residues", "residueName", "residueNames", "atom", "ligand", "entity", "around", "withinAngstroms", "byResidue"];
    const hasScopedSelection = extraKeys.some((key) => candidate[key] !== undefined);
    if (modelName && !hasScopedSelection) {
      return {
        keyword: "models",
        spec: quoteChimeraXSpecifier(modelName),
        centerSpec: quoteChimeraXSpecifier(modelName),
      };
    }
  }

  const atomspec = quoteChimeraXSpecifier(compileChimeraXAtomspec(selection as Parameters<typeof compileChimeraXAtomspec>[0], referenceHints));
  return {
    keyword: "atoms",
    spec: atomspec,
    centerSpec: atomspec,
  };
}

function buildChimeraXTransformCommands(
  action: Extract<ChimeraXAction, { type: "transform" }>,
  referenceHints?: SelectorReferenceMap,
): string[] {
  const target = resolveChimeraXTransformTarget(action.selection, referenceHints);
  const axis = action.axis ?? (action.mode === "rotate" ? "y" : "x");
  const amount = action.amount ?? (action.mode === "rotate" ? 25 : 10);
  const frames = action.frames ? ` ${action.frames}` : "";
  const coordinateSystem = action.coordinateSystem
    ? ` coordinateSystem ${quoteChimeraXSpecifier(compileChimeraXAtomspec(action.coordinateSystem, referenceHints))}`
    : "";

  if (action.mode === "rotate") {
    const centerSpec = action.center
      ? quoteChimeraXSpecifier(compileChimeraXAtomspec(action.center, referenceHints))
      : target.centerSpec;
    const center = centerSpec ? ` center ${centerSpec}` : "";
    return [
      target.keyword
        ? `turn ${axis} ${amount}${frames}${center}${coordinateSystem} ${target.keyword} ${target.spec}`
        : `turn ${axis} ${amount}${frames}${center}${coordinateSystem}`,
    ];
  }

  return [
    target.keyword
      ? `move ${axis} ${amount}${frames}${coordinateSystem} ${target.keyword} ${target.spec}`
      : `move ${axis} ${amount}${frames}${coordinateSystem}`,
  ];
}

function isSimpleChimeraXModelSpec(value: string): boolean {
  return /^#[!0-9.]+$/.test(value);
}

function resolveChimeraXTransformReference(
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

function createSceneAnnotation(semanticRole: string | undefined, aliases: string[] | undefined): SceneAnnotation | null {
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

function inferChimeraXOpenedName(action: Extract<ChimeraXAction, { type: "open" }>): string {
  if (action.path) {
    return path.basename(action.path);
  }
  return action.id ?? "structure";
}

function inferChimeraXModelType(action: Extract<ChimeraXAction, { type: "open" }>): string {
  const name = inferChimeraXOpenedName(action).toLowerCase();
  return /\.(map|mrc|ccp4|dx)$/i.test(name) ? "Volume" : "AtomicStructure";
}

function buildChimeraXCameraFrame(selection: string, frame: "hero" | "pocket" | "comparison" | "map"): string[] {
  const orient = selection ? `view ${selection} orient` : "view orient";

  if (frame === "pocket") {
    return [orient, "turn y 18", "turn x -10", "zoom 1.35", "clip front 10"];
  }

  if (frame === "comparison") {
    return [orient, "turn y 10", "turn x 5", "zoom 1.2"];
  }

  if (frame === "map") {
    return [orient, "turn y 20", "turn x 12", "zoom 1.25", "clip front 14"];
  }

  return [orient, "turn y 14", "turn x 8", "zoom 1.15"];
}

function isHighLatencyChimeraXCommand(command: string): boolean {
  return /\b(surface|hbonds|clashes|contacts|alphafold contacts|volume|fitmap|save)\b/i.test(command);
}

export function createChimeraXCommandBatches(commands: string[]): ChimeraXCommandBatch[] {
  const batches: ChimeraXCommandBatch[] = [];
  let pending: string[] = [];

  const flushPending = () => {
    if (!pending.length) {
      return;
    }
    batches.push({ commands: pending });
    pending = [];
  };

  for (const command of commands) {
    if (isBatchBarrierCommand(command)) {
      flushPending();
      batches.push({ commands: [command] });
      continue;
    }

    pending.push(command);
  }

  flushPending();
  return batches;
}

function isBatchBarrierCommand(command: string): boolean {
  return /\b(open|close|surface|hbonds|clashes|contacts|alphafold contacts|matchmaker|align|volume|molmap|fitmap|save|distance|angle|torsion|rmsd)\b/i.test(command);
}

function extractTopLevelModelId(modelId: string): number | null {
  const match = modelId.match(/^#(\d+)/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function summarizeChimeraXLogs(logMessages: Record<string, string[]> | undefined): string[] {
  const lines = flattenChimeraXLogs(logMessages)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(opened|window size|preset\s)/i.test(line))
    .map((line) => (line.length > 180 ? `${line.slice(0, 177)}...` : line));

  if (!lines.length) {
    return [];
  }

  const unique = [...new Set(lines)];
  const visible = unique.slice(0, 4);
  if (unique.length > visible.length) {
    visible.push(`ChimeraX emitted ${unique.length - visible.length} additional log lines.`);
  }
  return visible;
}

function extractChimeraXMetrics(commandResponses: Array<{ commands: string[]; response: ChimeraXJsonResponse }>): ActionResult["metrics"] {
  const metrics: ActionResult["metrics"] = [];

  for (const entry of commandResponses) {
    if (entry.commands.length !== 1) {
      continue;
    }

    const command = entry.commands[0] ?? "";
    const pythonValue = entry.response["python values"]?.[0];
    const logLines = flattenChimeraXLogs(entry.response["log messages"]);

    if (/^distance\s+/i.test(command) && typeof pythonValue === "number") {
      metrics.push({
        kind: "distance",
        label: "ChimeraX distance",
        value: roundMetric(pythonValue),
        unit: "A",
        source: "python_value",
      });
      continue;
    }

    if (/^angle\s+/i.test(command) && typeof pythonValue === "number") {
      metrics.push({
        kind: "angle",
        label: "ChimeraX angle",
        value: roundMetric(pythonValue),
        unit: "deg",
        source: "python_value",
      });
      continue;
    }

    if (/^torsion\s+/i.test(command)) {
      const torsionValue = extractFirstNumber(logLines, /Torsion angle .*? is\s+(-?\d+(?:\.\d+)?)/i);
      if (torsionValue != null) {
        metrics.push({
          kind: "torsion",
          label: "ChimeraX torsion",
          value: roundMetric(torsionValue),
          unit: "deg",
          source: "log",
        });
      }
      continue;
    }

    if (/^matchmaker\s+/i.test(command)) {
      const score = extractFirstNumber(logLines, /sequence alignment score\s*=\s*(-?\d+(?:\.\d+)?)/i);
      if (score != null) {
        metrics.push({
          kind: "alignment",
          label: "Matchmaker score",
          value: roundMetric(score),
          source: "log",
        });
      }
      continue;
    }

    if (/^fitmap\s+/i.test(command)) {
      const correlation = extractFirstNumber(logLines, /\bcorrelation(?:\s+about\s+\w+)?\s*=\s*(-?\d+(?:\.\d+)?)/i);
      const overlap = extractFirstNumber(logLines, /\boverlap\s*=\s*(-?\d+(?:\.\d+)?)/i);
      const averageMapValue = extractFirstNumber(logLines, /\baverage map value\s*=\s*(-?\d+(?:\.\d+)?)/i);
      const shifted = extractFirstNumber(logLines, /\bshifted from previous position\s*=\s*(-?\d+(?:\.\d+)?)/i);
      const rotated = extractFirstNumber(logLines, /\brotated from previous position\s*=\s*(-?\d+(?:\.\d+)?)/i);
      const atomsOutsideContour = extractFirstNumber(logLines, /\batoms outside contour\s*=\s*(-?\d+(?:\.\d+)?)/i);
      if (correlation != null) {
        metrics.push({
          kind: "fit",
          label: "Fit correlation",
          value: roundMetric(correlation),
          source: "log",
        });
      } else if (overlap != null) {
        metrics.push({
          kind: "fit",
          label: "Fit overlap",
          value: roundMetric(overlap),
          source: "log",
        });
      } else if (averageMapValue != null) {
        metrics.push({
          kind: "fit",
          label: "Fit average map value",
          value: roundMetric(averageMapValue),
          source: "log",
          details: {
            shiftedFromPrevious: shifted != null ? roundMetric(shifted) : undefined,
            rotatedFromPreviousDegrees: rotated != null ? roundMetric(rotated) : undefined,
            atomsOutsideContour: atomsOutsideContour != null ? roundMetric(atomsOutsideContour) : undefined,
          },
        });
      }
    }
  }

  return metrics;
}

function extractFirstNumber(lines: string[], pattern: RegExp): number | null {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function parseChimeraXModelLines(lines: string[]): Array<{ id: string; type: string; name: string }> {
  return lines
    .filter((line) => /^model id\s+#/i.test(line))
    .map((line) => {
      const match = line.match(/^model id\s+(#[^\s]+)\s+type\s+([^\s]+)\s+name\s+(.+)$/i);
      return {
        id: match?.[1] ?? line,
        type: match?.[2] ?? "unknown",
        name: match?.[3] ?? line,
      };
    });
}

export function parseChimeraXNamedViews(lines: string[]): string[] {
  const viewNames = new Set<string>();
  const stitched = lines.join("\n").replace(/-\n/g, "-").replace(/\n/g, " ");
  for (const match of stitched.matchAll(/\[([A-Za-z0-9._-]+)\]\(cxcmd:view\s+[A-Za-z0-9._-]+\)/g)) {
    viewNames.add(match[1]);
  }
  for (const line of lines) {
    const namedViews = line.match(/^Named views:\s+(.+)$/i);
    if (namedViews) {
      for (const match of namedViews[1].matchAll(/\[([A-Za-z0-9._-]+)\]\(/g)) {
        viewNames.add(match[1]);
      }
      continue;
    }

    const explicit = line.match(/^([A-Za-z0-9._-]+)\s+\(/);
    if (explicit && !explicit[1].startsWith("#")) {
      viewNames.add(explicit[1]);
      continue;
    }

    const named = line.match(/\bview(?:\s+name)?\s+([A-Za-z0-9._-]+)/i);
    if (named) {
      viewNames.add(named[1]);
    }
  }
  return [...viewNames];
}

export function parseChimeraXChainLines(lines: string[]): Array<{ chain: string; summary: string }> {
  return lines
    .filter((line) => /^chain id\s+(?:#[^/]+)?\/[A-Za-z0-9]/i.test(line) || /^(?:#[^/]+)?\/[A-Za-z0-9]/.test(line))
    .map((line) => {
      const match = line.match(/^chain id\s+((?:#[^/]+)?\/[A-Za-z0-9._-]+)\s+(.*)$/i)
        ?? line.match(/^((?:#[^/]+)?\/[A-Za-z0-9._-]+)\s+(.*)$/);
      return {
        chain: match?.[1] ?? line,
        summary: match?.[2] ?? line,
      };
    });
}

function parseChimeraXLighting(lines: string[]): string[] {
  return lines.filter((line) => /light|shadow|ambient|depth cue/i.test(line));
}

export function parseChimeraXWindowSize(lines: string[]): { width: number; height: number } | undefined {
  for (const line of lines) {
    const match = line.match(/(\d+)\s*x\s*(\d+)/i) ?? line.match(/window size\s+(\d+)\s+(\d+)/i);
    if (match) {
      return {
        width: Number(match[1]),
        height: Number(match[2]),
      };
    }
  }
  return undefined;
}

function flattenChimeraXLogs(logMessages: Record<string, string[]> | undefined): string[] {
  return Object.values(logMessages ?? {})
    .flat()
    .flatMap((line) => line.split(/\r?\n/g))
    .map((line) => line.trim())
    .filter(Boolean);
}

function validateChimeraXMeasurementSelectors(
  actions: ChimeraXAction[],
  referenceHints: SelectorReferenceMap,
  chainsByModel: Record<string, string[]>,
): void {
  for (const action of actions) {
    switch (action.type) {
      case "measure":
      case "distance":
        assertUnambiguousSingleAtomSelector(action.selection1, referenceHints, chainsByModel);
        assertUnambiguousSingleAtomSelector(action.selection2, referenceHints, chainsByModel);
        if ("selection3" in action) {
          assertUnambiguousSingleAtomSelector(action.selection3, referenceHints, chainsByModel);
        }
        if ("selection4" in action) {
          assertUnambiguousSingleAtomSelector(action.selection4, referenceHints, chainsByModel);
        }
        break;
      default:
        break;
    }
  }
}

function assertUnambiguousSingleAtomSelector(
  selection: unknown,
  referenceHints: SelectorReferenceMap,
  chainsByModel: Record<string, string[]>,
): void {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return;
  }

  const record = selection as Record<string, unknown>;
  if (typeof record.atom !== "string" || (!record.residue && !record.residues)) {
    return;
  }
  if (record.chain || record.chains || record.around) {
    return;
  }

  const resolvedHint = resolveChimeraXSelectorHint(record, referenceHints);
  if (resolvedHint && typeof resolvedHint === "object" && !Array.isArray(resolvedHint)) {
    const resolvedRecord = resolvedHint as Record<string, unknown>;
    if (resolvedRecord.chain || resolvedRecord.chains) {
      return;
    }
  }

  const resolvedModel = resolveChimeraXSingleAtomModel(record, resolvedHint);
  if (!resolvedModel) {
    return;
  }

  const chains = chainsByModel[resolvedModel] ?? [];
  if (chains.length <= 1) {
    return;
  }

  throw new Error(
    `Ambiguous single-atom selector for ${resolvedModel}: the model has multiple chains (${chains.join(", ")}). Use a chain-aware selector or a chain-specific semantic handle like scaffoldChainA, designChainA, binderChainA, or receptorChainA.`,
  );
}

function resolveChimeraXSingleAtomModel(
  selection: Record<string, unknown>,
  resolvedHint?: unknown,
): string | null {
  if (typeof selection.model === "string" && selection.model.trim()) {
    return selection.model;
  }

  if (!resolvedHint || typeof resolvedHint !== "object" || Array.isArray(resolvedHint)) {
    return null;
  }

  const record = resolvedHint as Record<string, unknown>;
  return typeof record.model === "string" && record.model.trim() ? record.model : null;
}

function resolveChimeraXSelectorHint(selection: Record<string, unknown>, referenceHints: SelectorReferenceMap): unknown {
  if (typeof selection.reference !== "string" || !selection.reference.trim()) {
    return null;
  }

  return referenceHints[selection.reference]?.selector ?? null;
}

function groupChimeraXChains(chains: Array<{ chain: string }>): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const entry of chains) {
    const match = entry.chain.match(/^(#[^/]+)\/(.+)$/);
    if (!match) {
      continue;
    }

    const modelId = match[1];
    const chainId = match[2];
    if (!result[modelId]) {
      result[modelId] = [];
    }
    if (!result[modelId].includes(chainId)) {
      result[modelId].push(chainId);
    }
  }

  return result;
}

function resolveExportPath(candidate: string | undefined, format: string, target: string): string {
  if (candidate) {
    return ensureAllowedExportPath(candidate);
  }
  return defaultExportPath(target, format);
}

async function hasExistingChimeraXProcess(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = spawn("pgrep", ["-f", "ChimeraX.*Contents/MacOS/ChimeraX"], {
      stdio: "ignore",
    });
    probe.on("error", () => resolve(false));
    probe.on("exit", (code) => resolve(code === 0));
  });
}

async function resolveChimeraXBinary(): Promise<string> {
  const explicit = "/Applications/ChimeraX.app/Contents/MacOS/ChimeraX";
  if (await fileExists(explicit)) {
    return explicit;
  }

  const applicationsDir = "/Applications";
  const entries = await fs.readdir(applicationsDir, { withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter((entry) => entry.isDirectory() && /^ChimeraX(?:-[^/]+)?\.app$/.test(entry.name))
    .map((entry) => path.join(applicationsDir, entry.name, "Contents", "MacOS", "ChimeraX"))
    .sort()
    .reverse();

  for (const candidate of matches) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find a ChimeraX app bundle under /Applications.");
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function materializeChimeraXActions(actions: ChimeraXAction[]): ChimeraXAction[] {
  return actions.map((action) => {
    if (action.type !== "export" || action.export.path) {
      return action;
    }

    return {
      ...action,
      export: {
        ...action.export,
        path: resolveExportPath(undefined, action.export.format, "chimerax"),
      },
    };
  });
}
