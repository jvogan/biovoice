import type { TargetKind } from "../schemas/index.js";

const sharedSelectorHints = [
  "Prefer selections grounded in the current active object, chain, numeric residue range, ligand/cofactor residue name, or named selection.",
  "For staged or BILD storyboard scenes, prefer model-level selections such as #1, #2-5, or the exact model names returned by get_target_state; do not invent residues, chains, atoms, or contacts when the scene has no atomic structure.",
  "Use residue only for residue IDs or ranges such as 58 or 58-87. For named cofactors or residue names such as HEM, ATP, NAD, or HIS, use ligand or residueName instead.",
  "For nearby residues or side chains, use around plus withinAngstroms, for example { object: \"4hhb\", entity: \"sidechain\", around: \"4hhb and resn HEM\", withinAngstroms: 5, byResidue: true }. Do not use byResidue with only HEM when the user asked for nearby side chains.",
  "When get_target_state returns referenceHints, prefer a selector object with reference, for example { reference: \"predictedModel\" }, or copy the returned concrete selector instead of inventing object names.",
  "If the user refers to 'this' or 'that', assume the most recently focused selection only when there is a single clear candidate.",
  "Batch several related actions into one tool call when the user asks for a sequence of visual changes.",
].join(" ");

const selectorObjectSchema = {
  type: "object",
  properties: {
    reference: { type: "string" },
    object: { type: "string" },
    model: { type: "string" },
    chain: { type: "string" },
    chains: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 24,
    },
    residue: { type: "string", description: "Numeric residue ID or range only, for example 58, 58-87, or 100A. Do not put ligand/cofactor names here." },
    residues: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 64,
    },
    residueName: { type: "string", description: "Residue name or cofactor code, for example HEM, ATP, NAD, or HIS." },
    residueNames: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 24,
    },
    atom: { type: "string" },
    ligand: { type: "string", description: "Ligand or cofactor residue name, for example HEM. Prefer this for heme/cofactor requests." },
    entity: { type: "string", enum: ["protein", "nucleic", "polymer", "organic", "solvent", "ions", "backbone", "sidechain"] },
    around: { type: "string", description: "Selection to search around for proximity requests, for example '4hhb and resn HEM'. Pair with withinAngstroms." },
    withinAngstroms: { type: "number", minimum: 0.5, maximum: 50 },
    byResidue: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const selectorSchema = {
  oneOf: [
    { type: "string", minLength: 1, maxLength: 400 },
    selectorObjectSchema,
  ],
} as const;

const exportBaseSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    width: { type: "number", minimum: 320, maximum: 4096 },
    height: { type: "number", minimum: 240, maximum: 4096 },
    rayTrace: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const pymolExportSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["png", "pse", "session"] },
    ...exportBaseSchema.properties,
  },
  additionalProperties: false,
} as const;

const chimeraXExportSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["png", "cxs", "session"] },
    ...exportBaseSchema.properties,
  },
  additionalProperties: false,
} as const;

const scientificWorkflowExportSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["png", "pse", "cxs", "session"] },
    ...exportBaseSchema.properties,
  },
  additionalProperties: false,
} as const;

const alphaFoldInputsSchema = {
  type: "object",
  properties: {
    modelPath: { type: "string" },
    uniprotId: { type: "string" },
    paePath: { type: "string" },
    useAfdbPae: { type: "boolean" },
    experimentalPath: { type: "string" },
    experimentalPdbId: { type: "string" },
    experimentalPdbFormat: { type: "string", enum: ["pdb", "cif"] },
    pdbFormat: { type: "string", enum: ["pdb", "cif"] },
    structureFormat: { type: "string", enum: ["pdb", "cif"] },
    cryoMapPath: { type: "string" },
    cryoMapEmdbId: { type: "string" },
    emdbId: { type: "string" },
    interfaceChains: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string" },
    },
    focusResidues: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string" },
    },
    modelLabel: { type: "string" },
    experimentalLabel: { type: "string" },
  },
  additionalProperties: false,
} as const;

