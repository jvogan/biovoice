import { z } from "zod";
import {
  buildSafeColorTokenSchema,
  buildSafeIdentifierSchema,
  buildSafeMetadataTextSchema,
  buildSafeSelectionExpressionSchema,
  selectorObjectSchema,
} from "../utils/selectors.js";

export const targetKinds = ["pymol", "chimerax"] as const;
export const voiceModes = ["push_to_talk", "open_mic"] as const;
export const responseLanguageModes = ["standard", "klingon"] as const;

export const targetKindSchema = z.enum(targetKinds);
export const voiceModeSchema = z.enum(voiceModes);
export const responseLanguageModeSchema = z.enum(responseLanguageModes);
export type TargetKind = z.infer<typeof targetKindSchema>;
export type VoiceMode = z.infer<typeof voiceModeSchema>;
export type ResponseLanguageMode = z.infer<typeof responseLanguageModeSchema>;

export const selectionValueSchema = z.union([
  buildSafeSelectionExpressionSchema(400, "selection"),
  selectorObjectSchema,
]);

const semanticRoleSchema = z.enum(["experimental", "predicted", "design", "scaffold", "binder", "receptor", "partner"]);
const actionNameSchema = buildSafeIdentifierSchema(80, "action name");
const shortActionNameSchema = buildSafeIdentifierSchema(40, "action name");
const sceneKeySchema = buildSafeIdentifierSchema(20, "scene key");
const targetSpecifierSchema = buildSafeSelectionExpressionSchema(120, "target specifier");
const colorTokenSchema = buildSafeColorTokenSchema(80, "color");
const settingNameSchema = buildSafeIdentifierSchema(80, "setting name");
const aliasLabelSchema = buildSafeMetadataTextSchema(80, "alias");

const baseEnvelopeSchema = z.object({
  target: targetKindSchema,
  summary: z.string().min(1).max(400).optional(),
  recipeId: z.string().min(1).max(120).optional(),
  dryRun: z.boolean().optional(),
});

const exportBaseSchema = z.object({
  path: z.string().min(1).max(400).optional(),
  width: z.number().int().min(320).max(4096).optional(),
  height: z.number().int().min(240).max(4096).optional(),
  rayTrace: z.boolean().optional(),
});

export const captureViewRequestSchema = z.object({
  target: targetKindSchema,
  path: z.string().min(1).max(400).optional(),
  width: z.number().int().min(320).max(4096).optional(),
  height: z.number().int().min(240).max(4096).optional(),
  inspectionPrompt: z.string().min(1).max(240).optional(),
  attachToConversation: z.boolean().optional(),
});

export const pymolExportSchema = exportBaseSchema.extend({
  format: z.enum(["png", "pse", "session"]).default("png"),
});

export const chimeraXExportSchema = exportBaseSchema.extend({
  format: z.enum(["png", "cxs", "session"]).default("png"),
});

