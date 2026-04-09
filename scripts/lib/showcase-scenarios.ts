import {
  resolveFromRoot,
  type ScientificLaunchInputs,
  type ScientificWorkflowKind,
  type TargetKind,
} from "../../packages/runtime-and-adapters/src/index.js";

export interface ShowcaseScenario {
  id: string;
  title: string;
  target: TargetKind;
  workflowId: ScientificWorkflowKind;
  scientificInputs: ScientificLaunchInputs;
  expectedRecipeId: string;
  expectedArtifactLabel: string;
  expectedMetricLabels: string[];
  expectedRankedCandidates?: number;
}

export interface VerifyShowcasesOptions {
  targets: TargetKind[];
  helpRequested: boolean;
}

function localData(...segments: string[]): string {
  return resolveFromRoot("examples", "data", "local", ...segments);
}

const showcaseScenarios: ShowcaseScenario[] = [
  {
    id: "pymol-alphafold-overlay",
    title: "PyMOL AlphaFold vs experiment overlay",
    target: "pymol",
    workflowId: "alphafold_vs_experiment_overlay",
    scientificInputs: {
      model: localData("af-p69905.pdb"),
      experimental: localData("4hhb.pdb"),
    },
    expectedRecipeId: "pymol-alphafold-experimental-overlay",
    expectedArtifactLabel: "PyMOL PNG export",
    expectedMetricLabels: ["PyMOL super RMSD"],
  },
  {
    id: "pymol-cryo-handoff",
    title: "PyMOL AlphaFold-to-cryo handoff",
    target: "pymol",
    workflowId: "alphafold_to_cryo_handoff",
    scientificInputs: {
      model: localData("af-p69905.pdb"),
      experimental: localData("8wj1.cif"),
      pae: localData("af-p69905-pae.json"),
      map: localData("emd_37575.map"),
    },
    expectedRecipeId: "pymol-cryo-atomic-handoff",
    expectedArtifactLabel: "PyMOL PNG export",
    expectedMetricLabels: ["Mean PAE"],
  },
  {
    id: "pymol-rosetta-compare",
    title: "PyMOL Rosetta top-design compare",
    target: "pymol",
    workflowId: "rosetta_top_design_compare",
    scientificInputs: {
      model: localData("rosetta_demo", "reference_scaffold.pdb"),
      bundle: localData("rosetta_demo"),
      scorefile: localData("rosetta_demo", "score.sc"),
      topN: 2,
    },
    expectedRecipeId: "pymol-rosetta-style-design-review",
    expectedArtifactLabel: "PyMOL PNG export",
    expectedMetricLabels: ["Top Rosetta score"],
    expectedRankedCandidates: 2,
  },
  {
    id: "chimerax-alphafold-overlay",
    title: "ChimeraX AlphaFold vs experiment overlay",
    target: "chimerax",
    workflowId: "alphafold_vs_experiment_overlay",
    scientificInputs: {
      model: localData("af-p69905.pdb"),
      experimental: localData("4hhb.pdb"),
    },
    expectedRecipeId: "chimerax-alphafold-experimental-overlay",
    expectedArtifactLabel: "ChimeraX PNG export",
    expectedMetricLabels: ["Matchmaker score"],
  },
  {
    id: "chimerax-cryo-handoff",
    title: "ChimeraX AlphaFold-to-cryo handoff",
    target: "chimerax",
    workflowId: "alphafold_to_cryo_handoff",
    scientificInputs: {
      model: localData("af-p69905.pdb"),
      experimental: localData("8wj1.cif"),
      pae: localData("af-p69905-pae.json"),
      map: localData("emd_37575.map"),
    },
    expectedRecipeId: "chimerax-em-map-fit-demo",
    expectedArtifactLabel: "ChimeraX PNG export",
    expectedMetricLabels: ["Fit average map value", "Mean PAE"],
  },
  {
    id: "chimerax-rosetta-interface",
    title: "ChimeraX Rosetta interface packing review",
    target: "chimerax",
    workflowId: "rosetta_interface_packing_review",
    scientificInputs: {
      model: localData("rosetta_demo", "reference_scaffold.pdb"),
      bundle: localData("rosetta_demo"),
      scorefile: localData("rosetta_demo", "score.sc"),
      topN: 2,
    },
    expectedRecipeId: "chimerax-interface-contacts-analysis",
    expectedArtifactLabel: "ChimeraX PNG export",
    expectedMetricLabels: ["Top Rosetta score"],
    expectedRankedCandidates: 2,
  },
];

export function getShowcaseScenarios(targets?: TargetKind[]): ShowcaseScenario[] {
  if (!targets?.length) {
    return showcaseScenarios.slice();
  }
  const selected = new Set(targets);
  return showcaseScenarios.filter((scenario) => selected.has(scenario.target));
}

export function parseVerifyShowcasesArgs(argv: string[]): VerifyShowcasesOptions {
  const selectedTargets: TargetKind[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      selectedTargets.push(parseTarget(argv[index + 1]));
      index += 1;
      continue;
    }
    if (token === "--targets") {
      const raw = argv[index + 1] ?? "";
      for (const entry of raw.split(",")) {
        if (!entry.trim()) {
          continue;
        }
        selectedTargets.push(parseTarget(entry));
      }
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      helpRequested = true;
      continue;
    }
    throw new Error(`Unknown flag: ${token}`);
  }

  return {
    targets: uniqueTargets(selectedTargets.length ? selectedTargets : ["pymol", "chimerax"]),
    helpRequested,
  };
}

export function verifyShowcasesUsage(): string {
  return [
    "Usage: tsx scripts/verify-showcases.ts [options]",
    "",
    "Options:",
    "  --target <pymol|chimera|chimerax>   Run only one target's showcase set. Repeatable.",
    "  --targets <csv>                     Comma-separated target list.",
    "  --help                              Show this message.",
  ].join("\n");
}

function parseTarget(value: string | undefined): TargetKind {
  if (value === "pymol") {
    return value;
  }
  if (value === "chimera" || value === "chimerax") {
    return "chimerax";
  }
  throw new Error(`Unknown target: ${value ?? "missing"}`);
}

function uniqueTargets(targets: TargetKind[]): TargetKind[] {
  return [...new Set(targets)];
}
