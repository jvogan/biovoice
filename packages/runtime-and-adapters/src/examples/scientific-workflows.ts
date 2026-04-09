import { scientificWorkflowKinds, type ScientificWorkflowKind, type TargetKind } from "../schemas/index.js";

export interface ScientificLaunchInputs {
  uniprot?: string;
  model?: string;
  experimental?: string;
  pae?: string;
  map?: string;
  bundle?: string;
  scorefile?: string;
  topN?: number;
}

export interface ScientificWorkflowCandidate {
  target: TargetKind;
  recipeId: string;
  score: number;
  reason: string;
}

export interface ScientificWorkflowSpec {
  id: ScientificWorkflowKind;
  title: string;
  summary: string;
  group: "AlphaFold" | "Rosetta";
  intent: string;
  defaultTarget: TargetKind;
  launchNotes: string[];
  inputHints: string[];
  voiceStarter: string;
  candidates: ScientificWorkflowCandidate[];
}

export interface ScientificWorkflowLaunch {
  workflowId?: ScientificWorkflowKind;
  recipeId?: string;
  target: TargetKind;
  audience?: boolean;
  autoconnect?: boolean;
  voice?: "push_to_talk" | "open_mic";
  advanced?: boolean;
  widget?: boolean;
  overlay?: boolean;
  scientificInputs?: ScientificLaunchInputs;
}

