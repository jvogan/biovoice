import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  actionResultSchema,
  resolveFromRoot,
  runScientificWorkflow,
  scientificWorkflowRequestSchema,
  type ScientificWorkflowContext,
  type TargetKind,
} from "../../packages/runtime-and-adapters/src/index.js";

function fixturePath(...segments: string[]): string {
  return resolveFromRoot("examples", "data", "local", ...segments);
}

const scratchDir = resolveFromRoot(".runtime", "tests", "scientific-runner");

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

function createRuntime() {
  const contexts = new Map<TargetKind, ScientificWorkflowContext>();
  const executedActions = new Map<TargetKind, Array<Record<string, unknown>>>();

  return {
    contexts,
    executedActions,
    runtime: {
      clearWorkflowContext(target: TargetKind) {
        contexts.delete(target);
      },
      setWorkflowContext(target: TargetKind, context: ScientificWorkflowContext) {
        contexts.set(target, context);
      },
      async executeActions(target: TargetKind, actions: Array<Record<string, unknown>>, dryRun?: boolean) {
        executedActions.set(target, [...(executedActions.get(target) ?? []), ...actions]);
        return actionResultSchema.parse({
          target,
          commandsExecuted: actions.map((action) => String(action.type ?? "unknown")),
          logs: [`${target} executed ${actions.length} action(s).`, dryRun ? "Dry run." : "Live run."],
          artifacts: [],
          metrics: [],
          warnings: [],
          state: {
            target,
            dryRun: Boolean(dryRun),
            actionTypes: actions.map((action) => String(action.type ?? "unknown")),
          },
        });
      },
      async getTargetState(target: TargetKind) {
        return {
          target,
          referenceHints: contexts.get(target)?.referenceHints ?? {},
          workflowState: contexts.get(target)?.workflowState ?? {},
        };
      },
    },
  };
}

