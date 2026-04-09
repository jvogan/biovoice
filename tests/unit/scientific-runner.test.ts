import { describe, expect, it } from "vitest";
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

function createRuntime() {
  const contexts = new Map<TargetKind, ScientificWorkflowContext>();

  return {
    contexts,
    runtime: {
      clearWorkflowContext(target: TargetKind) {
        contexts.delete(target);
      },
      setWorkflowContext(target: TargetKind, context: ScientificWorkflowContext) {
        contexts.set(target, context);
      },
      async executeActions(target: TargetKind, actions: Array<Record<string, unknown>>, dryRun?: boolean) {
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
});
