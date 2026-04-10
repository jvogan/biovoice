import { spawn } from "node:child_process";
import {
  buildLaunchGateScenario,
  smokeLaunchPage,
  parseVerifyLaunchArgs,
  verifyLaunchUsage,
} from "./lib/launch-gate.js";
import { runInteractiveBrowserSmoke } from "./lib/browser-launch-smoke.js";
import { resolveFromRoot, type TargetKind } from "../packages/runtime-and-adapters/src/index.js";

interface ManagedStartResult {
  ok: boolean;
  target: TargetKind;
  url: string;
  recommendedUrl?: string;
  pid?: number;
  serverMode?: string;
  targetEndpoint?: string;
  workflowStage?: Record<string, unknown>;
}

interface HealthPayload {
  ok: boolean;
  appId: string;
  projectRoot: string;
  serverMode: string;
  runtime?: {
    targets?: Partial<Record<TargetKind, {
      ready?: boolean;
      endpoint?: string;
      reachable?: boolean;
      commandReady?: boolean;
      busy?: boolean;
      warmupState?: "offline" | "warming" | "ready";
      lastRpcError?: string;
      validatedAt?: string;
    }>>;
  };
}

async function main(): Promise<void> {
  const options = parseVerifyLaunchArgs(process.argv.slice(2));
  if (options.helpRequested) {
    console.log(verifyLaunchUsage());
    return;
  }

  const summary: Record<string, unknown> = {
    ok: true,
    ranBroadCheck: options.runBroadCheck,
    browserSmoke: options.runBrowserSmoke,
    keptManagedRuntime: options.keepRunning ? options.targets[options.targets.length - 1] : null,
    targets: [] as unknown[],
  };

  if (options.runBroadCheck) {
    console.log("[verify-launch] Running npm run check");
    await runCommand(npmCommand(), ["run", "check"], {
      cwd: resolveFromRoot(),
      stdio: "inherit",
    });
    console.log("[verify-launch] Running npm run verify:examples");
    await runCommand(npmCommand(), ["run", "verify:examples"], {
      cwd: resolveFromRoot(),
      stdio: "inherit",
    });
  }

  const targetSummaries: Array<Record<string, unknown>> = [];
  for (const [index, target] of options.targets.entries()) {
    const keepRunning = options.keepRunning && index === options.targets.length - 1;
    targetSummaries.push(await verifyManagedTarget(target, {
      runBrowserSmoke: options.runBrowserSmoke,
      skipBuildOnStart: options.runBroadCheck,
      keepRunning,
    }));
  }

  summary.targets = targetSummaries;
  console.log(JSON.stringify(summary, null, 2));
}

