import dotenv from "dotenv";
import {
  RealtimeSessionRegistry,
  getScientificWorkflowSpec,
  scientificWorkflowRequestSchema,
  getRecipe,
  parseVariantMutationArgument,
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
    throw new Error("Usage: tsx scripts/rehearse-workflow.ts <recipeId|workflowId> [--target pymol|chimerax] [--step stepId] [--dry-run] [--capture] [--workflow workflowId] [--uniprot id] [--experimental-pdb-id id] [--emdb-id id] [--structure-format pdb|cif] [--pdb-format pdb|cif] [--model path] [--experimental path] [--pae path] [--map path] [--bundle path] [--scorefile path] [--top-n n] [--mutation A:H58Y] [--comparison path] [--ligand HEM] [--neighborhood-angstroms 5]");
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
    realtimeModel: process.env.REALTIME_MODEL ?? "gpt-realtime-2",
    realtimeVoice: process.env.REALTIME_VOICE ?? "marin",
    realtimeReasoningEffort: parseRealtimeReasoningEffort(process.env.REALTIME_REASONING_EFFORT ?? "low"),
    audioTranscriptionModel: process.env.REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe",
    realtimeOutputSpeed: Number(process.env.REALTIME_OUTPUT_SPEED ?? 1),
    realtimeMaxOutputTokens: Number(process.env.REALTIME_MAX_OUTPUT_TOKENS ?? 384),
    realtimeTracing: "auto",
    realtimeTruncation: {
      retentionRatio: Number(process.env.REALTIME_RETENTION_RATIO ?? 0.4),
      postInstructions: Number(process.env.REALTIME_POST_INSTRUCTIONS_TOKENS ?? 2000),
    },
    sessionGuardrails: {
      maxSessionMinutes: Number(process.env.REALTIME_MAX_SESSION_MINUTES ?? 25),
      maxResponsesPerSession: Number(process.env.REALTIME_MAX_RESPONSES_PER_SESSION ?? 18),
      maxTranscriptionsPerSession: Number(process.env.REALTIME_MAX_TRANSCRIPTIONS_PER_SESSION ?? 36),
      maxBillableTokensPerSession: Number(process.env.REALTIME_MAX_BILLABLE_TOKENS_PER_SESSION ?? 24000),
      warningRatio: Number(process.env.REALTIME_USAGE_WARNING_RATIO ?? 0.8),
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
    });
  }

  if (workflowId === "variant_environment_review") {
    return scientificWorkflowRequestSchema.parse({
      ...common,
      inputs: {
        modelPath: inputs.model,
        uniprotId: inputs.uniprot,
        mutations: inputs.mutations,
        comparisonPath: inputs.comparison,
        ligandCode: inputs.ligand,
        neighborhoodAngstroms: inputs.neighborhoodAngstroms,
      },
    });
  }

  return scientificWorkflowRequestSchema.parse({
    ...common,
    inputs: {
      bundlePath: inputs.bundle,
      scorefilePath: inputs.scorefile,
      referencePath: inputs.model,
      structureFormat: inputs.structureFormat,
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

function parseRealtimeReasoningEffort(value: string): "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "off" || normalized === "false") {
    return null;
  }
  if (
    normalized === "minimal"
    || normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "xhigh"
  ) {
    return normalized;
  }
  throw new Error(`Invalid REALTIME_REASONING_EFFORT: ${value}`);
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
  const neighborhoodValue = readFlagValue(flags, "--neighborhood-angstroms");
  const mutations = readFlagValues(flags, "--mutation").map(parseVariantMutationArgument);
  return {
    workflowId: workflowValue && scientificWorkflowKinds.includes(workflowValue as (typeof scientificWorkflowKinds)[number])
      ? (workflowValue as (typeof scientificWorkflowKinds)[number])
      : undefined,
    scientificInputs: {
      uniprot: readFlagValue(flags, "--uniprot"),
      experimentalPdbId: readFlagValue(flags, "--experimental-pdb-id"),
      emdbId: readFlagValue(flags, "--emdb-id"),
      structureFormat: readFlagValue(flags, "--structure-format"),
      pdbFormat: readFlagValue(flags, "--pdb-format"),
      model: readFlagValue(flags, "--model"),
      experimental: readFlagValue(flags, "--experimental"),
      pae: readFlagValue(flags, "--pae"),
      map: readFlagValue(flags, "--map"),
      bundle: readFlagValue(flags, "--bundle"),
      scorefile: readFlagValue(flags, "--scorefile"),
      topN: topNValue ? Number(topNValue) : undefined,
      mutations: mutations.length ? mutations : undefined,
      comparison: readFlagValue(flags, "--comparison"),
      ligand: readFlagValue(flags, "--ligand"),
      neighborhoodAngstroms: neighborhoodValue ? Number(neighborhoodValue) : undefined,
    },
    target: parseTarget(flags),
  };
}

function readFlagValues(flags: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] === name && flags[index + 1]) values.push(flags[index + 1]);
  }
  return values;
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
