import fs from "node:fs/promises";
import path from "node:path";
import { compileRecipeStepDoc, getExampleCatalog, getScientificWorkflowCatalog } from "../packages/runtime-and-adapters/src/examples/index.js";
import { examplesDir, projectRoot } from "../packages/runtime-and-adapters/src/utils/paths.js";

/** Convert an absolute path to a project-root-relative path for generated docs. */
function toRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(projectRoot)) {
    return "./" + path.relative(projectRoot, absolutePath);
  }
  return absolutePath;
}

/** Strip all occurrences of the absolute project root from a string so generated
 *  docs never leak the author's home directory. */
function stripProjectRoot(text: string): string {
  const escaped = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped + "/?", "g"), "./");
}

async function main() {
  const catalog = getExampleCatalog();
  const compiledDocs = new Map<string, Awaited<ReturnType<typeof compileRecipeDocBundle>>>();

  for (const recipe of catalog) {
    compiledDocs.set(recipe.id, await compileRecipeDocBundle(recipe));
  }

  await fs.mkdir(examplesDir, { recursive: true });
  const portableCatalog = catalog.map((recipe) => ({
    ...recipe,
    sampleData: recipe.sampleData.map((item) => ({
      ...item,
      localPath: item.localPath ? toRelativePath(item.localPath) : undefined,
    })),
  }));
  await writeFile("examples/catalog.json", JSON.stringify(portableCatalog, null, 2));
  await writeFile("examples/README.md", buildExamplesIndex(catalog));
  await writeFile("examples/scientific-workflows/README.md", buildScientificWorkflowsDoc());
  await writeFile("examples/start-here/README.md", buildStartHereDoc(catalog));
  await writeFile("examples/prompt-library/README.md", buildPromptLibraryDoc(catalog));
  await writeFile("examples/tool-playbooks/README.md", buildToolPlaybookDoc());
  await writeFile("examples/troubleshooting/README.md", buildTroubleshootingDoc());
  await writeFile("examples/gallery/README.md", buildGalleryDoc(catalog));

  for (const recipe of catalog) {
    const compiled = compiledDocs.get(recipe.id);
    if (!compiled) {
      throw new Error(`Missing compiled documentation bundle for ${recipe.id}`);
    }
    const recipeDir = path.join("examples", "workflow-recipes", recipe.id);
    await writeFile(path.join(recipeDir, "README.md"), buildRecipeReadme(recipe));
    await writeFile(path.join(recipeDir, "prompts.md"), buildPromptsDoc(recipe));
    await writeFile(path.join(recipeDir, "recipe.md"), buildRecipeDoc(recipe, compiled));
    await writeFile(path.join(recipeDir, "verify.md"), buildVerifyDoc(recipe));
    await writeFile(path.join(recipeDir, "adapters", `${recipe.apps[0]}.md`), buildAdapterDoc(recipe));
    await writeFile(path.join(recipeDir, "assets", "data-manifest.json"), JSON.stringify({
      id: recipe.id,
      title: recipe.title,
      sampleData: recipe.sampleData.map((item) => ({
        ...item,
        localPath: item.localPath ? toRelativePath(item.localPath) : undefined,
      })),
      checkpointCaptures: [
        "hero.png",
        "checkpoint-1.png",
        "checkpoint-2.png",
      ],
      generatedBy: "scripts/generate-example-files.ts",
    }, null, 2));
    await writeFile(path.join(recipeDir, "assets", "transcript.md"), buildTranscriptDoc(recipe, compiled));
    await writeFile(path.join(recipeDir, "assets", "captures.md"), buildCaptureDoc(recipe));
  }
}