const scientificWorkflowCatalog: ScientificWorkflowSpec[] = [
  {
    id: "alphafold_confidence_review",
    title: "AlphaFold Confidence Review",
    summary: "Start from a confidence-colored prediction, isolate uncertain loops, and keep the scene ready for a fast PTT demo.",
    group: "AlphaFold",
    intent: "confidence review",
    defaultTarget: "chimerax",
    launchNotes: [
      "Use this when you want the first story beat to be confidence and flexibility.",
      "Best for a clean overview, a loop close-up, and a high-confidence export.",
    ],
    inputHints: ["uniprot", "model", "pae"],
    voiceStarter: "Open the local AlphaFold model and color it by confidence.",
    candidates: [
      { target: "chimerax", recipeId: "chimerax-alphafold-confidence-review", score: 100, reason: "Best named-view confidence review and loop isolation." },
      { target: "pymol", recipeId: "pymol-alphafold-confidence-sweep", score: 98, reason: "Best putty-style confidence sweep and export." },
    ],
  },
  {
    id: "alphafold_vs_experiment_overlay",
    title: "AlphaFold vs Experiment Overlay",
    summary: "Overlay a prediction against an experimental structure, preserve assembly context, and move into a focused comparison patch.",
    group: "AlphaFold",
    intent: "prediction versus experiment",
    defaultTarget: "chimerax",
    launchNotes: [
      "Use this when the demo needs a direct structural comparison, not just a confidence story.",
      "The best shots are an assembly overview, an aligned overlay, and a side-by-side comparison.",
    ],
    inputHints: ["uniprot", "model", "experimental"],
    voiceStarter: "Open the experimental tetramer and the AlphaFold chain model.",
    candidates: [
      { target: "chimerax", recipeId: "chimerax-alphafold-experimental-overlay", score: 100, reason: "Best overlay handoff with named views." },
      { target: "pymol", recipeId: "pymol-alphafold-experimental-overlay", score: 99, reason: "Best chain-level overlay and polished export." },
    ],
  },
  {
    id: "alphafold_multimer_interface_review",
    title: "AlphaFold Multimer Interface Review",
    summary: "Inspect a multimer interface, surface the contact shell, and keep the comparison anchored while the interface is explained.",
    group: "AlphaFold",
    intent: "interface triage",
    defaultTarget: "chimerax",
    launchNotes: [
      "Use this when the story is about contacts, clashes, or an interface shell inside a prediction.",
      "The model should stay readable while only the interface becomes the focus.",
    ],
    inputHints: ["uniprot", "model", "pae"],
    voiceStarter: "Open the AlphaFold multimer and isolate the interface shell.",
    candidates: [
      { target: "chimerax", recipeId: "chimerax-interface-contacts-analysis", score: 100, reason: "Best interface contact, clash, and hbond review." },
      { target: "chimerax", recipeId: "chimerax-alphafold-confidence-review", score: 82, reason: "Good fallback for confidence-colored triage." },
      { target: "pymol", recipeId: "pymol-crystal-packing-contacts", score: 72, reason: "Useful if the comparison needs a PyMOL-style pocket or packing shell." },
    ],
  },
  {
    id: "alphafold_pae_guided_triage",
    title: "AlphaFold PAE-Guided Triage",
    summary: "Use optional PAE input to prioritize uncertain regions and turn them into a short, presentation-ready triage story.",
    group: "AlphaFold",
    intent: "PAE triage",
    defaultTarget: "chimerax",
    launchNotes: [
      "Use this when you want the workflow to surface uncertainty before moving into the overlay.",
      "The UI should summarize low-confidence regions and keep the rest of the assembly quiet.",
    ],
    inputHints: ["uniprot", "model", "pae"],
    voiceStarter: "Show me the uncertain AlphaFold regions first.",
    candidates: [
      { target: "chimerax", recipeId: "chimerax-alphafold-confidence-review", score: 100, reason: "Best confidence triage and named-view summary." },
      { target: "pymol", recipeId: "pymol-alphafold-confidence-sweep", score: 96, reason: "Best putty-based uncertain-region sweep." },
    ],
  },
  {
    id: "alphafold_to_cryo_handoff",
    title: "AlphaFold to Cryo Handoff",
    summary: "Move from prediction or confidence review into a cryo-plus-atomic presentation without losing the scene context.",
    group: "AlphaFold",
    intent: "cryo handoff",
    defaultTarget: "pymol",
    launchNotes: [
      "Use this when the model needs to read against a density map or an assembly cutaway.",
      "Best for a dense but visually polished before/after handoff.",
    ],
    inputHints: ["experimental", "map", "pae"],
    voiceStarter: "Show the cryo map and keep the atomic model visible for the handoff.",
    candidates: [
      { target: "pymol", recipeId: "pymol-cryo-atomic-handoff", score: 100, reason: "Best cryo-plus-atomic hero story in PyMOL." },
      { target: "chimerax", recipeId: "chimerax-em-map-fit-demo", score: 96, reason: "Best map-fit and cutaway handoff in ChimeraX." },
    ],
  },
  {
    id: "rosetta_scaffold_design_review",
    title: "Rosetta Scaffold / Design Review",
    summary: "Compare a scaffold against a design candidate, keep the scaffold anchored, and explode the design cleanly for the before/after shot.",
    group: "Rosetta",
    intent: "design review",
    defaultTarget: "pymol",
    launchNotes: [
      "Use this for scaffold-versus-design storytelling with strong semantic handles.",
      "Best when the key question is what changed in the remodeled shell.",
    ],
    inputHints: ["model", "bundle"],
    voiceStarter: "Open the scaffold and design candidate and keep the scaffold quiet.",
    candidates: [
      { target: "pymol", recipeId: "pymol-rosetta-style-design-review", score: 100, reason: "Best exploded scaffold-versus-design comparison in PyMOL." },
      { target: "chimerax", recipeId: "chimerax-rosetta-style-design-review", score: 98, reason: "Best semantic-handle design review in ChimeraX." },
    ],
  },
  {
    id: "rosetta_interface_packing_review",
    title: "Rosetta Interface Packing Review",
    summary: "Focus on interface contacts, packing, clashes, and residue neighborhoods before the final export.",
    group: "Rosetta",
    intent: "interface packing",
    defaultTarget: "chimerax",
    launchNotes: [
      "Use this when the science story is about interaction quality, not just a static overlay.",
      "Best for packed interfaces, contacts, and clash cleanup.",
    ],
    inputHints: ["bundle", "scorefile", "topN"],
    voiceStarter: "Show the interface contacts and clashes around the design patch.",
    candidates: [
      { target: "chimerax", recipeId: "chimerax-interface-contacts-analysis", score: 100, reason: "Best contacts, clashes, and hbond interface analysis." },
      { target: "pymol", recipeId: "pymol-crystal-packing-contacts", score: 92, reason: "Best packing-shell and contact storytelling in PyMOL." },
      { target: "chimerax", recipeId: "chimerax-rosetta-style-design-review", score: 86, reason: "Best if you want the interface review folded into the scaffold/design story." },
    ],
  },
  {
    id: "rosetta_ligand_redesign_review",
    title: "Rosetta Ligand Redesign Review",
    summary: "Tell a ligand-pocket redesign story with the pocket bright, the scaffold subdued, and the remodeled shell clearly visible.",
    group: "Rosetta",
    intent: "ligand redesign",
    defaultTarget: "pymol",
    launchNotes: [
      "Use this when the design is centered on a binding site or catalytic pocket.",
      "Best for a pocket hero shot, interaction shell, and polished export.",
    ],
    inputHints: ["model", "bundle", "scorefile"],
    voiceStarter: "Keep the ligand bright and show only the redesigned shell.",
    candidates: [
      { target: "pymol", recipeId: "pymol-binding-pocket-story", score: 100, reason: "Best pocket storytelling and ligand emphasis." },
      { target: "pymol", recipeId: "pymol-rosetta-style-design-review", score: 90, reason: "Best if the redesign is part of a broader scaffold overlay." },
      { target: "chimerax", recipeId: "chimerax-interface-contacts-analysis", score: 75, reason: "Good contact cleanup when the ligand pocket is part of a larger interface." },
    ],
  },
  {
    id: "rosetta_top_design_compare",
    title: "Rosetta Top-Design Compare",
    summary: "Rank the top designs, load the winners, and move between the overview and the best-scoring comparison shot.",
    group: "Rosetta",
    intent: "top design compare",
    defaultTarget: "pymol",
    launchNotes: [
      "Use this when the input bundle already contains multiple candidates and the best one is not obvious.",
      "Best for scorefile-driven review and side-by-side design comparison.",
    ],
    inputHints: ["bundle", "scorefile", "topN"],
    voiceStarter: "Rank the top designs and open the best-scoring candidates.",
    candidates: [
      { target: "pymol", recipeId: "pymol-rosetta-style-design-review", score: 100, reason: "Best design-versus-scaffold compare in PyMOL." },
      { target: "chimerax", recipeId: "chimerax-rosetta-style-design-review", score: 98, reason: "Best if you want named views and interface handoff in ChimeraX." },
      { target: "pymol", recipeId: "pymol-two-structure-comparison", score: 84, reason: "Useful fallback for a plain structural compare when design metadata is limited." },
    ],
  },
];

