import path from "node:path";
import { ChimeraXAdapter } from "../adapters/chimerax-adapter.js";
import { PymolAdapter } from "../adapters/pymol-adapter.js";
import type { ChimeraXAction, PymolAction, RecipeManifest } from "../schemas/index.js";
import { resolveFromRoot } from "../utils/paths.js";

const docPymolAdapter = new PymolAdapter({
  baseUrl: "http://127.0.0.1",
  startPort: 9123,
  timeoutMs: 8_000,
  renderTimeoutMs: 120_000,
  autolaunch: false,
});

const docChimeraXAdapter = new ChimeraXAdapter({
  port: 60_958,
  timeoutMs: 30_000,
  autolaunch: false,
});

export interface CompiledRecipeStepDoc {
  suggestedVoiceRequest: string;
  commands: string[];
  artifacts: Array<{
    kind: "image" | "session" | "model";
    path: string;
    label: string;
  }>;
}

export async function compileRecipeStepDoc(
  recipe: RecipeManifest,
  step: RecipeManifest["steps"][number],
): Promise<CompiledRecipeStepDoc> {
  const target = recipe.apps[0];
  const result =
    target === "pymol"
      ? await docPymolAdapter.execute(injectStablePymolDocExportPaths(recipe, step), true)
      : await docChimeraXAdapter.execute(injectStableChimeraXDocExportPaths(recipe, step), true);

  return {
    suggestedVoiceRequest: buildSuggestedVoiceRequest(step.summary),
    commands: result.commandsExecuted,
    artifacts: result.artifacts,
  };
}

function injectStablePymolDocExportPaths(
  recipe: RecipeManifest,
  step: RecipeManifest["steps"][number],
): PymolAction[] {
  const outputDir = resolveFromRoot("output", "doc-exports");

  return step.actions.map((action) => {
    if (action.type !== "export") {
      return action as PymolAction;
    }

    if (action.export.path) {
      return action as PymolAction;
    }

    return {
      ...action,
      export: {
        ...action.export,
        path: path.join(
          outputDir,
          `${recipe.id}-${step.id}.${action.export.format === "session" ? "pse" : action.export.format}`,
        ),
      },
    } as PymolAction;
  }) as PymolAction[];
}

function injectStableChimeraXDocExportPaths(
  recipe: RecipeManifest,
  step: RecipeManifest["steps"][number],
): ChimeraXAction[] {
  const outputDir = resolveFromRoot("output", "doc-exports");

  return step.actions.map((action) => {
    if (action.type !== "export") {
      return action as ChimeraXAction;
    }

    if (action.export.path) {
      return action as ChimeraXAction;
    }

    return {
      ...action,
      export: {
        ...action.export,
        path: path.join(
          outputDir,
          `${recipe.id}-${step.id}.${action.export.format === "session" ? "cxs" : action.export.format}`,
        ),
      },
    } as ChimeraXAction;
  }) as ChimeraXAction[];
}

function buildSuggestedVoiceRequest(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) {
    return "Run this recipe step.";
  }

  const normalized = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1) + ".";
}
