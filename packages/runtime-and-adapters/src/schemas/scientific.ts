import { z } from "zod";
import {
  actionResultArtifactSchema,
  actionResultMetricSchema,
  targetKindSchema,
} from "./shared.js";
import { selectorObjectSchema } from "../utils/selectors.js";

export const alphaFoldWorkflowKinds = [
  "alphafold_confidence_review",
  "alphafold_vs_experiment_overlay",
  "alphafold_multimer_interface_review",
  "alphafold_pae_guided_triage",
  "alphafold_to_cryo_handoff",
] as const;

export const rosettaWorkflowKinds = [
  "rosetta_scaffold_design_review",
  "rosetta_interface_packing_review",
  "rosetta_ligand_redesign_review",
  "rosetta_top_design_compare",
] as const;

export const scientificWorkflowKinds = [
  ...alphaFoldWorkflowKinds,
  ...rosettaWorkflowKinds,
] as const;

export const presentationModes = ["analysis", "demo", "publication"] as const;

export const scientificWorkflowKindSchema = z.enum(scientificWorkflowKinds);
export const alphaFoldWorkflowKindSchema = z.enum(alphaFoldWorkflowKinds);
export const rosettaWorkflowKindSchema = z.enum(rosettaWorkflowKinds);
export const presentationModeSchema = z.enum(presentationModes);

const workflowPathSchema = z.string().min(1).max(400);
const chainSchema = z.string().min(1).max(12);
const residueHintSchema = z.array(z.string().min(1).max(80)).min(1).max(64);
const pdbIdSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/, "experimentalPdbId must be a 4-character PDB accession.");

export const scientificWorkflowExportSchema = z.object({
  format: z.enum(["png", "pse", "cxs", "session"]).optional(),
  path: workflowPathSchema.optional(),
  width: z.number().int().min(320).max(4096).optional(),
  height: z.number().int().min(240).max(4096).optional(),
  rayTrace: z.boolean().optional(),
});

export const alphaFoldInputsSchema = z.object({
  modelPath: workflowPathSchema.optional(),
  uniprotId: z.string().min(1).max(40).optional(),
  paePath: workflowPathSchema.optional(),
  useAfdbPae: z.boolean().optional(),
  experimentalPath: workflowPathSchema.optional(),
  experimentalPdbId: pdbIdSchema.optional(),
  cryoMapPath: workflowPathSchema.optional(),
  interfaceChains: z.tuple([chainSchema, chainSchema]).optional(),
  focusResidues: residueHintSchema.optional(),
  modelLabel: z.string().min(1).max(80).optional(),
  experimentalLabel: z.string().min(1).max(80).optional(),
}).superRefine((value, ctx) => {
  if (!value.modelPath && !value.uniprotId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modelPath"],
      message: "AlphaFold workflows require either a local modelPath or a UniProt id.",
    });
  }
});

export const rosettaInputsSchema = z.object({
  bundlePath: workflowPathSchema.optional(),
  candidatePaths: z.array(workflowPathSchema).min(1).max(24).optional(),
  scorefilePath: workflowPathSchema.optional(),
  referencePath: workflowPathSchema.optional(),
  ligandCode: z.string().min(1).max(20).optional(),
  interfaceChains: z.tuple([chainSchema, chainSchema]).optional(),
  focusResidues: residueHintSchema.optional(),
  topN: z.number().int().min(1).max(8).optional(),
  designLabel: z.string().min(1).max(80).optional(),
  referenceLabel: z.string().min(1).max(80).optional(),
}).superRefine((value, ctx) => {
  if (!value.bundlePath && !value.candidatePaths?.length && !value.scorefilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bundlePath"],
      message: "Rosetta workflows require a bundlePath, candidatePaths, or a scorefilePath.",
    });
  }
});

const requestBaseSchema = z.object({
  target: targetKindSchema,
  summary: z.string().min(1).max(400).optional(),
  recipeId: z.string().min(1).max(120).optional(),
  dryRun: z.boolean().optional(),
  export: scientificWorkflowExportSchema.optional(),
  presentationMode: presentationModeSchema.optional(),
});

