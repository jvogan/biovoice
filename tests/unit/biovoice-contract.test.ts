import { describe, expect, it, vi } from "vitest";
import {
  executeCliCommand,
  normalizeLoopbackBaseUrl,
  parseCliArgs,
} from "../../scripts/biovoice.js";

describe("BioVoice agent CLI contract", () => {
  it("accepts loopback server URLs and rejects remote or credentialed URLs", () => {
    expect(normalizeLoopbackBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeLoopbackBaseUrl("http://127.0.0.2:3000")).toBe("http://127.0.0.2:3000");
    expect(normalizeLoopbackBaseUrl("http://[::1]:3000")).toBe("http://[::1]:3000");
    expect(() => normalizeLoopbackBaseUrl("https://example.org")).toThrow(/loopback/i);
    expect(() => normalizeLoopbackBaseUrl("http://user:pass@localhost:3000")).toThrow(/credentials/i);
    expect(() => normalizeLoopbackBaseUrl("http://localhost:3000/api")).toThrow(/path/i);
  });

  it("builds a schema-validated AlphaFold dry-run request", () => {
    const parsed = parseCliArgs([
      "plan",
      "--target", "pymol",
      "--workflow", "alphafold_vs_experiment_overlay",
      "--uniprot", "p69905",
      "--experimental-pdb-id", "4hhb",
      "--structure-format", "pdb",
      "--focus-residue", "A:42",
    ]);

    expect(parsed.command).toBe("plan");
    expect(parsed.workflowRequest).toMatchObject({
      target: "pymol",
      workflow: "alphafold_vs_experiment_overlay",
      dryRun: true,
      presentationMode: "analysis",
      inputs: {
        uniprotId: "P69905",
        experimentalPdbId: "4HHB",
        structureFormat: "pdb",
        focusResidues: ["A:42"],
      },
    });
  });

  it("builds a bounded Rosetta request with repeated candidate paths", () => {
    const parsed = parseCliArgs([
      "run",
      "--target", "chimerax",
      "--workflow", "rosetta_top_design_compare",
      "--model", "examples/data/scaffold.pdb",
      "--scorefile", "examples/data/score.sc",
      "--candidate", "examples/data/design_1.pdb",
      "--candidate", "examples/data/design_2.pdb",
      "--top-n", "2",
    ]);

    expect(parsed.workflowRequest).toMatchObject({
      target: "chimerax",
      workflow: "rosetta_top_design_compare",
      dryRun: false,
      inputs: {
        referencePath: "examples/data/scaffold.pdb",
        scorefilePath: "examples/data/score.sc",
        candidatePaths: ["examples/data/design_1.pdb", "examples/data/design_2.pdb"],
        topN: 2,
      },
    });
  });

  it("parses compact variant notation into structured mutation sites", () => {
    const parsed = parseCliArgs([
      "plan",
      "--target", "pymol",
      "--workflow", "variant_environment_review",
      "--uniprot", "P69905",
      "--mutation", "A:H58Y",
      "--mutation", "B:91",
      "--ligand", "hem",
      "--neighborhood-angstroms", "5.5",
    ]);

    expect(parsed.workflowRequest).toMatchObject({
      target: "pymol",
      workflow: "variant_environment_review",
      dryRun: true,
      inputs: {
        uniprotId: "P69905",
        mutations: [
          { chain: "A", from: "H", position: "58", to: "Y" },
          { chain: "B", position: "91" },
        ],
        ligandCode: "HEM",
        neighborhoodAngstroms: 5.5,
      },
    });
  });

  it("rejects URLs, raw-command flags, and workflow-incompatible inputs", () => {
    expect(() => parseCliArgs([
      "run",
      "--target", "pymol",
      "--workflow", "alphafold_confidence_review",
      "--model", "HTTPS://example.org/model.pdb",
    ])).toThrow(/local path/i);

    expect(() => parseCliArgs([
      "run",
      "--target", "pymol",
      "--workflow", "alphafold_confidence_review",
      "--uniprot", "P69905",
      "--command", "anything",
    ])).toThrow(/unknown/i);

    expect(() => parseCliArgs([
      "run",
      "--target", "pymol",
      "--workflow", "alphafold_confidence_review",
      "--uniprot", "P69905",
      "--bundle", "examples/data/designs",
    ])).toThrow(/not supported/i);

    expect(() => parseCliArgs([
      "plan",
      "--target", "pymol",
      "--workflow", "alphafold_pae_guided_triage",
      "--uniprot", "P69905",
      "--model", "./local-model.cif",
    ])).toThrow(/paePath or useAfdbPae/i);
  });

  it("uses the canonical undo route and returns a JSON envelope", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("http://127.0.0.1:3000/api/targets/pymol/undo");
      return new Response(JSON.stringify({ restored: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await executeCliCommand(parseCliArgs(["undo", "--target", "pymol"]), fetchMock);
    expect(result).toEqual({
      ok: true,
      command: "undo",
      target: "pymol",
      result: { restored: true },
    });
  });

  it("reports a blocked doctor response as a failed command", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      checks: [{ id: "pymol", status: "blocked", detail: "PyMOL is not ready." }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const output = await executeCliCommand(parseCliArgs(["doctor"]), fetchMock);
    expect(output).toMatchObject({
      ok: false,
      ready: false,
      command: "doctor",
    });
  });

  it("normalizes capabilities to the public agent-facing fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      appId: "biovoice",
      serverMode: "production",
      defaultTarget: "pymol",
      realtimeReady: true,
      runtime: {
        targets: {
          pymol: { ready: true, endpoint: "hidden" },
          chimerax: { ready: false, endpoint: "hidden" },
        },
      },
      scientificWorkflows: [{
        id: "alphafold_confidence_review",
        title: "AlphaFold Confidence Review",
        goal: "Review confidence.",
        apps: ["pymol", "chimerax"],
      }],
      examples: [{
        id: "example-one",
        title: "Example One",
        apps: ["pymol"],
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const output = await executeCliCommand(parseCliArgs(["capabilities"]), fetchMock);
    const result = output.result as Record<string, unknown>;
    expect(result.targets).toEqual([
      { id: "pymol", ready: true },
      { id: "chimerax", ready: false },
    ]);
    expect(result.commands).toContainEqual({ id: "capture", risk: "local_io" });
    expect(JSON.stringify(result)).not.toContain("endpoint");
  });
});
