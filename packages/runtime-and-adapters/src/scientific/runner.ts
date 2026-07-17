import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type ActionResult,
  type ChimeraXAction,
  type PymolAction,
  scientificWorkflowRequestSchema,
  scientificWorkflowResultSchema,
  type AlphaFoldWorkflowKind,
  type AlphaFoldInputs,
  type RosettaInputs,
  type RosettaWorkflowKind,
  type ScientificWorkflowKind,
  type ScientificWorkflowRequest,
  type ScientificWorkflowResult,
  type TargetKind,
  type VariantInputs,
  type VariantSite,
} from "../schemas/index.js";
import { ensureAllowedStructureInputPath } from "../utils/path-policy.js";
import { resolveFromRoot } from "../utils/paths.js";
import type { ReferenceHint } from "../utils/semantic-handles.js";
import type { SelectorReferenceMap } from "../utils/selectors.js";
import { getScientificWorkflow } from "./catalog.js";
import {
  ensureScientificCacheDirs,
  resolveAlphaFoldAsset,
  resolveEmdbMap,
  resolveRcsbStructure,
  scientificCacheDir,
  type StructureAssetFormat,
} from "./fetcher.js";

type TargetAction = PymolAction | ChimeraXAction;
type StructureHandle = { object: string } | { model: string };

export interface ScientificWorkflowContext {
  referenceHints: Record<string, ReferenceHint>;
  workflowState: Record<string, unknown>;
}

export interface ScientificWorkflowRuntime {
  clearWorkflowContext(target: TargetKind): void;
  setWorkflowContext(target: TargetKind, context: ScientificWorkflowContext): void;
  executeActions(target: TargetKind, actions: TargetAction[], dryRun?: boolean): Promise<ActionResult>;
  getTargetState(target: TargetKind): Promise<Record<string, unknown>>;
}

type WorkflowPhase = {
  actions: TargetAction[];
  updateContext?: ScientificWorkflowContext;
  phaseLabel: string;
};

type StructureResidue = {
  index: number;
  chain: string;
  residue: string;
  residueNumber: number | null;
  residueName: string;
  meanConfidence?: number;
};

type StructureAnalysis = {
  parserVersion: 3;
  path: string;
  format: "pdb" | "cif" | "unknown";
  chains: string[];
  residues: StructureResidue[];
  nonPolymerResidueNames: string[];
  lowConfidenceRanges: ResidueWindow[];
};

type ResidueWindow = {
  chain: string;
  startResidue: string;
  endResidue: string;
  residueLabels: string[];
  meanValue: number;
  label: string;
};

type PAEAnalysis = {
  residueCount: number;
  meanPae: number;
  maxPae: number;
  worstWindow?: ResidueWindow;
  uncertainInterface?: {
    chains: [string, string];
    chainAResidues: string[];
    chainBResidues: string[];
    meanPae: number;
  };
};

type AlphaFoldResolvedInputs = {
  modelPath: string;
  modelSource: "local" | "afdb";
  uniprotId?: string;
  afdbRecord?: Record<string, unknown>;
  paePath?: string;
  paeSource?: "local" | "afdb";
  experimentalPath?: string;
  experimentalSource?: "local" | "rcsb";
  cryoMapPath?: string;
  modelAnalysis?: StructureAnalysis;
  experimentalAnalysis?: StructureAnalysis;
  paeAnalysis?: PAEAnalysis;
  interfaceChains?: [string, string];
  focusResidues?: string[];
};

type RankedRosettaCandidate = {
  rank: number;
  tag: string;
  score?: number;
  scoreLabel?: string;
  path?: string;
  matched: boolean;
  warnings: string[];
  metadata?: Record<string, unknown>;
};

type RosettaResolvedInputs = {
  bundlePath?: string;
  scorefilePath?: string;
  referencePath?: string;
  referenceAnalysis?: StructureAnalysis;
  candidatePaths: string[];
  candidateAnalyses: Record<string, StructureAnalysis | undefined>;
  rankedCandidates: RankedRosettaCandidate[];
  topCandidatePath?: string;
  topN: number;
  ligandCode?: string;
  interfaceChains?: [string, string];
  focusResidues?: string[];
};

type ResolvedVariantSite = VariantSite & {
  chain: string;
  residueName: string;
  label: string;
};

type VariantResolvedInputs = {
  modelPath: string;
  modelSource: "local" | "afdb";
  uniprotId?: string;
  comparisonPath?: string;
  modelAnalysis: StructureAnalysis;
  comparisonAnalysis?: StructureAnalysis;
  mutations: ResolvedVariantSite[];
  ligandCode?: string;
  neighborhoodAngstroms: number;
};

type ScientificResolvedInputs = AlphaFoldResolvedInputs | RosettaResolvedInputs | VariantResolvedInputs;

type AlphaFoldHandlePlan = {
  predicted: StructureHandle;
  experimental?: StructureHandle;
  cryoMap?: StructureHandle;
  cryoMapModelId?: string;
};

type RosettaHandlePlan = {
  reference?: StructureHandle;
  topDesign: StructureHandle;
  loadedDesigns: Array<{ key: string; selector: StructureHandle }>;
  designPanelSelector: string | StructureHandle;
};

const maxScientificStructureParseBytes = 64 * 1024 * 1024;
const maxScientificJsonParseBytes = 32 * 1024 * 1024;
const maxScientificScorefileParseBytes = 32 * 1024 * 1024;

export async function runScientificWorkflow(
  request: ScientificWorkflowRequest,
  runtime: ScientificWorkflowRuntime,
): Promise<ScientificWorkflowResult> {
  const parsed = scientificWorkflowRequestSchema.parse(request);
  const manifest = getScientificWorkflow(parsed.workflow);
  if (!manifest.apps.includes(parsed.target)) {
    throw new Error(`${manifest.title} is not supported for ${parsed.target}.`);
  }

  runtime.clearWorkflowContext(parsed.target);

  if (isAlphaFoldWorkflow(parsed.workflow)) {
    const resolved = await resolveAlphaFoldInputs(parsed.inputs);
    if (parsed.workflow === "alphafold_multimer_interface_review" && !resolved.interfaceChains) {
      throw new Error("AlphaFold multimer interface review requires two polymer chains or explicit interfaceChains.");
    }
    const phases = buildAlphaFoldWorkflowPhases(parsed.target, parsed.workflow, resolved, parsed.presentationMode);
    return executeWorkflowPlan(parsed, resolved, phases, runtime);
  }

  if (parsed.workflow === "variant_environment_review") {
    const resolved = await resolveVariantInputs(parsed.inputs);
    const phases = buildVariantWorkflowPhases(parsed.target, resolved, parsed.presentationMode);
    return executeWorkflowPlan(parsed, resolved, phases, runtime);
  }

  const resolved = await resolveRosettaInputs(parsed.inputs);
  if (parsed.workflow === "rosetta_interface_packing_review" && !resolved.interfaceChains) {
    throw new Error("Rosetta interface packing review requires two polymer chains or explicit interfaceChains.");
  }
  const phases = buildRosettaWorkflowPhases(parsed.target, parsed.workflow, resolved, parsed.presentationMode);
  return executeWorkflowPlan(parsed, resolved, phases, runtime);
}

async function executeWorkflowPlan(
  request: ScientificWorkflowRequest,
  resolvedInputs: ScientificResolvedInputs,
  phases: WorkflowPhase[],
  runtime: ScientificWorkflowRuntime,
): Promise<ScientificWorkflowResult> {
  const commandsExecuted: string[] = [];
  const logs: string[] = [];
  const artifacts: ActionResult["artifacts"] = [];
  const metrics: ActionResult["metrics"] = [];
  const warnings = new Set<string>();
  let workflowContext: ScientificWorkflowContext | undefined;
  let latestState: Record<string, unknown> | undefined;

  for (const phase of phases) {
    if (!phase.actions.length) {
      if (phase.updateContext) {
        workflowContext = phase.updateContext;
        runtime.setWorkflowContext(request.target, phase.updateContext);
      }
      continue;
    }

    if (phase.updateContext) {
      workflowContext = phase.updateContext;
      runtime.setWorkflowContext(request.target, phase.updateContext);
    }

    const result = await runtime.executeActions(request.target, phase.actions, request.dryRun);
    commandsExecuted.push(...result.commandsExecuted);
    logs.push(`[${phase.phaseLabel}]`, ...result.logs);
    artifacts.push(...result.artifacts);
    metrics.push(...result.metrics);
    for (const warning of result.warnings) {
      warnings.add(warning);
    }
    latestState = result.state && typeof result.state === "object"
      ? result.state as Record<string, unknown>
      : latestState;
  }

  if (request.export) {
    const exportResult = await runtime.executeActions(
      request.target,
      [buildWorkflowExportAction(request.target, request.export, request.presentationMode)] as TargetAction[],
      request.dryRun,
    );
    commandsExecuted.push(...exportResult.commandsExecuted);
    logs.push("[export]", ...exportResult.logs);
    artifacts.push(...exportResult.artifacts);
    metrics.push(...exportResult.metrics);
    for (const warning of exportResult.warnings) {
      warnings.add(warning);
    }
    latestState = exportResult.state && typeof exportResult.state === "object"
      ? exportResult.state as Record<string, unknown>
      : latestState;
  }

  if (!latestState || request.dryRun) {
    latestState = workflowContext?.workflowState;
  }

  const rankedCandidates = isRosettaResolvedInputs(resolvedInputs)
    ? resolvedInputs.rankedCandidates
    : undefined;

  return scientificWorkflowResultSchema.parse({
    target: request.target,
    workflow: request.workflow,
    evidenceLevel: getScientificWorkflow(request.workflow).evidenceLevel,
    assumptions: buildWorkflowAssumptions(request.workflow, resolvedInputs),
    resolvedInputs: summarizeResolvedInputs(resolvedInputs),
    actionsExecuted: commandsExecuted.map((command) => summarizeCommand(command)),
    commandsExecuted,
    logs,
    artifacts,
    metrics: [
      ...metrics,
      ...buildWorkflowMetrics(request.workflow, resolvedInputs, rankedCandidates),
    ],
    warnings: [...warnings],
    workflowState: workflowContext?.workflowState ?? {},
    referenceHints: workflowContext?.referenceHints ?? {},
    rankedCandidates,
    state: latestState,
  });
}

function buildWorkflowMetrics(
  workflow: ScientificWorkflowKind,
  resolvedInputs: ScientificResolvedInputs,
  rankedCandidates: RankedRosettaCandidate[] | undefined,
): ActionResult["metrics"] {
  const metrics: ActionResult["metrics"] = [];

  if (isAlphaFoldResolvedInputs(resolvedInputs) && resolvedInputs.paeAnalysis) {
    metrics.push({
      kind: "contacts",
      label: "Mean PAE",
      value: roundMetric(resolvedInputs.paeAnalysis.meanPae),
      unit: "A",
      source: "computed",
      details: {
        workflow,
        residueCount: resolvedInputs.paeAnalysis.residueCount,
      },
    });
    if (resolvedInputs.paeAnalysis.uncertainInterface) {
      metrics.push({
        kind: "contacts",
        label: "Cross-chain PAE hotspot mean",
        value: roundMetric(resolvedInputs.paeAnalysis.uncertainInterface.meanPae),
        unit: "A",
        source: "computed",
      });
    }
  }

  if (isRosettaResolvedInputs(resolvedInputs) && rankedCandidates?.[0]?.score !== undefined) {
    metrics.push({
      kind: "alignment",
      label: "Top Rosetta score",
      name: rankedCandidates[0].tag,
      value: roundMetric(rankedCandidates[0].score),
      source: "computed",
      details: {
        workflow,
        scoreLabel: rankedCandidates[0].scoreLabel,
      },
    });
  }

  return metrics;
}

