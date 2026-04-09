import { describe, expect, it } from "vitest";
import { getExampleCatalog } from "../../packages/runtime-and-adapters/src/examples/index.js";

describe("example catalog", () => {
  it("contains a broad recipe pack split across both apps", () => {
    const catalog = getExampleCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(16);
    expect(catalog.filter((recipe) => recipe.apps.includes("pymol")).length).toBeGreaterThanOrEqual(8);
    expect(catalog.filter((recipe) => recipe.apps.includes("chimerax")).length).toBeGreaterThanOrEqual(8);
  });

  it("has a deep prompt pack for each app", () => {
    const catalog = getExampleCatalog();
    const pymolUtterances = catalog
      .filter((recipe) => recipe.apps.includes("pymol"))
      .flatMap((recipe) => recipe.utterances);
    const chimeraxUtterances = catalog
      .filter((recipe) => recipe.apps.includes("chimerax"))
      .flatMap((recipe) => recipe.utterances);

    expect(pymolUtterances.length).toBeGreaterThanOrEqual(200);
    expect(chimeraxUtterances.length).toBeGreaterThanOrEqual(200);
    expect(catalog.every((recipe) => recipe.utterances.length >= 20)).toBe(true);
  });

  it("keeps the public demo workflows on structured actions instead of raw commands", () => {
    const catalog = getExampleCatalog();
    const rawCommandSteps = catalog.flatMap((recipe) =>
      recipe.steps.flatMap((step) =>
        step.actions.filter((action) => action.type === "raw_command").map(() => `${recipe.id}:${step.id}`),
      ),
    );

    expect(rawCommandSteps).toEqual([]);
  });
});