function buildExamplesIndex(catalog: ReturnType<typeof getExampleCatalog>) {
  const grouped = groupByCategory(catalog);
  const sections = Object.entries(grouped).map(([category, recipes]) => {
    const items = recipes.map((recipe) => `- \`${recipe.id}\` | **${recipe.title}** | ${recipe.goal}`).join("\n");
    return `## ${titleCase(category)}\n${items}`;
  });

  return [
    "# Realtime Protein Structure Examples",
    "",
    "This directory is the public examples library for the PyMOL and ChimeraX voice-control console.",
    "",
    "## Structure",
    "- `start-here/`: onboarding and operator setup",
    "- `scientific-workflows/`: AlphaFold and Rosetta launch catalog",
    "- `workflow-recipes/`: full demo workflows for both apps",
    "- `prompt-library/`: curated utterance packs and follow-up prompts",
    "- `tool-playbooks/`: what the structured tool surface can do",
    "- `troubleshooting/`: speech, ambiguity, and export recovery",
    "- `gallery/`: demo ideas and operator-facing hero shots",
    "",
    ...sections,
    "",
    "Every workflow recipe directory ships with:",
    "- `README.md`",
    "- `prompts.md`",
    "- `recipe.md`",
    "- `verify.md`",
    "- `adapters/<tool>.md`",
    "- `assets/data-manifest.json`",
    "- `assets/transcript.md`",
    "- `assets/captures.md`",
  ].join("\n");
}

function buildStartHereDoc(catalog: ReturnType<typeof getExampleCatalog>) {
  const starterRecipes = catalog.slice(0, 4).map((recipe) => `- **${recipe.title}**: ${recipe.prompts[0]}`).join("\n");

  return [
    "# Start Here",
    "",
    "## Blessed Paths",
    "Human-first:",
    "- `npm run quickstart:pymol`",
    "- `npm run quickstart:chimerax`",
    "Agent-first:",
    "- `npm run agent:start -- pymol`",
    "- `npm run agent:start -- chimerax`",
    "- `npm run agent:start -- pymol --workflow alphafold_confidence_review --uniprot P12345`",
    "- `npm run agent:start -- chimerax --workflow rosetta_top_design_compare --bundle ./design-bundle --scorefile ./score.sc --top-n 5`",
    "",
    "## Minimum Setup",
    "1. Install dependencies with `npm install`.",
    "2. Copy `.env.example` to `.env` if you plan to use live voice.",
    "3. Pull local demo assets with `npm run prepare:data`.",
    "",
    "## Rehearse Without Voice",
    "1. Start with `npm run quickstart:pymol` or `npm run quickstart:chimerax`.",
    "2. Choose a recipe and run `Run First Step` or `Dry Run Workflow` before connecting voice.",
    "3. Use `Capture Current View` and `Reset Target` until the scene looks right.",
    "4. Or run a recipe straight from the terminal with `npm run rehearse:workflow -- <recipeId> --target <pymol|chimerax> --capture`.",
    "",
    "## First Live Voice Test",
    "1. Confirm `OPENAI_API_KEY` is set in `.env`.",
    "2. Start with `npm run quickstart:pymol` or `npm run quickstart:chimerax`. Do not use audience mode for the first live test.",
    "3. In the app, stay in `Push To Talk`.",
    "4. Use the first line from the recipe `Voice Pack` before freestyle speech.",
    "5. For AlphaFold or Rosetta tasks, choose a scientific launch card first so the right workflow and inputs are already pinned.",
    "6. Switch to `Always On` only after one clean turn in a quiet room.",
    "",
    "## Cost And Silence",
    "- Realtime billing is per response and input-transcription turn, not for simply keeping the connection open.",
    "- Idle silence by itself is not billed.",
    "- Open-mic or VAD can still create billable turns if ambient speech is committed and a response is triggered.",
    "- Leave idle auto-sleep on for normal use.",
    "",
    "## First Recipes To Try",
    starterRecipes,
    "",
    "## Scientific Launch Cards",
    "- Open the `Scientific Launch` rail in the UI to start from the task instead of the app.",
    "- For AlphaFold confidence or overlay stories, pin `--uniprot`, `--model`, and optionally `--pae`.",
    "- For Rosetta review stories, pin `--bundle`, `--scorefile`, and optionally `--top-n`.",
    "- The same flags work with the agent path: `npm run agent:start -- <pymol|chimerax> --workflow <workflowId> ...`.",
    "",
    "## Bring Your Own Files",
    "- AlphaFold: local `.pdb` or `.cif`, optional PAE JSON, optional experimental structure, optional map.",
    "- Rosetta: bundle directory, candidate models, `score.sc`, and an optional reference scaffold.",
    "",
    "## Demo Controls",
    "- `Space`: push to talk",
    "- `Cancel Turn`: clears the current audio buffer",
    "- `Pause Mic (keep session)`: stop accepting new audio without ending the session",
    "- `Disconnect (end session)`: close the live Realtime session completely",
    "- `Mute Voice Output`: keep visual execution but silence spoken confirmations",
    "- `Audience Clean Mode`: focus the screen on the signal well and timeline",
  ].join("\n");
}