export const pymolActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reset_workspace"),
  }),
  z.object({
    type: z.literal("load"),
    source: z.enum(["pdb", "local", "alphafold"]),
    id: buildSafeIdentifierSchema(120, "structure id").optional(),
    object: actionNameSchema.optional(),
    path: z.string().min(1).max(400).optional(),
    semanticRole: semanticRoleSchema.optional(),
    aliases: z.array(aliasLabelSchema).min(1).max(12).optional(),
  }),
  z.object({
    type: z.literal("select"),
    name: actionNameSchema,
    selection: selectionValueSchema,
  }),
  z.object({
    type: z.literal("show"),
    representations: z.array(z.enum(["cartoon", "sticks", "spheres", "surface", "mesh", "lines", "ribbon", "dots"])).min(1).max(5),
    selection: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("hide"),
    representations: z.array(z.enum(["cartoon", "sticks", "spheres", "surface", "mesh", "lines", "ribbon", "everything"])).min(1).max(5),
    selection: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("color"),
    selection: selectionValueSchema.optional(),
    color: colorTokenSchema.optional(),
    scheme: z.enum(["by_chain", "by_element", "rainbow", "b_factor"]).optional(),
  }),
  z.object({
    type: z.literal("cartoon"),
    selection: selectionValueSchema.optional(),
    style: z.enum(["automatic", "tube", "pipe", "putty", "oval", "rectangle", "loop", "arrow", "dumbbell", "skip"]).default("tube"),
    radius: z.number().min(0.05).max(5).optional(),
  }),
  z.object({
    type: z.literal("camera"),
    action: z.enum(["orient", "zoom", "center", "turn", "move", "clip", "hero_frame", "pocket_frame", "comparison_frame", "map_cutaway"]),
    selection: selectionValueSchema.optional(),
    axis: z.enum(["x", "y", "z"]).optional(),
    clipMode: z.enum(["near", "far", "move", "slab"]).optional(),
    degrees: z.number().min(-360).max(360).optional(),
    amount: z.number().min(-200).max(200).optional(),
    buffer: z.number().min(0).max(50).optional(),
    frames: z.number().int().min(1).max(600).optional(),
  }),
  z.object({
    type: z.literal("transform"),
    mode: z.enum(["translate", "rotate"]),
    selection: selectionValueSchema.optional(),
    object: actionNameSchema.optional(),
    axis: z.enum(["x", "y", "z"]).optional(),
    amount: z.number().min(-500).max(500).optional(),
    vector: z.tuple([
      z.number().min(-500).max(500),
      z.number().min(-500).max(500),
      z.number().min(-500).max(500),
    ]).optional(),
    camera: z.boolean().optional(),
    origin: selectionValueSchema.optional(),
    frames: z.number().int().min(1).max(600).optional(),
    center: selectionValueSchema.optional(),
    coordinateSystem: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("measure"),
    mode: z.enum(["distance", "angle", "dihedral", "polar_contacts"]).default("distance"),
    name: actionNameSchema.optional(),
    selection1: selectionValueSchema,
    selection2: selectionValueSchema,
    selection3: selectionValueSchema.optional(),
    selection4: selectionValueSchema.optional(),
    cutoff: z.number().min(0).max(50).optional(),
  }),
  z.object({
    type: z.literal("distance"),
    name: actionNameSchema.optional(),
    selection1: selectionValueSchema,
    selection2: selectionValueSchema,
    cutoff: z.number().min(0).max(50).optional(),
    mode: z.number().int().min(0).max(8).optional(),
  }),
  z.object({
    type: z.literal("contacts"),
    mode: z.enum(["polar_contacts", "hbonds", "contacts", "clashes"]).default("polar_contacts"),
    name: actionNameSchema.optional(),
    selection1: selectionValueSchema,
    selection2: selectionValueSchema.optional(),
    cutoff: z.number().min(0).max(20).optional(),
    distance: z.number().min(0).max(20).optional(),
  }),
  z.object({
    type: z.literal("label"),
    action: z.enum(["show", "clear"]).default("show"),
    selection: selectionValueSchema,
    text: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("align"),
    method: z.enum(["align", "super", "cealign"]).default("super"),
    mobile: selectionValueSchema,
    target: selectionValueSchema,
  }),
  z.object({
    type: z.literal("surface"),
    selection: selectionValueSchema.optional(),
    transparency: z.number().min(0).max(1).optional(),
    color: colorTokenSchema.optional(),
  }),
  z.object({
    type: z.literal("map"),
    selection: selectionValueSchema,
    mapName: actionNameSchema,
    displayAs: z.enum(["mesh", "surface"]).default("mesh"),
    grid: z.number().min(0.1).max(10).default(1),
    buffer: z.number().min(0).max(20).default(5),
    level: z.number().min(-10).max(10).default(1),
    carve: z.number().min(0).max(20).optional(),
  }),
  z.object({
    type: z.literal("map_display"),
    mapName: actionNameSchema,
    selection: selectionValueSchema.optional(),
    displayAs: z.enum(["mesh", "surface"]).default("mesh"),
    buffer: z.number().min(0).max(20).default(5),
    level: z.number().min(-10).max(10).default(1),
    carve: z.number().min(0).max(20).optional(),
    color: colorTokenSchema.optional(),
  }),
  z.object({
    type: z.literal("symmetry"),
    prefix: buildSafeIdentifierSchema(40, "symmetry prefix"),
    object: actionNameSchema,
    selection: selectionValueSchema,
    cutoff: z.number().min(0.5).max(1000).default(8),
    segi: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("scene"),
    action: z.enum(["store", "recall", "clear", "view_store", "view_recall"]),
    key: sceneKeySchema,
    message: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("object"),
    action: z.enum(["create", "delete", "enable", "disable"]),
    name: actionNameSchema,
    selection: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("preset"),
    name: z.enum([
      "publication",
      "presentation_light",
      "ligand_editorial",
      "assembly_editorial",
      "cryo_atomic_hero",
      "pocket_hero",
      "comparison_hero",
      "map_hero",
      "confidence_putty",
      "cartoon_overview",
    ]),
  }),
  z.object({
    type: z.literal("setting"),
    name: settingNameSchema,
    value: z.union([buildSafeSelectionExpressionSchema(120, "setting value"), z.number(), z.boolean()]),
    selection: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("export"),
    export: pymolExportSchema,
  }),
  z.object({
    type: z.literal("raw_command"),
    command: z.string().min(1).max(500),
    requiresConfirmation: z.boolean().optional(),
  }),
]);