function buildWorkflowAssumptions(
  workflow: ScientificWorkflowKind,
  resolvedInputs: ScientificResolvedInputs,
): string[] {
  const assumptions = [...getScientificWorkflow(workflow).assumptions];
  if (isAlphaFoldResolvedInputs(resolvedInputs) && resolvedInputs.paeAnalysis) {
    assumptions.push(
      "PAE rows and columns are assumed to follow the loaded model's polymer-residue order; matching dimensions alone do not prove construct identity.",
    );
  }
  if (isVariantResolvedInputs(resolvedInputs) && resolvedInputs.ligandCode) {
    assumptions.push(
      `Ligand context uses non-polymer residues named ${resolvedInputs.ligandCode} in the primary structure; the chemical identity is not independently verified.`,
    );
  }
  if (isVariantResolvedInputs(resolvedInputs) && resolvedInputs.comparisonPath) {
    assumptions.push(
      "The optional comparison structure is aligned as global visual context; residue numbering and local variant equivalence are not inferred across structures.",
    );
  }
  return uniqueStrings(assumptions);
}

async function resolveAlphaFoldInputs(inputs: AlphaFoldInputs): Promise<AlphaFoldResolvedInputs> {
  await ensureScientificCacheDirs();
  const shouldUseAfdbModel = !inputs.modelPath && Boolean(inputs.uniprotId);
  const shouldUseAfdbPae = Boolean(inputs.uniprotId)
    && !inputs.paePath
    && (inputs.useAfdbPae === true || (shouldUseAfdbModel && inputs.useAfdbPae !== false));
  const afdbAsset = inputs.uniprotId && (shouldUseAfdbModel || shouldUseAfdbPae)
    ? await resolveAlphaFoldAsset(inputs.uniprotId, {
      format: inputs.structureFormat,
      includePae: shouldUseAfdbPae,
    })
    : undefined;
  const afdbRecord = afdbAsset?.record;
  const modelPath = inputs.modelPath
    ? ensureAllowedModelInputPath(inputs.modelPath, "AlphaFold model")
    : afdbAsset?.modelPath ?? null;

  if (!modelPath) {
    throw new Error("AlphaFold workflows require either a local modelPath or a UniProt id with an AFDB model.");
  }

  const paePath = inputs.paePath
    ? ensureAllowedJsonInputPath(inputs.paePath, "PAE JSON")
    : shouldUseAfdbPae
    ? afdbAsset?.paePath
    : undefined;

  const experimentalPath = inputs.experimentalPath
    ? ensureAllowedModelInputPath(inputs.experimentalPath, "Experimental structure")
    : inputs.experimentalPdbId
    ? await resolvePdbDownload(inputs.experimentalPdbId, inputs.experimentalPdbFormat ?? inputs.pdbFormat ?? inputs.structureFormat ?? "pdb")
    : undefined;

  const cryoMapPath = inputs.cryoMapPath
    ? ensureAllowedMapInputPath(inputs.cryoMapPath, "Cryo map")
    : inputs.cryoMapEmdbId ?? inputs.emdbId
    ? (await resolveEmdbMap(inputs.cryoMapEmdbId ?? inputs.emdbId!, { includeMetadata: false })).path
    : undefined;

  const modelAnalysis = await analyzeStructureFileCached(modelPath);
  const experimentalAnalysis = experimentalPath ? await analyzeStructureFileCached(experimentalPath) : undefined;
  const interfaceChains = validateOrInferInterfaceChains(inputs.interfaceChains, modelAnalysis, "AlphaFold model");
  validateFocusResidues(inputs.focusResidues, modelAnalysis, "AlphaFold model");
  const paeAnalysis = paePath ? await analyzePaeFileCached(paePath, modelAnalysis, interfaceChains) : undefined;

  return {
    modelPath,
    modelSource: inputs.modelPath ? "local" : "afdb",
    uniprotId: inputs.uniprotId,
    afdbRecord,
    paePath,
    paeSource: inputs.paePath ? "local" : paePath ? "afdb" : undefined,
    experimentalPath,
    experimentalSource: inputs.experimentalPath ? "local" : experimentalPath ? "rcsb" : undefined,
    cryoMapPath,
    modelAnalysis,
    experimentalAnalysis,
    paeAnalysis,
    interfaceChains,
    focusResidues: inputs.focusResidues,
  };
}

async function resolveRosettaInputs(inputs: RosettaInputs): Promise<RosettaResolvedInputs> {
  await ensureScientificCacheDirs();
  const bundlePath = inputs.bundlePath
    ? ensureAllowedStructureInputPath(inputs.bundlePath, "Rosetta bundle")
    : undefined;
  const referencePath = inputs.referencePath
    ? ensureAllowedModelInputPath(inputs.referencePath, "Reference scaffold")
    : undefined;
  const candidatePaths = await collectRosettaCandidatePaths(bundlePath, inputs.candidatePaths);
  const referenceAnalysis = referencePath ? await analyzeStructureFileCached(referencePath) : undefined;
  const rankedCandidates = inputs.scorefilePath
    ? await parseRosettaScorefileCached(
      ensureAllowedStructureInputPath(inputs.scorefilePath, "Rosetta scorefile"),
      candidatePaths,
      inputs.topN ?? 3,
    )
    : candidatePaths.slice(0, Math.max(1, inputs.topN ?? 3)).map((candidatePath, index) => ({
      rank: index + 1,
      tag: path.basename(candidatePath, path.extname(candidatePath)),
      path: candidatePath,
      matched: true,
      warnings: [],
    }));

  const primaryAnalysisCandidatePath = rankedCandidates.find((candidate) => candidate.path)?.path ?? candidatePaths[0];
  const candidateAnalyses = primaryAnalysisCandidatePath
    ? Object.fromEntries(await Promise.all(
      [primaryAnalysisCandidatePath].map(async (candidatePath) => [candidatePath, await analyzeStructureFileCached(candidatePath)] as const),
    ))
    : {};
  const primaryAnalysis = primaryAnalysisCandidatePath
    ? candidateAnalyses[primaryAnalysisCandidatePath]
    : undefined;
  const interfaceChains = validateOrInferInterfaceChains(inputs.interfaceChains, primaryAnalysis, "primary Rosetta design");
  validateFocusResidues(inputs.focusResidues, primaryAnalysis, "primary Rosetta design");
  if (inputs.ligandCode && !primaryAnalysis?.nonPolymerResidueNames.includes(inputs.ligandCode)) {
    throw new Error(`Ligand ${inputs.ligandCode} is not present as a non-polymer residue in the primary Rosetta design.`);
  }

  return {
    bundlePath,
    scorefilePath: inputs.scorefilePath ? ensureAllowedStructureInputPath(inputs.scorefilePath, "Rosetta scorefile") : undefined,
    referencePath,
    referenceAnalysis,
    candidatePaths,
    candidateAnalyses,
    rankedCandidates,
    topCandidatePath: rankedCandidates.find((candidate) => candidate.path)?.path,
    topN: Math.max(1, Math.min(8, inputs.topN ?? 3)),
    ligandCode: inputs.ligandCode,
    interfaceChains,
    focusResidues: inputs.focusResidues,
  };
}

async function resolveVariantInputs(inputs: VariantInputs): Promise<VariantResolvedInputs> {
  await ensureScientificCacheDirs();
  const afdbAsset = inputs.uniprotId && !inputs.modelPath
    ? await resolveAlphaFoldAsset(inputs.uniprotId, { format: "pdb", includePae: false })
    : undefined;
  const modelPath = inputs.modelPath
    ? ensureAllowedModelInputPath(inputs.modelPath, "Variant review model")
    : afdbAsset?.modelPath;
  if (!modelPath) {
    throw new Error("Variant environment review requires a local modelPath or a UniProt id with an AFDB model.");
  }

  const modelAnalysis = await analyzeStructureFileCached(modelPath);
  if (!modelAnalysis?.residues.length) {
    throw new Error("Variant review model does not contain any polymer ATOM residues.");
  }

  const comparisonPath = inputs.comparisonPath
    ? ensureAllowedModelInputPath(inputs.comparisonPath, "Variant comparison structure")
    : undefined;
  const comparisonAnalysis = comparisonPath
    ? await analyzeStructureFileCached(comparisonPath)
    : undefined;
  if (comparisonPath && !comparisonAnalysis?.residues.length) {
    throw new Error("Variant comparison structure does not contain any polymer ATOM residues.");
  }
  if (inputs.ligandCode && !modelAnalysis.nonPolymerResidueNames.includes(inputs.ligandCode)) {
    throw new Error(`Ligand ${inputs.ligandCode} is not present as a non-polymer residue in the variant review model.`);
  }

  return {
    modelPath,
    modelSource: inputs.modelPath ? "local" : "afdb",
    uniprotId: inputs.uniprotId,
    comparisonPath,
    modelAnalysis,
    comparisonAnalysis,
    mutations: resolveVariantSites(inputs.mutations, modelAnalysis),
    ligandCode: inputs.ligandCode,
    neighborhoodAngstroms: inputs.neighborhoodAngstroms,
  };
}

function buildAlphaFoldWorkflowPhases(
  target: TargetKind,
  workflow: AlphaFoldWorkflowKind,
  resolved: AlphaFoldResolvedInputs,
  presentationMode = "demo",
): WorkflowPhase[] {
  const refs = buildAlphaFoldReferenceHints(target, workflow, resolved);
  const loadPhase = {
    phaseLabel: "load",
    actions: buildAlphaFoldLoadActions(target, resolved),
  } satisfies WorkflowPhase;
  const stagePhase = {
    phaseLabel: "stage",
    updateContext: {
      referenceHints: refs,
      workflowState: buildAlphaFoldWorkflowState(workflow, resolved, refs),
    },
    actions: buildAlphaFoldStageActions(target, workflow, presentationMode, resolved),
  } satisfies WorkflowPhase;
  return [loadPhase, stagePhase];
}

function buildRosettaWorkflowPhases(
  target: TargetKind,
  workflow: RosettaWorkflowKind,
  resolved: RosettaResolvedInputs,
  presentationMode = "demo",
): WorkflowPhase[] {
  const refs = buildRosettaReferenceHints(target, workflow, resolved);
  const loadPhase = {
    phaseLabel: "load",
    actions: buildRosettaLoadActions(target, workflow, resolved),
  } satisfies WorkflowPhase;
  const stagePhase = {
    phaseLabel: "stage",
    updateContext: {
      referenceHints: refs,
      workflowState: buildRosettaWorkflowState(workflow, resolved, refs),
    },
    actions: buildRosettaStageActions(target, workflow, presentationMode, resolved),
  } satisfies WorkflowPhase;
  return [loadPhase, stagePhase];
}

function buildVariantWorkflowPhases(
  target: TargetKind,
  resolved: VariantResolvedInputs,
  presentationMode = "demo",
): WorkflowPhase[] {
  const refs = buildVariantReferenceHints(target, resolved);
  return [
    {
      phaseLabel: "load",
      actions: buildVariantLoadActions(target, resolved),
    },
    {
      phaseLabel: "stage",
      updateContext: {
        referenceHints: refs,
        workflowState: buildVariantWorkflowState(resolved, refs),
      },
      actions: buildVariantStageActions(target, resolved, presentationMode),
    },
  ];
}

function buildAlphaFoldLoadActions(target: TargetKind, resolved: AlphaFoldResolvedInputs): TargetAction[] {
  if (target === "pymol") {
    const actions: PymolAction[] = [
      { type: "reset_workspace" },
      {
        type: "load",
        source: "local",
        path: resolved.modelPath,
        object: "af_prediction",
        semanticRole: "predicted",
        aliases: ["predicted model", "alphafold model", "prediction"],
      },
    ];
    if (resolved.experimentalPath) {
      actions.push({
        type: "load",
        source: "local",
        path: resolved.experimentalPath,
        object: "experimental_model",
        semanticRole: "experimental",
        aliases: ["experimental model", "reference model", "experimental structure"],
      });
    }
    if (resolved.cryoMapPath) {
      actions.push({
        type: "load",
        source: "local",
        path: resolved.cryoMapPath,
        object: "cryo_map",
        aliases: ["cryo map", "density map", "map"],
      });
    }
    return actions;
  }

  const actions: ChimeraXAction[] = [
    { type: "reset_workspace" },
    {
      type: "open",
      source: "local",
      path: resolved.modelPath,
      semanticRole: "predicted",
      aliases: ["predicted model", "alphafold model", "prediction"],
    },
  ];
  if (resolved.experimentalPath) {
    actions.push({
      type: "open",
      source: "local",
      path: resolved.experimentalPath,
      semanticRole: "experimental",
      aliases: ["experimental model", "reference model", "experimental structure"],
    });
  }
  if (resolved.cryoMapPath) {
    actions.push({
      type: "open",
      source: "local",
      path: resolved.cryoMapPath,
      aliases: ["cryo map", "density map", "map"],
    });
  }
  return actions;
}

