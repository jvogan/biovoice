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

  it("treats PyMOL alphabetic residue tokens as residue names", () => {
    expect(
      compilePymolSelection({
        object: "4hhb",
        residue: "HEM",
      }),
    ).toBe("4hhb and resn HEM");

    expect(
      compilePymolSelection({
        object: "4hhb",
        chain: "A",
        residue: "58",
        residueName: "HEM",
      }),
    ).toBe("4hhb and chain A and (resi 58 or resn HEM)");

    expect(
      compilePymolSelection({
        object: "4hhb",
        residue: "58+HEM",
      }),
    ).toBe("4hhb and (resi 58 or resn HEM)");
  });

  it("combines ChimeraX residue ids and residue names into one residue clause", () => {
    expect(
      compileChimeraXAtomspec({
        model: "#1",
        chain: "A",
        residue: "58",
        residueName: "HEM",
      }),
    ).toBe("#1/A:58,HEM");
  });

  it("wraps PyMOL around selectors so nearby side-chain selections retain coordinates", () => {
    expect(
      compilePymolSelection({
        object: "4hhb",
        entity: "sidechain",
        around: "4hhb and resn HEM",
        withinAngstroms: 5,
        byResidue: true,
      }),
    ).toBe("byres (4hhb and sidechain and ((4hhb and resn HEM) around 5))");
  });

  it("uses ChimeraX atom-spec zone operators for proximity selectors", () => {
    expect(
      compileChimeraXAtomspec({
        model: "#1",
        entity: "protein",
        around: "#1:HEM",
        withinAngstroms: 5,
        byResidue: true,
      }),
    ).toBe("((#1:HEM) :< 5) & (#1 & protein)");
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

  it("fails closed when a PyMOL semantic reference cannot be resolved", () => {
    expect(() => compilePymolSelection({
      reference: "missingModel",
      residue: "58",
    }, {})).toThrow(/Unresolved selector reference "missingModel" for pymol/);
  });

  it("fails closed when a ChimeraX semantic reference cannot be resolved", () => {
    expect(() => compileChimeraXAtomspec({
      reference: "missingModel",
      chain: "A",
    })).toThrow(/Unresolved selector reference "missingModel" for chimerax/);
  });
});