async function verifyManagedTarget(
  target: TargetKind,
  options: {
    runBrowserSmoke: boolean;
    skipBuildOnStart: boolean;
    keepRunning: boolean;
  },
): Promise<Record<string, unknown>> {
  console.log(`[verify-launch] Starting managed ${target}`);
  const startArgs = [
    "start",
    target,
    "--offline",
    "--clean-target",
    ...(options.skipBuildOnStart ? ["--skip-build"] : []),
  ];

  let startResult: ManagedStartResult | null = null;
  let completed = false;
  let primaryFailure: unknown;
  try {
    try {
      startResult = await runJsonTsScript<ManagedStartResult>("scripts/agent-runtime.ts", startArgs);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Managed start for ${target} failed. Inspect ${getLaunchLogPath(target)}.\n${details}`);
    }
    if (!startResult.ok) {
      throw new Error(`Managed start for ${target} did not return ok=true.`);
    }

    const routeChecks = await runManagedRouteChecks(target, startResult);
    const smokeCheck = await runTargetSmoke(target);
    const liveRecipeChecks = await runManagedRecipeMatrix(target, startResult, {
      includeSameSessionRepeat: target === "pymol",
    });
    const launchPageSmoke = options.runBrowserSmoke
      ? await smokeLaunchPage(startResult.url)
      : undefined;
    const browserSmoke = options.runBrowserSmoke
      ? await runInteractiveBrowserSmoke(startResult.url, target)
      : undefined;
    const postBrowserRecipeCheck = options.runBrowserSmoke && target === "pymol"
      ? await runManagedRecipeCheck(target, startResult, "post-browser-repeat")
      : undefined;
    startResult = await restartManagedTarget(target, options.skipBuildOnStart);
    const restartRouteChecks = await runManagedRouteChecks(target, startResult);
    const restartLiveRecipeCheck = await runManagedRecipeCheck(target, startResult, "post-restart");

    completed = true;
    return {
      target,
      keptRunning: options.keepRunning,
      start: {
        url: startResult.url,
        recommendedUrl: startResult.recommendedUrl ?? null,
        pid: startResult.pid ?? null,
        serverMode: startResult.serverMode ?? null,
        targetEndpoint: startResult.targetEndpoint ?? null,
      },
      routeChecks,
      smokeCheck,
      liveRecipeChecks,
      launchPageSmoke,
      browserSmoke,
      postBrowserRecipeCheck,
      restart: {
        url: startResult.url,
        recommendedUrl: startResult.recommendedUrl ?? null,
        pid: startResult.pid ?? null,
        serverMode: startResult.serverMode ?? null,
        targetEndpoint: startResult.targetEndpoint ?? null,
      },
      restartRouteChecks,
      restartLiveRecipeCheck,
    };
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    if (startResult && (!options.keepRunning || !completed)) {
      console.log(`[verify-launch] Stopping managed ${target}`);
      try {
        await runJsonTsScript("scripts/agent-runtime.ts", ["stop"]);
      } catch (error) {
        const message = `Failed to stop managed ${target}: ${error instanceof Error ? error.message : String(error)}`;
        if (primaryFailure) {
          console.error(`[verify-launch] ${message}`);
        } else {
          throw new Error(message);
        }
      }
    }
  }
}

async function runManagedRouteChecks(target: TargetKind, startResult: ManagedStartResult): Promise<Record<string, unknown>> {
  const scenario = buildLaunchGateScenario(target);
  const baseUrl = new URL(startResult.url);

  console.log(`[verify-launch] Checking managed routes for ${target}`);
  const health = await requestJson<HealthPayload>(new URL("/api/health", baseUrl));
  assert(health.ok, `${target} health route did not report ok=true.`);
  assert(health.appId === "biovoice", `${target} health route returned unexpected app id ${health.appId}.`);
  assert(
    health.projectRoot === resolveFromRoot(),
    `${target} health route reported project root ${health.projectRoot}, expected ${resolveFromRoot()}.`,
  );

  const targetHealth = health.runtime?.targets?.[target];
  assert(targetHealth?.ready === true, `${target} target was not ready in /api/health.`);
  assert(targetHealth?.reachable !== false, `${target} target was not reachable in /api/health.`);
  assert(targetHealth?.commandReady !== false, `${target} target was not command-ready in /api/health.`);

  const examples = await requestJson<unknown[]>(new URL("/api/examples", baseUrl));
  assert(Array.isArray(examples) && examples.length > 0, "Examples route returned an empty payload.");

  const workflows = await requestJson<unknown[]>(new URL("/api/workflows", baseUrl));
  assert(Array.isArray(workflows) && workflows.length > 0, "Workflows route returned an empty payload.");

  const recipeResult = await requestJson<Record<string, unknown>>(
    new URL(`/api/recipes/${scenario.recipeId}/run`, baseUrl),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        target,
        dryRun: true,
      }),
    },
  );
  const stepResults = Array.isArray(recipeResult.stepResults) ? recipeResult.stepResults : [];
  assert(stepResults.length > 0, `${target} recipe route did not return any step results.`);

  const workflowResult = await requestJson<Record<string, unknown>>(
    new URL("/api/workflows/run", baseUrl),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(scenario.workflowRequest),
    },
  );
  const workflowCommands = Array.isArray(workflowResult.commandsExecuted) ? workflowResult.commandsExecuted : [];
  assert(workflowCommands.length > 0, `${target} workflow route did not emit any commands.`);

  const actionResult = await requestJson<Record<string, unknown>>(
    new URL("/api/actions", baseUrl),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(scenario.actionEnvelope),
    },
  );
  const actionCommands = Array.isArray(actionResult.commandsExecuted) ? actionResult.commandsExecuted : [];
  assert(actionCommands.length > 0, `${target} action route did not emit any commands.`);

  const stateResult = await requestJson<Record<string, unknown>>(
    new URL(`/api/targets/${target}/state`, baseUrl),
  );
  const state = (stateResult.state ?? {}) as Record<string, unknown>;
  assertTargetStateMarker(target, state, scenario.expectedStateMarker);

  const captureResult = await requestJson<Record<string, unknown>>(
    new URL("/api/capture", baseUrl),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(scenario.captureRequest),
    },
  );
  const artifacts = Array.isArray(captureResult.artifacts) ? captureResult.artifacts as Array<Record<string, unknown>> : [];
  const imageArtifact = artifacts.find((artifact) => artifact.kind === "image" && typeof artifact.path === "string");
  assert(imageArtifact?.path, `${target} capture route did not return an image artifact.`);

  const artifactPath = String(imageArtifact.path);
  const artifactResponse = await fetch(new URL(`/api/artifacts?path=${encodeURIComponent(artifactPath)}`, baseUrl), {
    signal: AbortSignal.timeout(20_000),
  });
  assert(artifactResponse.ok, `${target} artifact route failed for ${artifactPath}.`);
  const artifactBytes = (await artifactResponse.arrayBuffer()).byteLength;
  assert(artifactBytes > 0, `${target} artifact route returned an empty payload.`);

  return {
    health: {
      url: baseUrl.toString(),
      serverMode: health.serverMode,
      targetEndpoint: targetHealth?.endpoint ?? null,
      reachable: targetHealth?.reachable ?? null,
      commandReady: targetHealth?.commandReady ?? null,
      busy: targetHealth?.busy ?? null,
      warmupState: targetHealth?.warmupState ?? null,
      validatedAt: targetHealth?.validatedAt ?? null,
    },
    examplesCount: examples.length,
    workflowsCount: workflows.length,
    recipeStepCount: stepResults.length,
    workflowCommandCount: workflowCommands.length,
    actionCommandCount: actionCommands.length,
    stateMarker: scenario.expectedStateMarker,
    captureArtifactPath: artifactPath,
    captureArtifactBytes: artifactBytes,
  };
}

async function runTargetSmoke(target: TargetKind): Promise<Record<string, unknown>> {
  const script = target === "pymol" ? "smoke:pymol" : "smoke:chimerax";
  console.log(`[verify-launch] Running npm run ${script}`);
  const result = await runCommand(npmCommand(), ["run", script], {
    cwd: resolveFromRoot(),
    env: process.env,
  });
  return {
    script,
    outputLines: result.stdout.split("\n").filter(Boolean).slice(-20),
  };
}

async function runManagedRecipeMatrix(
  target: TargetKind,
  startResult: ManagedStartResult,
  options: {
    includeSameSessionRepeat: boolean;
  },
): Promise<Record<string, unknown>> {
  const firstRun = await runManagedRecipeCheck(target, startResult, "fresh-start");
  const secondRun = options.includeSameSessionRepeat
    ? await runManagedRecipeCheck(target, startResult, "same-session-repeat")
    : undefined;

  return {
    firstRun,
    secondRun,
  };
}

async function runManagedRecipeCheck(
  target: TargetKind,
  startResult: ManagedStartResult,
  label: string,
): Promise<Record<string, unknown>> {
  const recipeId = buildLaunchGateScenario(target).recipeId;
  const baseUrl = new URL(startResult.url);
  console.log(`[verify-launch] Running ${label} live recipe ${recipeId} for ${target}`);

  const recipeResult = await requestJson<Record<string, unknown>>(
    new URL(`/api/recipes/${recipeId}/run`, baseUrl),
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        target,
      }),
    },
    target === "pymol" ? 420_000 : 120_000,
  );

  const stepResults = Array.isArray(recipeResult.stepResults)
    ? recipeResult.stepResults as Array<Record<string, unknown>>
    : [];
  assert(stepResults.length > 0, `${target} live recipe ${recipeId} did not return any step results.`);

  const stepArtifacts = stepResults.flatMap((stepResult) => {
    const result = stepResult.result as Record<string, unknown> | undefined;
    return Array.isArray(result?.artifacts) ? result.artifacts as Array<Record<string, unknown>> : [];
  });
  const imageArtifact = stepArtifacts.find((artifact) => artifact.kind === "image" && typeof artifact.path === "string");
  assert(imageArtifact?.path, `${target} live recipe ${recipeId} did not return an image artifact.`);

  const warningCounts = stepResults.map((stepResult) => {
    const result = stepResult.result as Record<string, unknown> | undefined;
    return Array.isArray(result?.warnings) ? result.warnings.length : 0;
  });

  return {
    label,
    recipeId,
    stepCount: stepResults.length,
    warningCounts,
    imageArtifactPath: String(imageArtifact.path),
    imageArtifactLabel: typeof imageArtifact.label === "string" ? imageArtifact.label : null,
  };
}

async function restartManagedTarget(target: TargetKind, skipBuildOnStart: boolean): Promise<ManagedStartResult> {
  console.log(`[verify-launch] Restarting managed ${target}`);
  try {
    return await runJsonTsScript<ManagedStartResult>("scripts/agent-runtime.ts", [
      "restart",
      target,
      "--offline",
      "--clean-target",
      ...(skipBuildOnStart ? ["--skip-build"] : []),
    ]);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Managed restart for ${target} failed. Inspect ${getLaunchLogPath(target)}.\n${details}`);
  }
}

