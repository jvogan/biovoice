import {
  scientificWorkflowManifestSchema,
  type ScientificWorkflowKind,
  type ScientificWorkflowManifest,
} from "../schemas/index.js";

export const scientificWorkflowCatalog: ScientificWorkflowManifest[] = scientificWorkflowManifestSchema.array().parse([
  {
    id: "alphafold_confidence_review",
    title: "AlphaFold Confidence Review",
    goal: "Load a predicted model, color it by confidence, identify the least trustworthy region, and stage a polished overview plus close-up.",
    category: "alphafold",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 6,
    docsSlug: "alphafold-confidence-review",
    starterPrompts: [
      "Open the AlphaFold model and color it by confidence.",
      "Find the least confident region and zoom there after the overview.",
      "Keep the structure clean and presentation-ready before export.",
    ],
    inputHints: [
      "Provide a local model path or a UniProt accession.",
      "Optional PAE JSON sharpens the low-confidence region selection.",
      "Push-to-talk is the recommended first live mode.",
    ],
  },
  {
    id: "alphafold_vs_experiment_overlay",
    title: "AlphaFold vs Experiment Overlay",
    goal: "Load a prediction and an experimental structure, align them, and stage a global overlay plus a focused discrepancy view.",
    category: "alphafold",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 8,
    docsSlug: "alphafold-vs-experiment-overlay",
    starterPrompts: [
      "Load the AlphaFold model and the experimental structure and align them.",
      "Keep the experiment quiet and highlight the predicted model by confidence.",
      "Save an overview and then a local discrepancy close-up.",
    ],
    inputHints: [
      "Provide either experimentalPath or experimentalPdbId.",
      "Optional focus residues can force the close-up region.",
      "If no focus residues are given, the workflow uses confidence or PAE-guided fallback regions.",
    ],
  },
  {
    id: "alphafold_multimer_interface_review",
    title: "AlphaFold Multimer Interface Review",
    goal: "Open a multimer prediction, isolate the interface, report contacts, and stage a clean interface hero shot.",
    category: "alphafold",
    apps: ["chimerax"],
    estimatedMinutes: 8,
    docsSlug: "alphafold-multimer-interface-review",
    starterPrompts: [
      "Open the AlphaFold multimer and isolate the A/B interface.",
      "Color by confidence and show contacts across the interface.",
      "Keep the interface readable and stage a clean hero view.",
    ],
    inputHints: [
      "Provide interfaceChains when the multimer is not a simple A/B default.",
      "Optional PAE JSON can promote uncertain-interface handles.",
      "ChimeraX is the default target for this workflow.",
    ],
  },
  {
    id: "alphafold_pae_guided_triage",
    title: "AlphaFold PAE-Guided Triage",
    goal: "Use PAE and confidence to surface uncertain regions or interfaces and move directly into an interpretable close-up.",
    category: "alphafold",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 7,
    docsSlug: "alphafold-pae-guided-triage",
    starterPrompts: [
      "Load the AlphaFold model and use the PAE to find the uncertain region.",
      "Highlight the uncertain shell and move into the close-up immediately after the overview.",
      "Tell me the worst-scoring region briefly once it is on screen.",
    ],
    inputHints: [
      "Provide paePath or rely on AFDB PAE when using UniProt intake.",
      "Optional focus residues can override the automatically selected region.",
      "The workflow produces workflow-specific semantic handles for uncertain regions.",
    ],
  },
  {
    id: "alphafold_to_cryo_handoff",
    title: "AlphaFold to Cryo Handoff",
    goal: "Stage a predicted model against a cryo map, fit or contour the map, and preserve a polished handoff from overview to local fit.",
    category: "alphafold",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 9,
    docsSlug: "alphafold-to-cryo-handoff",
    starterPrompts: [
      "Load the AlphaFold model with the cryo map and stage the overview first.",
      "Fit or contour the model into the map, then move into a local cutaway.",
      "Keep the map and model balanced for a polished export.",
    ],
    inputHints: [
      "cryoMapPath is required.",
      "ChimeraX emphasizes fit and orthoplanes; PyMOL emphasizes contour and presentation polish.",
      "Optional experimentalPath can act as the cryo-fit surrogate instead of the prediction.",
    ],
  },
  {
    id: "rosetta_scaffold_design_review",
    title: "Rosetta Scaffold vs Design Review",
    goal: "Align a design to its scaffold, isolate the changed shell, and stage before-vs-after views with semantic handles.",
    category: "rosetta",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 7,
    docsSlug: "rosetta-scaffold-design-review",
    starterPrompts: [
      "Open the scaffold and the design candidate and align them.",
      "Highlight only the changed shell and keep the scaffold subdued.",
      "Save a global overlay and a changed-shell close-up.",
    ],
    inputHints: [
      "referencePath is required.",
      "candidatePaths or bundlePath provide the design side.",
      "If no scorefile is given, the first candidate becomes the default top design.",
    ],
  },
  {
    id: "rosetta_interface_packing_review",
    title: "Rosetta Interface Packing Review",
    goal: "Inspect a designed interface, compute contacts and hbonds, and present the packed interface with the redesigned patch emphasized.",
    category: "rosetta",
    apps: ["chimerax", "pymol"],
    estimatedMinutes: 8,
    docsSlug: "rosetta-interface-packing-review",
    starterPrompts: [
      "Open the design complex and isolate the interface.",
      "Keep the receptor quiet and highlight the designed interface patch.",
      "Report the contacts briefly once the clean interface shot is ready.",
    ],
    inputHints: [
      "Provide interfaceChains when binder/receptor are not obvious.",
      "ChimeraX is the stronger default for contacts and hbonds.",
      "Optional scorefilePath promotes the best-ranked design automatically.",
    ],
  },
  {
    id: "rosetta_ligand_redesign_review",
    title: "Rosetta Ligand Redesign Review",
    goal: "Stage a ligand redesign story around a scaffold and design candidate, focusing on the ligand shell and changed pocket residues.",
    category: "rosetta",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 8,
    docsSlug: "rosetta-ligand-redesign-review",
    starterPrompts: [
      "Open the scaffold and the design candidate and keep the ligand bright.",
      "Highlight the ligand neighborhood and the redesigned shell only.",
      "Move into the pocket and save the cleanest redesign still.",
    ],
    inputHints: [
      "Provide ligandCode when the ligand residue name is known.",
      "Optional focus residues can force the redesigned shell.",
      "PyMOL is the default target for editorial ligand-pocket storytelling.",
    ],
  },
  {
    id: "rosetta_top_design_compare",
    title: "Rosetta Top-Design Compare",
    goal: "Parse a Rosetta scorefile, load the top candidates, align them to a reference, and stage an interpretable top-N comparison.",
    category: "rosetta",
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 9,
    docsSlug: "rosetta-top-design-compare",
    starterPrompts: [
      "Rank the Rosetta designs from the scorefile and open the top candidates.",
      "Align the top designs to the scaffold and move them into a readable comparison layout.",
      "Tell me which candidate is top-ranked before the export.",
    ],
    inputHints: [
      "scorefilePath is required.",
      "candidatePaths or bundlePath should contain the candidate models to match against score rows.",
      "topN defaults to three and is capped to keep the comparison readable.",
    ],
  },
]);

export function getScientificWorkflowCatalog(): ScientificWorkflowManifest[] {
  return scientificWorkflowCatalog;
}

export function getScientificWorkflow(id: ScientificWorkflowKind | string): ScientificWorkflowManifest {
  const workflow = scientificWorkflowCatalog.find((entry) => entry.id === id);
  if (!workflow) {
    throw new Error(`Unknown scientific workflow: ${id}`);
  }
  return workflow;
}
