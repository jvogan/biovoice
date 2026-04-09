import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileRecipeStepDoc,
  getExampleCatalog,
} from "../../packages/runtime-and-adapters/src/examples/index.js";

describe("example doc helpers", () => {
  it("compiles recipe steps into stable direct command equivalents", async () => {
    const recipe = getExampleCatalog().find((entry) => entry.id === "pymol-binding-pocket-story");
    expect(recipe).toBeDefined();
    const step = recipe!.steps.find((entry) => entry.id === "measure-and-surface");
    expect(step).toBeDefined();

    const compiled = await compileRecipeStepDoc(recipe!, step!);

    expect(compiled.suggestedVoiceRequest).toContain("Add key measurements");
    expect(compiled.commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("distance cat_contact_a"),
        expect.stringContaining("scene F1, store"),
        expect.stringContaining(path.join("output", "doc-exports", "pymol-binding-pocket-story-measure-and-surface.png")),
      ]),
    );
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.path).toContain(path.join("output", "doc-exports", "pymol-binding-pocket-story-measure-and-surface.png"));
  });

  it("produces stable export commands for ChimeraX steps too", async () => {
    const recipe = getExampleCatalog().find((entry) => entry.id === "chimerax-ligand-interaction-explainer");
    expect(recipe).toBeDefined();
    const step = recipe!.steps.find((entry) => entry.id === "export-pocket-view");
    expect(step).toBeDefined();

    const compiled = await compileRecipeStepDoc(recipe!, step!);

    expect(compiled.commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("graphics bgColor #FBFBF7"),
        expect.stringContaining(path.join("output", "doc-exports", "chimerax-ligand-interaction-explainer-export-pocket-view.png")),
      ]),
    );
    expect(compiled.artifacts).toHaveLength(1);
  });
});
