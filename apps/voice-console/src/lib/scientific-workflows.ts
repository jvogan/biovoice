import {
  buildScientificLaunchCommand,
  buildScientificWorkflowUrl,
  formatVariantMutationArgument,
  getScientificLaunchCatalog,
  getScientificWorkflowForRecipe,
  rankScientificWorkflowCandidates,
  resolveScientificWorkflowRecipeId,
  type ScientificLaunchInputs,
  type ScientificWorkflowCandidate,
} from "../../../../packages/runtime-and-adapters/src/examples/scientific-workflows.js";
import {
  scientificWorkflowRequestSchema,
  scientificWorkflowKinds,
  type ScientificWorkflowKind,
} from "../../../../packages/runtime-and-adapters/src/schemas/scientific.js";
import { getScientificWorkflow } from "../../../../packages/runtime-and-adapters/src/scientific/catalog.js";

type RecipeManifest = {
  id: string;
  apps: Array<"pymol" | "chimerax">;
};

export interface ScientificWorkflowLaunchCard {
  id: ScientificWorkflowKind;
  title: string;
  summary: string;
  group: "AlphaFold" | "Rosetta" | "Variant";
  intent: string;
  defaultTarget: "pymol" | "chimerax";
  bestRecipeId: string;
  candidateRecipes: ScientificWorkflowCandidate[];
  inputHints: string[];
  voiceStarter: string;
  evidenceLevel: "visualization" | "qualitative" | "quantitative";
  assumptions: string[];
  inputsReady: boolean;
  inputMessage?: string;
  launchUrl: string;
  agentCommand: string;
  rehearsalCommand: string;
}

export interface ScientificWorkflowQueryState {
  workflowId?: ScientificWorkflowKind;
  scientificInputs: ScientificLaunchInputs;
}

export function readScientificWorkflowQueryState(): ScientificWorkflowQueryState {
  if (typeof window === "undefined") {
    return { scientificInputs: {} };
  }

  const params = new URLSearchParams(window.location.search);
  const workflowId = params.get("workflow");
  const workflow = workflowId && scientificWorkflowKinds.includes(workflowId as ScientificWorkflowKind)
    ? (workflowId as ScientificWorkflowKind)
    : undefined;

  return {
    workflowId: workflow,
    scientificInputs: {
      uniprot: readParam(params, "uniprot"),
      experimentalPdbId: readParam(params, "experimental_pdb_id"),
      emdbId: readParam(params, "emdb_id"),
      structureFormat: readParam(params, "structure_format"),
      pdbFormat: readParam(params, "pdb_format"),
      topN: parseTopN(readParam(params, "top_n")),
    },
  };
}

export function buildScientificWorkflowInputs(
  workflowId: ScientificWorkflowKind,
  inputs: ScientificLaunchInputs,
): Record<string, unknown> {
  if (workflowId.startsWith("alphafold_")) {
    return compactInputs({
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
    });
  }
  if (workflowId === "variant_environment_review") {
    return compactInputs({
      modelPath: inputs.model,
      uniprotId: inputs.uniprot,
      mutations: inputs.mutations,
      comparisonPath: inputs.comparison,
      ligandCode: inputs.ligand,
      neighborhoodAngstroms: inputs.neighborhoodAngstroms,
    });
  }
  return compactInputs({
    bundlePath: inputs.bundle,
    scorefilePath: inputs.scorefile,
    referencePath: inputs.model,
    structureFormat: inputs.structureFormat,
    topN: inputs.topN,
  });
}

