import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileRecipeStepDoc, getExampleCatalog } from "../packages/runtime-and-adapters/src/examples/index.js";
import { localDataDir } from "../packages/runtime-and-adapters/src/utils/paths.js";

interface VerifyExamplesOptions {
  recipeId: string | null;
  requireData: boolean;
  helpRequested: boolean;
}

const controlCharacters = /[\u0000-\u001f\u007f]/;

export function parseVerifyExamplesArgs(args: string[]): VerifyExamplesOptions {
  const options: VerifyExamplesOptions = {
    recipeId: null,
    requireData: false,
    helpRequested: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.helpRequested = true;
      continue;
    }
    if (argument === "--require-data") {
      options.requireData = true;
      continue;
    }
    if (argument === "--recipe") {
      if (options.recipeId) {
        throw new Error("--recipe may only be supplied once.");
      }
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--recipe requires a recipe id.");
      }
      options.recipeId = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--recipe=")) {
      if (options.recipeId) {
        throw new Error("--recipe may only be supplied once.");
      }
      const value = argument.slice("--recipe=".length).trim();
      if (!value) {
        throw new Error("--recipe requires a recipe id.");
      }
      options.recipeId = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

export function verifyExamplesUsage(): string {
  return [
    "Usage: npm run verify:examples -- [--recipe <id>] [--require-data]",
    "",
    "By default this performs portable structural validation and does not require downloaded demo data.",
    "Use --require-data to also verify that every declared local sample file is installed.",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseVerifyExamplesArgs(process.argv.slice(2));
  if (options.helpRequested) {
    console.log(verifyExamplesUsage());
    return;
  }

  const catalog = getExampleCatalog();
  const recipes = options.recipeId
    ? catalog.filter((recipe) => recipe.id === options.recipeId)
    : catalog;

  if (!recipes.length) {
    throw new Error(options.recipeId ? `Unknown recipe ${options.recipeId}` : "No recipes found.");
  }

  for (const recipe of recipes) {
    console.log(`Verifying ${recipe.id}`);
    if (recipe.utterances.length < 18) {
      throw new Error(`${recipe.id} does not have enough utterances.`);
    }
    if (recipe.steps.length < 3) {
      throw new Error(`${recipe.id} does not have enough steps.`);
    }
    if (recipe.prompts.length < 3) {
      throw new Error(`${recipe.id} does not have enough starter prompts.`);
    }
    for (const sample of recipe.sampleData) {
      await validateSampleData(recipe.id, sample, options.requireData);
    }
    for (const step of recipe.steps) {
      const compiled = await compileRecipeStepDoc(recipe, step);
      if (!compiled.commands.length) {
        throw new Error(`${recipe.id}/${step.id} did not compile to any commands.`);
      }
      const exportCount = step.actions.filter((action) => action.type === "export").length;
      if (exportCount > 0 && compiled.artifacts.length < exportCount) {
        throw new Error(`${recipe.id}/${step.id} lost exported artifacts during compilation.`);
      }
    }
  }

  const dataMode = options.requireData ? "local data required" : "structural; local data not required";
  console.log(`Verified ${recipes.length} recipe definitions (${dataMode}).`);
}

async function validateSampleData(
  recipeId: string,
  sample: ReturnType<typeof getExampleCatalog>[number]["sampleData"][number],
  requireData: boolean,
): Promise<void> {
  if (sample.kind === "local" && !sample.localPath) {
    throw new Error(`${recipeId}/${sample.id} declares local sample data without a localPath.`);
  }

  let portableLocalPath: string | null = null;
  if (sample.localPath) {
    if (controlCharacters.test(sample.localPath)) {
      throw new Error(`${recipeId}/${sample.id} localPath contains unsupported control characters.`);
    }
    const resolvedPath = path.resolve(sample.localPath);
    const relativePath = path.relative(path.resolve(localDataDir), resolvedPath);
    if (!relativePath || path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
      throw new Error(`${recipeId}/${sample.id} localPath must stay under examples/data/local.`);
    }
    portableLocalPath = path.join("examples", "data", "local", relativePath);

    if (requireData) {
      const stat = await fs.stat(resolvedPath).catch(() => null);
      if (!stat?.isFile()) {
        throw new Error(
          `${recipeId}/${sample.id} is missing local demo data at ${portableLocalPath}. Run npm run prepare:data first.`,
        );
      }
    }
  }

  if (sample.kind !== "generated" && !sample.remoteUrl) {
    throw new Error(`${recipeId}/${sample.id} must declare an HTTPS source URL.`);
  }
  if (sample.remoteUrl) {
    let remoteUrl: URL;
    try {
      remoteUrl = new URL(sample.remoteUrl);
    } catch {
      throw new Error(`${recipeId}/${sample.id} has an invalid source URL.`);
    }
    if (remoteUrl.protocol !== "https:" || remoteUrl.username || remoteUrl.password) {
      throw new Error(`${recipeId}/${sample.id} source URL must use HTTPS without embedded credentials.`);
    }
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