function buildScientificWorkflowsDoc() {
  const workflows = getScientificWorkflowCatalog();

  const sections = workflows.map((workflow) => {
    const candidateLines = workflow.candidates
      .map((candidate) => `- **${candidate.target}**: \`${candidate.recipeId}\` (${candidate.score}) - ${candidate.reason}`)
      .join("\n");
    const inputHints = workflow.inputHints.map((hint) => `- \`${hint}\``).join("\n");
    const launchExample = workflow.id.startsWith("alpha")
      ? `npm run agent:start -- ${workflow.defaultTarget} --workflow ${workflow.id} --uniprot P12345 --model ./model.pdb`
      : `npm run agent:start -- ${workflow.defaultTarget} --workflow ${workflow.id} --bundle ./bundle --scorefile ./score.sc --top-n 5`;

    return [
      `## ${workflow.title}`,
      "",
      workflow.summary,
      "",
      `- Default target: \`${workflow.defaultTarget}\``,
      `- Intent: \`${workflow.intent}\``,
      `- Voice starter: ${workflow.voiceStarter}`,
      "",
      "### Input Hints",
      inputHints,
      "",
      "### Ranked Candidate Recipes",
      candidateLines,
      "",
      "### Launch Example",
      `- \`${launchExample}\``,
      "",
      "### Operator Notes",
      ...workflow.launchNotes.map((note) => `- ${note}`),
    ].join("\n");
  });

  return [
    "# Scientific Workflows",
    "",
    "This catalog is the task-first launch layer for AlphaFold and Rosetta work.",
    "",
    "Use it from the UI `Scientific Launch` rail, or pass the workflow explicitly to the agent start path.",
    "",
    "## Common Launch Pattern",
    "- `npm run agent:start -- <pymol|chimerax> --workflow <workflowId> [scientific inputs]`",
    "- Examples: `--uniprot`, `--model`, `--experimental`, `--pae`, `--map`, `--bundle`, `--scorefile`, `--top-n`",
    "- Keep `Push To Talk` as the default until the first clean live turn is complete.",
    "",
    "## Validated Local Showcases",
    "",
    "These are the strongest local-data rehearsals to run before a live demo or voice session:",
    "",
    "- `npm run showcase:pymol:pocket`",
    "- `npm run showcase:pymol:overlay`",
    "- `npm run showcase:pymol:cryo`",
    "- `npm run showcase:pymol:rosetta`",
    "- `npm run showcase:chimerax:pocket`",
    "- `npm run showcase:chimerax:overlay`",
    "- `npm run showcase:chimerax:map`",
    "- `npm run showcase:chimerax:rosetta`",
    "",
    "Run `npm run verify:showcases` to rehearse the pocket, AlphaFold, cryo, and Rosetta showcase matrix on both targets.",
    "",
    ...sections,
  ].join("\n");
}

function buildPromptLibraryDoc(catalog: ReturnType<typeof getExampleCatalog>) {
  const lines = catalog.flatMap((recipe) => [
    `## ${recipe.title}`,
    ...recipe.utterances.map((utterance) => `- ${utterance}`),
    "",
  ]);

  return [
    "# Prompt Library",
    "",
    "Use these spoken prompts as ready-made demo lines or as examples for downstream users.",
    "",
    "## Default Demo Aesthetic",
    "- Start from a light presentation preset unless the user asks for another look.",
    "- Use hero framing or pocket framing instead of only bare orient and zoom calls.",
    "- Keep labels restrained, silhouettes clean, and exports high resolution.",
    "",
    ...lines,
  ].join("\n");
}

