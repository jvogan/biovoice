import { describe, expect, it } from "vitest";
import {
  parseChimeraXModelLines,
  parseChimeraXNamedViews,
} from "../../packages/runtime-and-adapters/src/adapters/chimerax-adapter.js";

describe("ChimeraX state parsers", () => {
  it("extracts models from multiline info-model logs", () => {
    const lines = [
      "model id #1 type AtomicStructure name 1hsg.pdb",
      "model id #1.1 type MolecularSurface name \"1hsg.pdb_A SES surface\"",
      "model id #3 type PseudobondGroup name clashes",
    ];

    expect(parseChimeraXModelLines(lines)).toEqual([
      { id: "#1", type: "AtomicStructure", name: "1hsg.pdb" },
      { id: "#1.1", type: "MolecularSurface", name: "\"1hsg.pdb_A SES surface\"" },
      { id: "#3", type: "PseudobondGroup", name: "clashes" },
    ]);
  });

  it("extracts named views from the current ChimeraX markdown-style listing", () => {
    const lines = [
      "Named views: [demo-state](cxcmd:view demo-state)",
      "Named views: [hero-pocket](cxcmd:view hero-pocket) [overview](cxcmd:view overview)",
      "No named views.",
    ];

    expect(parseChimeraXNamedViews(lines)).toEqual([
      "demo-state",
      "hero-pocket",
      "overview",
    ]);
  });
});