export const chimeraXActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reset_workspace"),
  }),
  z.object({
    type: z.literal("open"),
    source: z.enum(["pdb", "local", "alphafold"]),
    id: buildSafeIdentifierSchema(120, "structure id").optional(),
    path: z.string().min(1).max(400).optional(),
    semanticRole: semanticRoleSchema.optional(),
    aliases: z.array(aliasLabelSchema).min(1).max(12).optional(),
  }),
  z.object({
    type: z.literal("close"),
    target: targetSpecifierSchema.default("all"),
  }),
  z.object({
    type: z.literal("visibility"),
    mode: z.enum(["show", "hide"]),
    selection: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("select"),
    selection: selectionValueSchema.optional(),
    action: z.enum(["replace", "clear"]).default("replace"),
  }),
  z.object({
    type: z.literal("style"),
    selection: selectionValueSchema.optional(),
    atoms: z.enum(["stick", "ball", "sphere"]).optional(),
    ribbon: z.boolean().optional(),
    surface: z.boolean().optional(),
    zoneNear: selectionValueSchema.optional(),
    zoneDistance: z.number().min(0.5).max(25).optional(),
    zoneMaxComponents: z.number().int().min(1).max(20).optional(),
    transparency: z.number().min(0).max(100).optional(),
  }),
  z.object({
    type: z.literal("color"),
    selection: selectionValueSchema.optional(),
    color: colorTokenSchema.optional(),
    scheme: z.enum(["bychain", "byelement", "bfactor", "confidence"]).optional(),
  }),
  z.object({
    type: z.literal("camera"),
    action: z.enum(["view", "turn", "move", "zoom", "clip", "hero_frame", "pocket_frame", "comparison_frame", "map_cutaway"]),
    selection: selectionValueSchema.optional(),
    axis: z.enum(["x", "y", "z"]).optional(),
    clipMode: z.enum(["near", "far", "front", "back", "off", "list"]).optional(),
    amount: z.number().min(-360).max(360).optional(),
    frames: z.number().int().min(1).max(600).optional(),
  }),
  z.object({
    type: z.literal("transform"),
    mode: z.enum(["translate", "rotate"]),
    selection: selectionValueSchema.optional(),
    axis: z.enum(["x", "y", "z"]).optional(),
    amount: z.number().min(-500).max(500).optional(),
    frames: z.number().int().min(1).max(600).optional(),
    center: selectionValueSchema.optional(),
    coordinateSystem: selectionValueSchema.optional(),
  }),
  z.object({
    type: z.literal("measure"),
    mode: z.enum(["distance", "angle", "torsion"]).default("distance"),
    selection1: selectionValueSchema,
    selection2: selectionValueSchema,
    selection3: selectionValueSchema.optional(),
    selection4: selectionValueSchema.optional(),
    color: colorTokenSchema.optional(),
  }),
  z.object({
    type: z.literal("distance"),
    selection1: selectionValueSchema,
    selection2: selectionValueSchema,
    color: colorTokenSchema.optional(),
  }),
  z.object({
    type: z.literal("label"),
    action: z.enum(["show", "clear"]).default("show"),
    selection: selectionValueSchema,
    text: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("contacts"),
    mode: z.enum(["hbonds", "clashes", "contacts", "alphafold_contacts"]).default("hbonds"),
    selection1: selectionValueSchema,
    selection2: selectionValueSchema.optional(),
    distance: z.number().min(0).max(20).optional(),
  }),
  z.object({
    type: z.literal("align"),
    method: z.enum(["matchmaker", "align"]).default("matchmaker"),
    mobile: selectionValueSchema,
    target: selectionValueSchema,
  }),
  z.object({
    type: z.literal("fit"),
    mobile: selectionValueSchema,
    map: targetSpecifierSchema,
  }),
  z.object({
    type: z.literal("symmetry"),
    action: z.enum(["assembly", "clear"]).default("assembly"),
    selection: selectionValueSchema.optional(),
    assemblyId: buildSafeIdentifierSchema(40, "assembly id").optional(),
    copies: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("layout"),
    mode: z.enum(["tile", "off"]),
  }),
  z.object({
    type: z.literal("volume"),
    action: z.enum(["molmap", "surface", "mesh", "orthoplanes", "zone", "show", "hide"]),
    selection: selectionValueSchema.optional(),
    mapName: actionNameSchema.optional(),
    nearAtoms: selectionValueSchema.optional(),
    resolution: z.number().min(1).max(20).optional(),
    level: z.number().min(-10).max(10).optional(),
    range: z.number().min(0.5).max(50).optional(),
    minimalBounds: z.boolean().optional(),
    newMap: z.boolean().optional(),
    transparency: z.number().min(0).max(100).optional(),
    showOutlineBox: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("preset"),
    name: z.enum([
      "publication",
      "interactive",
      "soft-light",
      "outline",
      "silhouette",
      "presentation_light",
      "ligand_editorial",
      "assembly_editorial",
      "cryo_atomic_hero",
      "comparison_hero",
      "map_hero",
      "confidence_hero",
      "cartoon_overview",
    ]),
  }),
  z.object({
    type: z.literal("graphics"),
    background: colorTokenSchema.optional(),
    silhouettes: z.boolean().optional(),
    silhouetteColor: colorTokenSchema.optional(),
    silhouetteWidth: z.number().min(1).max(12).optional(),
    quality: z.number().min(0.2).max(4).optional(),
  }),
  z.object({
    type: z.literal("cartoon"),
    selection: selectionValueSchema.optional(),
    width: z.number().min(0.5).max(5).optional(),
    thickness: z.number().min(0.1).max(2).optional(),
    xsection: z.enum(["oval", "rect", "barbell"]).optional(),
  }),
  z.object({
    type: z.literal("cartoon_style"),
    selection: selectionValueSchema.optional(),
    width: z.number().min(0.5).max(5).optional(),
    thickness: z.number().min(0.1).max(2).optional(),
    xsection: z.enum(["oval", "rect", "barbell"]).optional(),
  }),
  z.object({
    type: z.literal("view"),
    action: z.enum(["save", "recall", "delete", "initial"]),
    name: actionNameSchema.optional(),
    frames: z.number().int().min(1).max(300).optional(),
  }),
  z.object({
    type: z.literal("lighting"),
    mode: z.enum(["simple", "soft", "full", "flat"]),
  }),
  z.object({
    type: z.literal("export"),
    export: chimeraXExportSchema,
  }),
  z.object({
    type: z.literal("raw_command"),
    command: z.string().min(1).max(500),
    requiresConfirmation: z.boolean().optional(),
  }),
]);

