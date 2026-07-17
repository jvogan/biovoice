import { describe, expect, it } from "vitest";
import {
  parseVerifyExamplesArgs,
  verifyExamplesUsage,
} from "../../scripts/verify-examples.js";

describe("verify examples options", () => {
  it("defaults to portable structural verification", () => {
    expect(parseVerifyExamplesArgs([])).toEqual({
      recipeId: null,
      requireData: false,
      helpRequested: false,
    });
  });

  it("parses recipe filters and the explicit local-data check", () => {
    expect(parseVerifyExamplesArgs([
      "--recipe",
      "pymol-binding-pocket-story",
      "--require-data",
    ])).toEqual({
      recipeId: "pymol-binding-pocket-story",
      requireData: true,
      helpRequested: false,
    });
    expect(parseVerifyExamplesArgs([
      "--recipe=chimerax-ligand-interaction-explainer",
    ]).recipeId).toBe("chimerax-ligand-interaction-explainer");
  });

  it("rejects ambiguous or malformed arguments", () => {
    expect(() => parseVerifyExamplesArgs(["--recipe"])).toThrow(/requires a recipe id/i);
    expect(() => parseVerifyExamplesArgs(["--recipe", "one", "--recipe", "two"])).toThrow(/only be supplied once/i);
    expect(() => parseVerifyExamplesArgs(["--unknown"])).toThrow(/unknown argument/i);
    expect(() => parseVerifyExamplesArgs(["positional-value"])).toThrow(/unknown argument/i);
  });

  it("documents the optional installed-data mode", () => {
    expect(verifyExamplesUsage()).toContain("--require-data");
    expect(verifyExamplesUsage()).toMatch(/does not require downloaded demo data/i);
  });
});