function buildToolPlaybookDoc() {
  return [
    "# Tool Playbooks",
    "",
    "## PyMOL",
    "- `reset_workspace`, `load`, `select`, `show`, `hide`, `color`, `camera`, `measure`, `distance`, `label`, `align`, `surface`, `map`, `scene`, `object`, `preset`, `setting`, `export`, `raw_command`",
    "- Best for pocket walkthroughs, named scenes, camera hero frames, synthetic gaussian maps, and ray-traced exports.",
    "",
    "## ChimeraX",
    "- `reset_workspace`, `open`, `close`, `visibility`, `select`, `style`, `color`, `camera`, `measure`, `distance`, `label`, `contacts`, `align`, `fit`, `layout`, `volume`, `preset`, `graphics`, `cartoon`, `view`, `lighting`, `export`, `raw_command`",
    "- Best for contact analysis, named-view demos, matchmaker alignments, map fitting, tiled comparisons, AlphaFold review, and polished publication exports.",
    "",
    "## Guardrails",
    "- Ask for clarification when chain IDs, residue ranges, filenames, or export paths are ambiguous.",
    "- Prefer structured tools over raw commands.",
    "- Confirm destructive actions or overwrites before executing them.",
    "- Default to the repo-wide demo aesthetic unless the operator explicitly wants a different look.",
  ].join("\n");
}

function buildTroubleshootingDoc() {
  return [
    "# Troubleshooting",
    "",
    "## Speech And Recognition",
    "- If the model mishears a PDB ID, spell it out and say each character individually.",
    "- Stay in push-to-talk mode until the room is quiet enough for open-mic use.",
    "",
    "## Target Process Issues",
    "- If PyMOL is not responding, restart it with `pymol -R` or use `npm run smoke:pymol`.",
    "- If ChimeraX is not responding, restart the REST server with `remotecontrol rest start port 60958 json true log false` or use `npm run smoke:chimerax`.",
    "",
    "## Recovery",
    "- Use the built-in recipe steps to recover a complex demo without restyling the scene manually.",
    "- Use `Reset Target` when you want a clean presentation baseline without restarting the app.",
    "- Use `Cancel Turn` if a spoken instruction starts to drift before the tool call executes.",
  ].join("\n");
}

function buildGalleryDoc(catalog: ReturnType<typeof getExampleCatalog>) {
  const cards = catalog.map((recipe) => `- **${recipe.title}** (${recipe.apps[0]}): ${recipe.goal}`).join("\n");
  return [
    "# Gallery",
    "",
    "Suggested hero demos and reusable video segments:",
    cards,
  ].join("\n");
}

function buildRecipeReadme(recipe: ReturnType<typeof getExampleCatalog>[number]) {
  return [
    `# ${recipe.title}`,
    "",
    recipe.goal,
    "",
    `- App: \`${recipe.apps.join(", ")}\``,
    `- Difficulty: \`${recipe.difficulty}\``,
    `- Estimated time: \`${recipe.estimatedMinutes} minutes\``,
    `- Voice mode: \`${recipe.voiceMode}\``,
    `- Last verified: \`${recipe.lastVerified}\``,
    "",
    "## Sample Data",
    ...recipe.sampleData.map((item) => `- **${item.label}**: ${item.localPath ? toRelativePath(item.localPath) : item.remoteUrl}`),
    "",
    "## What Success Looks Like",
    ...recipe.checkpoints.map((item) => `- ${item}`),
  ].join("\n");
}

function buildPromptsDoc(recipe: ReturnType<typeof getExampleCatalog>[number]) {
  return [
    `# ${recipe.title} Prompts`,
    "",
    "## Starter Prompts",
    ...recipe.prompts.map((prompt) => `- ${prompt}`),
    "",
    "## Reusable Spoken Utterances",
    ...recipe.utterances.map((utterance) => `- ${utterance}`),
  ].join("\n");
}