function buildRosettaLoadActions(target: TargetKind, workflow: ScientificWorkflowKind, resolved: RosettaResolvedInputs): TargetAction[] {
  const loadedCandidatePaths = getRosettaLoadedCandidatePaths(workflow, resolved);
  const candidatePath = loadedCandidatePaths[0];
  if (!candidatePath) {
    throw new Error("Rosetta workflows require at least one candidate model.");
  }

  if (target === "pymol") {
    const actions: PymolAction[] = [{ type: "reset_workspace" }];
    if (resolved.referencePath) {
      actions.push({
        type: "load",
        source: "local",
        path: resolved.referencePath,
        object: "reference_scaffold",
        semanticRole: "scaffold",
        aliases: ["reference scaffold", "scaffold", "wt scaffold"],
      });
    }

    const primaryDesignObject = workflow === "rosetta_top_design_compare" ? "design_top_1" : "rosetta_top_design";
    actions.push({
      type: "load",
      source: "local",
      path: candidatePath,
      object: primaryDesignObject,
      semanticRole: "design",
      aliases: ["design model", "top design", "rosetta design"],
    });

    loadedCandidatePaths.slice(1).forEach((topCandidatePath, index) => {
      actions.push({
        type: "load",
        source: "local",
        path: topCandidatePath,
        object: `design_top_${index + 2}`,
        semanticRole: "design",
        aliases: [`design candidate ${index + 2}`],
      });
    });

    return actions;
  }

  const actions: ChimeraXAction[] = [{ type: "reset_workspace" }];
  if (resolved.referencePath) {
    actions.push({
      type: "open",
      source: "local",
      path: resolved.referencePath,
      semanticRole: "scaffold",
      aliases: ["reference scaffold", "scaffold", "wt scaffold"],
    });
  }
  actions.push({
    type: "open",
    source: "local",
    path: candidatePath,
    semanticRole: "design",
    aliases: ["design model", "top design", "rosetta design"],
  });
  loadedCandidatePaths.slice(1).forEach((topCandidatePath, index) => {
    actions.push({
      type: "open",
      source: "local",
      path: topCandidatePath,
      semanticRole: "design",
      aliases: [`design candidate ${index + 2}`],
    });
  });
  return actions;
}

function buildVariantLoadActions(target: TargetKind, resolved: VariantResolvedInputs): TargetAction[] {
  if (target === "pymol") {
    const actions: PymolAction[] = [
      { type: "reset_workspace" },
      {
        type: "load",
        source: "local",
        path: resolved.modelPath,
        object: "variant_model",
        semanticRole: resolved.modelSource === "afdb" ? "predicted" : "partner",
        aliases: ["variant model", "review model", "primary structure"],
      },
    ];
    if (resolved.comparisonPath) {
      actions.push({
        type: "load",
        source: "local",
        path: resolved.comparisonPath,
        object: "comparison_model",
        semanticRole: "reference",
        aliases: ["comparison structure", "reference structure", "comparison model"],
      });
    }
    return actions;
  }

  const actions: ChimeraXAction[] = [
    { type: "reset_workspace" },
    {
      type: "open",
      source: "local",
      path: resolved.modelPath,
      semanticRole: resolved.modelSource === "afdb" ? "predicted" : "partner",
      aliases: ["variant model", "review model", "primary structure"],
    },
  ];
  if (resolved.comparisonPath) {
    actions.push({
      type: "open",
      source: "local",
      path: resolved.comparisonPath,
      semanticRole: "reference",
      aliases: ["comparison structure", "reference structure", "comparison model"],
    });
  }
  return actions;
}

function buildAlphaFoldStageActions(
  target: TargetKind,
  workflow: ScientificWorkflowKind,
  presentationMode: string,
  resolved: AlphaFoldResolvedInputs,
): TargetAction[] {
  const handlePlan = getAlphaFoldHandlePlan(target, resolved);
  if (target === "pymol") {
    const actions: PymolAction[] = [
      { type: "hide", representations: ["everything"] },
      { type: "show", representations: ["cartoon"], selection: { reference: "predictedModel", entity: "protein" } },
      { type: "preset", name: workflow === "alphafold_to_cryo_handoff" ? "cryo_atomic_hero" : "confidence_putty" },
      { type: "color", scheme: "b_factor", selection: { reference: "predictedModel", entity: "protein" } },
    ];

    if (workflow === "alphafold_vs_experiment_overlay" && resolved.experimentalPath) {
      actions.push(
        { type: "show", representations: ["cartoon"], selection: { reference: "experimentalModel", entity: "protein" } },
        { type: "color", color: "gray70", selection: { reference: "experimentalModel", entity: "protein" } },
        { type: "align", method: "super", mobile: { reference: "predictedModel", entity: "protein" }, target: { reference: "experimentalModel", entity: "protein" } },
      );
    }

    if (workflow === "alphafold_to_cryo_handoff" && resolved.cryoMapPath) {
      actions.push(
        { type: "map_display", mapName: "cryo_map", selection: { reference: "cryoFitRegion" }, displayAs: "mesh", buffer: 6, level: 1.2, color: "cyan" },
      );
    }

    if (hasReferenceHandle("lowConfidenceRegion", resolved, workflow)) {
      actions.push(
        { type: "show", representations: ["sticks"], selection: { reference: "lowConfidenceRegion" } },
        { type: "color", color: "tv_red", selection: { reference: "lowConfidenceRegion" } },
      );
    }

    if (workflow === "alphafold_pae_guided_triage" && hasReferenceHandle("uncertainInterface", resolved, workflow)) {
      actions.push(
        { type: "show", representations: ["sticks"], selection: { reference: "uncertainInterface" } },
        { type: "color", color: "hotpink", selection: { reference: "uncertainInterface" } },
      );
    }

    actions.push({
      type: "camera",
      action: workflow === "alphafold_to_cryo_handoff" ? "map_cutaway" : "comparison_frame",
      selection: { reference: pickAlphaFoldFocusHandle(workflow, resolved) },
      buffer: presentationMode === "publication" ? 10 : 8,
    });

    return actions;
  }

  const actions: ChimeraXAction[] = [
    { type: "visibility", mode: "show", selection: { reference: "predictedModel" } },
    { type: "style", selection: { reference: "predictedModel" }, ribbon: true },
    { type: "preset", name: workflow === "alphafold_to_cryo_handoff" ? "cryo_atomic_hero" : "confidence_hero" },
    { type: "color", scheme: "confidence", selection: { reference: "predictedModel" } },
  ];

  if (workflow === "alphafold_vs_experiment_overlay" && resolved.experimentalPath) {
    actions.push(
      { type: "visibility", mode: "show", selection: { reference: "experimentalModel" } },
      { type: "style", selection: { reference: "experimentalModel" }, ribbon: true },
      { type: "color", color: "gray70", selection: { reference: "experimentalModel" } },
      { type: "align", method: "matchmaker", mobile: { reference: "predictedModel" }, target: { reference: "experimentalModel" } },
    );
  }

  if (
    workflow === "alphafold_multimer_interface_review"
    || (workflow === "alphafold_pae_guided_triage" && resolved.interfaceChains)
  ) {
    actions.push(
      { type: "contacts", mode: "hbonds", selection1: { reference: "predictedPartnerA" }, selection2: { reference: "predictedPartnerB" } },
      { type: "contacts", mode: "contacts", selection1: { reference: "predictedPartnerA" }, selection2: { reference: "predictedPartnerB" }, distance: 4.2 },
    );
  }

  if (workflow === "alphafold_to_cryo_handoff" && resolved.cryoMapPath) {
    const mapName = handlePlan.cryoMapModelId ?? "#2";
    actions.push(
      { type: "volume", action: "mesh", mapName, level: 0.02, transparency: 25 },
      { type: "fit", mobile: { reference: resolved.experimentalPath ? "experimentalModel" : "predictedModel" }, map: mapName },
    );
  }

  if (workflow === "alphafold_pae_guided_triage" && hasReferenceHandle("uncertainInterface", resolved, workflow)) {
    actions.push(
      { type: "style", selection: { reference: "uncertainInterface" }, atoms: "stick" },
      { type: "color", color: "deeppink", selection: { reference: "uncertainInterface" } },
    );
  } else if (hasReferenceHandle("lowConfidenceRegion", resolved, workflow)) {
    actions.push(
      { type: "style", selection: { reference: "lowConfidenceRegion" }, atoms: "stick" },
      { type: "color", color: "deeppink", selection: { reference: "lowConfidenceRegion" } },
    );
  }

  actions.push({
    type: "camera",
    action: workflow === "alphafold_to_cryo_handoff" ? "map_cutaway" : "comparison_frame",
    selection: { reference: pickAlphaFoldFocusHandle(workflow, resolved) },
    amount: presentationMode === "publication" ? 14 : 12,
  });

  return actions;
}

function buildRosettaStageActions(
  target: TargetKind,
  workflow: ScientificWorkflowKind,
  presentationMode: string,
  resolved: RosettaResolvedInputs,
): TargetAction[] {
  if (target === "pymol") {
    const actions: PymolAction[] = [
      { type: "hide", representations: ["everything"] },
      ...(resolved.referencePath ? [{ type: "show", representations: ["cartoon"], selection: { reference: "referenceScaffold", entity: "protein" } } satisfies PymolAction] : []),
      { type: "show", representations: ["cartoon"], selection: { reference: workflow === "rosetta_top_design_compare" ? "designPanel" : "topDesign", entity: "protein" } },
      { type: "preset", name: workflow === "rosetta_ligand_redesign_review" ? "ligand_editorial" : "comparison_hero" },
    ];

    if (resolved.referencePath) {
      actions.push({ type: "color", color: "gray70", selection: { reference: "referenceScaffold", entity: "protein" } });
      actions.push({ type: "align", method: "cealign", mobile: { reference: "topDesign", entity: "protein" }, target: { reference: "referenceScaffold", entity: "protein" } });
    }

    if (workflow === "rosetta_top_design_compare") {
      resolved.rankedCandidates
        .filter((candidate) => candidate.path)
        .slice(0, resolved.topN)
        .forEach((candidate, index) => {
          actions.push({ type: "transform", mode: "translate", selection: { reference: index === 0 ? "topDesign" : `designCandidate${index + 1}` }, axis: "x", amount: index * 24 });
        });
    }

    if (hasRosettaFocusHandle(workflow, resolved)) {
      const focusHandle = pickRosettaFocusHandle(workflow, resolved);
      actions.push(
        { type: "show", representations: ["sticks"], selection: { reference: focusHandle } },
        { type: "color", color: "hotpink", selection: { reference: focusHandle } },
      );
    }

    if (workflow === "rosetta_ligand_redesign_review" && resolved.ligandCode) {
      actions.push(
        { type: "show", representations: ["sticks"], selection: { reference: "ligandRedesignShell" } },
      );
    }

    actions.push({
      type: "camera",
      action: workflow === "rosetta_ligand_redesign_review" ? "pocket_frame" : "comparison_frame",
      selection: { reference: pickRosettaCameraHandle(workflow, resolved) },
      buffer: presentationMode === "publication" ? 10 : 8,
    });

    return actions;
  }

  const actions: ChimeraXAction[] = [
    ...(resolved.referencePath ? [{ type: "style", selection: { reference: "referenceScaffold" }, ribbon: true } satisfies ChimeraXAction] : []),
    { type: "style", selection: { reference: workflow === "rosetta_top_design_compare" ? "designPanel" : "topDesign" }, ribbon: true },
    { type: "preset", name: workflow === "rosetta_interface_packing_review" ? "assembly_editorial" : workflow === "rosetta_ligand_redesign_review" ? "ligand_editorial" : "comparison_hero" },
  ];

  if (resolved.referencePath) {
    actions.push(
      { type: "color", color: "gray70", selection: { reference: "referenceScaffold" } },
      { type: "align", method: "matchmaker", mobile: { reference: "topDesign" }, target: { reference: "referenceScaffold" } },
    );
  }

  if (workflow === "rosetta_interface_packing_review") {
    actions.push(
      { type: "contacts", mode: "hbonds", selection1: { reference: "partnerA" }, selection2: { reference: "partnerB" } },
      { type: "contacts", mode: "contacts", selection1: { reference: "partnerA" }, selection2: { reference: "partnerB" }, distance: 4.2 },
      { type: "style", selection: { reference: "interfacePatch" }, atoms: "stick", ribbon: true },
      { type: "color", color: "deeppink", selection: { reference: "interfacePatch" } },
    );
  }

  if (workflow === "rosetta_top_design_compare") {
    actions.push({ type: "layout", mode: "tile" });
  } else if (workflow !== "rosetta_interface_packing_review" && hasRosettaFocusHandle(workflow, resolved)) {
    actions.push(
      { type: "style", selection: { reference: pickRosettaFocusHandle(workflow, resolved) }, atoms: "stick" },
      { type: "color", color: "deeppink", selection: { reference: pickRosettaFocusHandle(workflow, resolved) } },
    );
  }

  actions.push({
    type: "camera",
    action: workflow === "rosetta_ligand_redesign_review" ? "pocket_frame" : "comparison_frame",
    selection: { reference: pickRosettaCameraHandle(workflow, resolved) },
    amount: presentationMode === "publication" ? 16 : 12,
  });

  return actions;
}

