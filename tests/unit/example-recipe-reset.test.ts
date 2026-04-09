import { describe, expect, it } from "vitest";
import { getExampleCatalog } from "../../packages/runtime-and-adapters/src/examples/library.js";

describe("example recipe hygiene", () => {
  it("starts every PyMOL example recipe from a clean workspace", () => {
    const recipes = getExampleCatalog().filter((recipe) => recipe.apps.includes("pymol"));
    const offenders = recipes
      .filter((recipe) => recipe.steps[0]?.actions?.[0]?.type !== "reset_workspace")
      .map((recipe) => recipe.id);

    expect(offenders).toEqual([]);
  });
});