export const alphaFoldWorkflowRequestSchema = requestBaseSchema.extend({
  workflow: alphaFoldWorkflowKindSchema,
  inputs: alphaFoldInputsSchema,
}).superRefine((value, ctx) => {
  if (value.workflow === "alphafold_vs_experiment_overlay" && !value.inputs.experimentalPath && !value.inputs.experimentalPdbId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "experimentalPath"],
      message: "AlphaFold overlay requires an experimentalPath or experimentalPdbId.",
    });
  }
  if (value.workflow === "alphafold_pae_guided_triage" && !value.inputs.paePath && value.inputs.useAfdbPae !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "paePath"],
      message: "PAE-guided triage requires a paePath or useAfdbPae=true.",
    });
  }
  if (value.workflow === "alphafold_to_cryo_handoff" && !value.inputs.cryoMapPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "cryoMapPath"],
      message: "AlphaFold-to-cryo handoff requires a cryoMapPath.",
    });
  }
});

export const rosettaWorkflowRequestSchema = requestBaseSchema.extend({
  workflow: rosettaWorkflowKindSchema,
  inputs: rosettaInputsSchema,
}).superRefine((value, ctx) => {
  if (value.workflow === "rosetta_scaffold_design_review" && !value.inputs.referencePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "referencePath"],
      message: "Scaffold-design review requires a referencePath.",
    });
  }
  if (value.workflow === "rosetta_top_design_compare" && !value.inputs.scorefilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "scorefilePath"],
      message: "Top-design compare requires a scorefilePath.",
    });
  }
});

export const scientificWorkflowRequestSchema = z.union([
  alphaFoldWorkflowRequestSchema,
  rosettaWorkflowRequestSchema,
]);

const referenceHintSchema = z.object({
  label: z.string().min(1).max(200),
  selector: z.union([z.string().min(1).max(400), selectorObjectSchema]),
  reason: z.string().min(1).max(400).optional(),
  aliases: z.array(z.string().min(1).max(120)).max(24).optional(),
});

export const rankedCandidateSchema = z.object({
  rank: z.number().int().min(1),
  tag: z.string().min(1).max(160),
  score: z.number().finite().optional(),
  scoreLabel: z.string().min(1).max(80).optional(),
  path: workflowPathSchema.optional(),
  matched: z.boolean().default(true),
  warnings: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const scientificWorkflowResultSchema = z.object({
  target: targetKindSchema,
  workflow: scientificWorkflowKindSchema,
  resolvedInputs: z.record(z.string(), z.unknown()),
  actionsExecuted: z.array(z.string()).default([]),
  commandsExecuted: z.array(z.string()).default([]),
  logs: z.array(z.string()).default([]),
  artifacts: z.array(actionResultArtifactSchema).default([]),
  metrics: z.array(actionResultMetricSchema).default([]),
  warnings: z.array(z.string()).default([]),
  workflowState: z.record(z.string(), z.unknown()).default({}),
  referenceHints: z.record(z.string(), referenceHintSchema).default({}),
  rankedCandidates: z.array(rankedCandidateSchema).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const scientificWorkflowManifestSchema = z.object({
  id: scientificWorkflowKindSchema,
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(400),
  category: z.enum(["alphafold", "rosetta"]),
  apps: z.array(targetKindSchema).min(1),
  estimatedMinutes: z.number().int().min(1).max(30),
  starterPrompts: z.array(z.string().min(1).max(240)).min(1).max(8),
  docsSlug: z.string().min(1).max(160),
  inputHints: z.array(z.string().min(1).max(240)).min(1).max(12),
});

export type ScientificWorkflowKind = z.infer<typeof scientificWorkflowKindSchema>;
export type AlphaFoldWorkflowKind = z.infer<typeof alphaFoldWorkflowKindSchema>;
export type RosettaWorkflowKind = z.infer<typeof rosettaWorkflowKindSchema>;
export type ScientificWorkflowRequest = z.infer<typeof scientificWorkflowRequestSchema>;
export type ScientificWorkflowResult = z.infer<typeof scientificWorkflowResultSchema>;
export type ScientificWorkflowManifest = z.infer<typeof scientificWorkflowManifestSchema>;
export type AlphaFoldInputs = z.infer<typeof alphaFoldInputsSchema>;
export type RosettaInputs = z.infer<typeof rosettaInputsSchema>;