describe("scientific workflow runner", () => {
  it("builds AlphaFold confidence review state from local model and PAE inputs", async () => {
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      presentationMode: "demo",
      inputs: {
        modelPath: fixturePath("af-p69905.pdb"),
        paePath: fixturePath("af-p69905-pae.json"),
      },
    });

    const result = await runScientificWorkflow(request, runtime);

    expect(result.referenceHints.predictedModel).toBeDefined();
    expect(result.referenceHints.lowConfidenceRegion).toBeDefined();
    expect(result.workflowState.confidenceSummary).toBeDefined();
    expect(result.metrics.find((metric) => metric.label === "Mean PAE")).toBeDefined();
    expect(result.evidenceLevel).toBe("quantitative");
    expect(result.assumptions).toEqual(expect.arrayContaining([
      expect.stringMatching(/do not validate biological function/i),
    ]));
    expect(result.actionsExecuted).toContain("reset_workspace");
    expect(result.actionsExecuted).toContain("load");
  });

  it("ranks Rosetta candidates from a local scorefile and exposes design handles", async () => {
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "rosetta_top_design_compare",
      dryRun: true,
      presentationMode: "demo",
      inputs: {
        bundlePath: fixturePath("rosetta_demo"),
        scorefilePath: fixturePath("rosetta_demo", "score.sc"),
        topN: 2,
      },
    });

    const result = await runScientificWorkflow(request, runtime);

    expect(result.rankedCandidates).toHaveLength(2);
    expect(result.rankedCandidates?.[0]?.tag).toBe("design_top_a");
    expect(result.referenceHints.topDesign).toBeDefined();
    expect(result.referenceHints.designPanel).toBeDefined();
    expect(result.referenceHints.designCandidate2).toBeDefined();
    expect(result.metrics.find((metric) => metric.label === "Top Rosetta score")).toBeDefined();
    expect(result.actionsExecuted).toContain("layout");
  });

  it("uses a guaranteed-visible camera handle for ChimeraX Rosetta interface reviews", async () => {
    const { runtime, executedActions } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "rosetta_interface_packing_review",
      dryRun: true,
      presentationMode: "demo",
      inputs: {
        bundlePath: fixturePath("rosetta_demo"),
        scorefilePath: fixturePath("rosetta_demo", "score.sc"),
        referencePath: fixturePath("rosetta_demo", "reference_scaffold.pdb"),
        topN: 2,
      },
    });

    await runScientificWorkflow(request, runtime);

    const cameraAction = executedActions.get("chimerax")?.find((action) => action.type === "camera");
    expect(cameraAction).toMatchObject({
      type: "camera",
      action: "comparison_frame",
      selection: {
        reference: "topDesign",
      },
    });
  });

  it("rejects non-JSON PAE inputs", async () => {
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "alphafold_pae_guided_triage",
      dryRun: true,
      presentationMode: "demo",
      inputs: {
        modelPath: fixturePath("af-p69905.pdb"),
        paePath: fixturePath("af-p69905.pdb"),
      },
    });

    await expect(runScientificWorkflow(request, runtime)).rejects.toThrow(".json");
  });

  it("rejects PAE matrices whose dimensions do not exactly match polymer residues", async () => {
    await fs.mkdir(scratchDir, { recursive: true });
    const paePath = path.join(scratchDir, "mismatched-pae.json");
    await fs.writeFile(paePath, JSON.stringify([{
      predicted_aligned_error: [[0, 1], [1, 0]],
    }]), "utf8");
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      inputs: {
        modelPath: fixturePath("af-p69905.pdb"),
        paePath,
      },
    });

    await expect(runScientificWorkflow(request, runtime)).rejects.toThrow(
      /PAE matrix residue count \(2\) does not match polymer residue count \(142\)/,
    );
  });

  it.each([
    { label: "non-square", matrix: [[0, 1], [1]], error: /PAE matrix must be square/ },
    { label: "non-numeric", matrix: [[0, "bad"], [1, 0]], error: /finite non-negative number/ },
  ])("rejects $label PAE matrices", async ({ matrix, error }) => {
    await fs.mkdir(scratchDir, { recursive: true });
    const paePath = path.join(scratchDir, "invalid-pae.json");
    await fs.writeFile(paePath, JSON.stringify([{ predicted_aligned_error: matrix }]), "utf8");
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      inputs: {
        modelPath: fixturePath("af-p69905.pdb"),
        paePath,
      },
    });

    await expect(runScientificWorkflow(request, runtime)).rejects.toThrow(error);
  });

  it("parses mmCIF atom_site columns by header and excludes HETATM rows from PAE indexing", async () => {
    await fs.mkdir(scratchDir, { recursive: true });
    const modelPath = path.join(scratchDir, "header-aware.cif");
    const paePath = path.join(scratchDir, "header-aware-pae.json");
    await fs.writeFile(modelPath, [
      "data_header_order",
      "loop_",
      "_atom_site.auth_seq_id",
      "_atom_site.group_PDB",
      "_atom_site.B_iso_or_equiv",
      "_atom_site.auth_asym_id",
      "_atom_site.auth_comp_id",
      "_atom_site.pdbx_PDB_ins_code",
      "1 ATOM 44.0 A GLY ?",
      "900 HETATM 12.0 A HEM ?",
      "2 ATOM 91.0 A ALA ?",
      "#",
    ].join("\n"), "utf8");
    await fs.writeFile(paePath, JSON.stringify([{
      pae: [[0, 3], [4, 0]],
    }]), "utf8");
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "chimerax",
      workflow: "alphafold_confidence_review",
      dryRun: true,
      inputs: { modelPath, paePath },
    });

    const result = await runScientificWorkflow(request, runtime);

    expect(result.resolvedInputs).toMatchObject({
      chains: ["A"],
      paeSummary: { residueCount: 2 },
    });
  });

  it.each(["pymol", "chimerax"] as const)(
    "builds a fail-closed %s variant environment review with comparison, ligand context, and a named view",
    async (target) => {
      const { runtime, executedActions } = createRuntime();
      const request = scientificWorkflowRequestSchema.parse({
        target,
        workflow: "variant_environment_review",
        dryRun: true,
        presentationMode: "publication",
        export: { format: "png" },
        inputs: {
          modelPath: fixturePath("4hhb.pdb"),
          comparisonPath: fixturePath("4hhb.pdb"),
          mutations: [{ position: "58", chain: "A", from: "H", to: "Y" }],
          ligandCode: "HEM",
          neighborhoodAngstroms: 6,
        },
      });

      const result = await runScientificWorkflow(request, runtime);
      const actions = executedActions.get(target) ?? [];

      expect(result.evidenceLevel).toBe("qualitative");
      expect(result.assumptions).toEqual(expect.arrayContaining([
        expect.stringMatching(/does not predict stability/i),
      ]));
      expect(result.referenceHints).toEqual(expect.objectContaining({
        variantModel: expect.any(Object),
        variantSites: expect.any(Object),
        variantNeighborhood: expect.any(Object),
        comparisonModel: expect.any(Object),
        variantLigand: expect.any(Object),
      }));
      if (target === "chimerax") {
        const neighborhood = result.referenceHints.variantNeighborhood as { selector?: unknown };
        expect(neighborhood.selector).toEqual(expect.stringContaining(":< 6"));
        expect(neighborhood.selector).toEqual(expect.stringContaining("~("));
        expect(neighborhood.selector).not.toEqual(expect.stringContaining(" zone "));
      }
      expect(result.resolvedInputs).toMatchObject({
        mutations: [{ position: "58", chain: "A", from: "H", to: "Y", residueName: "HIS" }],
        neighborhoodAngstroms: 6,
      });
      expect(actions.some((action) => action.type === "align")).toBe(true);
      expect(actions.some((action) => action.type === "contacts")).toBe(true);
      expect(actions.some((action) => action.type === "export")).toBe(true);
      expect(actions.some((action) => target === "pymol"
        ? action.type === "scene" && action.action === "view_store"
        : action.type === "view" && action.action === "save")).toBe(true);
    },
  );

  it("requires a chain when a variant residue number is ambiguous", async () => {
    const { runtime } = createRuntime();
    const request = scientificWorkflowRequestSchema.parse({
      target: "pymol",
      workflow: "variant_environment_review",
      dryRun: true,
      inputs: {
        modelPath: fixturePath("4hhb.pdb"),
        mutations: [{ position: "58" }],
      },
    });

    await expect(runScientificWorkflow(request, runtime)).rejects.toThrow(/ambiguous across chains/i);
  });
});
