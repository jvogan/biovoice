import { spawn } from "node:child_process";
import {
  getShowcaseScenarios,
  parseVerifyShowcasesArgs,
  verifyShowcasesUsage,
  type ShowcaseScenario,
} from "./lib/showcase-scenarios.js";
import { resolveFromRoot } from "../packages/runtime-and-adapters/src/index.js";

interface RehearsalMetric {
  label?: string;
  value?: number;
  source?: string;
}

interface RehearsalArtifact {
  kind?: string;
  label?: string;
  path?: string;
}

interface RehearsalPayload {
  ok: boolean;
  recipeId?: string;
  workflowId?: string;
  target?: string;
  result?: {
    warnings?: string[];
    metrics?: RehearsalMetric[];
    rankedCandidates?: unknown[];
  };
  capture?: {
    warnings?: string[];
    artifacts?: RehearsalArtifact[];
  };
}

async function main(): Promise<void> {
  const options = parseVerifyShowcasesArgs(process.argv.slice(2));
  if (options.helpRequested) {
    console.log(verifyShowcasesUsage());
    return;
  }

  const scenarios = getShowcaseScenarios(options.targets);
  const summary = {
    ok: true,
    scenarioCount: scenarios.length,
    targets: options.targets,
    scenarios: [] as Array<Record<string, unknown>>,
  };

  for (const scenario of scenarios) {
    summary.scenarios.push(await verifyScenario(scenario));
  }

  console.log(JSON.stringify(summary, null, 2));
}

async function verifyScenario(scenario: ShowcaseScenario): Promise<Record<string, unknown>> {
  console.log(`[verify-showcases] Running ${scenario.id}`);
  const payload = await runJsonTsScript<RehearsalPayload>("scripts/rehearse-workflow.ts", buildScenarioArgs(scenario));

  assert(payload.ok, `${scenario.id} did not return ok=true.`);
  assert(payload.recipeId === scenario.expectedRecipeId, `${scenario.id} resolved ${payload.recipeId ?? "unknown recipe"}, expected ${scenario.expectedRecipeId}.`);

  const resultWarnings = payload.result?.warnings ?? [];
  assert(resultWarnings.length === 0, `${scenario.id} returned workflow warnings: ${resultWarnings.join(" | ")}`);

  const captureWarnings = payload.capture?.warnings ?? [];
  assert(captureWarnings.length === 0, `${scenario.id} returned capture warnings: ${captureWarnings.join(" | ")}`);

  const captureArtifacts = payload.capture?.artifacts ?? [];
  const imageArtifact = captureArtifacts.find((artifact) => artifact.kind === "image" && typeof artifact.path === "string");
  assert(imageArtifact?.path, `${scenario.id} did not return an image capture artifact.`);
  assert(imageArtifact.label === scenario.expectedArtifactLabel, `${scenario.id} returned artifact label ${imageArtifact.label ?? "unknown"}, expected ${scenario.expectedArtifactLabel}.`);

  const metricLabels = new Set((payload.result?.metrics ?? []).map((metric) => metric.label).filter((label): label is string => Boolean(label)));
  for (const label of scenario.expectedMetricLabels) {
    assert(metricLabels.has(label), `${scenario.id} did not emit expected metric ${label}.`);
  }

  if (typeof scenario.expectedRankedCandidates === "number") {
    const rankedCandidates = payload.result?.rankedCandidates ?? [];
    assert(
      Array.isArray(rankedCandidates) && rankedCandidates.length >= scenario.expectedRankedCandidates,
      `${scenario.id} returned ${Array.isArray(rankedCandidates) ? rankedCandidates.length : 0} ranked candidates, expected at least ${scenario.expectedRankedCandidates}.`,
    );
  }

  return {
    id: scenario.id,
    title: scenario.title,
    target: scenario.target,
    workflowId: scenario.workflowId,
    recipeId: payload.recipeId ?? null,
    metricLabels: [...metricLabels],
    artifactPath: imageArtifact.path,
    artifactLabel: imageArtifact.label ?? null,
  };
}

function buildScenarioArgs(scenario: ShowcaseScenario): string[] {
  const args = [scenario.workflowId, "--target", scenario.target, "--capture"];
  appendScientificFlags(args, scenario.scientificInputs);
  return args;
}

function appendScientificFlags(args: string[], inputs: ShowcaseScenario["scientificInputs"]): void {
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
  },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
    });

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