const workflowById = new Map(scientificWorkflowCatalog.map((workflow) => [workflow.id, workflow] as const));
const workflowByRecipeId = new Map<string, ScientificWorkflowSpec>();
for (const workflow of scientificWorkflowCatalog) {
  for (const candidate of workflow.candidates) {
    workflowByRecipeId.set(candidate.recipeId, workflow);
  }
}

export function getScientificWorkflowCatalog(): ScientificWorkflowSpec[] {
  return scientificWorkflowCatalog.slice();
}

export function getScientificWorkflowSpec(workflowId: ScientificWorkflowKind): ScientificWorkflowSpec {
  const workflow = workflowById.get(workflowId);
  if (!workflow) {
    throw new Error(`Unknown scientific workflow: ${workflowId}`);
  }
  return workflow;
}

export function getScientificWorkflowForRecipe(recipeId: string | undefined | null): ScientificWorkflowSpec | null {
  if (!recipeId) {
    return null;
  }
  return workflowByRecipeId.get(recipeId) ?? null;
}

export function resolveScientificWorkflowRecipeId(
  workflowId: ScientificWorkflowKind | undefined,
  target: TargetKind,
): string | null {
  if (!workflowId) {
    return null;
  }

  const workflow = getScientificWorkflowSpec(workflowId);
  const targetCandidate = workflow.candidates.find((candidate) => candidate.target === target);
  return targetCandidate?.recipeId ?? workflow.candidates[0]?.recipeId ?? null;
}