function buildVariantStageActions(
  target: TargetKind,
  resolved: VariantResolvedInputs,
  presentationMode: string,
): TargetAction[] {
  if (target === "pymol") {
    const actions: PymolAction[] = [
      { type: "hide", representations: ["everything"] },
      { type: "show", representations: ["cartoon"], selection: { reference: "variantModel", entity: "protein" } },
      { type: "preset", name: resolved.ligandCode ? "ligand_editorial" : "comparison_hero" },
      { type: "color", color: "gray80", selection: { reference: "variantModel", entity: "protein" } },
    ];
    if (resolved.comparisonPath) {
      actions.push(
        { type: "show", representations: ["cartoon"], selection: { reference: "comparisonModel", entity: "protein" } },
        { type: "color", color: "gray40", selection: { reference: "comparisonModel", entity: "protein" } },
        { type: "align", method: "super", mobile: { reference: "variantModel", entity: "protein" }, target: { reference: "comparisonModel", entity: "protein" } },
      );
    }
    actions.push(
      { type: "show", representations: ["sticks"], selection: { reference: "variantNeighborhood" } },
      { type: "color", color: "hotpink", selection: { reference: "variantNeighborhood" } },
      { type: "show", representations: ["sticks", "spheres"], selection: { reference: "variantSites" } },
      { type: "color", color: "tv_red", selection: { reference: "variantSites" } },
      { type: "contacts", mode: "contacts", name: "variant_local_contacts", selection1: { reference: "variantSites" }, selection2: { reference: "variantNeighborhood" }, cutoff: 4.5 },
    );
    if (resolved.ligandCode) {
      actions.push(
        { type: "show", representations: ["sticks"], selection: { reference: "variantLigand" } },
        { type: "color", color: "yellow", selection: { reference: "variantLigand" } },
        { type: "contacts", mode: "polar_contacts", name: "variant_ligand_contacts", selection1: { reference: "variantNeighborhood" }, selection2: { reference: "variantLigand" }, cutoff: 4.0 },
      );
    }
    actions.push(
      { type: "camera", action: "pocket_frame", selection: { reference: "variantNeighborhood" }, buffer: presentationMode === "publication" ? 10 : 8 },
      { type: "scene", action: "view_store", key: "variant_closeup", message: "Variant environment close-up" },
    );
    return actions;
  }

  const actions: ChimeraXAction[] = [
    { type: "visibility", mode: "show", selection: { reference: "variantModel" } },
    { type: "style", selection: { reference: "variantModel", entity: "protein" }, ribbon: true },
    { type: "preset", name: resolved.ligandCode ? "ligand_editorial" : "comparison_hero" },
    { type: "color", color: "gray80", selection: { reference: "variantModel", entity: "protein" } },
  ];
  if (resolved.comparisonPath) {
    actions.push(
      { type: "visibility", mode: "show", selection: { reference: "comparisonModel" } },
      { type: "style", selection: { reference: "comparisonModel", entity: "protein" }, ribbon: true },
      { type: "color", color: "gray40", selection: { reference: "comparisonModel", entity: "protein" } },
      { type: "align", method: "matchmaker", mobile: { reference: "variantModel", entity: "protein" }, target: { reference: "comparisonModel", entity: "protein" } },
    );
  }
  actions.push(
    { type: "style", selection: { reference: "variantNeighborhood" }, atoms: "stick", ribbon: true },
    { type: "color", color: "hotpink", selection: { reference: "variantNeighborhood" } },
    { type: "style", selection: { reference: "variantSites" }, atoms: "sphere" },
    { type: "color", color: "red", selection: { reference: "variantSites" } },
    { type: "contacts", mode: "contacts", selection1: { reference: "variantSites" }, selection2: { reference: "variantNeighborhood" }, distance: 4.5 },
  );
  if (resolved.ligandCode) {
    actions.push(
      { type: "style", selection: { reference: "variantLigand" }, atoms: "stick" },
      { type: "color", color: "yellow", selection: { reference: "variantLigand" } },
      { type: "contacts", mode: "hbonds", selection1: { reference: "variantNeighborhood" }, selection2: { reference: "variantLigand" }, distance: 4.0 },
    );
  }
  actions.push(
    { type: "camera", action: "pocket_frame", selection: { reference: "variantNeighborhood" }, amount: presentationMode === "publication" ? 16 : 12 },
    { type: "view", action: "save", name: "variant_closeup" },
  );
  return actions;
}

function buildAlphaFoldReferenceHints(
  target: TargetKind,
  workflow: ScientificWorkflowKind,
  resolved: AlphaFoldResolvedInputs,
): Record<string, ReferenceHint> {
  const handlePlan = getAlphaFoldHandlePlan(target, resolved);
  const refs = createBaseAlphaFoldReferenceHints(target, resolved, handlePlan);
  const focusWindow = resolved.focusResidues?.length
    ? buildResidueWindowFromHints(resolved.modelAnalysis, resolved.focusResidues, "Focus residues")
    : resolved.modelAnalysis?.lowConfidenceRanges[0] ?? resolved.paeAnalysis?.worstWindow;

  if (focusWindow) {
    refs.lowConfidenceRegion = createRegionReference(handlePlan.predicted, focusWindow, "Low-confidence region");
    refs.experimentalOverlayRegion = workflow === "alphafold_vs_experiment_overlay" && resolved.experimentalPath
      ? createOverlayRegionReference(target, handlePlan, focusWindow, "Experimental overlay region")
      : refs.lowConfidenceRegion;
    refs.cryoFitRegion = workflow === "alphafold_to_cryo_handoff"
      ? refs.lowConfidenceRegion
      : refs.experimentalOverlayRegion;
  }

  const interfaceSummary = resolved.paeAnalysis?.uncertainInterface;
  if (interfaceSummary) {
    refs.uncertainInterface = createInterfaceReference(target, interfaceSummary, "Cross-chain PAE hotspots");
  }

  if (resolved.interfaceChains?.[0]) {
    refs.predictedPartnerA = createChainReference(handlePlan.predicted, resolved.interfaceChains[0], "Predicted partner A");
  }
  if (resolved.interfaceChains?.[1]) {
    refs.predictedPartnerB = createChainReference(handlePlan.predicted, resolved.interfaceChains[1], "Predicted partner B");
  }

  return refs;
}

function buildRosettaReferenceHints(
  target: TargetKind,
  workflow: ScientificWorkflowKind,
  resolved: RosettaResolvedInputs,
): Record<string, ReferenceHint> {
  const handlePlan = getRosettaHandlePlan(target, workflow, resolved);
  const refs = createBaseRosettaReferenceHints(target, workflow, resolved, handlePlan);
  const loadedTopCandidatePath = getRosettaLoadedCandidatePaths(workflow, resolved)[0];
  const topAnalysis = loadedTopCandidatePath ? resolved.candidateAnalyses[loadedTopCandidatePath] : undefined;
  const mutationWindow = resolved.focusResidues?.length
    ? buildResidueWindowFromHints(topAnalysis, resolved.focusResidues, "Focus residues")
    : buildMutationWindow(resolved.referenceAnalysis, topAnalysis);

  if (mutationWindow) {
    refs.mutatedShell = createRegionReference(handlePlan.topDesign, mutationWindow, "Mutated shell");
    refs.interfacePatch = refs.mutatedShell;
    refs.ligandRedesignShell = refs.mutatedShell;
  }

  if (resolved.interfaceChains) {
    refs.interfacePatch = createGeometricInterfaceReference(
      target,
      handlePlan.topDesign,
      resolved.interfaceChains,
    );
  }
  if (resolved.ligandCode) {
    refs.ligandRedesignShell = createLigandShellReference(target, handlePlan.topDesign, resolved.ligandCode);
  }

  if (resolved.interfaceChains?.[0]) {
    refs.partnerA = createChainReference(handlePlan.topDesign, resolved.interfaceChains[0], "Design partner A");
  }
  if (resolved.interfaceChains?.[1]) {
    refs.partnerB = createChainReference(handlePlan.topDesign, resolved.interfaceChains[1], "Design partner B");
  }

  return refs;
}

function buildVariantReferenceHints(
  target: TargetKind,
  resolved: VariantResolvedInputs,
): Record<string, ReferenceHint> {
  const variantHandle: StructureHandle = target === "pymol"
    ? { object: "variant_model" }
    : { model: "#1" };
  const siteSelector = buildVariantSiteSelector(target, resolved.mutations, variantHandle);
  const refs: Record<string, ReferenceHint> = {
    variantModel: {
      label: "Variant review model",
      selector: variantHandle,
      aliases: ["variant model", "review model", "primary structure"],
    },
    variantSites: {
      label: "Variant sites",
      selector: siteSelector,
      reason: `Resolved ${resolved.mutations.length} annotated residue site(s) in the loaded polymer model.`,
      aliases: ["variant sites", "mutations", "changed residues"],
    },
    variantNeighborhood: {
      label: "Variant neighborhood",
      selector: buildVariantNeighborhoodSelector(
        target,
        siteSelector,
        variantHandle,
        resolved.neighborhoodAngstroms,
      ),
      reason: `Polymer residues within ${resolved.neighborhoodAngstroms} A of the annotated sites.`,
      aliases: ["variant neighborhood", "mutation environment", "local environment"],
    },
  };

  if (resolved.comparisonPath) {
    refs.comparisonModel = {
      label: "Comparison structure",
      selector: target === "pymol" ? { object: "comparison_model" } : { model: "#2" },
      aliases: ["comparison structure", "reference structure", "comparison model"],
    };
    refs.referenceModel = refs.comparisonModel;
  }
  if (resolved.ligandCode) {
    refs.variantLigand = {
      label: `Ligand ${resolved.ligandCode}`,
      selector: "object" in variantHandle
        ? { object: variantHandle.object, ligand: resolved.ligandCode }
        : { model: variantHandle.model, ligand: resolved.ligandCode },
      reason: "Ligand identity is selected by residue code in the primary structure.",
      aliases: ["variant ligand", "nearby ligand", resolved.ligandCode],
    };
    refs.ligandContext = refs.variantLigand;
  }

  return refs;
}