export const pymolEnvelopeSchema = baseEnvelopeSchema.extend({
  target: z.literal("pymol"),
  actions: z.array(pymolActionSchema).min(1).max(20),
});

export const chimeraXEnvelopeSchema = baseEnvelopeSchema.extend({
  target: z.literal("chimerax"),
  actions: z.array(chimeraXActionSchema).min(1).max(20),
});

export const actionEnvelopeSchema = z.discriminatedUnion("target", [
  pymolEnvelopeSchema,
  chimeraXEnvelopeSchema,
]);

export type PymolAction = z.infer<typeof pymolActionSchema>;
export type ChimeraXAction = z.infer<typeof chimeraXActionSchema>;
export type ActionEnvelope = z.infer<typeof actionEnvelopeSchema>;
export type CaptureViewRequest = z.infer<typeof captureViewRequestSchema>;

export const actionResultMetricSchema = z.object({
  kind: z.enum(["distance", "angle", "dihedral", "torsion", "alignment", "fit", "contacts", "capture"]),
  label: z.string().min(1).max(200),
  name: z.string().min(1).max(120).optional(),
  value: z.number().finite().optional(),
  valueText: z.string().min(1).max(240).optional(),
  unit: z.string().min(1).max(40).optional(),
  source: z.enum(["computed", "rpc", "python_value", "log"]).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).refine((metric) => typeof metric.value === "number" || typeof metric.valueText === "string", {
  message: "Action result metrics must include either a numeric value or a textual value.",
});

export const actionResultArtifactSchema = z.object({
  kind: z.enum(["image", "session", "model"]),
  path: z.string(),
  label: z.string(),
  url: z.string().optional(),
  mimeType: z.string().optional(),
});

export const actionResultSchema = z.object({
  target: targetKindSchema,
  commandsExecuted: z.array(z.string()),
  logs: z.array(z.string()),
  artifacts: z.array(actionResultArtifactSchema).default([]),
  metrics: z.array(actionResultMetricSchema).default([]),
  warnings: z.array(z.string()).default([]),
  state: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export type ActionResult = z.infer<typeof actionResultSchema>;
export type ActionResultArtifact = z.infer<typeof actionResultArtifactSchema>;
export type ActionResultMetric = z.infer<typeof actionResultMetricSchema>;

export const recipeStepSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(400),
  actions: z.array(z.union([pymolActionSchema, chimeraXActionSchema])).min(1),
  checkpoints: z.array(z.string()).min(1),
  manualCommands: z.array(z.string()).min(1),
});

export const recipeManifestSchema = z.object({
  id: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(400),
  apps: z.array(targetKindSchema).min(1),
  difficulty: z.enum(["intro", "operator", "deep-dive"]),
  dataType: z.string().min(1).max(80),
  task: z.string().min(1).max(120),
  estimatedMinutes: z.number().int().min(1).max(120),
  voiceMode: voiceModeSchema,
  requiresConfirmation: z.boolean(),
  lastVerified: z.string().min(1).max(40),
  sampleData: z.array(z.object({
    id: z.string().min(1).max(120),
    kind: z.enum(["pdb", "alphafold", "local", "generated"]),
    label: z.string().min(1).max(120),
    localPath: z.string().max(400).optional(),
    remoteUrl: z.string().url().optional(),
  })).min(1),
  prompts: z.array(z.string()).min(3),
  checkpoints: z.array(z.string()).min(3),
  utterances: z.array(z.string()).min(6),
  steps: z.array(recipeStepSchema).min(3),
});

export type RecipeManifest = z.infer<typeof recipeManifestSchema>;
