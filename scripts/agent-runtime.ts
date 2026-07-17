import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import {
  ChimeraXAdapter,
  PymolAdapter,
  buildScientificWorkflowUrl,
  cleanupRuntimeArtifacts,
  getRuntimeCleanupOptions,
  resolveScientificWorkflowRecipeId,
  resolvePublicBaseUrlOrigin,
  resolveFromRoot,
  parseVariantMutationArgument,
  scientificWorkflowRequestSchema,
  scientificWorkflowKinds,
  type ScientificLaunchInputs,
  type ScientificWorkflowKind,
  type TargetKind,
} from "../packages/runtime-and-adapters/src/index.js";
import {
  launchFloatingCompanion,
  stopFloatingCompanion,
  type FloatingCompanionState,
} from "./lib/floating-companion.js";

dotenv.config({ path: resolveFromRoot(".env") });

type ServerMode = "built-static" | "dev-api" | "api-only";

type AgentState = {
  pid: number;
  instanceId?: string;
  target: TargetKind;
  workflowId?: ScientificWorkflowKind;
  scientificInputs?: ScientificLaunchInputs;
  targetEndpoint?: string;
  targetPort?: number;
  targetPid?: number;
  targetValidatedAt?: string;
  url: string;
  logPath: string;
  startedAt: string;
  serverMode: ServerMode;
  overlay?: FloatingCompanionState;
};

type TargetRuntimeHandle = {
  endpoint: string;
  port?: number;
  pid?: number;
  validatedAt?: string;
};

type StartOptions = {
  forceTargetRestart: boolean;
  skipBuild: boolean;
  skipPreflight: boolean;
  offline: boolean;
  reuseDev: boolean;
  cleanTarget: boolean;
  workflowId?: ScientificWorkflowKind;
  scientificInputs: ScientificLaunchInputs;
  recipeId?: string;
  audience: boolean;
  autoconnect: boolean;
  openMic: boolean;
  advanced: boolean;
  overlay: boolean;
};

type AppHealth = {
  ok: boolean;
  appId: string;
  instanceId: string;
  pid: number;
  projectRoot: string;
  serverMode: ServerMode;
  startedAt: string;
  publicBaseUrl: string;
  realtimeReady: boolean;
  usageReady: boolean;
  runtime: {
    targets: {
      pymol: {
        ready: boolean;
        endpoint?: string;
        reachable?: boolean;
        commandReady?: boolean;
        busy?: boolean;
        warmupState?: "offline" | "warming" | "ready";
        lastRpcError?: string;
        validatedAt?: string;
      };
      chimerax: {
        ready: boolean;
        endpoint?: string;
        reachable?: boolean;
        commandReady?: boolean;
        busy?: boolean;
        warmupState?: "offline" | "warming" | "ready";
        lastRpcError?: string;
        validatedAt?: string;
      };
    };
  };
};

const projectRoot = resolveFromRoot();
const appId = "biovoice";
const agentStateDir = resolveFromRoot(".runtime", "agent-runtime");
const agentStatePath = path.join(agentStateDir, "state.json");
const defaultPort = Number(process.env.PORT ?? "3000");
const configuredHost = process.env.HOST ?? "127.0.0.1";
const localAppHost = configuredHost === "0.0.0.0" ? "127.0.0.1" : configuredHost;
const managedAppUrl = `http://${localAppHost}:${defaultPort}`;
const publicAppUrl = resolvePublicBaseUrlOrigin({
  configuredPublicBaseUrl: process.env.PUBLIC_BASE_URL,
  listenHost: configuredHost,
  port: defaultPort,
});
const command = process.argv[2];
const cli = parseCliArgs(process.argv.slice(3));
const targetArg = cli.target;
const managedChimeraXProcessPattern = "ChimeraX.*remotecontrol rest start port";
const managedPymolProcessPattern = "python -m pymol -R -J";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const relevantPaths = [
  "apps",
  "packages",
  "examples",
  "scripts",
  "tests",
  "package.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "vitest.config.ts",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
];

await main();

