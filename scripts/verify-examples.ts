import fs from "node:fs/promises";
import { compileRecipeStepDoc, getExampleCatalog } from "../packages/runtime-and-adapters/src/examples/index.js";

async function main() {
  const recipeId = process.argv.includes("--recipe")
    ? process.argv[process.argv.indexOf("--recipe") + 1]
    : null;

  const catalog = getExampleCatalog();
  const recipes = recipeId ? catalog.filter((recipe) => recipe.id === recipeId) : catalog;

  if (!recipes.length) {
    throw new Error(recipeId ? `Unknown recipe ${recipeId}` : "No recipes found.");
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
      if (sample.kind === "local" && sample.localPath) {
        await fs.access(sample.localPath);
      }
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

  console.log(`Verified ${recipes.length} recipe definitions.`);
}

void main();
