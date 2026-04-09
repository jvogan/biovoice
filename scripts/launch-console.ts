import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildScientificWorkflowUrl,
  getScientificWorkflowSpec,
  resolveScientificWorkflowRecipeId,
  scientificWorkflowKinds,
  type ScientificLaunchInputs,
  type ScientificWorkflowKind,
} from "../packages/runtime-and-adapters/src/index.js";

const execFileAsync = promisify(execFile);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type TargetKind = "pymol" | "chimerax";

async function main() {
  const [targetArg, ...rest] = process.argv.slice(2);
  const target = normalizeTarget(targetArg);
  if (!target) {
    throw new Error("Usage: tsx scripts/launch-console.ts <pymol|chimera|chimerax> [recipeId|workflowId] [--workflow workflowId] [--uniprot id] [--model path] [--experimental path] [--pae path] [--map path] [--bundle path] [--scorefile path] [--top-n N] [--audience] [--open-mic] [--offline] [--skip-build] [--skip-preflight] [--reuse-dev] [--clean-target]");
  }
  const launchId = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined;
  const flags = launchId ? rest.slice(1) : rest;
  const parsed = parseLaunchFlags(flags);
  const workflowId = parsed.workflowId ?? (launchId && isScientificWorkflowId(launchId) ? launchId : undefined);
  const recipeId = parsed.recipeId ?? (launchId && !isScientificWorkflowId(launchId) ? launchId : undefined) ?? (workflowId ? resolveScientificWorkflowRecipeId(workflowId, target) ?? undefined : undefined);
  const launchInputs = parsed.scientificInputs;

  const query = new URLSearchParams();
  const url = buildScientificWorkflowUrl("http://localhost:3000", {
    target,
    recipeId,
    workflowId,
    scientificInputs: launchInputs,
    audience: parsed.audience,
    voice: parsed.openMic ? "open_mic" : undefined,
    advanced: parsed.advanced,
    widget: true,
    overlay: parsed.overlay,
  });
  const queryUrl = new URL(url);
  for (const [key, value] of queryUrl.searchParams.entries()) {
    query.set(key, value);
  }

  const agentArgs = ["run", "agent:start", "--", target];
  if (recipeId) {
    agentArgs.push("--recipe", recipeId);
  }
  if (workflowId) {
    agentArgs.push("--workflow", workflowId);
  }
  appendScientificFlags(agentArgs, launchInputs);
  if (parsed.audience) agentArgs.push("--audience");
  if (parsed.openMic) agentArgs.push("--open-mic");
  if (parsed.offline) agentArgs.push("--offline");
  if (parsed.skipBuild) agentArgs.push("--skip-build");
  if (parsed.skipPreflight) agentArgs.push("--skip-preflight");
  if (parsed.reuseDev) agentArgs.push("--reuse-dev");
  if (parsed.cleanTarget) agentArgs.push("--clean-target");
  if (parsed.advanced) agentArgs.push("--advanced");
  if (parsed.overlay) agentArgs.push("--overlay");

  const started = await execFileAsync(npmCommand, agentArgs, {
    cwd: projectRoot,
    env: process.env,
  });

  const reportedUrl = parseRecommendedUrl(started.stdout);
  const launchUrl = reportedUrl ?? `http://localhost:3000/?${query.toString()}`;
  if (!parsed.overlay) {
    await execFileAsync("open", [launchUrl]);
  }
  console.log(JSON.stringify({
    ok: true,
    target,
    url: launchUrl,
    workflowId,
    recipeId,
    overlay: parsed.overlay,
  }, null, 2));
}

function normalizeTarget(value: string | undefined): TargetKind | null {
  if (value === "pymol") return "pymol";
  if (value === "chimera" || value === "chimerax") return "chimerax";
  return null;
}

function parseRecommendedUrl(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { recommendedUrl?: string };
    return parsed.recommendedUrl ?? null;
  } catch {
    return null;
  }
}

function parseLaunchFlags(flags: string[]): {
  workflowId?: ScientificWorkflowKind;
  recipeId?: string;
  audience: boolean;
  autoconnect: boolean;
  openMic: boolean;
  advanced: boolean;
  overlay: boolean;
  offline: boolean;
  skipBuild: boolean;
  skipPreflight: boolean;
  reuseDev: boolean;
  cleanTarget: boolean;
  scientificInputs: ScientificLaunchInputs;
} {
  const workflowId = readFlagValue(flags, "--workflow");
  const recipeId = readFlagValue(flags, "--recipe");
  const topNRaw = readFlagValue(flags, "--top-n");
  const scientificInputs: ScientificLaunchInputs = {
    uniprot: readFlagValue(flags, "--uniprot"),
    model: readFlagValue(flags, "--model"),
    experimental: readFlagValue(flags, "--experimental"),
    pae: readFlagValue(flags, "--pae"),
    map: readFlagValue(flags, "--map"),
    bundle: readFlagValue(flags, "--bundle"),
    scorefile: readFlagValue(flags, "--scorefile"),
    topN: topNRaw ? Number(topNRaw) : undefined,
  };

  return {
    workflowId: workflowId && isScientificWorkflowId(workflowId) ? workflowId : undefined,
    recipeId: recipeId && recipeId.trim() ? recipeId : undefined,
    audience: flags.includes("--audience"),
    autoconnect: flags.includes("--autoconnect"),
    openMic: flags.includes("--open-mic"),
    advanced: flags.includes("--advanced"),
    overlay: flags.includes("--overlay"),
    offline: flags.includes("--offline"),
    skipBuild: flags.includes("--skip-build"),
    skipPreflight: flags.includes("--skip-preflight"),
    reuseDev: flags.includes("--reuse-dev"),
    cleanTarget: flags.includes("--clean-target"),
    scientificInputs,
  };
}

function appendScientificFlags(args: string[], inputs: ScientificLaunchInputs): void {
  if (inputs.uniprot) args.push("--uniprot", inputs.uniprot);
  if (inputs.model) args.push("--model", inputs.model);
  if (inputs.experimental) args.push("--experimental", inputs.experimental);
  if (inputs.pae) args.push("--pae", inputs.pae);
  if (inputs.map) args.push("--map", inputs.map);
  if (inputs.bundle) args.push("--bundle", inputs.bundle);
  if (inputs.scorefile) args.push("--scorefile", inputs.scorefile);
  if (typeof inputs.topN === "number" && Number.isFinite(inputs.topN)) {
    args.push("--top-n", String(Math.max(1, Math.round(inputs.topN))));
  }
}

function isScientificWorkflowId(value: string): value is ScientificWorkflowKind {
  return scientificWorkflowKinds.includes(value as ScientificWorkflowKind);
}

function readFlagValue(flags: string[], name: string): string | undefined {
  const index = flags.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return flags[index + 1];
}

void main();