function buildAlphaFoldWorkflowState(
  workflow: ScientificWorkflowKind,
  resolved: AlphaFoldResolvedInputs,
  refs: Record<string, ReferenceHint>,
): Record<string, unknown> {
  return {
    workflow,
    source: resolved.modelSource,
    uniprotId: resolved.uniprotId,
    modelPath: resolved.modelPath,
    experimentalPath: resolved.experimentalPath,
    cryoMapPath: resolved.cryoMapPath,
    paePath: resolved.paePath,
    lowConfidenceRegion: refs.lowConfidenceRegion,
    uncertainInterface: refs.uncertainInterface,
    interfaceChains: resolved.interfaceChains,
    confidenceSummary: resolved.modelAnalysis?.lowConfidenceRanges.map(summarizeWindow),
    paeSummary: resolved.paeAnalysis
      ? {
          residueCount: resolved.paeAnalysis.residueCount,
          meanPae: roundMetric(resolved.paeAnalysis.meanPae),
          worstWindow: resolved.paeAnalysis.worstWindow ? summarizeWindow(resolved.paeAnalysis.worstWindow) : null,
          uncertainInterface: resolved.paeAnalysis.uncertainInterface ?? null,
        }
      : undefined,
  };
}

function buildRosettaWorkflowState(
  workflow: ScientificWorkflowKind,
  resolved: RosettaResolvedInputs,
  refs: Record<string, ReferenceHint>,
): Record<string, unknown> {
  return {
    workflow,
    referencePath: resolved.referencePath,
    topCandidatePath: resolved.topCandidatePath,
    topN: resolved.topN,
    ligandCode: resolved.ligandCode,
    topDesign: refs.topDesign,
    mutatedShell: refs.mutatedShell,
    interfacePatch: refs.interfacePatch,
    rankedCandidates: resolved.rankedCandidates,
  };
}

function buildVariantWorkflowState(
  resolved: VariantResolvedInputs,
  refs: Record<string, ReferenceHint>,
): Record<string, unknown> {
  return {
    workflow: "variant_environment_review",
    modelSource: resolved.modelSource,
    uniprotId: resolved.uniprotId,
    modelPath: resolved.modelPath,
    comparisonPath: resolved.comparisonPath,
    mutations: resolved.mutations,
    ligandCode: resolved.ligandCode,
    neighborhoodAngstroms: resolved.neighborhoodAngstroms,
    variantSites: refs.variantSites,
    variantNeighborhood: refs.variantNeighborhood,
  };
}

function createBaseAlphaFoldReferenceHints(
  target: TargetKind,
  resolved: AlphaFoldResolvedInputs,
  handlePlan: AlphaFoldHandlePlan,
): Record<string, ReferenceHint> {
  const refs: Record<string, ReferenceHint> = {
    predictedModel: { label: "Predicted model", selector: handlePlan.predicted, aliases: ["predicted model", "alphafold model", "prediction"] },
  };
  if (resolved.experimentalPath && handlePlan.experimental) {
    refs.experimentalModel = { label: "Experimental model", selector: handlePlan.experimental, aliases: ["experimental model", "reference model"] };
    refs.referenceModel = refs.experimentalModel;
  }
  if (resolved.cryoMapPath && handlePlan.cryoMap) {
    refs.map = { label: "Cryo map", selector: "model" in handlePlan.cryoMap ? handlePlan.cryoMap.model : handlePlan.cryoMap, aliases: ["map", "density map", "cryo map"] };
    refs.cryoFitRegion = refs.predictedModel;
  }
  return refs;
}

function createBaseRosettaReferenceHints(
  target: TargetKind,
  workflow: ScientificWorkflowKind,
  resolved: RosettaResolvedInputs,
  handlePlan: RosettaHandlePlan,
): Record<string, ReferenceHint> {
  const refs: Record<string, ReferenceHint> = {
    topDesign: { label: "Top design", selector: handlePlan.topDesign, aliases: ["top design", "design model", "best design"] },
  };
  if (resolved.referencePath && handlePlan.reference) {
    refs.referenceScaffold = { label: "Reference scaffold", selector: handlePlan.reference, aliases: ["reference scaffold", "scaffold", "wt scaffold"] };
    refs.scaffoldModel = refs.referenceScaffold;
  }
  if (workflow === "rosetta_top_design_compare") {
    refs.designPanel = {
      label: "Design panel",
      selector: handlePlan.designPanelSelector,
      aliases: ["design panel", "top designs", "design lineup"],
    };
    handlePlan.loadedDesigns.slice(1).forEach((candidate, index) => {
      refs[`designCandidate${index + 2}`] = {
        label: `Design candidate ${index + 2}`,
        selector: candidate.selector,
        aliases: [`design candidate ${index + 2}`],
      };
    });
  } else {
    refs.designPanel = refs.topDesign;
  }
  return refs;
}

function buildWorkflowExportAction(
  target: TargetKind,
  input: ScientificWorkflowRequest["export"],
  presentationMode: string | undefined,
): TargetAction {
  const width = input?.width ?? (presentationMode === "publication" ? 3200 : 2200);
  const height = input?.height ?? (presentationMode === "publication" ? 2100 : 1500);
  if (target === "pymol") {
    return {
      type: "export",
      export: {
        format: input?.format === "pse" || input?.format === "session" ? "pse" : "png",
        path: input?.path,
        width,
        height,
        rayTrace: input?.rayTrace ?? presentationMode === "publication",
      },
    } satisfies PymolAction;
  }

  return {
    type: "export",
    export: {
      format: input?.format === "cxs" || input?.format === "session" ? "cxs" : "png",
      path: input?.path,
      width,
      height,
    },
  } satisfies ChimeraXAction;
}

function getAlphaFoldHandlePlan(target: TargetKind, resolved: AlphaFoldResolvedInputs): AlphaFoldHandlePlan {
  if (target === "pymol") {
    return {
      predicted: { object: "af_prediction" },
      experimental: resolved.experimentalPath ? { object: "experimental_model" } : undefined,
      cryoMap: resolved.cryoMapPath ? { object: "cryo_map" } : undefined,
    };
  }

  let nextModelId = 1;
  const predicted = { model: `#${nextModelId}` } satisfies StructureHandle;
  nextModelId += 1;
  const experimental = resolved.experimentalPath
    ? ({ model: `#${nextModelId++}` } satisfies StructureHandle)
    : undefined;
  const cryoMapModelId = resolved.cryoMapPath ? `#${nextModelId}` : undefined;

  return {
    predicted,
    experimental,
    cryoMap: cryoMapModelId ? { model: cryoMapModelId } : undefined,
    cryoMapModelId,
  };
}

function getRosettaLoadedCandidatePaths(workflow: ScientificWorkflowKind, resolved: RosettaResolvedInputs): string[] {
  const primaryCandidatePath = resolved.topCandidatePath ?? resolved.candidatePaths[0];
  if (!primaryCandidatePath) {
    return [];
  }

  const additionalTopCandidates = workflow === "rosetta_top_design_compare"
    ? resolved.rankedCandidates
      .filter((candidate) => candidate.path)
      .slice(0, resolved.topN)
      .map((candidate) => candidate.path!)
      .filter((candidatePath, index, values) => values.indexOf(candidatePath) === index)
    : [];

  return [
    primaryCandidatePath,
    ...additionalTopCandidates.filter((candidatePath) => candidatePath !== primaryCandidatePath),
  ];
}

function getRosettaHandlePlan(
  target: TargetKind,
  workflow: ScientificWorkflowKind,
  resolved: RosettaResolvedInputs,
): RosettaHandlePlan {
  const loadedCandidates = getRosettaLoadedCandidatePaths(workflow, resolved);
  if (!loadedCandidates.length) {
    throw new Error("Rosetta workflows require at least one candidate model.");
  }

  if (target === "pymol") {
    const loadedDesigns = loadedCandidates.map((_, index) => ({
      key: index === 0 ? "topDesign" : `designCandidate${index + 1}`,
      selector: { object: workflow === "rosetta_top_design_compare" ? `design_top_${index + 1}` : "rosetta_top_design" } satisfies StructureHandle,
    }));

    return {
      reference: resolved.referencePath ? { object: "reference_scaffold" } : undefined,
      topDesign: loadedDesigns[0]?.selector ?? { object: "rosetta_top_design" },
      loadedDesigns,
      designPanelSelector: workflow === "rosetta_top_design_compare"
        ? loadedDesigns.map((candidate) => (candidate.selector as { object: string }).object).join(" or ")
        : loadedDesigns[0]?.selector ?? { object: "rosetta_top_design" },
    };
  }

  let nextModelId = resolved.referencePath ? 2 : 1;
  const loadedDesigns = loadedCandidates.map((_, index) => ({
    key: index === 0 ? "topDesign" : `designCandidate${index + 1}`,
    selector: { model: `#${nextModelId + index}` } satisfies StructureHandle,
  }));

  return {
    reference: resolved.referencePath ? { model: "#1" } : undefined,
    topDesign: loadedDesigns[0]?.selector ?? { model: resolved.referencePath ? "#2" : "#1" },
    loadedDesigns,
    designPanelSelector: workflow === "rosetta_top_design_compare"
      ? loadedDesigns.map((candidate) => `(${(candidate.selector as { model: string }).model})`).join("|")
      : loadedDesigns[0]?.selector ?? { model: resolved.referencePath ? "#2" : "#1" },
  };
}

function pickAlphaFoldFocusHandle(workflow: ScientificWorkflowKind, resolved: AlphaFoldResolvedInputs): string {
  if (workflow === "alphafold_pae_guided_triage" && resolved.paeAnalysis?.uncertainInterface) {
    return "uncertainInterface";
  }
  if (workflow === "alphafold_to_cryo_handoff") {
    return "cryoFitRegion";
  }
  if (workflow === "alphafold_vs_experiment_overlay") {
    return hasReferenceHandle("lowConfidenceRegion", resolved, workflow)
      ? "experimentalOverlayRegion"
      : resolved.experimentalPath
      ? "experimentalModel"
      : "predictedModel";
  }
  return hasReferenceHandle("lowConfidenceRegion", resolved, workflow)
    ? "lowConfidenceRegion"
    : "predictedModel";
}

function hasReferenceHandle(name: string, resolved: AlphaFoldResolvedInputs, workflow: ScientificWorkflowKind): boolean {
  if (name === "uncertainInterface") {
    return workflow === "alphafold_pae_guided_triage" && Boolean(resolved.paeAnalysis?.uncertainInterface);
  }
  return Boolean(resolved.focusResidues?.length || resolved.modelAnalysis?.lowConfidenceRanges[0] || resolved.paeAnalysis?.worstWindow);
}

function pickRosettaFocusHandle(workflow: ScientificWorkflowKind, resolved: RosettaResolvedInputs): string {
  if (workflow === "rosetta_interface_packing_review") {
    return "interfacePatch";
  }
  if (workflow === "rosetta_ligand_redesign_review") {
    return "ligandRedesignShell";
  }
  if (workflow === "rosetta_top_design_compare") {
    return "designPanel";
  }
  return "mutatedShell";
}

function pickRosettaCameraHandle(workflow: ScientificWorkflowKind, resolved: RosettaResolvedInputs): string {
  if (workflow === "rosetta_interface_packing_review") {
    return "topDesign";
  }
  return hasRosettaFocusHandle(workflow, resolved)
    ? pickRosettaFocusHandle(workflow, resolved)
    : "topDesign";
}

function hasRosettaFocusHandle(workflow: ScientificWorkflowKind, resolved: RosettaResolvedInputs): boolean {
  if (workflow === "rosetta_top_design_compare") {
    return true;
  }
  if (workflow === "rosetta_interface_packing_review") {
    return Boolean(resolved.interfaceChains);
  }
  if (workflow === "rosetta_ligand_redesign_review" && resolved.ligandCode) {
    return true;
  }
  const topCandidatePath = getRosettaLoadedCandidatePaths(workflow, resolved)[0];
  const topAnalysis = topCandidatePath ? resolved.candidateAnalyses[topCandidatePath] : undefined;
  return Boolean(
    resolved.focusResidues?.length
    || buildMutationWindow(resolved.referenceAnalysis, topAnalysis),
  );
}

