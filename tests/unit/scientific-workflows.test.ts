import { describe, expect, it } from "vitest";
import {
  buildScientificLaunchCommand,
  buildScientificWorkflowUrl,
  formatVariantMutationArgument,
  getScientificLaunchCatalog,
  getScientificWorkflowForRecipe,
  parseVariantMutationArgument,
  rankScientificWorkflowCandidates,
  resolveScientificWorkflowRecipeId,
} from "../../packages/runtime-and-adapters/src/index.js";
import {
  buildScientificWorkflowInputs,
  buildScientificWorkflowLaunchCards,
} from "../../apps/voice-console/src/lib/scientific-workflows.js";

describe("scientific workflow helpers", () => {
  it("exposes a broad task-first workflow catalog", () => {
    const catalog = getScientificLaunchCatalog();

    expect(catalog).toHaveLength(10);
    expect(catalog.map((workflow) => workflow.id)).toContain("alphafold_vs_experiment_overlay");
    expect(catalog.map((workflow) => workflow.id)).toContain("rosetta_top_design_compare");
    expect(catalog.map((workflow) => workflow.id)).toContain("variant_environment_review");
  });

  it("maps workflow ids to the right target recipe and launch metadata", () => {
    expect(resolveScientificWorkflowRecipeId("alphafold_confidence_review", "chimerax")).toBe("chimerax-alphafold-confidence-review");
    expect(resolveScientificWorkflowRecipeId("rosetta_top_design_compare", "pymol")).toBe("pymol-rosetta-style-design-review");
  });

  it("builds browser launch urls without local file paths and keeps full CLI commands", () => {
    const url = buildScientificWorkflowUrl("http://localhost:3000", {
      target: "pymol",
      workflowId: "rosetta_interface_packing_review",
      scientificInputs: {
        bundle: "./bundle",
        scorefile: "./score.sc",
        topN: 5,
      },
      audience: true,
      widget: true,
      overlay: true,
    });
    const command = buildScientificLaunchCommand({
      target: "pymol",
      workflowId: "rosetta_interface_packing_review",
      scientificInputs: {
        bundle: "./bundle",
        scorefile: "./score.sc",
        topN: 5,
      },
      audience: true,
      widget: true,
      overlay: true,
    });

    expect(url).toContain("workflow=rosetta_interface_packing_review");
    expect(url).toContain("target=pymol");
    expect(url).toContain("top_n=5");
    expect(url).toContain("overlay=1");
    expect(url).not.toContain("bundle=");
    expect(url).not.toContain("scorefile=");
    expect(url).not.toContain("autoconnect");
    expect(command).toContain("--workflow rosetta_interface_packing_review");
    expect(command).toContain("--bundle ./bundle");
    expect(command).toContain("--scorefile ./score.sc");
    expect(command).toContain("--top-n 5");
    expect(command).toContain("--overlay");
    expect(command).not.toContain("--widget");
    expect(command).not.toContain("--autoconnect");
  });

  it("keeps explicit recipe launches in the generated agent command", () => {
    const command = buildScientificLaunchCommand({
      target: "pymol",
      recipeId: "pymol-binding-pocket-story",
    });

    expect(command).toContain("--recipe pymol-binding-pocket-story");
    expect(command).not.toContain("--widget");
  });

  it("keeps database ids and format hints in launch urls and commands", () => {
    const url = buildScientificWorkflowUrl("http://localhost:3000", {
      target: "chimerax",
      workflowId: "alphafold_vs_experiment_overlay",
      scientificInputs: {
        uniprot: "P69905",
        experimentalPdbId: "4HHB",
        emdbId: "EMD-37575",
        structureFormat: "cif",
        pdbFormat: "pdb",
        experimental: "/private/4hhb.pdb",
        map: "/private/emd_37575.map",
      },
      widget: true,
    });
    const command = buildScientificLaunchCommand({
      target: "chimerax",
      workflowId: "alphafold_vs_experiment_overlay",
      scientificInputs: {
        uniprot: "P69905",
        experimentalPdbId: "4HHB",
        emdbId: "EMD-37575",
        structureFormat: "cif",
        pdbFormat: "pdb",
        experimental: "/private/4hhb.pdb",
        map: "/private/emd_37575.map",
      },
      widget: true,
    });

    expect(url).toContain("uniprot=P69905");
    expect(url).toContain("experimental_pdb_id=4HHB");
    expect(url).toContain("emdb_id=EMD-37575");
    expect(url).toContain("structure_format=cif");
    expect(url).toContain("pdb_format=pdb");
    expect(url).not.toContain("experimental=");
    expect(url).not.toContain("map=");
    expect(command).toContain("--experimental-pdb-id 4HHB");
    expect(command).toContain("--emdb-id EMD-37575");
    expect(command).toContain("--structure-format cif");
    expect(command).toContain("--pdb-format pdb");
    expect(command).toContain("--experimental /private/4hhb.pdb");
    expect(command).toContain("--map /private/emd_37575.map");
  });

  it("ranks only available candidate recipes for the active target", () => {
    const workflow = getScientificWorkflowForRecipe("pymol-alphafold-experimental-overlay");
    expect(workflow?.id).toBe("alphafold_vs_experiment_overlay");

    const ranked = rankScientificWorkflowCandidates(
      workflow?.id,
      "pymol",
      new Set(["pymol-alphafold-experimental-overlay", "pymol-rosetta-style-design-review"]),
    );

    expect(ranked.map((candidate) => candidate.recipeId)).toEqual(["pymol-alphafold-experimental-overlay"]);
  });

  it("disables workflows that the selected target does not support", () => {
    const cards = buildScientificWorkflowLaunchCards({
      target: "pymol",
      baseUrl: "http://localhost:3000",
      recipes: [],
      scientificInputs: { model: "./multimer.cif" },
    });
    const multimer = cards.find((card) => card.id === "alphafold_multimer_interface_review");

    expect(multimer?.inputsReady).toBe(false);
    expect(multimer?.inputMessage).toMatch(/not available for PyMOL/i);
  });

  it("does not silently pair AFDB PAE with an unrelated local model", () => {
    expect(buildScientificWorkflowInputs("alphafold_pae_guided_triage", {
      uniprot: "P69905",
    })).toMatchObject({ useAfdbPae: true });

    expect(buildScientificWorkflowInputs("alphafold_pae_guided_triage", {
      uniprot: "P69905",
      model: "./local-model.cif",
    })).not.toHaveProperty("useAfdbPae");
  });

  it("round-trips insertion-code mutation sites without ambiguous shorthand", () => {
    const insertionSite = parseVariantMutationArgument("A:@100A");
    expect(insertionSite).toEqual({ chain: "A", position: "100A" });
    expect(formatVariantMutationArgument(insertionSite)).toBe("A:@100A");

    const annotatedSite = parseVariantMutationArgument("A:H@100A>Y");
    expect(annotatedSite).toEqual({ chain: "A", from: "H", position: "100A", to: "Y" });
    expect(formatVariantMutationArgument(annotatedSite)).toBe("A:H@100A>Y");
    expect(() => parseVariantMutationArgument("A:100A")).toThrow(/Use A:@100A/);
  });
});