async function main(): Promise<void> {
  switch (command) {
    case "start":
      await start(targetArg, {
        forceTargetRestart: false,
        skipBuild: cli.skipBuild,
        skipPreflight: cli.skipPreflight || cli.offline,
        offline: cli.offline,
        reuseDev: cli.reuseDev,
        cleanTarget: cli.cleanTarget,
        workflowId: cli.workflowId,
        scientificInputs: cli.scientificInputs,
        recipeId: cli.recipeId,
        audience: cli.audience,
        autoconnect: cli.autoconnect,
        openMic: cli.openMic,
        advanced: cli.advanced,
        overlay: cli.overlay,
      });
      return;
    case "restart":
      await start(targetArg, {
        forceTargetRestart: true,
        skipBuild: cli.skipBuild,
        skipPreflight: cli.skipPreflight || cli.offline,
        offline: cli.offline,
        reuseDev: cli.reuseDev,
        cleanTarget: cli.cleanTarget,
        workflowId: cli.workflowId,
        scientificInputs: cli.scientificInputs,
        recipeId: cli.recipeId,
        audience: cli.audience,
        autoconnect: cli.autoconnect,
        openMic: cli.openMic,
        advanced: cli.advanced,
        overlay: cli.overlay,
      });
      return;
    case "status":
      await status();
      return;
    case "stop":
      await stop();
      return;
    default:
        throw new Error("Usage: tsx scripts/agent-runtime.ts <start|restart|status|stop> [pymol|chimera|chimerax] [--recipe <id>] [--workflow <id>] [--uniprot <id>] [--experimental-pdb-id <id>] [--emdb-id <id>] [--structure-format <pdb|cif>] [--pdb-format <pdb|cif>] [--model <path>] [--experimental <path>] [--pae <path>] [--map <path>] [--bundle <path>] [--scorefile <path>] [--top-n <n>] [--mutation <A:H58Y>] [--comparison <path>] [--ligand <HEM>] [--neighborhood-angstroms <5>] [--audience] [--open-mic] [--advanced] [--overlay] [--offline] [--skip-build] [--skip-preflight] [--reuse-dev] [--clean-target]");
  }
}

