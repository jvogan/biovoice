import dotenv from "dotenv";
import {
  RealtimeSessionRegistry,
  getScientificWorkflowSpec,
  scientificWorkflowRequestSchema,
  getRecipe,
  resolveScientificWorkflowRecipeId,
  resolveFromRoot,
  scientificWorkflowKinds,
  type ScientificWorkflowRequest,
  type ScientificLaunchInputs,
  type TargetKind,
} from "../packages/runtime-and-adapters/src/index.js";

dotenv.config({ path: resolveFromRoot(".env") });

async function main() {
  const [identifier, ...flags] = process.argv.slice(2);
  if (!identifier) {
    throw new Error("Usage: tsx scripts/rehearse-workflow.ts <recipeId|workflowId> [--target pymol|chimerax] [--step stepId] [--dry-run] [--capture] [--workflow workflowId] [--uniprot id] [--model path] [--experimental path] [--pae path] [--map path] [--bundle path] [--scorefile path] [--top-n n]");
  }

  const parsed = parseScientificFlags(flags);
  const workflowId = parsed.workflowId ?? (scientificWorkflowKinds.includes(identifier as (typeof scientificWorkflowKinds)[number]) ? (identifier as (typeof scientificWorkflowKinds)[number]) : undefined);
  const workflowTarget = workflowId ? getScientificWorkflowSpec(workflowId).defaultTarget : undefined;
  const recipeId = workflowId
    ? resolveScientificWorkflowRecipeId(workflowId, parsed.target ?? workflowTarget ?? "pymol") ?? identifier
    : identifier;
  const recipe = workflowId ? null : getRecipe(recipeId);
  const target = parseTarget(flags) ?? recipe?.apps[0] ?? workflowTarget ?? "pymol";
  const stepId = readFlagValue(flags, "--step");
  const dryRun = flags.includes("--dry-run");
  const capture = flags.includes("--capture");

  const registry = new RealtimeSessionRegistry({
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    realtimeModel: process.env.REALTIME_MODEL ?? "gpt-realtime-1.5",
    realtimeVoice: process.env.REALTIME_VOICE ?? "marin",
    audioTranscriptionModel: process.env.REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe",
    realtimeOutputSpeed: Number(process.env.REALTIME_OUTPUT_SPEED ?? 1),
    realtimeMaxOutputTokens: 1536,
    realtimeTracing: "auto",
    realtimeTruncation: {
      retentionRatio: Number(process.env.REALTIME_RETENTION_RATIO ?? 0.8),
      postInstructions: Number(process.env.REALTIME_POST_INSTRUCTIONS_TOKENS ?? 12000),
    },
    transcriptionPromptHint: process.env.REALTIME_TRANSCRIPTION_PROMPT_HINT,
    debugRawEvents: false,
    pymol: {
      rpcUrl: process.env.PYMOL_RPC_URL,
      baseUrl: process.env.PYMOL_RPC_BASE_URL ?? "http://127.0.0.1",
      startPort: Number(process.env.PYMOL_RPC_START_PORT ?? 9123),
      timeoutMs: Number(process.env.PYMOL_TIMEOUT_MS ?? 8000),
      renderTimeoutMs: Number(process.env.PYMOL_RENDER_TIMEOUT_MS ?? 120000),
      autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
    },
    chimerax: {
      port: Number(process.env.CHIMERAX_REST_PORT ?? 60958),
      timeoutMs: Number(process.env.CHIMERAX_TIMEOUT_MS ?? 30000),
      autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
    },
  });

  const result = workflowId
    ? await registry.runScientificWorkflowDirect(buildScientificWorkflowRequest(workflowId, target, parsed.scientificInputs, recipeId, dryRun))
    : stepId
    ? await registry.runRecipeStepDirect(recipe!.id, stepId, target, dryRun)
    : await registry.runRecipeDirect(recipe!.id, target, dryRun);

  const captureResult = capture
    ? await registry.captureViewDirect({
      target,
      attachToConversation: false,
    })
    : null;

  console.log(JSON.stringify({
    ok: true,
    recipeId: recipe?.id ?? recipeId,
    workflowId,
    target,
    dryRun,
    stepId,
    scientificInputs: parsed.scientificInputs,
    result,
    capture: captureResult,
  }, null, 2));
}

function buildScientificWorkflowRequest(
  workflowId: (typeof scientificWorkflowKinds)[number],
  target: TargetKind,
  inputs: ScientificLaunchInputs,
  recipeId: string,
  dryRun: boolean,
): ScientificWorkflowRequest {
  const common = {
    target,
    workflow: workflowId,
    recipeId,
    dryRun,
    presentationMode: "demo" as const,
  };

  if (workflowId.startsWith("alphafold_")) {
    return scientificWorkflowRequestSchema.parse({
      ...common,
      inputs: {
        modelPath: inputs.model,
        uniprotId: inputs.uniprot,
        experimentalPath: inputs.experimental,
        paePath: inputs.pae,
        useAfdbPae: Boolean(inputs.uniprot && !inputs.pae),
        cryoMapPath: inputs.map,
      },
    });
  }

  return scientificWorkflowRequestSchema.parse({
    ...common,
    inputs: {
      bundlePath: inputs.bundle,
      scorefilePath: inputs.scorefile,
      referencePath: inputs.model,
      topN: inputs.topN,
    },
  });
}

function parseTarget(flags: string[]): TargetKind | undefined {
  const raw = readFlagValue(flags, "--target");
  if (raw === "pymol" || raw === "chimerax") {
    return raw;
  }
  if (raw === "chimera") {
    return "chimerax";
  }
  return undefined;
}

function readFlagValue(flags: string[], name: string): string | undefined {
  const index = flags.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return flags[index + 1];
}

function parseScientificFlags(flags: string[]): {
  workflowId?: (typeof scientificWorkflowKinds)[number];
  scientificInputs: ScientificLaunchInputs;
  target?: TargetKind;
} {
  const workflowValue = readFlagValue(flags, "--workflow");
  const topNValue = readFlagValue(flags, "--top-n");
  return {
    workflowId: workflowValue && scientificWorkflowKinds.includes(workflowValue as (typeof scientificWorkflowKinds)[number])
      ? (workflowValue as (typeof scientificWorkflowKinds)[number])
      : undefined,
    scientificInputs: {
      uniprot: readFlagValue(flags, "--uniprot"),
      model: readFlagValue(flags, "--model"),
      experimental: readFlagValue(flags, "--experimental"),
      pae: readFlagValue(flags, "--pae"),
      map: readFlagValue(flags, "--map"),
      bundle: readFlagValue(flags, "--bundle"),
      scorefile: readFlagValue(flags, "--scorefile"),
      topN: topNValue ? Number(topNValue) : undefined,
    },
    target: parseTarget(flags),
  };
}

main()
  .then(() => {
    process.exitCode = 0;
    setImmediate(() => process.exit(0));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  });
