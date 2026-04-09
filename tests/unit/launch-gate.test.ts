import { describe, expect, it } from "vitest";
import {
  buildLaunchGateScenario,
  extractLocalLaunchAssetUrls,
  parseVerifyLaunchArgs,
} from "../../scripts/lib/launch-gate.js";

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("parseVerifyLaunchArgs", () => {
  it("defaults to both managed targets with the broad check enabled", () => {
    expect(parseVerifyLaunchArgs([])).toEqual({
      targets: ["pymol", "chimerax"],
      runBroadCheck: true,
      runBrowserSmoke: false,
      keepRunning: false,
      helpRequested: false,
    });
  });

  it("normalizes aliases, de-duplicates targets, and honors toggles", () => {
    expect(parseVerifyLaunchArgs([
      "--target",
      "chimera",
      "--targets",
      "pymol,chimerax,pymol",
      "--browser",
      "--skip-check",
      "--keep-running",
    ])).toEqual({
      targets: ["chimerax", "pymol"],
      runBroadCheck: false,
      runBrowserSmoke: true,
      keepRunning: true,
      helpRequested: false,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseVerifyLaunchArgs(["--wat"])).toThrow("Unknown flag: --wat");
  });
});

describe("buildLaunchGateScenario", () => {
  it("builds the PyMOL managed-route smoke scenario", () => {
    const scenario = buildLaunchGateScenario("pymol");
    const loadAction = scenario.actionEnvelope.actions.find((action) => action.type === "load");

    expect(scenario.recipeId).toBe("pymol-binding-pocket-story");
    expect(scenario.workflowRequest.workflow).toBe("alphafold_vs_experiment_overlay");
    expect(scenario.expectedStateMarker).toBe("launch_gate_model");
    expect(normalizePath(scenario.captureRequest.path ?? "")).toBe("");
    expect(normalizePath(((loadAction as { path?: string } | undefined)?.path) ?? "")).toMatch(/examples\/data\/local\/1hsg\.pdb$/);
  });

  it("builds the ChimeraX managed-route smoke scenario", () => {
    const scenario = buildLaunchGateScenario("chimerax");
    const openAction = scenario.actionEnvelope.actions.find((action) => action.type === "open");
    const inputs = scenario.workflowRequest.inputs as Record<string, unknown>;

    expect(scenario.recipeId).toBe("chimerax-ligand-interaction-explainer");
    expect(scenario.workflowRequest.workflow).toBe("rosetta_top_design_compare");
    expect(scenario.expectedStateMarker).toBe("1hsg");
    expect(normalizePath(((openAction as { path?: string } | undefined)?.path) ?? "")).toMatch(/examples\/data\/local\/1hsg\.pdb$/);
    expect(normalizePath(String(inputs.bundlePath ?? ""))).toMatch(/examples\/data\/local\/rosetta_demo$/);
  });
});

describe("extractLocalLaunchAssetUrls", () => {
  it("keeps same-origin launch assets and excludes remote or api links", async () => {
    const assetUrls = await extractLocalLaunchAssetUrls(
      `
        <html>
          <head>
            <link rel="stylesheet" href="/assets/app.css">
            <link rel="modulepreload stylesheet" href="./assets/entry.js">
            <link rel="icon" href="/favicon.ico">
            <link rel="stylesheet" href="https://cdn.example.com/app.css">
          </head>
          <body>
            <script src="/assets/index.js"></script>
            <script src="/api/debug"></script>
          </body>
        </html>
      `,
      "http://localhost:3000/?target=pymol",
    );

    expect(assetUrls).toEqual([
      "http://localhost:3000/assets/index.js",
      "http://localhost:3000/assets/app.css",
      "http://localhost:3000/assets/entry.js",
    ]);
  });
});
