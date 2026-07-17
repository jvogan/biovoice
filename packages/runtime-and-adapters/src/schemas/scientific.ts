import { z } from "zod";
import {
  actionResultArtifactSchema,
  actionResultMetricSchema,
  targetKindSchema,
} from "./shared.js";
import {
  buildSafeIdentifierSchema,
  buildSafeMetadataTextSchema,
  selectorObjectSchema,
} from "../utils/selectors.js";

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

export const variantWorkflowKinds = [
  "variant_environment_review",
] as const;

export const scientificWorkflowKinds = [
  ...alphaFoldWorkflowKinds,
  ...rosettaWorkflowKinds,
  ...variantWorkflowKinds,
] as const;

export const presentationModes = ["analysis", "demo", "publication"] as const;
export const scientificEvidenceLevels = ["visualization", "qualitative", "quantitative"] as const;

export const scientificWorkflowKindSchema = z.enum(scientificWorkflowKinds);
export const alphaFoldWorkflowKindSchema = z.enum(alphaFoldWorkflowKinds);
export const rosettaWorkflowKindSchema = z.enum(rosettaWorkflowKinds);
export const variantWorkflowKindSchema = z.enum(variantWorkflowKinds);
export const presentationModeSchema = z.enum(presentationModes);
export const scientificEvidenceLevelSchema = z.enum(scientificEvidenceLevels);

const workflowPathSchema = z.string().min(1).max(400);
const chainSchema = buildSafeIdentifierSchema(12, "chain identifier");
const residueHintSchema = z.array(z.string().min(1).max(80)).min(1).max(64);
const chemicalComponentIdSchema = z.string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,20}$/, "ligand code must be a literal alphanumeric chemical-component id.");
const pdbIdSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/, "experimentalPdbId must be a 4-character PDB accession.");
const emdbIdSchema = z.string().trim().toUpperCase().regex(/^(EMD[-_]?)?\d{3,8}$/, "emdbId must look like EMD-1234.");
const uniprotIdSchema = buildSafeIdentifierSchema(40, "UniProt accession");
const assetObjectNameSchema = buildSafeIdentifierSchema(80, "asset object name");
const assetAliasSchema = buildSafeMetadataTextSchema(80, "asset alias");
const assetQuerySchema = buildSafeMetadataTextSchema(240, "database search query");
const assetFormatSchema = z.enum(["pdb", "cif"]);
const assetSemanticRoleSchema = z.enum(["experimental", "predicted", "design", "scaffold", "binder", "receptor", "partner", "reference"]);
const assemblyIdSchema = z.string().trim().regex(/^[1-9][0-9]{0,3}$/, "assemblyId must be a numeric RCSB biological assembly id.");

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
  experimentalPdbFormat: assetFormatSchema.optional(),
  pdbFormat: assetFormatSchema.optional(),
  structureFormat: assetFormatSchema.optional(),
  cryoMapPath: workflowPathSchema.optional(),
  cryoMapEmdbId: emdbIdSchema.optional(),
  emdbId: emdbIdSchema.optional(),
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
  ligandCode: chemicalComponentIdSchema.optional(),
  interfaceChains: z.tuple([chainSchema, chainSchema]).optional(),
  focusResidues: residueHintSchema.optional(),
  topN: z.number().int().min(1).max(8).optional(),
  designLabel: z.string().min(1).max(80).optional(),
  referenceLabel: z.string().min(1).max(80).optional(),
}).superRefine((value, ctx) => {
  if (!value.bundlePath && !value.candidatePaths?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bundlePath"],
      message: "Rosetta workflows require a bundlePath or candidatePaths containing loadable structures.",
    });
  }
});

export const variantSiteSchema = z.object({
  position: buildSafeIdentifierSchema(8, "variant residue position"),
  chain: buildSafeIdentifierSchema(12, "variant chain").optional(),
  from: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, "from must be a one- or three-letter amino-acid code.").optional(),
  to: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, "to must be a one- or three-letter amino-acid code.").optional(),
});

export const variantInputsSchema = z.object({
  modelPath: workflowPathSchema.optional(),
  uniprotId: uniprotIdSchema.optional(),
  mutations: z.array(variantSiteSchema).min(1).max(12),
  comparisonPath: workflowPathSchema.optional(),
  ligandCode: chemicalComponentIdSchema.optional(),
  neighborhoodAngstroms: z.number().min(2).max(12).default(5),
  modelLabel: z.string().min(1).max(80).optional(),
  comparisonLabel: z.string().min(1).max(80).optional(),
}).superRefine((value, ctx) => {
  if (!value.modelPath && !value.uniprotId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modelPath"],
      message: "Variant environment review requires either a local modelPath or a UniProt id.",
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
  if (value.workflow === "alphafold_multimer_interface_review" && !value.inputs.modelPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "modelPath"],
      message: "AlphaFold multimer interface review requires a local multimer modelPath.",
    });
  }
  if (
    value.workflow === "alphafold_to_cryo_handoff"
    && !value.inputs.cryoMapPath
    && !value.inputs.cryoMapEmdbId
    && !value.inputs.emdbId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "cryoMapPath"],
      message: "AlphaFold-to-cryo handoff requires a cryoMapPath, cryoMapEmdbId, or emdbId.",
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
  if (
    value.workflow === "rosetta_ligand_redesign_review"
    && !value.inputs.ligandCode
    && !value.inputs.focusResidues?.length
    && !value.inputs.referencePath
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inputs", "ligandCode"],
      message: "Ligand redesign review requires a ligandCode, focusResidues, or referencePath to define the redesign context.",
    });
  }
});

