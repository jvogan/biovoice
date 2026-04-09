import { describe, expect, it } from "vitest";
import {
  getShowcaseScenarios,
  parseVerifyShowcasesArgs,
} from "../../scripts/lib/showcase-scenarios.js";

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("parseVerifyShowcasesArgs", () => {
  it("defaults to both targets", () => {
    expect(parseVerifyShowcasesArgs([])).toEqual({
      targets: ["pymol", "chimerax"],
      helpRequested: false,
    });
  });

  it("normalizes aliases and de-duplicates targets", () => {
    expect(parseVerifyShowcasesArgs([
      "--target",
      "chimera",
      "--targets",
      "pymol,chimerax,pymol",
    ])).toEqual({
      targets: ["chimerax", "pymol"],
      helpRequested: false,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseVerifyShowcasesArgs(["--wat"])).toThrow("Unknown flag: --wat");
  });
});

describe("getShowcaseScenarios", () => {
  it("returns the full six-scenario matrix by default", () => {
    const scenarios = getShowcaseScenarios();

    expect(scenarios).toHaveLength(6);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "pymol-alphafold-overlay",
      "pymol-cryo-handoff",
      "pymol-rosetta-compare",
      "chimerax-alphafold-overlay",
      "chimerax-cryo-handoff",
      "chimerax-rosetta-interface",
    ]);
  });

  it("keeps the local demo-data paths anchored inside examples/data/local", () => {
    const [pymolCryo] = getShowcaseScenarios(["pymol"]).filter((scenario) => scenario.id === "pymol-cryo-handoff");
    const [chimeraRosetta] = getShowcaseScenarios(["chimerax"]).filter((scenario) => scenario.id === "chimerax-rosetta-interface");

    expect(normalizePath(pymolCryo.scientificInputs.map ?? "")).toMatch(/examples\/data\/local\/emd_37575\.map$/);
    expect(normalizePath(chimeraRosetta.scientificInputs.bundle ?? "")).toMatch(/examples\/data\/local\/rosetta_demo$/);
    expect(normalizePath(chimeraRosetta.scientificInputs.model ?? "")).toMatch(/examples\/data\/local\/rosetta_demo\/reference_scaffold\.pdb$/);
  });
});
