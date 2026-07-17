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
    evidenceLevel: "quantitative",
    assumptions: [
      "B-factor values in the prediction are interpreted as AlphaFold confidence values.",
      "Confidence and PAE describe model uncertainty; they do not validate biological function.",
    ],
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
    evidenceLevel: "qualitative",
    assumptions: [
      "The loaded structures represent comparable constructs and biological states.",
      "A visual overlay is not, by itself, a quantitative structural validation.",
    ],
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
    evidenceLevel: "quantitative",
    assumptions: [
      "The selected chains represent the intended biological interface.",
      "Geometric contacts and PAE do not establish binding affinity or biological relevance.",
    ],
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
    evidenceLevel: "quantitative",
    assumptions: [
      "The PAE matrix uses the same polymer-residue order as the loaded model.",
      "High PAE indicates positional uncertainty, not necessarily disorder or lack of interaction.",
    ],
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
    evidenceLevel: "qualitative",
    assumptions: [
      "The model and map describe the same construct and conformational state.",
      "A staged fit requires independent map-quality and model-validation checks before scientific interpretation.",
    ],
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 9,
    docsSlug: "alphafold-to-cryo-handoff",
    starterPrompts: [
      "Load the AlphaFold model with the cryo map and stage the overview first.",
      "Fit or contour the model into the map, then move into a local cutaway.",
      "Keep the map and model balanced for a polished export.",
    ],
    inputHints: [
      "Provide cryoMapPath for local maps, or cryoMapEmdbId/emdbId to fetch a known EMDB map.",
      "ChimeraX emphasizes fit and orthoplanes; PyMOL emphasizes contour and presentation polish.",
      "Optional experimentalPath can act as the cryo-fit surrogate instead of the prediction.",
    ],
  },
  {
    id: "rosetta_scaffold_design_review",
    title: "Rosetta Scaffold vs Design Review",
    goal: "Align a design to its scaffold, isolate the changed shell, and stage before-vs-after views with semantic handles.",
    category: "rosetta",
    evidenceLevel: "qualitative",
    assumptions: [
      "Residue identifiers are comparable between the scaffold and design structures.",
      "Visible structural differences do not establish stability or function.",
    ],
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
    evidenceLevel: "quantitative",
    assumptions: [
      "The selected chains represent the designed interface.",
      "Geometric contacts and hydrogen bonds are descriptive and are not an energetic binding calculation.",
    ],
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
    evidenceLevel: "qualitative",
    assumptions: [
      "The ligand residue code identifies the intended bound ligand in the loaded structure.",
      "Pocket geometry alone does not predict affinity, catalysis, or selectivity.",
    ],
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
    evidenceLevel: "quantitative",
    assumptions: [
      "Score rows were produced with a comparable Rosetta score function and protocol.",
      "Lower total score is treated as better; ranking does not establish experimental performance.",
    ],
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
  {
    id: "variant_environment_review",
    title: "Variant Environment Review",
    goal: "Locate annotated variant sites, inspect their local structural neighborhoods, and optionally compare a second structure or nearby ligand.",
    category: "variant",
    evidenceLevel: "qualitative",
    assumptions: [
      "Residue numbering and optional chain identifiers match the loaded structure.",
      "The neighborhood is a geometric inspection and does not predict stability, pathogenicity, affinity, or function.",
      "An optional comparison structure represents a scientifically meaningful state or variant for visual alignment.",
    ],
    apps: ["pymol", "chimerax"],
    estimatedMinutes: 6,
    docsSlug: "variant-environment-review",
    starterPrompts: [
      "Show mutation A:58 in its local structural environment.",
      "Compare these variant sites with the reference structure and highlight nearby contacts.",
      "Keep the ligand visible and save a clean variant close-up.",
    ],
    inputHints: [
      "Provide a local model path or UniProt accession plus at least one residue position.",
      "Add chain identifiers whenever the same residue number occurs in multiple chains.",
      "An optional comparison structure and ligand code add overlay and pocket context.",
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
