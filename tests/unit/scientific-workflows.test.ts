import { describe, expect, it } from "vitest";
import {
  buildScientificLaunchCommand,
  buildScientificWorkflowUrl,
  getScientificWorkflowCatalog,
  getScientificWorkflowForRecipe,
  rankScientificWorkflowCandidates,
  resolveScientificWorkflowRecipeId,
} from "../../packages/runtime-and-adapters/src/index.js";

describe("scientific workflow helpers", () => {
  it("exposes a broad task-first workflow catalog", () => {
    const catalog = getScientificWorkflowCatalog();

    expect(catalog).toHaveLength(9);
    expect(catalog.map((workflow) => workflow.id)).toContain("alphafold_vs_experiment_overlay");
    expect(catalog.map((workflow) => workflow.id)).toContain("rosetta_top_design_compare");
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
});