function resolveVariantSites(
  sites: VariantSite[],
  structure: StructureAnalysis,
): ResolvedVariantSite[] {
  const resolved: ResolvedVariantSite[] = [];
  const seen = new Set<string>();

  for (const site of sites) {
    const matches = structure.residues.filter((residue) => (
      residue.residue === site.position
      && (!site.chain || residue.chain === site.chain)
    ));
    if (!matches.length) {
      const scope = site.chain ? `${site.chain}:` : "";
      throw new Error(`Variant site ${scope}${site.position} was not found among polymer residues in the review model.`);
    }

    const matchingChains = [...new Set(matches.map((residue) => residue.chain))];
    if (!site.chain && matchingChains.length > 1) {
      throw new Error(
        `Variant residue ${site.position} is ambiguous across chains ${matchingChains.map((chain) => chain || "unlabeled").join(", ")}; provide a chain identifier.`,
      );
    }

    const match = matches[0];
    const key = `${match.chain}:${match.residue}`;
    if (seen.has(key)) {
      throw new Error(`Variant site ${key} was provided more than once.`);
    }
    seen.add(key);

    if (site.from && normalizeAminoAcidCode(site.from) !== normalizeAminoAcidCode(match.residueName)) {
      throw new Error(
        `Variant site ${key} expected ${site.from}, but the loaded model contains ${match.residueName}.`,
      );
    }

    resolved.push({
      ...site,
      chain: match.chain,
      residueName: match.residueName,
      label: `${site.from ?? match.residueName}${site.position}${site.to ?? ""}`,
    });
  }

  return resolved;
}

function buildVariantSiteSelector(
  target: TargetKind,
  sites: ResolvedVariantSite[],
  model: StructureHandle,
): string {
  const byChain = groupBy(sites, (site) => site.chain);
  const selector = target === "pymol"
    ? Object.entries(byChain)
      .map(([chain, chainSites]) => {
        const residues = uniqueStrings(chainSites.map((site) => site.position)).join("+");
        const object = "object" in model ? model.object : "variant_model";
        return chain
          ? `(${object} and chain ${chain} and resi ${residues})`
          : `(${object} and resi ${residues})`;
      })
      .join(" or ")
    : Object.entries(byChain)
      .map(([chain, chainSites]) => {
        const residues = uniqueStrings(chainSites.map((site) => site.position)).join(",");
        const modelId = "model" in model ? model.model : "#1";
        return chain ? `(${modelId}/${chain}:${residues})` : `(${modelId}:${residues})`;
      })
      .join("|");

  if (!selector || selector.length > 400) {
    throw new Error("The combined variant-site selector is too large; split the sites into smaller reviews.");
  }
  return selector;
}

function buildVariantNeighborhoodSelector(
  target: TargetKind,
  sites: string,
  model: StructureHandle,
  distance: number,
): string {
  const selector = target === "pymol"
    ? `byres (${"object" in model ? model.object : "variant_model"} and polymer.protein and ((${sites}) around ${distance}))`
    : `((${sites}) :< ${distance}) & ${"model" in model ? model.model : "#1"} & protein & ~(${sites})`;
  if (selector.length > 400) {
    throw new Error("The combined variant-neighborhood selector is too large; split the sites into smaller reviews.");
  }
  return selector;
}

const aminoAcidThreeLetterCodes: Record<string, string> = {
  A: "ALA",
  R: "ARG",
  N: "ASN",
  D: "ASP",
  C: "CYS",
  Q: "GLN",
  E: "GLU",
  G: "GLY",
  H: "HIS",
  I: "ILE",
  L: "LEU",
  K: "LYS",
  M: "MET",
  F: "PHE",
  P: "PRO",
  S: "SER",
  T: "THR",
  W: "TRP",
  Y: "TYR",
  V: "VAL",
  U: "SEC",
  O: "PYL",
};

function normalizeAminoAcidCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return aminoAcidThreeLetterCodes[normalized] ?? normalized;
}

function createChainReference(
  base: StructureHandle,
  chain: string,
  label: string,
): ReferenceHint {
  return {
    label,
    selector: "object" in base ? { object: base.object, chain } : { model: base.model, chain },
    aliases: [label.toLowerCase(), `${label.toLowerCase()} chain ${chain}`],
  };
}

function createRegionReference(
  base: StructureHandle,
  window: ResidueWindow,
  label: string,
): ReferenceHint {
  return {
    label,
    selector: "object" in base
      ? { object: base.object, ...(window.chain ? { chain: window.chain } : {}), residues: window.residueLabels }
      : { model: base.model, ...(window.chain ? { chain: window.chain } : {}), residues: window.residueLabels },
    reason: `${label} spans ${window.chain ? `${window.chain}:` : "unlabeled chain "}${window.startResidue}-${window.endResidue}.`,
    aliases: [label.toLowerCase(), `${label.toLowerCase()} ${window.chain ? `${window.chain} ` : ""}${window.startResidue}-${window.endResidue}`],
  };
}

function createOverlayRegionReference(
  target: TargetKind,
  handlePlan: AlphaFoldHandlePlan,
  window: ResidueWindow,
  label: string,
): ReferenceHint {
  if (target === "pymol") {
    const chainClause = window.chain ? ` and chain ${window.chain}` : "";
    return {
      label,
      selector: `(experimental_model${chainClause} and resi ${window.residueLabels.join("+")}) or (af_prediction${chainClause} and resi ${window.residueLabels.join("+")})`,
    };
  }

  const predictedModel = "model" in handlePlan.predicted ? handlePlan.predicted.model : "#1";
  const experimentalModel = handlePlan.experimental && "model" in handlePlan.experimental ? handlePlan.experimental.model : "#2";
  return {
    label,
    selector: window.chain
      ? `(${predictedModel}/${window.chain}:${window.startResidue}-${window.endResidue})|(${experimentalModel}/${window.chain}:${window.startResidue}-${window.endResidue})`
      : `(${predictedModel}:${window.startResidue}-${window.endResidue})|(${experimentalModel}:${window.startResidue}-${window.endResidue})`,
  };
}

function createInterfaceReference(
  target: TargetKind,
  input: NonNullable<PAEAnalysis["uncertainInterface"]>,
  label: string,
): ReferenceHint {
  if (target === "pymol") {
    return {
      label,
      selector: `(af_prediction and chain ${input.chains[0]} and resi ${input.chainAResidues.join("+")}) or (af_prediction and chain ${input.chains[1]} and resi ${input.chainBResidues.join("+")})`,
      reason: "Top residues by mean cross-chain PAE; this is an uncertainty hotspot view, not a geometric interface assignment.",
    };
  }

  const rangeA = compactResidueLabels(input.chainAResidues);
  const rangeB = compactResidueLabels(input.chainBResidues);
  return {
    label,
    selector: `(#1/${input.chains[0]}:${rangeA})|(#1/${input.chains[1]}:${rangeB})`,
    reason: "Top residues by mean cross-chain PAE; this is an uncertainty hotspot view, not a geometric interface assignment.",
  };
}

function createGeometricInterfaceReference(
  target: TargetKind,
  designHandle: StructureHandle,
  chains: [string, string],
): ReferenceHint {
  if (target === "pymol") {
    const objectName = "object" in designHandle ? designHandle.object : "rosetta_top_design";
    return {
      label: "Geometric interface patch",
      selector: `byres ((((${objectName} and chain ${chains[0]}) within 5 of (${objectName} and chain ${chains[1]}))) or (((${objectName} and chain ${chains[1]}) within 5 of (${objectName} and chain ${chains[0]}))))`,
      reason: `Polymer residues within 5 A across chains ${chains[0]} and ${chains[1]}.`,
      aliases: ["interface patch", "designed interface", "packing shell"],
    };
  }

  const model = "model" in designHandle ? designHandle.model : "#1";
  return {
    label: "Geometric interface patch",
    selector: `(((${model}/${chains[1]}) :< 5) & ${model}/${chains[0]} & protein)|(((${model}/${chains[0]}) :< 5) & ${model}/${chains[1]} & protein)`,
    reason: `Polymer residues within 5 A across chains ${chains[0]} and ${chains[1]}.`,
    aliases: ["interface patch", "designed interface", "packing shell"],
  };
}

function createLigandShellReference(target: TargetKind, designHandle: StructureHandle, ligandCode: string): ReferenceHint {
  if (target === "pymol") {
    const objectName = "object" in designHandle ? designHandle.object : "rosetta_top_design";
    return {
      label: "Ligand redesign shell",
      selector: { object: objectName, around: `${objectName} and resn ${ligandCode}`, withinAngstroms: 5, byResidue: true },
    };
  }

  const model = "model" in designHandle ? designHandle.model : "#1";
  return {
    label: "Ligand redesign shell",
    selector: `((${model}:${ligandCode}) :< 5) & ${model} & protein`,
  };
}

function summarizeResolvedInputs(input: ScientificResolvedInputs): Record<string, unknown> {
  if (isAlphaFoldResolvedInputs(input)) {
    return {
      modelPath: input.modelPath,
      modelSource: input.modelSource,
      uniprotId: input.uniprotId,
      paePath: input.paePath,
      experimentalPath: input.experimentalPath,
      cryoMapPath: input.cryoMapPath,
      chains: input.modelAnalysis?.chains ?? [],
      lowConfidenceRanges: input.modelAnalysis?.lowConfidenceRanges.map(summarizeWindow) ?? [],
      paeSummary: input.paeAnalysis
        ? {
            residueCount: input.paeAnalysis.residueCount,
            meanPae: roundMetric(input.paeAnalysis.meanPae),
            maxPae: roundMetric(input.paeAnalysis.maxPae),
            worstWindow: input.paeAnalysis.worstWindow ? summarizeWindow(input.paeAnalysis.worstWindow) : null,
            uncertainInterface: input.paeAnalysis.uncertainInterface ?? null,
          }
        : undefined,
    };
  }

  if (isVariantResolvedInputs(input)) {
    return {
      modelPath: input.modelPath,
      modelSource: input.modelSource,
      uniprotId: input.uniprotId,
      comparisonPath: input.comparisonPath,
      mutations: input.mutations,
      ligandCode: input.ligandCode,
      neighborhoodAngstroms: input.neighborhoodAngstroms,
      chains: input.modelAnalysis.chains,
    };
  }

  return {
    bundlePath: input.bundlePath,
    scorefilePath: input.scorefilePath,
    referencePath: input.referencePath,
    topN: input.topN,
    ligandCode: input.ligandCode,
    candidatePaths: input.candidatePaths,
    rankedCandidates: input.rankedCandidates,
  };
}

async function resolvePdbDownload(pdbId: string, format: StructureAssetFormat = "pdb"): Promise<string> {
  return (await resolveRcsbStructure(pdbId, { format, includeMetadata: false })).path;
}

async function analyzeStructureFileCached(filePath: string): Promise<StructureAnalysis | undefined> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    return undefined;
  }
  const cacheKey = buildPathCacheKey(filePath, stat);
  const cachePath = path.join(scientificCacheDir, "manifests", `${cacheKey}.structure.json`);
  const cached = await readJsonFile(cachePath).catch(() => null);
  if (cached && (cached as Partial<StructureAnalysis>).parserVersion === 3) {
    return cached as StructureAnalysis;
  }
  const analysis = await analyzeStructureFile(filePath);
  if (analysis) {
    await writeJsonFile(cachePath, analysis);
  }
  return analysis;
}

async function analyzePaeFileCached(
  filePath: string,
  structureAnalysis: StructureAnalysis | undefined,
  interfaceChains?: [string, string],
): Promise<PAEAnalysis | undefined> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    return undefined;
  }
  const structureFingerprint = structureAnalysis
    ? structureAnalysis.residues.map((residue) => `${residue.chain}:${residue.residue}:${residue.residueName}`).join("|")
    : "missing-structure";
  const cacheKey = crypto.createHash("sha1").update(JSON.stringify({
    version: 2,
    pae: buildPathCacheKey(filePath, stat),
    structureFingerprint,
    interfaceChains,
  })).digest("hex");
  const cachePath = path.join(scientificCacheDir, "pae", `${cacheKey}.json`);
  const cached = await readJsonFile(cachePath).catch(() => null);
  if (cached) {
    return cached as PAEAnalysis;
  }
  const analysis = await analyzePaeFile(filePath, structureAnalysis, interfaceChains);
  if (analysis) {
    await writeJsonFile(cachePath, analysis);
  }
  return analysis;
}

