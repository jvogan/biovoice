import { describe, expect, it } from "vitest";
import {
  buildChimeraXReferenceSummary,
  buildPymolReferenceSummary,
} from "../../packages/runtime-and-adapters/src/utils/semantic-handles.js";

describe("semantic structure handles", () => {
  it("classifies PyMOL objects into scaffold, binder, predicted, and reference handles", () => {
    const summary = buildPymolReferenceSummary({
      molecularObjectNames: ["exp_4hhb_complex", "af_prediction_chainA", "rosetta_binder_v2", "wt_scaffold"],
      mapObjectNames: ["emd_1234_map"],
      selectionNames: ["ligand_shell"],
      visibleChains: ["A", "B"],
      chainsByObject: {
        exp_4hhb_complex: ["A", "B"],
        af_prediction_chainA: ["A"],
        rosetta_binder_v2: ["B"],
        wt_scaffold: ["A"],
      },
      ligandAtomCount: 48,
    });

    expect(summary.handles.experimentalModel?.selector).toEqual({ object: "exp_4hhb_complex" });
    expect(summary.handles.predictedModel?.selector).toEqual({ object: "af_prediction_chainA" });
    expect(summary.handles.binderModel?.selector).toEqual({ object: "rosetta_binder_v2" });
    expect(summary.handles.scaffoldModel?.selector).toEqual({ object: "wt_scaffold" });
    expect(summary.handles.referenceModel?.selector).toEqual({ object: "exp_4hhb_complex" });
    expect(summary.handles.map?.selector).toEqual({ object: "emd_1234_map" });
    expect(summary.handles.scaffoldChainA?.selector).toEqual({ object: "wt_scaffold", chain: "A" });
    expect(summary.handles.binderChainB?.selector).toEqual({ object: "rosetta_binder_v2", chain: "B" });
    expect(summary.handles.ligandContext?.selector).toBe("exp_4hhb_complex and organic");
    expect(summary.handles.ligandNeighborhood?.selector).toEqual({
      object: "exp_4hhb_complex",
      around: "exp_4hhb_complex and organic",
      withinAngstroms: 5,
      byResidue: true,
    });
    expect(summary.handles.partnerA?.selector).toEqual({ object: "exp_4hhb_complex", chain: "A" });
    expect(summary.chainHandles).toEqual(expect.arrayContaining([
      { label: "chain A", selector: { object: "exp_4hhb_complex", chain: "A" }, aliases: expect.any(Array) },
      { label: "predicted model chain A", selector: { object: "af_prediction_chainA", chain: "A" }, aliases: expect.any(Array) },
    ]));
  });

  it("classifies ChimeraX models into semantic handles for natural-language workflows", () => {
    const summary = buildChimeraXReferenceSummary({
      models: [
        { id: "#1", type: "atomic structure", name: "exp_4hhb_complex" },
        { id: "#2", type: "atomic structure", name: "af_prediction_chainA" },
        { id: "#3", type: "atomic structure", name: "rosetta_binder_v2" },
        { id: "#8", type: "volume", name: "emd_1234_map" },
      ],
      chains: [
        { chain: "#1/A", summary: "alpha chain A" },
        { chain: "#1/B", summary: "beta chain B" },
      ],
      namedViews: ["overview", "interface-closeup"],
    });

    expect(summary.handles.wholeComplex?.selector).toEqual({ model: "#1" });
    expect(summary.handles.referenceModel?.selector).toEqual({ model: "#1" });
    expect(summary.handles.predictedModel?.selector).toEqual({ model: "#2" });
    expect(summary.handles.binderModel?.selector).toEqual({ model: "#3" });
    expect(summary.handles.experimentalChainA?.selector).toEqual({ model: "#1", chain: "A" });
    expect(summary.handles.referenceChainB?.selector).toEqual({ model: "#1", chain: "B" });
    expect(summary.handles.map?.selector).toBe("#8");
    expect(summary.handles.partnerA?.selector).toEqual({ model: "#1", chain: "A" });
    expect(summary.chainHandles).toEqual(expect.arrayContaining([
      { label: "chain A", selector: { model: "#1", chain: "A" }, aliases: expect.any(Array) },
      { label: "chain B", selector: { model: "#1", chain: "B" }, aliases: expect.any(Array) },
    ]));
  });
});
