import { describe, expect, it } from "vitest";
import {
  compileChimeraXAtomspec,
  compilePymolSelection,
} from "../../packages/runtime-and-adapters/src/utils/selectors.js";

describe("selector compilers", () => {
  it("builds a PyMOL selection from structured selector fields", () => {
    expect(
      compilePymolSelection({
        object: "1hsg",
        chain: "A",
        residue: "25+26",
        atom: "CA",
      }),
    ).toBe("1hsg and chain A and resi 25+26 and name CA");
  });

  it("builds a ChimeraX atomspec from structured selector fields", () => {
    expect(
      compileChimeraXAtomspec({
        model: "#1",
        chain: "A",
        residue: "25-27",
        atom: "CA",
      }),
    ).toBe("#1/A:25-27@CA");
  });

  it("supports structured entity selectors for both targets", () => {
    expect(
      compilePymolSelection({
        object: "1hsg",
        entity: "protein",
      }),
    ).toBe("1hsg and polymer.protein");

    expect(
      compileChimeraXAtomspec({
        model: "#1",
        entity: "organic",
      }),
    ).toBe("#1 & ligand");
  });

  it("supports multi-chain and multi-residue selectors for both targets", () => {
    expect(
      compilePymolSelection({
        object: "1grl",
        chains: ["A", "B", "C"],
        residues: ["191-376", "409-523"],
      }),
    ).toBe("1grl and chain A+B+C and resi 191-376+409-523");

    expect(
      compileChimeraXAtomspec({
        model: "#1",
        chains: ["A", "B"],
        residues: ["31", "53", "100A"],
      }),
    ).toBe("#1/A,B:31,53,100A");
  });

  it("can scope a semantic reference handle with additional selector fields", () => {
    const referenceHints = {
      scaffoldModel: { selector: { object: "wt_scaffold" } },
      predictedModel: { selector: { model: "#2" } },
    };

    expect(
      compilePymolSelection({
        reference: "scaffoldModel",
        residue: "118-160",
      }, referenceHints),
    ).toBe("wt_scaffold and resi 118-160");

    expect(
      compileChimeraXAtomspec({
        reference: "predictedModel",
        chain: "A",
        residue: "118-160",
      }, referenceHints),
    ).toBe("#2/A:118-160");
  });
});
