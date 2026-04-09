import { describe, expect, it } from "vitest";
import {
  actionResultSchema,
  captureViewRequestSchema,
  chimeraXEnvelopeSchema,
  pymolEnvelopeSchema,
  scientificWorkflowRequestSchema,
} from "../../packages/runtime-and-adapters/src/schemas/index.js";
import { resolveFromRoot } from "../../packages/runtime-and-adapters/src/utils/paths.js";

describe("action envelopes", () => {
  it("accepts a PyMOL action batch", () => {
    const parsed = pymolEnvelopeSchema.parse({
      target: "pymol",
      actions: [
        { type: "load", source: "pdb", id: "1hsg", object: "1hsg" },
        { type: "show", representations: ["cartoon"], selection: "polymer.protein" },
        { type: "camera", action: "pocket_frame", selection: "organic", buffer: 6 },
        { type: "measure", mode: "angle", selection1: "chain A and resi 25 and name CA", selection2: "chain A and resi 26 and name CA", selection3: "chain A and resi 27 and name CA" },
        { type: "symmetry", prefix: "ligand_mates", object: "1hsg", selection: "organic", cutoff: 6 },
      ],
    });

    expect(parsed.actions).toHaveLength(5);
  });

  it("accepts a ChimeraX action batch", () => {
    const parsed = chimeraXEnvelopeSchema.parse({
      target: "chimerax",
      actions: [
        { type: "open", source: "pdb", id: "1hsg" },
        { type: "color", scheme: "bychain", selection: "#1" },
        { type: "contacts", mode: "hbonds", selection1: "ligand", selection2: "protein" },
        { type: "camera", action: "clip", clipMode: "front", amount: 8 },
        { type: "label", action: "clear", selection: "#1/A:25" },
        { type: "symmetry", action: "assembly", selection: "#1", assemblyId: "1", copies: true },
        { type: "lighting", mode: "soft" },
        { type: "view", action: "save", name: "pocket-hero" },
      ],
    });

    expect(parsed.actions).toHaveLength(8);
  });

  it("accepts capture view requests and rich action result payloads", () => {
    const capture = captureViewRequestSchema.parse({
      target: "chimerax",
      inspectionPrompt: "Check whether the ligand and hydrogen bonds are clearly visible.",
      attachToConversation: true,
    });

    expect(capture.target).toBe("chimerax");

    const result = actionResultSchema.parse({
      target: "pymol",
      commandsExecuted: ["png /tmp/test.png, width=1200, height=800, dpi=350, ray=0"],
      logs: ["Capture finished."],
      artifacts: [
        {
          kind: "image",
          path: "/tmp/test.png",
          label: "Viewport capture",
          url: "/api/artifacts?path=%2Ftmp%2Ftest.png",
          mimeType: "image/png",
        },
      ],
      metrics: [
        {
          kind: "distance",
          label: "PyMOL distance",
          value: 3.21,
          unit: "A",
          source: "rpc",
        },
        {
          kind: "capture",
          label: "Viewport capture",
          valueText: "Viewport capture",
          source: "rpc",
        },
      ],
    });

    expect(result.metrics).toHaveLength(2);
    expect(result.artifacts[0]?.url).toContain("/api/artifacts");
  });

  it("accepts scientific workflow requests for AlphaFold and Rosetta", () => {
    const alphafold = scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "alphafold_vs_experiment_overlay",
      presentationMode: "demo",
      inputs: {
        uniprotId: "P69905",
        experimentalPdbId: "4HHB",
      },
    });

    const rosetta = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "rosetta_top_design_compare",
      presentationMode: "analysis",
      inputs: {
        bundlePath: resolveFromRoot("examples", "data", "local", "rosetta_demo"),
        scorefilePath: resolveFromRoot("examples", "data", "local", "rosetta_demo", "score.sc"),
        topN: 2,
      },
    });

    expect(alphafold.workflow).toBe("alphafold_vs_experiment_overlay");
    expect(rosetta.workflow).toBe("rosetta_top_design_compare");
  });

  it("rejects arbitrary remote structure URLs in action envelopes", () => {
    expect(() => pymolEnvelopeSchema.parse({
      target: "pymol",
      actions: [
        { type: "load", source: "url", url: "http://127.0.0.1:8080/internal" },
      ],
    })).toThrow();

    expect(() => chimeraXEnvelopeSchema.parse({
      target: "chimerax",
      actions: [
        { type: "open", source: "url", url: "http://127.0.0.1:8080/internal" },
      ],
    })).toThrow();
  });

  it("rejects structured action fields that try to smuggle raw commands", () => {
    expect(() => pymolEnvelopeSchema.parse({
      target: "pymol",
      actions: [
        { type: "select", name: "ligand; delete all", selection: "organic" },
      ],
    })).toThrow(/structured command dispatch/i);

    expect(() => chimeraXEnvelopeSchema.parse({
      target: "chimerax",
      actions: [
        { type: "close", target: "#1; close all" },
      ],
    })).toThrow(/structured command dispatch/i);
  });

  it("rejects invalid experimental PDB identifiers in scientific workflows", () => {
    expect(() => scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "alphafold_vs_experiment_overlay",
      presentationMode: "demo",
      inputs: {
        uniprotId: "P69905",
        experimentalPdbId: "../../../../tmp/x",
      },
    })).toThrow(/4-character PDB accession/i);
  });
});