function compactInputs(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function buildScientificWorkflowLaunchCards(input: {
  target: "pymol" | "chimerax";
  baseUrl: string;
  recipes: RecipeManifest[];
  workflowId?: ScientificWorkflowKind;
  scientificInputs?: ScientificLaunchInputs;
}): ScientificWorkflowLaunchCard[] {
  const availableRecipeIds = new Set(input.recipes.map((recipe) => recipe.id));
  return getScientificLaunchCatalog().map((workflow) => {
    const manifest = getScientificWorkflow(workflow.id);
    const targetSupported = manifest.apps.includes(input.target);
    const requestCheck = scientificWorkflowRequestSchema.safeParse({
      target: input.target,
      workflow: workflow.id,
      dryRun: true,
      inputs: buildScientificWorkflowInputs(workflow.id, input.scientificInputs ?? {}),
    });
    const targetCandidate = rankScientificWorkflowCandidates(workflow.id, input.target, availableRecipeIds)[0] ?? workflow.candidates.find((candidate) => candidate.target === input.target) ?? workflow.candidates[0];
    const recipeId = input.workflowId === workflow.id
      ? resolveScientificWorkflowRecipeId(workflow.id, input.target) ?? targetCandidate.recipeId
      : targetCandidate.recipeId;
    const launchUrl = buildScientificWorkflowUrl(input.baseUrl, {
      target: input.target,
      workflowId: workflow.id,
      recipeId,
      scientificInputs: input.scientificInputs,
      widget: true,
    });
    const agentCommand = buildScientificLaunchCommand({
      target: input.target,
      workflowId: workflow.id,
      recipeId,
      scientificInputs: input.scientificInputs,
      widget: true,
    });

    return {
      id: workflow.id,
      title: workflow.title,
      summary: workflow.summary,
      group: workflow.group,
      intent: workflow.intent,
      defaultTarget: workflow.defaultTarget,
      bestRecipeId: recipeId,
      candidateRecipes: rankScientificWorkflowCandidates(workflow.id, input.target, availableRecipeIds),
      inputHints: workflow.inputHints,
      voiceStarter: workflow.voiceStarter,
      evidenceLevel: manifest.evidenceLevel,
      assumptions: manifest.assumptions,
      inputsReady: targetSupported && requestCheck.success,
      ...(!targetSupported || !requestCheck.success ? {
        inputMessage: !targetSupported
          ? `${workflow.title} is not available for ${input.target === "pymol" ? "PyMOL" : "ChimeraX"}.`
          : requestCheck.error?.issues[0]?.message ?? "Required scientific inputs are missing.",
      } : {}),
      launchUrl,
      agentCommand,
      rehearsalCommand: `npm run rehearse:workflow -- ${workflow.id} --target ${input.target} --capture${formatScientificInputArgs(input.scientificInputs)}`,
    };
  });
}

export function getScientificWorkflowFromRecipe(recipeId: string | undefined | null): ScientificWorkflowKind | null {
  return getScientificWorkflowForRecipe(recipeId)?.id ?? null;
}

export function formatScientificInputSummary(inputs?: ScientificLaunchInputs): string {
  if (!inputs) {
    return "No scientific inputs pinned.";
  }

  const summary: string[] = [];
  if (inputs.uniprot) summary.push(`UniProt ${inputs.uniprot}`);
  if (inputs.model) summary.push(`Model ${shortenPath(inputs.model)}`);
  if (inputs.experimental) summary.push(`Experimental ${shortenPath(inputs.experimental)}`);
  if (inputs.pae) summary.push(`PAE ${shortenPath(inputs.pae)}`);
  if (inputs.map) summary.push(`Map ${shortenPath(inputs.map)}`);
  if (inputs.bundle) summary.push(`Bundle ${shortenPath(inputs.bundle)}`);
  if (inputs.scorefile) summary.push(`Scorefile ${shortenPath(inputs.scorefile)}`);
  if (typeof inputs.topN === "number" && Number.isFinite(inputs.topN)) summary.push(`Top ${Math.max(1, Math.round(inputs.topN))}`);
  if (inputs.mutations?.length) summary.push(`${inputs.mutations.length} variant site${inputs.mutations.length === 1 ? "" : "s"}`);
  if (inputs.comparison) summary.push(`Comparison ${shortenPath(inputs.comparison)}`);
  if (inputs.ligand) summary.push(`Ligand ${inputs.ligand}`);
  return summary.length ? summary.join(" · ") : "No scientific inputs pinned.";
}

function readParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value && value.trim() ? value.trim() : undefined;
}

function parseTopN(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatScientificInputArgs(inputs?: ScientificLaunchInputs): string {
  if (!inputs) {
    return "";
  }

  const parts: string[] = [];
  if (inputs.uniprot) parts.push("--uniprot", inputs.uniprot);
  if (inputs.model) parts.push("--model", inputs.model);
  if (inputs.experimental) parts.push("--experimental", inputs.experimental);
  if (inputs.pae) parts.push("--pae", inputs.pae);
  if (inputs.map) parts.push("--map", inputs.map);
  if (inputs.bundle) parts.push("--bundle", inputs.bundle);
  if (inputs.scorefile) parts.push("--scorefile", inputs.scorefile);
  if (typeof inputs.topN === "number" && Number.isFinite(inputs.topN)) parts.push("--top-n", String(Math.max(1, Math.round(inputs.topN))));
  for (const mutation of inputs.mutations ?? []) parts.push("--mutation", formatVariantMutationArgument(mutation));
  if (inputs.comparison) parts.push("--comparison", inputs.comparison);
  if (inputs.ligand) parts.push("--ligand", inputs.ligand);
  if (typeof inputs.neighborhoodAngstroms === "number" && Number.isFinite(inputs.neighborhoodAngstroms)) {
    parts.push("--neighborhood-angstroms", String(inputs.neighborhoodAngstroms));
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function shortenPath(value: string): string {
  const parts = value.split(/[\\/]/g);
  return parts[parts.length - 1] ?? value;
}
