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
  path: string;
  format: "pdb" | "cif" | "unknown";
  chains: string[];
  residues: StructureResidue[];
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
    const phases = buildAlphaFoldWorkflowPhases(parsed.target, parsed.workflow, resolved, parsed.presentationMode);
    return executeWorkflowPlan(parsed, resolved, phases, runtime);
  }

  const resolved = await resolveRosettaInputs(parsed.inputs);
  const phases = buildRosettaWorkflowPhases(parsed.target, parsed.workflow, resolved, parsed.presentationMode);
  return executeWorkflowPlan(parsed, resolved, phases, runtime);
}

async function executeWorkflowPlan(
  request: ScientificWorkflowRequest,
  resolvedInputs: AlphaFoldResolvedInputs | RosettaResolvedInputs,
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
  resolvedInputs: AlphaFoldResolvedInputs | RosettaResolvedInputs,
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
        label: "Uncertain interface PAE",
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

async function resolveAlphaFoldInputs(inputs: AlphaFoldInputs): Promise<AlphaFoldResolvedInputs> {
  await ensureScientificCacheDirs();
  const afdbAsset = inputs.uniprotId
    ? await resolveAlphaFoldAsset(inputs.uniprotId, {
      format: inputs.structureFormat,
      includePae: inputs.useAfdbPae !== false,
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
    : inputs.useAfdbPae !== false
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
  const paeAnalysis = paePath ? await analyzePaeFileCached(paePath, modelAnalysis, inputs.interfaceChains) : undefined;

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
    interfaceChains: inputs.interfaceChains ?? inferDefaultInterfaceChains(modelAnalysis?.chains ?? []),
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
    interfaceChains: inputs.interfaceChains,
    focusResidues: inputs.focusResidues,
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

  if (workflow === "alphafold_multimer_interface_review" || workflow === "alphafold_pae_guided_triage") {
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

    if (hasRosettaFocusHandle(workflow)) {
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
      selection: { reference: pickRosettaFocusHandle(workflow, resolved) },
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
  } else if (workflow !== "rosetta_interface_packing_review" && hasRosettaFocusHandle(workflow)) {
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
    refs.uncertainInterface = createInterfaceReference(target, interfaceSummary, "Uncertain interface");
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
    refs.ligandRedesignShell = resolved.ligandCode
      ? createLigandShellReference(target, handlePlan.topDesign, resolved.ligandCode)
      : refs.mutatedShell;
  }

  if (resolved.interfaceChains?.[0]) {
    refs.partnerA = createChainReference(handlePlan.topDesign, resolved.interfaceChains[0], "Design partner A");
  }
  if (resolved.interfaceChains?.[1]) {
    refs.partnerB = createChainReference(handlePlan.topDesign, resolved.interfaceChains[1], "Design partner B");
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
    return "experimentalOverlayRegion";
  }
  return "lowConfidenceRegion";
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
    return resolved.interfaceChains?.[0] ? "partnerA" : "topDesign";
  }
  return pickRosettaFocusHandle(workflow, resolved);
}

function hasRosettaFocusHandle(workflow: ScientificWorkflowKind): boolean {
  return workflow.length > 0;
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
      ? { object: base.object, chain: window.chain, residues: window.residueLabels }
      : { model: base.model, chain: window.chain, residues: window.residueLabels },
    reason: `${label} spans ${window.chain}:${window.startResidue}-${window.endResidue}.`,
    aliases: [label.toLowerCase(), `${label.toLowerCase()} ${window.chain} ${window.startResidue}-${window.endResidue}`],
  };
}

function createOverlayRegionReference(
  target: TargetKind,
  handlePlan: AlphaFoldHandlePlan,
  window: ResidueWindow,
  label: string,
): ReferenceHint {
  if (target === "pymol") {
    return {
      label,
      selector: `(experimental_model and chain ${window.chain} and resi ${window.residueLabels.join("+")}) or (af_prediction and chain ${window.chain} and resi ${window.residueLabels.join("+")})`,
    };
  }

  const predictedModel = "model" in handlePlan.predicted ? handlePlan.predicted.model : "#1";
  const experimentalModel = handlePlan.experimental && "model" in handlePlan.experimental ? handlePlan.experimental.model : "#2";
  return {
    label,
    selector: `(${predictedModel}/${window.chain}:${window.startResidue}-${window.endResidue})|(${experimentalModel}/${window.chain}:${window.startResidue}-${window.endResidue})`,
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
    };
  }

  const rangeA = compactResidueLabels(input.chainAResidues);
  const rangeB = compactResidueLabels(input.chainBResidues);
  return {
    label,
    selector: `(#1/${input.chains[0]}:${rangeA})|(#1/${input.chains[1]}:${rangeB})`,
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
    selector: `${model} & zone :${ligandCode} range 5`,
  };
}

function summarizeResolvedInputs(input: AlphaFoldResolvedInputs | RosettaResolvedInputs): Record<string, unknown> {
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
  if (cached) {
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
  const cacheKey = buildPathCacheKey(filePath, stat);
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
  for (const line of content.split(/\r?\n/)) {
    if (!/^ATOM|^HETATM/.test(line)) {
      continue;
    }
    const chain = line.slice(21, 22).trim() || "?";
    const residue = line.slice(22, 26).trim();
    const residueNumber = Number.parseInt(residue, 10);
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
    path: filePath,
    format: "pdb",
    chains: uniqueStrings(residues.map((residue) => residue.chain)),
    residues,
    lowConfidenceRanges: detectLowConfidenceRanges(residues),
  };
}

function parseCifStructure(filePath: string, content: string): StructureAnalysis {
  const residueAccumulator = new Map<string, { chain: string; residue: string; residueNumber: number | null; residueName: string; scores: number[] }>();
  for (const line of content.split(/\r?\n/)) {
    if (!/^ATOM|^HETATM/.test(line)) {
      continue;
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 15) {
      continue;
    }
    const residueName = tokens[5] || tokens[17] || "UNK";
    const chain = tokens[6] || tokens[18] || "?";
    const residue = tokens[8] || tokens[16] || "?";
    const residueNumber = Number.parseInt(residue, 10);
    const bFactor = Number.parseFloat(tokens[14] ?? "");
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
    path: filePath,
    format: "cif",
    chains: uniqueStrings(residues.map((residue) => residue.chain)),
    residues,
    lowConfidenceRanges: detectLowConfidenceRanges(residues),
  };
}

async function analyzePaeFile(
  filePath: string,
  structureAnalysis: StructureAnalysis | undefined,
  interfaceChains?: [string, string],
): Promise<PAEAnalysis | undefined> {
  const payload = await readJsonFile(filePath);
  const record = Array.isArray(payload) ? payload[0] : payload;
  const matrix = Array.isArray(record?.predicted_aligned_error)
    ? record.predicted_aligned_error as number[][]
    : null;
  if (!matrix?.length) {
    return undefined;
  }

  const rowMeans = matrix.map((row) => row.reduce((sum, value) => sum + value, 0) / Math.max(1, row.length));
  const flatValues = matrix.flat();
  const meanPae = flatValues.reduce((sum, value) => sum + value, 0) / Math.max(1, flatValues.length);
  const maxPae = flatValues.reduce((max, value) => Math.max(max, value), 0);
  const worstWindow = structureAnalysis
    ? buildWorstPaeWindow(rowMeans, structureAnalysis)
    : undefined;
  const uncertainInterface = structureAnalysis
    ? buildUncertainInterface(matrix, structureAnalysis, interfaceChains)
    : undefined;

  return {
    residueCount: matrix.length,
    meanPae,
    maxPae,
    worstWindow,
    uncertainInterface,
  };
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
  let bestStart = 0;
  let bestMean = -1;
  for (let index = 0; index <= rowMeans.length - windowSize; index += 1) {
    const slice = rowMeans.slice(index, index + windowSize);
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    if (mean > bestMean) {
      bestMean = mean;
      bestStart = index;
    }
  }
  const residues = structureAnalysis.residues.slice(bestStart, bestStart + windowSize);
  if (!residues.length) {
    return undefined;
  }
  return residuesToWindow(residues[0].chain, residues, "Worst PAE window", bestMean);
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
    value: average(matrix[residue.index]?.slice(chainB[0].index, chainB[chainB.length - 1].index + 1) ?? []),
  })).sort((left, right) => right.value - left.value).slice(0, 6);

  const chainBMeans = chainB.map((residue) => ({
    residue,
    value: average(matrix[residue.index]?.slice(chainA[0].index, chainA[chainA.length - 1].index + 1) ?? []),
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
  const numbers = values
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numbers.length) {
    return values.join(",");
  }
  const ranges: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (let index = 1; index < numbers.length; index += 1) {
    const current = numbers[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join(",");
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAlphaFoldWorkflow(workflow: ScientificWorkflowKind): workflow is typeof import("../schemas/index.js").alphaFoldWorkflowKinds[number] {
  return workflow.startsWith("alphafold_");
}

function isAlphaFoldResolvedInputs(value: AlphaFoldResolvedInputs | RosettaResolvedInputs): value is AlphaFoldResolvedInputs {
  return "modelPath" in value;
}

function isRosettaResolvedInputs(value: AlphaFoldResolvedInputs | RosettaResolvedInputs): value is RosettaResolvedInputs {
  return "candidatePaths" in value;
}