const rosettaInputsSchema = {
  type: "object",
  properties: {
    bundlePath: { type: "string" },
    candidatePaths: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: { type: "string" },
    },
    scorefilePath: { type: "string" },
    referencePath: { type: "string" },
    ligandCode: { type: "string" },
    interfaceChains: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string" },
    },
    focusResidues: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string" },
    },
    topN: { type: "number", minimum: 1, maximum: 8 },
    designLabel: { type: "string" },
    referenceLabel: { type: "string" },
  },
  additionalProperties: false,
} as const;

function variantSchema(
  actionType: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      type: { type: "string", enum: [actionType] },
      ...properties,
    },
    required: ["type", ...required],
    additionalProperties: false,
  };
}

const pymolActionSchemas = [
  variantSchema("reset_workspace", {}),
  variantSchema("load", {
    source: { type: "string", enum: ["pdb", "local", "alphafold"] },
    id: { type: "string" },
    object: { type: "string" },
    path: { type: "string" },
    semanticRole: { type: "string", enum: ["experimental", "predicted", "design", "scaffold", "binder", "receptor", "partner"] },
    aliases: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 12,
    },
  }, ["source"]),
  variantSchema("select", {
    name: { type: "string" },
    selection: selectorSchema,
  }, ["name", "selection"]),
  variantSchema("show", {
    representations: {
      type: "array",
      description: "Adds representations without hiding existing ones. For switch-to-cartoon or cartoon-only requests, prefer preset cartoon_overview or pair hide everything on polymer.protein with show cartoon.",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", enum: ["cartoon", "sticks", "spheres", "surface", "mesh", "lines", "ribbon", "dots"] },
    },
    selection: selectorSchema,
  }, ["representations"]),
  variantSchema("hide", {
    representations: {
      type: "array",
      description: "Use everything on polymer.protein before show cartoon when the user asks for a cartoon-only protein view.",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", enum: ["cartoon", "sticks", "spheres", "surface", "mesh", "lines", "ribbon", "everything"] },
    },
    selection: selectorSchema,
  }, ["representations"]),
  variantSchema("color", {
    selection: selectorSchema,
    color: { type: "string", description: "Use compact PyMOL-safe color tokens. Prefer gray80 for light gray, gray60 for medium gray, and gray40 for dark gray." },
    scheme: { type: "string", enum: ["by_chain", "by_element", "rainbow", "b_factor"], description: "Use b_factor for AlphaFold confidence in PyMOL; it renders with the AlphaFold-style red-yellow-green-cyan-blue palette." },
  }),
  variantSchema("cartoon", {
    selection: selectorSchema,
    style: {
      type: "string",
      enum: ["automatic", "tube", "pipe", "putty", "oval", "rectangle", "loop", "arrow", "dumbbell", "skip"],
      description: "Use tube or pipe when the user asks for a cartoon pipe, tube, thick cartoon, or cylindrical chain.",
    },
    radius: { type: "number", minimum: 0.05, maximum: 5, description: "Optional tube/putty radius. For a visible pipe-style cartoon, use about 0.45 to 0.7." },
  }),
  variantSchema("camera", {
    action: { type: "string", enum: ["orient", "zoom", "center", "turn", "move", "clip", "hero_frame", "pocket_frame", "comparison_frame", "map_cutaway"] },
    selection: selectorSchema,
    axis: { type: "string", enum: ["x", "y", "z"] },
    clipMode: { type: "string", enum: ["near", "far", "move", "slab"] },
    degrees: { type: "number", minimum: -360, maximum: 360 },
    amount: { type: "number", minimum: -200, maximum: 200 },
    buffer: { type: "number", minimum: 0, maximum: 50 },
  }, ["action"]),
  variantSchema("transform", {
    mode: { type: "string", enum: ["translate", "rotate"] },
    selection: {
      ...selectorSchema,
      description: "Whole object or atom selection to move/rotate. Prefer object-level selectors such as { object: \"af_prediction\" } or semantic references when moving a whole partner.",
    },
    object: { type: "string" },
    axis: { type: "string", enum: ["x", "y", "z"] },
    amount: { type: "number", minimum: -500, maximum: 500 },
    vector: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "number", minimum: -500, maximum: 500 },
    },
    camera: { type: "boolean" },
    origin: selectorSchema,
    frames: { type: "number", minimum: 1, maximum: 600 },
    center: { ...selectorSchema, description: "Accepted alias for PyMOL transform origin; use this when rotating around a ligand, pocket, or partner center." },
    coordinateSystem: { ...selectorSchema, description: "Selection accepted by the shared schema for parity with ChimeraX transform planning." },
  }, ["mode"]),
  variantSchema("measure", {
    mode: { type: "string", enum: ["distance", "angle", "dihedral", "polar_contacts"] },
    name: { type: "string" },
    selection1: selectorSchema,
    selection2: selectorSchema,
    selection3: selectorSchema,
    selection4: selectorSchema,
    cutoff: { type: "number", minimum: 0, maximum: 50 },
  }, ["selection1", "selection2"]),
  variantSchema("distance", {
    name: { type: "string" },
    selection1: selectorSchema,
    selection2: selectorSchema,
    cutoff: { type: "number", minimum: 0, maximum: 50 },
    mode: { type: "number", minimum: 0, maximum: 8 },
  }, ["selection1", "selection2"]),
  variantSchema("contacts", {
    mode: {
      type: "string",
      enum: ["polar_contacts", "hbonds", "contacts", "clashes"],
      description: "Use polar_contacts or hbonds for hydrogen-bond style pseudobonds, contacts for generic close contacts, and clashes for short-distance clash markers.",
    },
    name: { type: "string" },
    selection1: selectorSchema,
    selection2: selectorSchema,
    cutoff: { type: "number", minimum: 0, maximum: 20 },
    distance: { type: "number", minimum: 0, maximum: 20, description: "Alias for cutoff, matching the ChimeraX contacts action vocabulary." },
  }, ["selection1"]),
  variantSchema("label", {
    action: { type: "string", enum: ["show", "clear"] },
    selection: selectorSchema,
    text: { type: "string", description: "Literal label text. Use explicit text such as Fe, Heme, or Chain A. Do not use PyMOL printf placeholders such as %S." },
  }, ["selection"]),
  variantSchema("align", {
    method: { type: "string", enum: ["align", "super", "cealign"] },
    mobile: selectorSchema,
    target: selectorSchema,
  }, ["mobile", "target"]),
  variantSchema("surface", {
    selection: selectorSchema,
    transparency: { type: "number", minimum: 0, maximum: 1 },
    color: { type: "string", description: "Surface-only color. Use compact PyMOL-safe tokens such as gray80, gray60, gray40, cyan, hotpink, or tv_orange. Do not add a separate color action unless the user wants atom/cartoon colors changed too." },
  }),
  variantSchema("map", {
    selection: selectorSchema,
    mapName: { type: "string" },
    displayAs: { type: "string", enum: ["mesh", "surface"] },
    grid: { type: "number", minimum: 0.1, maximum: 10 },
    buffer: { type: "number", minimum: 0, maximum: 20 },
    level: { type: "number", minimum: -10, maximum: 10 },
    carve: { type: "number", minimum: 0, maximum: 20 },
  }, ["selection", "mapName"]),
  variantSchema("map_display", {
    mapName: { type: "string" },
    selection: selectorSchema,
    displayAs: { type: "string", enum: ["mesh", "surface"] },
    buffer: { type: "number", minimum: 0, maximum: 20 },
    level: { type: "number", minimum: -10, maximum: 10 },
    carve: { type: "number", minimum: 0, maximum: 20 },
    color: { type: "string", description: "Use compact color tokens such as gray80, gray60, gray40, cyan, hotpink, or tv_orange." },
  }, ["mapName"]),
  variantSchema("symmetry", {
    prefix: { type: "string" },
    object: { type: "string" },
    selection: selectorSchema,
    cutoff: { type: "number", minimum: 0.5, maximum: 1000 },
    segi: { type: "boolean" },
  }, ["prefix", "object", "selection"]),
  variantSchema("scene", {
    action: { type: "string", enum: ["store", "recall", "clear", "view_store", "view_recall"] },
    key: { type: "string" },
    message: { type: "string" },
  }, ["action", "key"]),
  variantSchema("object", {
    action: { type: "string", enum: ["create", "delete", "enable", "disable"] },
    name: { type: "string" },
    selection: selectorSchema,
  }, ["action", "name"]),
  variantSchema("preset", {
    name: {
      type: "string",
      enum: [
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
      ],
    },
  }, ["name"]),
  variantSchema("setting", {
    name: { type: "string" },
    value: {
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
      ],
    },
    selection: selectorSchema,
  }, ["name", "value"]),
  variantSchema("export", {
    export: pymolExportSchema,
  }, ["export"]),
  variantSchema("raw_command", {
    command: { type: "string" },
    requiresConfirmation: { type: "boolean" },
  }, ["command"]),
] as const;