async function start(target: TargetKind | undefined, options: StartOptions): Promise<void> {
  if (target !== "pymol" && target !== "chimerax") {
    throw new Error("Start requires a target: pymol, chimera, or chimerax.");
  }

  if (!options.offline) {
    requireOpenAiKey();
  }
  await fsPromises.mkdir(agentStateDir, { recursive: true });
  const runtimeCleanup = await cleanupRuntimeArtifacts(getRuntimeCleanupOptions());
  const existing = await readState();
  const preferredTargetState = options.forceTargetRestart ? null : existing;
  const health = await fetchHealth(managedAppUrl);

  if (options.forceTargetRestart) {
    await restartTargetApp(target, existing);
  }

  if (health?.ok && !isExpectedAppHealth(health)) {
    throw new Error(
      `Port ${new URL(managedAppUrl).port || "3000"} is already serving ${health.appId ?? "another HTTP service"} from ${health.projectRoot ?? "another project"}, not ${projectRoot}. Stop that service or change PORT.`,
    );
  }

  if (health && isExpectedAppHealth(health) && !isReusableManagedHealth(health, options.reuseDev)) {
    await killProcessesListeningOnPort(getAppPort(managedAppUrl));
    await waitForPortRelease(getAppPort(managedAppUrl), 10_000);
  }

  if (health && isReusableManagedHealth(health, options.reuseDev)) {
    const repoChangedSinceRunning = await hasRelevantChangesSince(health.startedAt);
    if (existing && await isManagedStateMatch(existing, health, managedAppUrl)) {
      if (!repoChangedSinceRunning && !options.forceTargetRestart) {
        const targetHandle = await ensureTargetAppReady(target, preferredTargetState);
        if (options.cleanTarget) {
          await resetTargetWorkspace(target, targetHandle.endpoint);
        }
        const workflowStage = options.workflowId
          ? await stageScientificWorkflow(managedAppUrl, target, options)
          : undefined;
        if (!options.skipPreflight && !options.offline) {
          await preflightRealtimeCredentials(managedAppUrl, target);
        }
        const overlay = options.overlay
          ? await relaunchFloatingCompanion(existing.overlay, target, buildRecommendedUrl(publicAppUrl, target, options))
          : await clearFloatingCompanion(existing.overlay);
        if (overlay !== existing.overlay) {
          existing.overlay = overlay;
        }
        applyTargetHandle(existing, targetHandle);
        await writeState(existing);
        emit({
          ok: true,
          action: "start",
          managed: true,
          reused: true,
          target,
          workflowId: options.workflowId,
          scientificInputs: options.scientificInputs,
          url: managedAppUrl,
          pid: existing.pid,
          logPath: existing.logPath,
          serverMode: health.serverMode,
          targetEndpoint: targetHandle.endpoint,
          targetPort: targetHandle.port,
          targetPid: targetHandle.pid,
          targetValidatedAt: targetHandle.validatedAt,
          workflowStage,
          overlay,
          runtimeCleanup: summarizeRuntimeCleanup(runtimeCleanup),
          recommendedUrl: buildRecommendedUrl(publicAppUrl, target, options),
        });
        return;
      }

      await stopManagedProcess(existing);
    } else if (!repoChangedSinceRunning) {
      const targetHandle = await ensureTargetAppReady(target, preferredTargetState);
      if (options.cleanTarget) {
        await resetTargetWorkspace(target, targetHandle.endpoint);
      }
      const workflowStage = options.workflowId
        ? await stageScientificWorkflow(managedAppUrl, target, options)
        : undefined;
      if (!options.skipPreflight && !options.offline) {
        await preflightRealtimeCredentials(managedAppUrl, target);
      }
      const overlay = options.overlay
        ? await relaunchFloatingCompanion(undefined, target, buildRecommendedUrl(publicAppUrl, target, options))
        : undefined;
        emit({
          ok: true,
          action: "start",
          managed: false,
          reused: true,
          target,
          workflowId: options.workflowId,
          scientificInputs: options.scientificInputs,
          url: managedAppUrl,
          serverMode: health.serverMode,
          note: "A matching voice console is already running from this repo. Leaving it in place.",
          targetEndpoint: targetHandle.endpoint,
          targetPort: targetHandle.port,
          targetPid: targetHandle.pid,
          targetValidatedAt: targetHandle.validatedAt,
          workflowStage,
          overlay,
          runtimeCleanup: summarizeRuntimeCleanup(runtimeCleanup),
          recommendedUrl: buildRecommendedUrl(publicAppUrl, target, options),
        });
      return;
    }
  }

  if (existing) {
    await stopManagedProcess(existing).catch(() => {});
  }

  if (health && isExpectedAppHealth(health)) {
    await killProcessesListeningOnPort(getAppPort(managedAppUrl));
    await waitForPortRelease(getAppPort(managedAppUrl), 10_000);
  }

  const [targetHandle] = await Promise.all([
    ensureTargetAppReady(target, preferredTargetState),
    options.skipBuild ? Promise.resolve() : buildRuntime(),
  ]);

  const logPath = path.join(agentStateDir, `start-${target}.log`);
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(npmCommand, ["run", "start"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DEFAULT_TARGET: target,
      ...(target === "pymol" ? { PYMOL_RPC_URL: targetHandle.endpoint } : {}),
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const freshHealth = await waitForHealth(managedAppUrl, 45_000, health?.instanceId);

  const state: AgentState = {
    pid: freshHealth.pid,
    instanceId: freshHealth.instanceId,
    target,
    workflowId: options.workflowId,
    scientificInputs: options.scientificInputs,
    targetEndpoint: targetHandle.endpoint,
    targetPort: targetHandle.port,
    targetPid: targetHandle.pid,
    targetValidatedAt: targetHandle.validatedAt,
    url: managedAppUrl,
    logPath,
    startedAt: new Date().toISOString(),
    serverMode: freshHealth.serverMode,
  };
  await writeState(state);
  if (options.cleanTarget) {
    await resetTargetWorkspace(target, targetHandle.endpoint);
  }
  const workflowStage = options.workflowId
    ? await stageScientificWorkflow(managedAppUrl, target, options)
    : undefined;
  if (!options.skipPreflight && !options.offline) {
    await preflightRealtimeCredentials(managedAppUrl, target);
  }
  if (options.overlay) {
    state.overlay = await relaunchFloatingCompanion(undefined, target, buildRecommendedUrl(publicAppUrl, target, options));
    await writeState(state);
  }

  emit({
    ok: true,
    action: "start",
    managed: true,
    reused: false,
    target,
    workflowId: options.workflowId,
    scientificInputs: options.scientificInputs,
    url: managedAppUrl,
    pid: state.pid,
    logPath,
    serverMode: state.serverMode,
    targetEndpoint: targetHandle.endpoint,
    targetPort: targetHandle.port,
    targetPid: targetHandle.pid,
    targetValidatedAt: targetHandle.validatedAt,
    workflowStage,
    overlay: state.overlay,
    runtimeCleanup: summarizeRuntimeCleanup(runtimeCleanup),
    recommendedUrl: buildRecommendedUrl(publicAppUrl, target, options),
  });
}

function normalizeTarget(value: string | undefined): TargetKind | undefined {
  if (value === "pymol" || value === "chimerax") {
    return value;
  }

  if (value === "chimera") {
    return "chimerax";
  }

  return undefined;
}

function parseCliArgs(argv: string[]): {
  target?: TargetKind;
  skipBuild: boolean;
  skipPreflight: boolean;
  offline: boolean;
  reuseDev: boolean;
  cleanTarget: boolean;
  workflowId?: ScientificWorkflowKind;
  scientificInputs: ScientificLaunchInputs;
  recipeId?: string;
  audience: boolean;
  autoconnect: boolean;
  openMic: boolean;
  advanced: boolean;
  overlay: boolean;
} {
  let target: TargetKind | undefined;
  let recipeId: string | undefined;
  let audience = false;
  let autoconnect = false;
  let openMic = false;
  let advanced = false;
  let overlay = false;
  let skipBuild = false;
  let skipPreflight = false;
  let offline = false;
  let reuseDev = false;
  let cleanTarget = false;
  let workflowId: ScientificWorkflowKind | undefined;
  let scientificInputs: ScientificLaunchInputs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const maybeTarget = normalizeTarget(token);
    if (!token.startsWith("--") && maybeTarget && !target) {
      target = maybeTarget;
      continue;
    }
    if (token === "--recipe") {
      recipeId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--workflow") {
      const candidate = argv[index + 1];
      if (candidate && scientificWorkflowKinds.includes(candidate as ScientificWorkflowKind)) {
        workflowId = candidate as ScientificWorkflowKind;
      }
      index += 1;
      continue;
    }
    if (token === "--uniprot") {
      scientificInputs = { ...scientificInputs, uniprot: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--experimental-pdb-id") {
      scientificInputs = { ...scientificInputs, experimentalPdbId: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--emdb-id") {
      scientificInputs = { ...scientificInputs, emdbId: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--structure-format") {
      scientificInputs = { ...scientificInputs, structureFormat: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--pdb-format") {
      scientificInputs = { ...scientificInputs, pdbFormat: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--model") {
      scientificInputs = { ...scientificInputs, model: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--experimental") {
      scientificInputs = { ...scientificInputs, experimental: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--pae") {
      scientificInputs = { ...scientificInputs, pae: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--map") {
      scientificInputs = { ...scientificInputs, map: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--bundle") {
      scientificInputs = { ...scientificInputs, bundle: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--scorefile") {
      scientificInputs = { ...scientificInputs, scorefile: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--top-n") {
      const raw = Number(argv[index + 1]);
      scientificInputs = { ...scientificInputs, topN: Number.isFinite(raw) ? raw : undefined };
      index += 1;
      continue;
    }
    if (token === "--mutation") {
      const mutation = parseVariantMutationArgument(argv[index + 1] ?? "");
      scientificInputs = { ...scientificInputs, mutations: [...(scientificInputs.mutations ?? []), mutation] };
      index += 1;
      continue;
    }
    if (token === "--comparison") {
      scientificInputs = { ...scientificInputs, comparison: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--ligand") {
      scientificInputs = { ...scientificInputs, ligand: argv[index + 1] };
      index += 1;
      continue;
    }
    if (token === "--neighborhood-angstroms") {
      const raw = Number(argv[index + 1]);
      scientificInputs = { ...scientificInputs, neighborhoodAngstroms: Number.isFinite(raw) ? raw : undefined };
      index += 1;
      continue;
    }
    if (token === "--audience") {
      audience = true;
      continue;
    }
    if (token === "--autoconnect") {
      autoconnect = true;
      continue;
    }
    if (token === "--open-mic") {
      openMic = true;
      continue;
    }
    if (token === "--advanced") {
      advanced = true;
      continue;
    }
    if (token === "--overlay") {
      overlay = true;
      continue;
    }
    if (token === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (token === "--skip-preflight") {
      skipPreflight = true;
      continue;
    }
    if (token === "--offline") {
      offline = true;
      continue;
    }
    if (token === "--reuse-dev") {
      reuseDev = true;
      continue;
    }
    if (token === "--clean-target") {
      cleanTarget = true;
    }
  }

  return {
    target,
    skipBuild,
    skipPreflight,
    offline,
    reuseDev,
    cleanTarget,
    workflowId,
    scientificInputs,
    recipeId,
    audience,
    autoconnect,
    openMic,
    advanced,
    overlay,
  };
}

async function status(): Promise<void> {
  let state = await readState();
  if (state?.overlay && !await isPidAlive(state.overlay.pid)) {
    delete state.overlay;
    await writeState(state);
  }
  const statusUrl = state?.url ?? managedAppUrl;
  const health = await fetchHealth(statusUrl);
  const managed = Boolean(state && health && await isManagedStateMatch(state, health, statusUrl));
  const overlayAlive = state?.overlay ? await isPidAlive(state.overlay.pid) : false;

  emit({
    ok: true,
    action: "status",
    url: statusUrl,
    healthy: Boolean(health && isExpectedAppHealth(health)),
    managed,
    state,
    pidAlive: state ? await isPidAlive(state.pid) : false,
    overlayAlive,
    health,
  });
}

async function stop(): Promise<void> {
  const state = await readState();
  if (!state) {
    emit({
      ok: true,
      action: "stop",
      managed: false,
      stopped: false,
      note: "No managed voice console process was recorded.",
    });
    return;
  }

  await stopManagedProcess(state);
  emit({
    ok: true,
    action: "stop",
    managed: true,
    stopped: true,
    pid: state.pid,
  });
}

async function buildRuntime(): Promise<void> {
  if (await isRuntimeBuildCurrent()) {
    return;
  }
  await runForeground(npmCommand, ["run", "build"]);
}

async function ensureTargetAppReady(target: TargetKind, existingState?: AgentState | null): Promise<TargetRuntimeHandle> {
  if (target === "pymol") {
    const adapter = new PymolAdapter({
      rpcUrl: existingState?.target === "pymol" ? existingState.targetEndpoint ?? process.env.PYMOL_RPC_URL : process.env.PYMOL_RPC_URL,
      baseUrl: process.env.PYMOL_RPC_BASE_URL ?? "http://127.0.0.1",
      startPort: Number(process.env.PYMOL_RPC_START_PORT ?? 9123),
      timeoutMs: Number(process.env.PYMOL_TIMEOUT_MS ?? 8000),
      renderTimeoutMs: Number(process.env.PYMOL_RENDER_TIMEOUT_MS ?? 120000),
      autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
    });
    const endpoint = await adapter.ensureReady();
    const availability = await adapter.getAvailabilitySummary();
    const port = getPortFromUrl(endpoint) ?? undefined;
    const pid = port ? await getPrimaryListeningPid(port) : undefined;
    return {
      endpoint,
      port,
      pid,
      validatedAt: availability.validatedAt,
    };
  }

  const adapter = new ChimeraXAdapter({
    port: Number(process.env.CHIMERAX_REST_PORT ?? 60958),
    timeoutMs: Number(process.env.CHIMERAX_TIMEOUT_MS ?? 30000),
    autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
  });
  const endpoint = await adapter.ensureReady();
  const availability = await adapter.getAvailabilitySummary();
  const port = getPortFromUrl(endpoint) ?? undefined;
  const pid = port ? await getPrimaryListeningPid(port) : undefined;
  return {
    endpoint,
    port,
    pid,
    validatedAt: availability.validatedAt,
  };
}

async function restartTargetApp(target: TargetKind, existingState?: AgentState | null): Promise<void> {
  if (target === "pymol") {
    let killed = await stopRecordedTargetProcess(existingState, "pymol");
    const startPort = Number(process.env.PYMOL_RPC_START_PORT ?? 9123);
    if (killed === 0) {
      for (const port of Array.from({ length: 6 }, (_, index) => startPort + index)) {
        killed += await killManagedProcessesListeningOnPort(port, managedPymolProcessPattern);
      }
    }
    if (killed > 0) {
      await sleep(1_500);
    }
    return;
  }

  let killed = await stopRecordedTargetProcess(existingState, "chimerax");
  if (killed === 0) {
    killed = await killManagedProcessesListeningOnPort(
      Number(process.env.CHIMERAX_REST_PORT ?? 60958),
      managedChimeraXProcessPattern,
    );
  }
  if (killed > 0) {
    await sleep(1_500);
  }
}

async function stopManagedProcess(state: AgentState): Promise<void> {
  await stopFloatingCompanion(state.overlay);
  const stateUrl = state.url ?? managedAppUrl;
  const listeners = await listProcessesListeningOnPort(getAppPort(stateUrl));
  const health = await fetchHealth(stateUrl);
  const recordedProcessOwnsPort =
    listeners.includes(state.pid)
    || Boolean(health && health.instanceId === state.instanceId && health.pid === state.pid);

  const pidAlive = await isPidAlive(state.pid);
  if (pidAlive && recordedProcessOwnsPort) {
    process.kill(state.pid, "SIGTERM");
    await waitForExit(state.pid, 10_000);
  }

  const lingeringHealth = await fetchHealth(stateUrl);
  if (lingeringHealth && lingeringHealth.instanceId === state.instanceId) {
    await killProcessesListeningOnPort(getAppPort(stateUrl));
    await waitForPortRelease(getAppPort(stateUrl), 10_000);
  }

  await fsPromises.rm(agentStatePath, { force: true });
}

async function readState(): Promise<AgentState | null> {
  try {
    const raw = await fsPromises.readFile(agentStatePath, "utf8");
    return JSON.parse(raw) as AgentState;
  } catch {
    return null;
  }
}

async function writeState(state: AgentState): Promise<void> {
  await fsPromises.writeFile(agentStatePath, JSON.stringify(state, null, 2), "utf8");
}

async function fetchHealth(url: string): Promise<AppHealth | null> {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as AppHealth;
  } catch {
    return null;
  }
}

async function preflightRealtimeCredentials(url: string, target: TargetKind): Promise<void> {
  const session = await fetchJson<{ clientSecret: string; sessionId: string; sessionAccessToken: string }>(
    `${url}/api/realtime/client-secret`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target,
        voiceMode: "push_to_talk",
      }),
    },
  );

  await fetchJson<{ ok: true }>(`${url}/api/sessions/${session.sessionId}/disconnect`, {
    method: "POST",
    headers: {
      "X-Session-Access-Token": session.sessionAccessToken,
    },
  }).catch(() => {});
}

function isExpectedAppHealth(health: AppHealth): boolean {
  return health.appId === appId && health.projectRoot === projectRoot;
}

function isReusableManagedHealth(health: AppHealth, reuseDev: boolean): boolean {
  return isExpectedAppHealth(health) && (health.serverMode === "built-static" || (reuseDev && health.serverMode === "dev-api"));
}

async function isPidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number, previousInstanceId?: string): Promise<AppHealth> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const health = await fetchHealth(url);
    if (
      health
      && isExpectedAppHealth(health)
      && (!previousInstanceId || health.instanceId !== previousInstanceId)
    ) {
      return health;
    }
    await sleep(500);
  }
  throw new Error(`Voice console did not become healthy at ${url} within ${timeoutMs}ms.`);
}

async function isManagedStateMatch(state: AgentState, health: AppHealth, url: string): Promise<boolean> {
  if (!isExpectedAppHealth(health)) {
    return false;
  }

  const listeners = await listProcessesListeningOnPort(getAppPort(url));
  return state.instanceId === health.instanceId && state.pid === health.pid && listeners.includes(health.pid);
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPidAlive(pid))) {
      return;
    }
    await sleep(250);
  }
}

async function waitForPortRelease(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const listeners = await listProcessesListeningOnPort(port);
    if (!listeners.length) {
      return;
    }
    await sleep(250);
  }
}

async function hasRelevantChangesSince(sinceIso: string): Promise<boolean> {
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) {
    return true;
  }

  for (const relativePath of relevantPaths) {
    const candidate = resolveFromRoot(relativePath);
    if (await pathHasChangesSince(candidate, sinceMs)) {
      return true;
    }
  }

  return false;
}

async function isRuntimeBuildCurrent(): Promise<boolean> {
  const buildTargets = [
    resolveFromRoot("dist", "server", "index.js"),
    resolveFromRoot("dist", "web", "index.html"),
  ];

  const buildTimes = await Promise.all(buildTargets.map(async (candidate) => {
    const stats = await fsPromises.stat(candidate).catch(() => null);
    return stats?.mtimeMs ?? 0;
  }));

  if (buildTimes.some((mtime) => mtime <= 0)) {
    return false;
  }

  const oldestBuildArtifactMs = Math.min(...buildTimes);
  for (const relativePath of relevantPaths) {
    const candidate = resolveFromRoot(relativePath);
    if (await pathHasChangesSince(candidate, oldestBuildArtifactMs)) {
      return false;
    }
  }

  return true;
}

async function pathHasChangesSince(candidate: string, sinceMs: number): Promise<boolean> {
  let stats: fs.Stats;
  try {
    stats = await fsPromises.stat(candidate);
  } catch {
    return false;
  }

  if (stats.mtimeMs > sinceMs) {
    return true;
  }

  if (!stats.isDirectory()) {
    return false;
  }

  const entries = await fsPromises.readdir(candidate, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".runtime" || entry.name === ".git") {
      continue;
    }
    if (await pathHasChangesSince(path.join(candidate, entry.name), sinceMs)) {
      return true;
    }
  }

  return false;
}

async function runForeground(commandName: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${commandName} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.`));
    });
    child.on("error", reject);
  });
}

async function resetTargetWorkspace(target: TargetKind, targetEndpoint?: string): Promise<void> {
  if (target === "pymol") {
    const adapter = new PymolAdapter({
      rpcUrl: targetEndpoint ?? process.env.PYMOL_RPC_URL,
      baseUrl: process.env.PYMOL_RPC_BASE_URL ?? "http://127.0.0.1",
      startPort: Number(process.env.PYMOL_RPC_START_PORT ?? 9123),
      timeoutMs: Number(process.env.PYMOL_TIMEOUT_MS ?? 8000),
      renderTimeoutMs: Number(process.env.PYMOL_RENDER_TIMEOUT_MS ?? 120000),
      autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
    });
    await adapter.execute([{ type: "reset_workspace" }], false);
    return;
  }

  const adapter = new ChimeraXAdapter({
    port: Number(process.env.CHIMERAX_REST_PORT ?? 60958),
    timeoutMs: Number(process.env.CHIMERAX_TIMEOUT_MS ?? 30000),
    autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
  });
  await adapter.execute([{ type: "reset_workspace" }], false);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((payload as { error?: string }).error ?? `Request failed (${response.status})`));
  }
  return payload as T;
}

function getAppPort(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) {
    return Number(parsed.port);
  }
  return parsed.protocol === "https:" ? 443 : 80;
}

function getPortFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

async function listProcessesListeningOnPort(port: number): Promise<number[]> {
  return await new Promise<number[]>((resolve) => {
    const child = spawn("lsof", ["-ti", `tcp:${port}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve([]));
    child.on("exit", () => {
      const pids = stdout
        .split(/\r?\n/g)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      resolve([...new Set(pids)]);
    });
  });
}