async function analyzeStructureFile(filePath: string): Promise<StructureAnalysis | undefined> {
  const extension = path.extname(filePath).toLowerCase();
  const content = await readUtf8FileWithinLimit(filePath, "Scientific structure input", maxScientificStructureParseBytes);
  if (extension === ".pdb" || extension === ".ent") {
    return parsePdbStructure(filePath, content);
  }
  if (extension === ".cif" || extension === ".mmcif") {
    return parseCifStructure(filePath, content);
  }
  return undefined;
}

function parsePdbStructure(filePath: string, content: string): StructureAnalysis {
  const residueAccumulator = new Map<string, { chain: string; residue: string; residueNumber: number | null; residueName: string; scores: number[] }>();
  const nonPolymerResidueNames = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("HETATM")) {
      const residueName = line.slice(17, 20).trim().toUpperCase();
      if (residueName) nonPolymerResidueNames.add(residueName);
      continue;
    }
    if (!line.startsWith("ATOM  ")) {
      continue;
    }
    const chain = line.slice(21, 22).trim();
    const sequenceNumber = line.slice(22, 26).trim();
    const insertionCode = normalizeStructureToken(line.slice(26, 27));
    const residue = `${sequenceNumber}${insertionCode ?? ""}`;
    const residueNumber = Number.parseInt(sequenceNumber, 10);
    const residueName = line.slice(17, 20).trim() || "UNK";
    const bFactor = Number.parseFloat(line.slice(60, 66).trim());
    const key = `${chain}:${residue}`;
    const current = residueAccumulator.get(key) ?? {
      chain,
      residue,
      residueNumber: Number.isFinite(residueNumber) ? residueNumber : null,
      residueName,
      scores: [],
    };
    if (Number.isFinite(bFactor)) {
      current.scores.push(bFactor);
    }
    residueAccumulator.set(key, current);
  }

  const residues = [...residueAccumulator.values()].map((entry, index) => ({
    index,
    chain: entry.chain,
    residue: entry.residue,
    residueNumber: entry.residueNumber,
    residueName: entry.residueName,
    meanConfidence: entry.scores.length
      ? entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length
      : undefined,
  }));

  return {
    parserVersion: 3,
    path: filePath,
    format: "pdb",
    chains: uniqueStrings(residues.map((residue) => residue.chain)),
    residues,
    nonPolymerResidueNames: [...nonPolymerResidueNames].sort(),
    lowConfidenceRanges: detectLowConfidenceRanges(residues),
  };
}

function parseCifStructure(filePath: string, content: string): StructureAnalysis {
  const residueAccumulator = new Map<string, { chain: string; residue: string; residueNumber: number | null; residueName: string; scores: number[] }>();
  const nonPolymerResidueNames = new Set<string>();
  for (const row of parseCifAtomSiteRows(content)) {
    const group = (getCifValue(row, ["_atom_site.group_pdb"]) ?? "").toUpperCase();
    const residueName = (getCifValue(row, ["_atom_site.auth_comp_id", "_atom_site.label_comp_id"]) ?? "UNK").toUpperCase();
    if (group === "HETATM") {
      nonPolymerResidueNames.add(residueName);
      continue;
    }
    if (group !== "ATOM") {
      continue;
    }
    const chain = getCifValue(row, ["_atom_site.auth_asym_id", "_atom_site.label_asym_id"]) ?? "";
    const sequenceNumber = getCifValue(row, ["_atom_site.auth_seq_id", "_atom_site.label_seq_id"]) ?? "?";
    const insertionCode = getCifValue(row, ["_atom_site.pdbx_pdb_ins_code"]);
    const residue = `${sequenceNumber}${insertionCode ?? ""}`;
    const residueNumber = Number.parseInt(sequenceNumber, 10);
    const bFactor = Number.parseFloat(getCifValue(row, ["_atom_site.b_iso_or_equiv"]) ?? "");
    const key = `${chain}:${residue}`;
    const current = residueAccumulator.get(key) ?? {
      chain,
      residue,
      residueNumber: Number.isFinite(residueNumber) ? residueNumber : null,
      residueName,
      scores: [],
    };
    if (Number.isFinite(bFactor)) {
      current.scores.push(bFactor);
    }
    residueAccumulator.set(key, current);
  }
  const residues = [...residueAccumulator.values()].map((entry, index) => ({
    index,
    chain: entry.chain,
    residue: entry.residue,
    residueNumber: entry.residueNumber,
    residueName: entry.residueName,
    meanConfidence: entry.scores.length
      ? entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length
      : undefined,
  }));
  return {
    parserVersion: 3,
    path: filePath,
    format: "cif",
    chains: uniqueStrings(residues.map((residue) => residue.chain)),
    residues,
    nonPolymerResidueNames: [...nonPolymerResidueNames].sort(),
    lowConfidenceRanges: detectLowConfidenceRanges(residues),
  };
}

function parseCifAtomSiteRows(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/);
  const rows: Array<Record<string, string>> = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (lines[lineIndex].trim().toLowerCase() !== "loop_") {
      continue;
    }

    const headers: string[] = [];
    let cursor = lineIndex + 1;
    while (cursor < lines.length && lines[cursor].trim().startsWith("_")) {
      headers.push(lines[cursor].trim().split(/\s+/, 1)[0].toLowerCase());
      cursor += 1;
    }
    if (!headers.some((header) => header.startsWith("_atom_site."))) {
      lineIndex = cursor - 1;
      continue;
    }

    const bufferedTokens: string[] = [];
    for (; cursor < lines.length; cursor += 1) {
      const trimmed = lines[cursor].trim();
      const lower = trimmed.toLowerCase();
      if (!trimmed || trimmed === "#") {
        if (trimmed === "#") {
          break;
        }
        continue;
      }
      if (lower === "loop_" || lower === "stop_" || lower.startsWith("data_") || lower.startsWith("save_") || trimmed.startsWith("_")) {
        break;
      }

      bufferedTokens.push(...tokenizeCifDataLine(lines[cursor]));
      while (bufferedTokens.length >= headers.length) {
        const values = bufferedTokens.splice(0, headers.length);
        rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? "?"])));
      }
    }
    if (bufferedTokens.length) {
      throw new Error("mmCIF atom_site loop ended with an incomplete row.");
    }
    lineIndex = cursor - 1;
  }

  return rows;
}

function tokenizeCifDataLine(line: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < line.length) {
    while (index < line.length && /\s/.test(line[index])) index += 1;
    if (index >= line.length || line[index] === "#") break;

    const quote = line[index] === "'" || line[index] === '"' ? line[index] : null;
    if (quote) {
      index += 1;
      const start = index;
      while (index < line.length && line[index] !== quote) index += 1;
      if (index >= line.length) {
        throw new Error("mmCIF atom_site row contains an unterminated quoted value.");
      }
      tokens.push(line.slice(start, index));
      index += 1;
      continue;
    }

    const start = index;
    while (index < line.length && !/\s/.test(line[index]) && line[index] !== "#") index += 1;
    tokens.push(line.slice(start, index));
    if (line[index] === "#") break;
  }
  return tokens;
}

function getCifValue(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeStructureToken(row[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeStructureToken(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return !normalized || normalized === "." || normalized === "?" ? undefined : normalized;
}

async function analyzePaeFile(
  filePath: string,
  structureAnalysis: StructureAnalysis | undefined,
  interfaceChains?: [string, string],
): Promise<PAEAnalysis | undefined> {
  const payload = await readJsonFile(filePath);
  const record = Array.isArray(payload) ? payload[0] : payload;
  const matrix = record && typeof record === "object"
    ? (record as Record<string, unknown>).predicted_aligned_error ?? (record as Record<string, unknown>).pae
    : undefined;
  if (!structureAnalysis?.residues.length) {
    throw new Error("PAE mapping requires a parsed structure with polymer ATOM residues.");
  }
  const validatedMatrix = validatePaeMatrix(matrix, structureAnalysis);

  const rowMeans = validatedMatrix.map((row) => row.reduce((sum, value) => sum + value, 0) / row.length);
  const flatValues = validatedMatrix.flat();
  const meanPae = flatValues.reduce((sum, value) => sum + value, 0) / Math.max(1, flatValues.length);
  const maxPae = flatValues.reduce((max, value) => Math.max(max, value), 0);
  const worstWindow = buildWorstPaeWindow(rowMeans, structureAnalysis);
  const uncertainInterface = buildUncertainInterface(validatedMatrix, structureAnalysis, interfaceChains);

  return {
    residueCount: validatedMatrix.length,
    meanPae,
    maxPae,
    worstWindow,
    uncertainInterface,
  };
}

function validatePaeMatrix(
  value: unknown,
  structureAnalysis: StructureAnalysis,
): number[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("PAE JSON must contain a non-empty predicted_aligned_error matrix.");
  }
  const size = value.length;
  const matrix = value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== size) {
      throw new Error(`PAE matrix must be square; row ${rowIndex + 1} has ${Array.isArray(row) ? row.length : 0} values for a ${size}-row matrix.`);
    }
    return row.map((entry, columnIndex) => {
      if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
        throw new Error(`PAE matrix entry ${rowIndex + 1},${columnIndex + 1} must be a finite non-negative number.`);
      }
      return entry;
    });
  });

  if (size !== structureAnalysis.residues.length) {
    throw new Error(
      `PAE matrix residue count (${size}) does not match polymer residue count (${structureAnalysis.residues.length}) in the loaded structure.`,
    );
  }
  return matrix;
}

async function collectRosettaCandidatePaths(bundlePath: string | undefined, candidatePaths: string[] | undefined): Promise<string[]> {
  const explicit = candidatePaths?.map((candidatePath) => ensureAllowedModelInputPath(candidatePath, "Rosetta candidate")) ?? [];
  if (!bundlePath) {
    return uniqueStrings(explicit);
  }
  const entries = await fs.readdir(bundlePath, { withFileTypes: true });
  const bundleCandidates = entries
    .filter((entry) => entry.isFile() && /\.(pdb|cif|mmcif)$/i.test(entry.name))
    .map((entry) => ensureAllowedModelInputPath(path.join(bundlePath, entry.name), "Rosetta candidate"));
  return uniqueStrings([...explicit, ...bundleCandidates]);
}

async function parseRosettaScorefileCached(
  scorefilePath: string,
  candidatePaths: string[],
  topN: number,
): Promise<RankedRosettaCandidate[]> {
  const stat = await fs.stat(scorefilePath);
  const cacheKey = buildPathCacheKey(scorefilePath, stat);
  const cachePath = path.join(scientificCacheDir, "rosetta", `${cacheKey}.json`);
  const cached = await readJsonFile(cachePath).catch(() => null);
  if (cached) {
    return cached as RankedRosettaCandidate[];
  }

  const rankings = await parseRosettaScorefile(scorefilePath, candidatePaths, topN);
  await writeJsonFile(cachePath, rankings);
  return rankings;
}

async function parseRosettaScorefile(
  scorefilePath: string,
  candidatePaths: string[],
  topN: number,
): Promise<RankedRosettaCandidate[]> {
  const text = await readUtf8FileWithinLimit(scorefilePath, "Rosetta scorefile", maxScientificScorefileParseBytes);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const scoreLines = lines.filter((line) => line.startsWith("SCORE:"));
  if (scoreLines.length < 2) {
    throw new Error(`Rosetta scorefile appears invalid: ${scorefilePath}`);
  }
  const header = scoreLines[0].split(/\s+/).slice(1);
  const descriptionIndex = header.findIndex((token) => token === "description");
  const scoreColumn = ["total_score", "score", "total"].find((token) => header.includes(token)) ?? header[0];
  const scoreIndex = header.indexOf(scoreColumn);
  const candidateMap = new Map(candidatePaths.map((candidatePath) => [
    normalizeRosettaTag(path.basename(candidatePath, path.extname(candidatePath))),
    candidatePath,
  ]));

  const rankings = scoreLines.slice(1).map((line) => {
    const columns = line.split(/\s+/).slice(1);
    const tag = columns[descriptionIndex] ?? columns[columns.length - 1];
    const normalizedTag = normalizeRosettaTag(tag);
    const exactPath = candidateMap.get(normalizedTag);
    const fuzzyPath = exactPath
      ?? candidatePaths.find((candidatePath) => {
        const normalizedCandidate = normalizeRosettaTag(path.basename(candidatePath, path.extname(candidatePath)));
        return normalizedCandidate.includes(normalizedTag) || normalizedTag.includes(normalizedCandidate);
      });
    const score = Number.parseFloat(columns[scoreIndex] ?? "");

    return {
      tag,
      score: Number.isFinite(score) ? score : undefined,
      scoreLabel: scoreColumn,
      path: fuzzyPath,
      matched: Boolean(fuzzyPath),
      warnings: fuzzyPath ? [] : [`No candidate structure matched score row ${tag}.`],
      metadata: Object.fromEntries(header.map((name, index) => [name, columns[index] ?? null])),
    };
  }).sort((left, right) => {
    const leftScore = left.score ?? Number.POSITIVE_INFINITY;
    const rightScore = right.score ?? Number.POSITIVE_INFINITY;
    return leftScore - rightScore;
  }).slice(0, Math.max(1, topN)).map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));

  return rankings;
}