const chimeraXActionSchemas = [
  variantSchema("reset_workspace", {}),
  variantSchema("open", {
    source: { type: "string", enum: ["pdb", "local", "alphafold"] },
    id: { type: "string" },
    path: { type: "string" },
    semanticRole: { type: "string", enum: ["experimental", "predicted", "design", "scaffold", "binder", "receptor", "partner"] },
    aliases: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 12,
    },
  }, ["source"]),
  variantSchema("close", {
    target: { type: "string" },
  }),
  variantSchema("visibility", {
    mode: { type: "string", enum: ["show", "hide"] },
    selection: {
      ...selectorSchema,
      description: "Selection or model spec to show/hide. For staged BILD scenes, use whole-model specs such as #1, #2-5, #1,3,4,6, or exact names from get_target_state.",
    },
  }, ["mode"]),
  variantSchema("select", {
    action: { type: "string", enum: ["replace", "clear"] },
    selection: selectorSchema,
  }),
  variantSchema("style", {
    selection: selectorSchema,
    atoms: { type: "string", enum: ["stick", "ball", "sphere"] },
    ribbon: { type: "boolean" },
    surface: { type: "boolean" },
    zoneNear: selectorSchema,
    zoneDistance: { type: "number", minimum: 0.5, maximum: 25 },
    zoneMaxComponents: { type: "number", minimum: 1, maximum: 20 },
    transparency: { type: "number", minimum: 0, maximum: 100, description: "Surface transparency percent when surface is true. Avoid a separate color action if the user wants existing atom/cartoon colors preserved." },
  }),
  variantSchema("color", {
    selection: {
      ...selectorSchema,
      description: "Selection or whole model to recolor. For staged BILD scenes, recolor complete component models such as #2 or #5 rather than trying atom/residue selectors.",
    },
    color: { type: "string", description: "Use compact color tokens or hex values. Prefer gray80 for light gray, gray60 for medium gray, and gray40 for dark gray." },
    scheme: { type: "string", enum: ["bychain", "byelement", "bfactor", "confidence"] },
  }),
  variantSchema("camera", {
    action: { type: "string", enum: ["view", "turn", "move", "zoom", "clip", "hero_frame", "pocket_frame", "comparison_frame", "map_cutaway"], description: "Use hero_frame/comparison_frame for polished storyboard beats; use turn or move with frames for visible live motion." },
    selection: {
      ...selectorSchema,
      description: "Optional focus selection. For staged scenes, frame model ranges such as #1-6 or #2-5.",
    },
    axis: { type: "string", enum: ["x", "y", "z"] },
    clipMode: { type: "string", enum: ["near", "far", "front", "back", "off", "list"] },
    amount: { type: "number", minimum: -360, maximum: 360 },
    frames: { type: "number", minimum: 1, maximum: 600 },
  }, ["action"]),
  variantSchema("transform", {
    mode: { type: "string", enum: ["translate", "rotate"] },
    selection: {
      ...selectorSchema,
      description: "Whole model or atomic selection to move/rotate. For staged storyboard scenes, use model specs like #3 or #2-5 to explode, reassemble, or animate components.",
    },
    axis: { type: "string", enum: ["x", "y", "z"] },
    amount: { type: "number", minimum: -500, maximum: 500 },
    frames: { type: "number", minimum: 1, maximum: 600 },
    center: selectorSchema,
    coordinateSystem: selectorSchema,
  }, ["mode"]),
  variantSchema("measure", {
    mode: { type: "string", enum: ["distance", "angle", "torsion"] },
    selection1: selectorSchema,
    selection2: selectorSchema,
    selection3: selectorSchema,
    selection4: selectorSchema,
    color: { type: "string" },
  }, ["selection1", "selection2"]),
  variantSchema("distance", {
    selection1: selectorSchema,
    selection2: selectorSchema,
    color: { type: "string" },
  }, ["selection1", "selection2"]),
  variantSchema("label", {
    action: { type: "string", enum: ["show", "clear"] },
    selection: selectorSchema,
    text: { type: "string", description: "Literal atom label text. Use explicit text such as Fe, Heme, or Chain A. Do not use command-language placeholders such as %S. Avoid this for Generic3DModel/BILD storyboard scenes; use prebuilt 2D overlays or model-level coloring instead." },
  }, ["selection"]),
  variantSchema("contacts", {
    mode: { type: "string", enum: ["hbonds", "clashes", "contacts", "alphafold_contacts"] },
    selection1: selectorSchema,
    selection2: selectorSchema,
    distance: { type: "number", minimum: 0, maximum: 20 },
  }, ["selection1"]),
  variantSchema("align", {
    method: { type: "string", enum: ["matchmaker", "align"] },
    mobile: selectorSchema,
    target: selectorSchema,
  }, ["mobile", "target"]),
  variantSchema("fit", {
    mobile: selectorSchema,
    map: { type: "string" },
  }, ["mobile", "map"]),
  variantSchema("symmetry", {
    action: { type: "string", enum: ["assembly", "clear"] },
    selection: selectorSchema,
    assemblyId: { type: "string" },
    copies: { type: "boolean" },
  }),
  variantSchema("layout", {
    mode: { type: "string", enum: ["tile", "off"] },
  }, ["mode"]),
  variantSchema("volume", {
    action: { type: "string", enum: ["molmap", "surface", "mesh", "orthoplanes", "zone", "show", "hide"] },
    selection: selectorSchema,
    mapName: { type: "string" },
    nearAtoms: selectorSchema,
    resolution: { type: "number", minimum: 1, maximum: 20 },
    level: { type: "number", minimum: -10, maximum: 10 },
    range: { type: "number", minimum: 0.5, maximum: 50 },
    minimalBounds: { type: "boolean" },
    newMap: { type: "boolean" },
    transparency: { type: "number", minimum: 0, maximum: 100 },
    showOutlineBox: { type: "boolean", description: "Set false for clean paper-style density surfaces without the volume outline box." },
  }, ["action"]),
  variantSchema("preset", {
    name: {
      type: "string",
      enum: [
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
      ],
    },
  }, ["name"]),
  variantSchema("graphics", {
    background: { type: "string" },
    silhouettes: { type: "boolean" },
    silhouetteColor: { type: "string" },
    silhouetteWidth: { type: "number", minimum: 1, maximum: 12 },
    quality: { type: "number", minimum: 0.2, maximum: 4 },
  }),
  variantSchema("cartoon", {
    selection: selectorSchema,
    width: { type: "number", minimum: 0.5, maximum: 5 },
    thickness: { type: "number", minimum: 0.1, maximum: 2 },
    xsection: { type: "string", enum: ["oval", "rect", "barbell"] },
  }),
  variantSchema("cartoon_style", {
    selection: selectorSchema,
    width: { type: "number", minimum: 0.5, maximum: 5 },
    thickness: { type: "number", minimum: 0.1, maximum: 2 },
    xsection: { type: "string", enum: ["oval", "rect", "barbell"] },
  }),
  variantSchema("view", {
    action: { type: "string", enum: ["save", "recall", "delete", "initial"] },
    name: { type: "string" },
    frames: { type: "number", minimum: 1, maximum: 300 },
  }, ["action"]),
  variantSchema("lighting", {
    mode: { type: "string", enum: ["simple", "soft", "full", "flat"] },
  }, ["mode"]),
  variantSchema("export", {
    export: chimeraXExportSchema,
  }, ["export"]),
  variantSchema("raw_command", {
    command: { type: "string" },
    requiresConfirmation: { type: "boolean" },
  }, ["command"]),
] as const;