async function getPrimaryListeningPid(port: number): Promise<number | undefined> {
  const pids = await listProcessesListeningOnPort(port);
  return pids[0];
}

async function killProcessesListeningOnPort(port: number): Promise<void> {
  const pids = await listProcessesListeningOnPort(port);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Best effort.
    }
  }
}

async function readProcessCommand(pid: number): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const child = spawn("ps", ["-p", String(pid), "-o", "command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("exit", () => resolve(stdout.trim() || null));
  });
}

async function killManagedProcessesListeningOnPort(port: number, commandPattern: string): Promise<number> {
  const pattern = new RegExp(commandPattern, "i");
  const pids = await listProcessesListeningOnPort(port);
  let killed = 0;

  for (const pid of pids) {
    const commandLine = await readProcessCommand(pid);
    if (!commandLine || !pattern.test(commandLine)) {
      continue;
    }

    try {
      process.kill(pid, "SIGTERM");
      killed += 1;
    } catch {
      // Best effort.
    }
  }

  return killed;
}

async function stopRecordedTargetProcess(state: AgentState | null | undefined, target: TargetKind): Promise<number> {
  if (!state || state.target !== target) {
    return 0;
  }

  if (Number.isInteger(state.targetPid) && state.targetPid && await isPidAlive(state.targetPid)) {
    try {
      process.kill(state.targetPid, "SIGTERM");
      await waitForExit(state.targetPid, 10_000);
      return 1;
    } catch {
      return 0;
    }
  }

  if (Number.isInteger(state.targetPort) && state.targetPort) {
    const listeners = await listProcessesListeningOnPort(state.targetPort);
    if (state.targetPid && listeners.includes(state.targetPid)) {
      try {
        process.kill(state.targetPid, "SIGTERM");
        await waitForExit(state.targetPid, 10_000);
        return 1;
      } catch {
        return 0;
      }
    }
  }

  return 0;
}

function requireOpenAiKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env or the shell environment before starting the realtime console.");
  }
}

function emit(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

function summarizeRuntimeCleanup(summary: { removedPaths: string[]; bytesRecovered: number; warnings?: string[] }): Record<string, unknown> {
  return {
    removedCount: summary.removedPaths.length,
    bytesRecovered: summary.bytesRecovered,
    removedPathsPreview: summary.removedPaths.slice(0, 8),
    warnings: summary.warnings?.slice(0, 4) ?? [],
  };
}

function applyTargetHandle(state: AgentState, handle: TargetRuntimeHandle): void {
  state.targetEndpoint = handle.endpoint;
  state.targetPort = handle.port;
  state.targetPid = handle.pid;
  state.targetValidatedAt = handle.validatedAt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRecommendedUrl(
  baseUrl: string,
  target: TargetKind,
  options: Pick<StartOptions, "recipeId" | "workflowId" | "scientificInputs" | "audience" | "autoconnect" | "openMic" | "advanced" | "overlay">,
): string {
  const resolvedRecipeId = options.recipeId ?? resolveScientificWorkflowRecipeId(options.workflowId, target) ?? undefined;
  return buildScientificWorkflowUrl(baseUrl, {
    target,
    recipeId: resolvedRecipeId,
    workflowId: options.workflowId,
    scientificInputs: options.scientificInputs,
    audience: options.audience,
    autoconnect: options.autoconnect,
    voice: options.openMic ? "open_mic" : undefined,
    advanced: options.advanced,
    widget: true,
    overlay: options.overlay,
  });
}

async function relaunchFloatingCompanion(
  existing: FloatingCompanionState | undefined,
  target: TargetKind,
  url: string,
): Promise<FloatingCompanionState> {
  await stopFloatingCompanion(existing);
  return launchFloatingCompanion({ target, url });
}

async function clearFloatingCompanion(existing: FloatingCompanionState | undefined): Promise<undefined> {
  await stopFloatingCompanion(existing);
  return undefined;
}

async function stageScientificWorkflow(
  baseUrl: string,
  target: TargetKind,
  options: Pick<StartOptions, "workflowId" | "scientificInputs" | "recipeId">,
): Promise<Record<string, unknown>> {
  if (!options.workflowId) {
    return { staged: false };
  }

  const draftRequest = buildScientificWorkflowRequest(target, options.workflowId, options.scientificInputs, options.recipeId);
  const parsed = scientificWorkflowRequestSchema.safeParse(draftRequest);
  if (!parsed.success) {
    return {
      staged: false,
      workflowId: options.workflowId,
      reason: "Missing workflow inputs for offline staging.",
      missing: parsed.error.issues.map((issue) => issue.message).slice(0, 4),
    };
  }

  const response = await fetch(new URL("/api/workflows/run", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `Workflow staging failed for ${options.workflowId}.`);
  }

  return {
    staged: true,
    workflowId: options.workflowId,
    warningCount: Array.isArray(payload.warnings) ? payload.warnings.length : 0,
    metricCount: Array.isArray(payload.metrics) ? payload.metrics.length : 0,
    artifactCount: Array.isArray(payload.artifacts) ? payload.artifacts.length : 0,
    topCandidate: Array.isArray(payload.rankedCandidates) && payload.rankedCandidates[0] && typeof payload.rankedCandidates[0] === "object"
      ? (payload.rankedCandidates[0] as Record<string, unknown>).tag
      : undefined,
  };
}

function buildScientificWorkflowRequest(
  target: TargetKind,
  workflowId: ScientificWorkflowKind,
  inputs: ScientificLaunchInputs,
  recipeId?: string,
): Record<string, unknown> {
  const common = {
    target,
    workflow: workflowId,
    recipeId: recipeId ?? resolveScientificWorkflowRecipeId(workflowId, target) ?? undefined,
    presentationMode: "demo",
  };

  if (workflowId.startsWith("alphafold_")) {
    return {
      ...common,
      inputs: {
        modelPath: inputs.model,
        uniprotId: inputs.uniprot,
        experimentalPath: inputs.experimental,
        experimentalPdbId: inputs.experimentalPdbId,
        experimentalPdbFormat: inputs.pdbFormat ?? inputs.structureFormat,
        pdbFormat: inputs.pdbFormat,
        paePath: inputs.pae,
        useAfdbPae: workflowId === "alphafold_pae_guided_triage" && inputs.uniprot && !inputs.model && !inputs.pae
          ? true
          : undefined,
        cryoMapPath: inputs.map,
        emdbId: inputs.emdbId,
        cryoMapEmdbId: inputs.emdbId,
        structureFormat: inputs.structureFormat,
      },
    };
  }

  if (workflowId === "variant_environment_review") {
    return {
      ...common,
      inputs: {
        modelPath: inputs.model,
        uniprotId: inputs.uniprot,
        mutations: inputs.mutations,
        comparisonPath: inputs.comparison,
        ligandCode: inputs.ligand,
        neighborhoodAngstroms: inputs.neighborhoodAngstroms,
      },
    };
  }

  return {
    ...common,
    inputs: {
      bundlePath: inputs.bundle,
      scorefilePath: inputs.scorefile,
      referencePath: inputs.model,
      structureFormat: inputs.structureFormat,
      topN: inputs.topN,
    },
  };
}