function detectLowConfidenceRanges(residues: StructureResidue[]): ResidueWindow[] {
  const byChain = groupBy(residues, (residue) => residue.chain);
  const windows: ResidueWindow[] = [];
  for (const [chain, chainResidues] of Object.entries(byChain)) {
    const lowResidues = chainResidues.filter((residue) => typeof residue.meanConfidence === "number" && residue.meanConfidence < 70);
    if (!lowResidues.length) {
      const fallbackResidues = chainResidues
        .filter((residue) => typeof residue.meanConfidence === "number")
        .sort((left, right) => (left.meanConfidence ?? 100) - (right.meanConfidence ?? 100))
        .slice(0, Math.min(8, chainResidues.length));
      if (fallbackResidues.length) {
        windows.push(residuesToWindow(chain, fallbackResidues, "Low-confidence fallback"));
      }
      continue;
    }
    windows.push(residuesToWindow(chain, lowResidues.slice(0, Math.min(12, lowResidues.length)), "Low-confidence region"));
  }
  return windows.sort((left, right) => left.meanValue - right.meanValue);
}

function buildWorstPaeWindow(rowMeans: number[], structureAnalysis: StructureAnalysis): ResidueWindow | undefined {
  if (!structureAnalysis.residues.length) {
    return undefined;
  }
  const windowSize = Math.min(10, Math.max(4, Math.floor(rowMeans.length / 12)));
  let bestResidues: StructureResidue[] = [];
  let bestMean = -1;
  const residuesByChain = groupBy(structureAnalysis.residues, (residue) => residue.chain);
  for (const chainResidues of Object.values(residuesByChain)) {
    const chainWindowSize = Math.min(windowSize, chainResidues.length);
    for (let index = 0; index <= chainResidues.length - chainWindowSize; index += 1) {
      const residues = chainResidues.slice(index, index + chainWindowSize);
      const values = residues.map((residue) => rowMeans[residue.index]).filter((value) => Number.isFinite(value));
      if (values.length !== residues.length) {
        continue;
      }
      const mean = average(values);
      if (mean > bestMean) {
        bestMean = mean;
        bestResidues = residues;
      }
    }
  }
  if (!bestResidues.length) {
    return undefined;
  }
  return residuesToWindow(bestResidues[0].chain, bestResidues, "Worst PAE window", bestMean);
}

function buildUncertainInterface(
  matrix: number[][],
  structureAnalysis: StructureAnalysis,
  interfaceChains?: [string, string],
): PAEAnalysis["uncertainInterface"] {
  const chains = interfaceChains ?? inferDefaultInterfaceChains(structureAnalysis.chains);
  if (!chains) {
    return undefined;
  }

  const chainA = structureAnalysis.residues.filter((residue) => residue.chain === chains[0]);
  const chainB = structureAnalysis.residues.filter((residue) => residue.chain === chains[1]);
  if (!chainA.length || !chainB.length) {
    return undefined;
  }

  const chainAMeans = chainA.map((residue) => ({
    residue,
    value: average(chainB.map((partner) => matrix[residue.index]?.[partner.index]).filter((value) => Number.isFinite(value))),
  })).sort((left, right) => right.value - left.value).slice(0, 6);

  const chainBMeans = chainB.map((residue) => ({
    residue,
    value: average(chainA.map((partner) => matrix[residue.index]?.[partner.index]).filter((value) => Number.isFinite(value))),
  })).sort((left, right) => right.value - left.value).slice(0, 6);

  return {
    chains,
    chainAResidues: chainAMeans.map((entry) => entry.residue.residue),
    chainBResidues: chainBMeans.map((entry) => entry.residue.residue),
    meanPae: average([...chainAMeans.map((entry) => entry.value), ...chainBMeans.map((entry) => entry.value)]),
  };
}

function buildMutationWindow(
  reference: StructureAnalysis | undefined,
  design: StructureAnalysis | undefined,
): ResidueWindow | undefined {
  if (!reference || !design) {
    return undefined;
  }
  const referenceMap = new Map(reference.residues.map((residue) => [`${residue.chain}:${residue.residue}`, residue.residueName]));
  const changed = design.residues.filter((residue) => {
    const referenceName = referenceMap.get(`${residue.chain}:${residue.residue}`);
    return referenceName && referenceName !== residue.residueName;
  });
  if (!changed.length) {
    return undefined;
  }
  return residuesToWindow(changed[0].chain, changed.slice(0, 12), "Mutated shell");
}

function buildResidueWindowFromHints(
  structureAnalysis: StructureAnalysis | undefined,
  residueHints: string[],
  label: string,
): ResidueWindow | undefined {
  if (!structureAnalysis) {
    return undefined;
  }
  const selected = structureAnalysis.residues.filter((residue) => residueHints.includes(residue.residue) || residueHints.includes(`${residue.chain}:${residue.residue}`));
  if (!selected.length) {
    return undefined;
  }
  return residuesToWindow(selected[0].chain, selected, label);
}

function residuesToWindow(
  chain: string,
  residues: Array<{ residue: string; meanConfidence?: number }>,
  label: string,
  overrideMean?: number,
): ResidueWindow {
  const residueLabels = uniqueStrings(residues.map((residue) => residue.residue));
  const meanValue = overrideMean ?? average(residues.map((residue) => residue.meanConfidence).filter((value): value is number => typeof value === "number"));
  return {
    chain,
    startResidue: residueLabels[0] ?? "?",
    endResidue: residueLabels[residueLabels.length - 1] ?? "?",
    residueLabels,
    meanValue,
    label,
  };
}

function summarizeWindow(window: ResidueWindow): Record<string, unknown> {
  return {
    chain: window.chain,
    startResidue: window.startResidue,
    endResidue: window.endResidue,
    residues: window.residueLabels,
    meanValue: roundMetric(window.meanValue),
    label: window.label,
  };
}

function buildPathCacheKey(filePath: string, stat: { mtimeMs: number; size: number }): string {
  return crypto.createHash("sha1").update(`${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`).digest("hex");
}

function ensureAllowedJsonInputPath(candidate: string, label: string): string {
  const resolved = ensureAllowedStructureInputPath(candidate, label);
  if (path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error(`${label} must be a .json file in this workflow layer.`);
  }
  return resolved;
}

function ensureAllowedModelInputPath(candidate: string, label: string): string {
  const resolved = ensureAllowedStructureInputPath(candidate, label);
  const extension = path.extname(resolved).toLowerCase();
  if (![".pdb", ".cif", ".mmcif", ".ent"].includes(extension)) {
    throw new Error(`${label} must be a .pdb, .cif, .mmcif, or .ent file.`);
  }
  return resolved;
}

function ensureAllowedMapInputPath(candidate: string, label: string): string {
  const resolved = ensureAllowedStructureInputPath(candidate, label);
  const extension = path.extname(resolved).toLowerCase();
  if (![".map", ".mrc", ".ccp4"].includes(extension)) {
    throw new Error(`${label} must be a .map, .mrc, or .ccp4 file.`);
  }
  return resolved;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readUtf8FileWithinLimit(filePath, "Scientific JSON input", maxScientificJsonParseBytes)) as unknown;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeRosettaTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(pdb|cif|mmcif)$/g, "")
    .replace(/[_\-\s]+/g, "_")
    .replace(/_relaxed$|_unrelaxed$/g, "")
    .trim();
}

function inferDefaultInterfaceChains(chains: string[]): [string, string] | undefined {
  return chains.length >= 2 ? [chains[0], chains[1]] : undefined;
}

function validateOrInferInterfaceChains(
  requested: [string, string] | undefined,
  analysis: StructureAnalysis | undefined,
  label: string,
): [string, string] | undefined {
  if (!requested) return inferDefaultInterfaceChains(analysis?.chains ?? []);
  if (requested[0] === requested[1]) {
    throw new Error(`${label} interfaceChains must name two distinct polymer chains.`);
  }
  if (!analysis) {
    throw new Error(`${label} could not be parsed, so explicit interfaceChains cannot be validated.`);
  }
  const missing = requested.filter((chain) => !analysis.chains.includes(chain));
  if (missing.length) {
    throw new Error(`${label} does not contain requested interface chain${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);
  }
  return requested;
}

function validateFocusResidues(
  hints: string[] | undefined,
  analysis: StructureAnalysis | undefined,
  label: string,
): void {
  if (!hints?.length) return;
  if (!analysis) {
    throw new Error(`${label} could not be parsed, so focusResidues cannot be validated.`);
  }
  const matched = new Set<string>();
  const residues = analysis.residues.filter((residue) => hints.some((hint) => {
    const isMatch = hint === residue.residue || hint === `${residue.chain}:${residue.residue}`;
    if (isMatch) matched.add(hint);
    return isMatch;
  }));
  const missing = hints.filter((hint) => !matched.has(hint));
  if (missing.length) {
    throw new Error(`${label} does not contain requested focus residue${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);
  }
  const chains = [...new Set(residues.map((residue) => residue.chain))];
  if (chains.length > 1) {
    throw new Error(`${label} focusResidues must resolve to one chain per workflow run; split cross-chain focuses into separate runs.`);
  }
}

async function readUtf8FileWithinLimit(filePath: string, label: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size > maxBytes) {
    throw new Error(
      `${label} is too large for in-memory parsing (${formatBytes(stat.size)} > ${formatBytes(maxBytes)}).`,
    );
  }
  return fs.readFile(filePath, "utf8");
}

function formatBytes(value: number): string {
  return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
}

function groupBy<T>(values: T[], keyFn: (value: T) => string): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const value of values) {
    const key = keyFn(value);
    grouped[key] ??= [];
    grouped[key].push(value);
  }
  return grouped;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeCommand(command: string): string {
  return command.split(",")[0].trim();
}

function compactResidueLabels(values: string[]): string {
  const labels = uniqueStrings(values);
  const compacted: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  const flushRange = () => {
    if (start === undefined || previous === undefined) return;
    compacted.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = undefined;
    previous = undefined;
  };

  for (const label of labels) {
    if (!/^[+-]?\d+$/.test(label)) {
      flushRange();
      compacted.push(label);
      continue;
    }
    const current = Number(label);
    if (start === undefined) {
      start = current;
      previous = current;
      continue;
    }
    if (current === (previous as number) + 1) {
      previous = current;
      continue;
    }
    flushRange();
    start = current;
    previous = current;
  }
  flushRange();
  return compacted.join(",");
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAlphaFoldWorkflow(workflow: ScientificWorkflowKind): workflow is typeof import("../schemas/index.js").alphaFoldWorkflowKinds[number] {
  return workflow.startsWith("alphafold_");
}

function isAlphaFoldResolvedInputs(value: ScientificResolvedInputs): value is AlphaFoldResolvedInputs {
  return !("candidatePaths" in value) && !("mutations" in value);
}

function isRosettaResolvedInputs(value: ScientificResolvedInputs): value is RosettaResolvedInputs {
  return "candidatePaths" in value;
}

function isVariantResolvedInputs(value: ScientificResolvedInputs): value is VariantResolvedInputs {
  return "mutations" in value;
}