async function requestJson<T>(url: URL, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status}): ${String((payload as { error?: string }).error ?? "unknown error")}`);
  }
  return payload as T;
}

async function runJsonTsScript<T = Record<string, unknown>>(relativeScriptPath: string, args: string[]): Promise<T> {
  const scriptPath = resolveFromRoot(relativeScriptPath);
  const { stdout } = await runCommand(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolveFromRoot(),
    env: process.env,
  });
  const jsonPayload = extractTrailingJsonPayload(stdout);
  try {
    return JSON.parse(jsonPayload) as T;
  } catch (error) {
    throw new Error(`Expected JSON output from ${relativeScriptPath}: ${error instanceof Error ? error.message : String(error)}\n${stdout}`);
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit";
  },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? "pipe",
    });

    if (options.stdio === "inherit") {
      child.on("exit", (code) => {
        if (code === 0) {
          resolve({ stdout: "", stderr: "" });
          return;
        }
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.`));
      });
      child.on("error", reject);
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.\n${stderr || stdout}`));
    });
    child.on("error", reject);
  });
}

function assertTargetStateMarker(target: TargetKind, state: Record<string, unknown>, marker: string): void {
  if (target === "pymol") {
    const objectNames = Array.isArray(state.objectNames) ? state.objectNames as unknown[] : [];
    const hasMarker = objectNames.some((value) => typeof value === "string" && value === marker);
    assert(hasMarker, `PyMOL target state did not include ${marker}.`);
    return;
  }

  const models = Array.isArray(state.models) ? state.models as Array<Record<string, unknown>> : [];
  const hasMarker = models.some((model) => typeof model.name === "string" && model.name.toLowerCase().includes(marker.toLowerCase()));
  assert(hasMarker, `ChimeraX target state did not include a model matching ${marker}.`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function extractTrailingJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Script did not emit any stdout.");
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectIndex = trimmed.lastIndexOf("\n{");
  const arrayIndex = trimmed.lastIndexOf("\n[");
  const startIndex = Math.max(objectIndex, arrayIndex);
  if (startIndex >= 0) {
    return trimmed.slice(startIndex + 1).trim();
  }

  const fallbackObjectIndex = trimmed.lastIndexOf("{");
  const fallbackArrayIndex = trimmed.lastIndexOf("[");
  const fallbackStartIndex = Math.max(fallbackObjectIndex, fallbackArrayIndex);
  if (fallbackStartIndex >= 0) {
    return trimmed.slice(fallbackStartIndex).trim();
  }

  throw new Error("Could not find a trailing JSON payload in script output.");
}

function getLaunchLogPath(target: TargetKind): string {
  return resolveFromRoot(".runtime", "agent-runtime", `start-${target}.log`);
}

const jsonHeaders = {
  "Content-Type": "application/json",
};

void main();