export const variantWorkflowRequestSchema = requestBaseSchema.extend({
  workflow: variantWorkflowKindSchema,
  inputs: variantInputsSchema,
});

export const scientificWorkflowRequestSchema = z.union([
  alphaFoldWorkflowRequestSchema,
  rosettaWorkflowRequestSchema,
  variantWorkflowRequestSchema,
]);

const resolveAssetBaseSchema = z.object({
  target: targetKindSchema.optional(),
  loadIntoTarget: z.boolean().optional(),
  object: assetObjectNameSchema.optional(),
  semanticRole: assetSemanticRoleSchema.optional(),
  aliases: z.array(assetAliasSchema).min(1).max(12).optional(),
});

const resolveScientificAssetRequestBaseSchema = z.discriminatedUnion("source", [
  resolveAssetBaseSchema.extend({
    source: z.literal("alphafold"),
    uniprotId: uniprotIdSchema,
    format: assetFormatSchema.default("pdb"),
    includePae: z.boolean().optional(),
  }),
  resolveAssetBaseSchema.extend({
    source: z.literal("rcsb"),
    pdbId: pdbIdSchema,
    format: assetFormatSchema.default("cif"),
    assemblyId: assemblyIdSchema.optional(),
    includeMetadata: z.boolean().optional(),
  }),
  resolveAssetBaseSchema.extend({
    source: z.literal("rcsb_search"),
    query: assetQuerySchema,
    limit: z.number().int().min(1).max(25).optional(),
  }),
  resolveAssetBaseSchema.extend({
    source: z.literal("emdb"),
    emdbId: emdbIdSchema,
    includeMetadata: z.boolean().optional(),
  }),
  resolveAssetBaseSchema.extend({
    source: z.literal("uniprot"),
    accession: uniprotIdSchema.optional(),
    query: assetQuerySchema.optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
]);

export const resolveScientificAssetRequestSchema = resolveScientificAssetRequestBaseSchema.superRefine((value, ctx) => {
  if (value.source === "uniprot" && !value.accession && !value.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accession"],
      message: "UniProt resolver requires an accession or query.",
    });
  }
});

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
  evidenceLevel: scientificEvidenceLevelSchema,
  assumptions: z.array(z.string().min(1).max(400)).default([]),
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
  category: z.enum(["alphafold", "rosetta", "variant"]),
  evidenceLevel: scientificEvidenceLevelSchema,
  assumptions: z.array(z.string().min(1).max(400)).min(1).max(12),
  apps: z.array(targetKindSchema).min(1),
  estimatedMinutes: z.number().int().min(1).max(30),
  starterPrompts: z.array(z.string().min(1).max(240)).min(1).max(8),
  docsSlug: z.string().min(1).max(160),
  inputHints: z.array(z.string().min(1).max(240)).min(1).max(12),
});

export type ScientificWorkflowKind = z.infer<typeof scientificWorkflowKindSchema>;
export type AlphaFoldWorkflowKind = z.infer<typeof alphaFoldWorkflowKindSchema>;
export type RosettaWorkflowKind = z.infer<typeof rosettaWorkflowKindSchema>;
export type VariantWorkflowKind = z.infer<typeof variantWorkflowKindSchema>;
export type ScientificWorkflowRequest = z.infer<typeof scientificWorkflowRequestSchema>;
export type ResolveScientificAssetRequest = z.infer<typeof resolveScientificAssetRequestSchema>;
export type ScientificWorkflowResult = z.infer<typeof scientificWorkflowResultSchema>;
export type ScientificWorkflowManifest = z.infer<typeof scientificWorkflowManifestSchema>;
export type AlphaFoldInputs = z.infer<typeof alphaFoldInputsSchema>;
export type RosettaInputs = z.infer<typeof rosettaInputsSchema>;
export type VariantInputs = z.infer<typeof variantInputsSchema>;
export type VariantSite = z.infer<typeof variantSiteSchema>;
export type ScientificEvidenceLevel = z.infer<typeof scientificEvidenceLevelSchema>;