function buildRecipeDoc(
  recipe: ReturnType<typeof getExampleCatalog>[number],
  compiled: Awaited<ReturnType<typeof compileRecipeDocBundle>>,
) {
  const steps = recipe.steps.flatMap((step, index) => [
    `## Step ${index + 1}: ${step.title}`,
    "",
    `**Suggested voice request:** ${compiled.steps[index]?.suggestedVoiceRequest ?? step.summary}`,
    "",
    step.summary,
    "",
    "Checkpoints:",
    ...step.checkpoints.map((checkpoint) => `- ${checkpoint}`),
    "",
    "Direct command equivalents:",
    ...(compiled.steps[index]?.commands ?? step.manualCommands).map((command) => `- \`${command}\``),
    "",
  ]);

  return [
    `# ${recipe.title} Workflow`,
    "",
    ...steps,
  ].join("\n");
}

function buildVerifyDoc(recipe: ReturnType<typeof getExampleCatalog>[number]) {
  return [
    `# Verify ${recipe.title}`,
    "",
    "## Acceptance Checklist",
    ...recipe.checkpoints.map((checkpoint) => `- [ ] ${checkpoint}`),
    "",
    "## Failure Cases To Watch",
    "- Chain or residue identifiers are misheard and the wrong region is selected.",
    "- Export paths collide with existing files without confirmation.",
    "- The target process is disconnected or the remote-control port is unavailable.",
    "",
    "## Suggested Commands",
    `- \`npm run verify:examples -- --recipe ${recipe.id}\``,
    recipe.apps.includes("pymol") ? "- `npm run smoke:pymol`" : "- `npm run smoke:chimerax`",
  ].join("\n");
}

function buildAdapterDoc(recipe: ReturnType<typeof getExampleCatalog>[number]) {
  return [
    `# ${recipe.title} Adapter Notes`,
    "",
    `This recipe targets **${recipe.apps[0]}**.`,
    "",
    "## Structured Steps",
    ...recipe.steps.map((step) => `- **${step.title}**: ${step.summary}`),
    "",
    "## Notes",
    "- The voice console compiles these recipe steps into structured tool calls.",
    "- The manual command list in `recipe.md` is the direct fallback if you want to run the workflow without voice.",
  ].join("\n");
}

function buildTranscriptDoc(
  recipe: ReturnType<typeof getExampleCatalog>[number],
  compiled: Awaited<ReturnType<typeof compileRecipeDocBundle>>,
) {
  const turns = recipe.steps.flatMap((step, index) => [
    `## Turn ${index + 1}`,
    `**Operator:** ${compiled.steps[index]?.suggestedVoiceRequest ?? step.summary}`,
    `**System action:** ${step.summary}`,
    `**Visible result:** ${step.checkpoints.join(" ")}`,
    "",
  ]);

  return [
    `# ${recipe.title} Transcript`,
    "",
    ...turns,
  ].join("\n");
}

function buildCaptureDoc(recipe: ReturnType<typeof getExampleCatalog>[number]) {
  const firstStep = recipe.steps[0];
  const middleStep = recipe.steps[Math.min(1, recipe.steps.length - 1)];
  const finalStep = recipe.steps[recipe.steps.length - 1];
  return [
    `# ${recipe.title} Capture Plan`,
    "",
    `- \`hero.png\`: final polished frame after **${finalStep.title}**`,
    `- \`checkpoint-1.png\`: after **${firstStep.title}**`,
    `- \`checkpoint-2.png\`: after **${middleStep.title}**`,
    "",
    "Use the verification flow to regenerate these captures after prompt or adapter changes.",
  ].join("\n");
}

async function compileRecipeDocBundle(recipe: ReturnType<typeof getExampleCatalog>[number]) {
  const steps = await Promise.all(recipe.steps.map((step) => compileRecipeStepDoc(recipe, step)));
  return { steps };
}

function groupByCategory(catalog: ReturnType<typeof getExampleCatalog>) {
  return catalog.reduce<Record<string, typeof catalog>>((groups, recipe) => {
    groups[recipe.category] ??= [];
    groups[recipe.category].push(recipe);
    return groups;
  }, {});
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function writeFile(relativePath: string, content: string) {
  const destination = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `${stripProjectRoot(content).trim()}\n`, "utf8");
}

void main();