export function rankScientificWorkflowCandidates(
  workflowId: ScientificWorkflowKind | undefined,
  target: TargetKind,
  availableRecipeIds: Set<string>,
): ScientificWorkflowCandidate[] {
  if (!workflowId) {
    return [];
  }

  return getScientificWorkflowSpec(workflowId).candidates
    .filter((candidate) => candidate.target === target && availableRecipeIds.has(candidate.recipeId))
    .sort((left, right) => right.score - left.score);
}

export function buildScientificWorkflowUrl(
  baseUrl: string,
  launch: ScientificWorkflowLaunch,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("target", launch.target);

  const resolvedRecipeId = launch.recipeId ?? resolveScientificWorkflowRecipeId(launch.workflowId, launch.target);
  if (resolvedRecipeId) {
    url.searchParams.set("recipe", resolvedRecipeId);
  }

  if (launch.workflowId) {
    url.searchParams.set("workflow", launch.workflowId);
  }
  if (launch.audience) {
    url.searchParams.set("audience", "1");
  }
  if (launch.voice) {
    url.searchParams.set("voice", launch.voice);
  }
  if (launch.advanced) {
    url.searchParams.set("advanced", "1");
  }
  if (launch.widget) {
    url.searchParams.set("widget", "1");
  }
  if (launch.overlay) {
    url.searchParams.set("overlay", "1");
  }

  appendScientificLaunchInputs(url.searchParams, launch.scientificInputs);
  return url.toString();
}

export function buildScientificLaunchCommand(launch: ScientificWorkflowLaunch): string {
  const parts = ["npm run agent:start --", launch.target];
  if (launch.recipeId) {
    parts.push("--recipe", launch.recipeId);
  }
  if (launch.workflowId) {
    parts.push("--workflow", launch.workflowId);
  }
  appendScientificLaunchArgs(parts, launch.scientificInputs);
  if (launch.audience) {
    parts.push("--audience");
  }
  if (launch.voice === "open_mic") {
    parts.push("--open-mic");
  }
  if (launch.advanced) {
    parts.push("--advanced");
  }
  if (launch.overlay) {
    parts.push("--overlay");
  }
  return parts.join(" ");
}

function appendScientificLaunchInputs(params: URLSearchParams, inputs?: ScientificLaunchInputs): void {
  if (!inputs) {
    return;
  }

  if (inputs.uniprot) params.set("uniprot", inputs.uniprot);
  // Keep browser launch URLs free of local filesystem paths. File-based inputs
  // should travel through explicit CLI arguments or direct workflow staging.
  if (typeof inputs.topN === "number" && Number.isFinite(inputs.topN)) params.set("top_n", String(Math.max(1, Math.round(inputs.topN))));
}

function appendScientificLaunchArgs(parts: string[], inputs?: ScientificLaunchInputs): void {
  if (!inputs) {
    return;
  }

  if (inputs.uniprot) parts.push("--uniprot", inputs.uniprot);
  if (inputs.model) parts.push("--model", inputs.model);
  if (inputs.experimental) parts.push("--experimental", inputs.experimental);
  if (inputs.pae) parts.push("--pae", inputs.pae);
  if (inputs.map) parts.push("--map", inputs.map);
  if (inputs.bundle) parts.push("--bundle", inputs.bundle);
  if (inputs.scorefile) parts.push("--scorefile", inputs.scorefile);
  if (typeof inputs.topN === "number" && Number.isFinite(inputs.topN)) parts.push("--top-n", String(Math.max(1, Math.round(inputs.topN))));
}
