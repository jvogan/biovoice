import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChimeraXAdapter } from "../../packages/runtime-and-adapters/src/adapters/chimerax-adapter.js";
import { PymolAdapter } from "../../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";
import {
  compileRecipeStepDoc,
  getExampleCatalog,
} from "../../packages/runtime-and-adapters/src/examples/index.js";
import { resolveFromRoot } from "../../packages/runtime-and-adapters/src/utils/paths.js";

describe("example doc helpers", () => {
  it("compiles recipe steps into stable direct command equivalents", async () => {
    const recipe = getExampleCatalog().find((entry) => entry.id === "pymol-binding-pocket-story");
    expect(recipe).toBeDefined();
    const step = recipe!.steps.find((entry) => entry.id === "measure-and-surface");
    expect(step).toBeDefined();

    const compiled = await compileRecipeStepDoc(recipe!, step!);

    expect(compiled.suggestedVoiceRequest).toContain("Add key measurements");
    expect(compiled.commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("distance cat_contact_a"),
        expect.stringContaining("scene F1, store"),
        expect.stringContaining(path.join("output", "doc-exports", "pymol-binding-pocket-story-measure-and-surface.png")),
      ]),
    );
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.path).toContain(path.join("output", "doc-exports", "pymol-binding-pocket-story-measure-and-surface.png"));
  });

  it("produces stable export commands for ChimeraX steps too", async () => {
    const recipe = getExampleCatalog().find((entry) => entry.id === "chimerax-ligand-interaction-explainer");
    expect(recipe).toBeDefined();
    const step = recipe!.steps.find((entry) => entry.id === "export-pocket-view");
    expect(step).toBeDefined();

    const compiled = await compileRecipeStepDoc(recipe!, step!);

    expect(compiled.commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("graphics bgColor #FBFBF7"),
        expect.stringContaining(path.join("output", "doc-exports", "chimerax-ligand-interaction-explainer-export-pocket-view.png")),
      ]),
    );
    expect(compiled.artifacts).toHaveLength(1);
  });

  it("compiles missing explicit local inputs only in the documentation adapter", async () => {
    const recipe = getExampleCatalog().find((entry) => entry.id === "pymol-binding-pocket-story");
    expect(recipe).toBeDefined();
    const sourceStep = recipe!.steps.find((entry) => entry.id === "load-and-style");
    expect(sourceStep).toBeDefined();
    const missingPath = resolveFromRoot(".runtime", "tests", "example-doc-helpers", "missing-model.pdb");
    await fs.rm(missingPath, { force: true });
    const step = {
      ...sourceStep!,
      actions: sourceStep!.actions.map((action) => action.type === "load"
        ? { ...action, path: missingPath }
        : action),
    };

    const compiled = await compileRecipeStepDoc(recipe!, step);
    expect(compiled.commands).toContain(`load "${missingPath}", 1hsg`);

    const strictAdapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });
    await expect(strictAdapter.execute([
      { type: "load", source: "local", path: missingPath, object: "missing_model" },
    ], true)).rejects.toThrow(/does not exist/i);

    const liveAdapterWithDocOption = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
      allowMissingLocalInputsForDocumentation: true,
    });
    liveAdapterWithDocOption.ensureReady = async () => "http://127.0.0.1:9123/RPC2";
    await expect(liveAdapterWithDocOption.execute([
      { type: "load", source: "local", path: missingPath, object: "missing_model" },
    ])).rejects.toThrow(/does not exist/i);

    const strictChimeraXAdapter = new ChimeraXAdapter({
      port: 60_958,
      timeoutMs: 30_000,
      autolaunch: false,
    });
    await expect(strictChimeraXAdapter.execute([
      { type: "open", source: "local", path: missingPath },
    ], true)).rejects.toThrow(/does not exist/i);

    const liveChimeraXAdapterWithDocOption = new ChimeraXAdapter({
      port: 65_535,
      timeoutMs: 30_000,
      autolaunch: false,
      allowMissingLocalInputsForDocumentation: true,
    });
    liveChimeraXAdapterWithDocOption.ensureReady = async () => "http://127.0.0.1:65535";
    (liveChimeraXAdapterWithDocOption as unknown as {
      runCommands: () => Promise<{ error: null; "log messages": Record<string, never> }>;
    }).runCommands = async () => ({ error: null, "log messages": {} });
    await expect(liveChimeraXAdapterWithDocOption.execute([
      { type: "open", source: "local", path: missingPath },
    ])).rejects.toThrow(/does not exist/i);
  });

  it("does not let documentation compilation bypass the allowed input roots", async () => {
    const recipe = getExampleCatalog().find((entry) => entry.id === "pymol-binding-pocket-story");
    expect(recipe).toBeDefined();
    const sourceStep = recipe!.steps.find((entry) => entry.id === "load-and-style");
    expect(sourceStep).toBeDefined();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "biovoice-doc-root-"));
    const outsidePath = path.join(tempDir, "missing-model.pdb");

    try {
      const step = {
        ...sourceStep!,
        actions: sourceStep!.actions.map((action) => action.type === "load"
          ? { ...action, path: outsidePath }
          : action),
      };

      await expect(compileRecipeStepDoc(recipe!, step)).rejects.toThrow(/outside the allowed roots/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