export function buildRealtimeTools(activeTarget: TargetKind, options: { advancedMode?: boolean } = {}) {
  const advancedMode = options.advancedMode ?? false;
  const activePymolActionSchemas = filterActionSchemas(pymolActionSchemas, advancedMode);
  const activeChimeraXActionSchemas = filterActionSchemas(chimeraXActionSchemas, advancedMode);
  return [
    {
      type: "function",
      name: "wait_for_user",
      description: "Call this when the latest audio should not receive a spoken response, such as silence, background noise, hold music, TV audio, side conversation, or speech not addressed to the assistant. This ends the turn quietly while continuing to listen.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "set_response_language_mode",
      description: "Switch the assistant's user-facing spoken/text response language mode for the current Realtime session. Use mode=klingon when the user asks to enter, start, enable, or stay in Klingon mode. Use mode=standard when the user asks to stop, exit, disable, or leave Klingon mode. This does not change tool execution, target app state, selectors, IDs, or scientific action behavior.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["standard", "klingon"] },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "run_pymol_actions",
      description: `Run one or more structured PyMOL visualization actions. Only use this when the active target is PyMOL. Supports complex scientist workflows such as ligand-pocket styling, residue-neighborhood selections, distances/angles/dihedrals, structured polar contacts, close contacts and clashes, subset or CA-only alignment, crystal mates, whole-object or partner transforms for side-by-side comparison, scaffold-versus-design review, density mesh/surface creation, scene storage, label cleanup, clip slabs, and polished exports. ${sharedSelectorHints}`,
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["pymol"] },
          summary: { type: "string" },
          recipeId: { type: "string" },
          dryRun: { type: "boolean" },
          actions: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              oneOf: [...activePymolActionSchemas],
            },
          },
        },
        required: ["target", "actions"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "run_chimerax_actions",
      description: `Run one or more structured ChimeraX visualization actions. Only use this when the active target is ChimeraX. Supports complex scientist workflows such as ligand interactions, hbonds/clashes/contacts, AlphaFold confidence coloring, named views, alignment and tiling, map fitting, orthoplane inspection, front/back clipping, partner or whole-model transforms for assemblies and design reviews, scaffold-versus-design review, label cleanup, assembly views, and polished exports. Also supports staged non-atomic/BILD storyboard demos via model-level show/hide, recolor, named view recall/save, camera motion, whole-model transforms, capture, and export. ${sharedSelectorHints}`,
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["chimerax"] },
          summary: { type: "string" },
          recipeId: { type: "string" },
          dryRun: { type: "boolean" },
          actions: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              oneOf: [...activeChimeraXActionSchemas],
            },
          },
        },
        required: ["target", "actions"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "resolve_structure_asset",
      description: "Resolve, search, and cache known structural biology assets from approved databases. Use this before loading online or database-backed content that is not already local: AlphaFold DB models/PAE by UniProt accession, RCSB PDB/mmCIF by PDB ID, RCSB full-text search, EMDB maps by EMD ID, and UniProt metadata/search. This tool does not accept arbitrary URLs. Set loadIntoTarget with a target to load the resolved model or map into PyMOL or ChimeraX using a stable object/id and optional semanticRole/aliases.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["alphafold", "rcsb", "rcsb_search", "emdb", "uniprot"] },
          target: { type: "string", enum: ["pymol", "chimerax"] },
          loadIntoTarget: { type: "boolean" },
          uniprotId: { type: "string" },
          pdbId: { type: "string" },
          emdbId: { type: "string" },
          accession: { type: "string" },
          query: { type: "string" },
          format: { type: "string", enum: ["pdb", "cif"] },
          assemblyId: { type: "string" },
          includePae: { type: "boolean" },
          includeMetadata: { type: "boolean" },
          limit: { type: "number", minimum: 1, maximum: 25 },
          object: { type: "string" },
          semanticRole: { type: "string", enum: ["experimental", "predicted", "design", "scaffold", "binder", "receptor", "partner"] },
          aliases: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 12,
          },
        },
        required: ["source"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "get_target_state",
      description: "Fetch the current target's state summary before deciding on the next action, especially when the user says 'this', 'that', 'whole complex', 'predicted model', 'experimental model', 'binder', 'scaffold', 'partner A', 'partner B', or asks what is loaded. The result includes referenceHints with concrete selectors for semantic handles and model metadata; if models are Generic3DModel/BILD/Labels, treat the scene as a staged storyboard and prefer model-level actions over atom/residue/contact tools.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["pymol", "chimerax"] },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "run_scientific_workflow",
      description: "Run a domain-level AlphaFold or Rosetta workflow and compile it into the existing PyMOL or ChimeraX action wrappers. Prefer this for task-level requests such as AlphaFold confidence review, prediction-vs-experiment overlay, multimer interface triage, PAE-guided uncertainty review, cryo handoff, Rosetta scaffold-versus-design review, scorefile-ranked top-design compare, interface packing review, or ligand redesign review. Use this instead of hand-building low-level actions when the user names AlphaFold, AFDB, UniProt, PAE, Rosetta, score.sc, scaffold, design candidate, interface packing, or ligand redesign as the main goal.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["pymol", "chimerax"] },
          workflow: {
            type: "string",
            enum: [
              "alphafold_confidence_review",
              "alphafold_vs_experiment_overlay",
              "alphafold_multimer_interface_review",
              "alphafold_pae_guided_triage",
              "alphafold_to_cryo_handoff",
              "rosetta_scaffold_design_review",
              "rosetta_interface_packing_review",
              "rosetta_ligand_redesign_review",
              "rosetta_top_design_compare",
            ],
          },
          summary: { type: "string" },
          recipeId: { type: "string" },
          dryRun: { type: "boolean" },
          presentationMode: { type: "string", enum: ["analysis", "demo", "publication"] },
          export: scientificWorkflowExportSchema,
          inputs: {
            oneOf: [alphaFoldInputsSchema, rosettaInputsSchema],
          },
        },
        required: ["target", "workflow", "inputs"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "run_recipe_step",
      description: "Execute a named recipe step from the built-in demo library. Use this when the user asks to start, continue, or replay a packaged demo workflow.",
      parameters: {
        type: "object",
        properties: {
          recipeId: { type: "string" },
          stepId: { type: "string" },
          target: { type: "string", enum: ["pymol", "chimerax"] },
          dryRun: { type: "boolean" },
        },
        required: ["recipeId", "stepId", "target"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "export_artifact",
      description: "Save a presentation-ready export from the current target, such as a PNG or session file.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["pymol", "chimerax"] },
          format: { type: "string", enum: ["png", "pse", "cxs", "session"] },
          ...exportBaseSchema.properties,
        },
        required: ["target", "format"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "capture_view",
      description: "Capture the current target viewport as a PNG for visual self-checking. Use this to inspect framing, label clutter, ligand visibility, contact overlays, clipping planes, surfaces, lighting, and export readiness before deciding what to do next.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["pymol", "chimerax"] },
          path: { type: "string" },
          width: { type: "number", minimum: 320, maximum: 4096 },
          height: { type: "number", minimum: 240, maximum: 4096 },
          inspectionPrompt: { type: "string" },
          attachToConversation: { type: "boolean" },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  ].filter((tool) => {
    if (tool.name === "run_pymol_actions") return activeTarget === "pymol";
    if (tool.name === "run_chimerax_actions") return activeTarget === "chimerax";
    return true;
  });
}

function filterActionSchemas<T extends ReadonlyArray<Record<string, unknown>>>(schemas: T, advancedMode: boolean): T {
  if (advancedMode) {
    return schemas;
  }

  return schemas.filter((schema) => {
    const actionType = ((schema.properties as { type?: { enum?: string[] } }).type?.enum ?? [])[0];
    return actionType !== "raw_command";
  }) as unknown as T;
}
