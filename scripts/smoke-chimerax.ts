import { ChimeraXAdapter } from "../packages/runtime-and-adapters/src/adapters/chimerax-adapter.js";
import { getRecipe } from "../packages/runtime-and-adapters/src/examples/index.js";

async function main() {
  const adapter = new ChimeraXAdapter({
    port: Number(process.env.CHIMERAX_REST_PORT ?? 60958),
    timeoutMs: Number(process.env.CHIMERAX_TIMEOUT_MS ?? 30000),
    autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
  });

  const recipe = getRecipe("chimerax-ligand-interaction-explainer");
  for (const step of recipe.steps) {
    console.log(`Running step: ${step.title}`);
    const result = await adapter.execute(step.actions as never, false);
    console.log(result.commandsExecuted.join("\n"));
  }
}

void main();
