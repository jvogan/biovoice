import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  scientificWorkflowKinds,
} from "../packages/runtime-and-adapters/src/index.js";
import { getScientificWorkflowCatalog } from "../packages/runtime-and-adapters/src/scientific/catalog.js";

const fixturePath = fileURLToPath(new URL("../tests/fixtures/voice-contract-evals.json", import.meta.url));
const targetSchema = z.enum(["pymol", "chimerax"]);
const workflowSchema = z.enum(scientificWorkflowKinds).nullable();
const riskSchema = z.enum(["read_only", "reversible", "confirmation_required"]);
const conditionSchema = z.enum(["clean", "background_speech", "correction", "ambiguous", "identifier_spelling"]);
const intentSchema = z.enum([
  "get_state",
  "capture_view",
  "undo",
  "camera",
  "style",
  "visibility",
  "measure",
  "reset",
  "close_model",
  "export",
  "transform",
  "raw_command",
  "clarify_entity",
  "run_workflow",
]);

const safeIdentifier = z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/);
const chainIdentifier = z.string().min(1).max(12).regex(/^[A-Za-z0-9_.-]+$/);
const residueIdentifier = z.string().min(3).max(32).regex(/^[A-Za-z0-9_.-]{1,12}:[1-9][0-9]{0,5}[A-Za-z]?$/);
const ligandIdentifier = z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/);
const pdbIdentifier = z.string().regex(/^[A-Z0-9]{4}$/);
const emdbIdentifier = z.string().regex(/^(EMD[-_]?)?\d{3,8}$/);
const uniprotIdentifier = z.string().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9_.-]*$/);

const entityHintsSchema = z.object({
  references: z.array(safeIdentifier).max(12).optional(),
  chains: z.array(chainIdentifier).max(8).optional(),
  residues: z.array(residueIdentifier).max(16).optional(),
  ligands: z.array(ligandIdentifier).max(8).optional(),
  pdbIds: z.array(pdbIdentifier).max(8).optional(),
  emdbIds: z.array(emdbIdentifier).max(8).optional(),
  uniprotIds: z.array(uniprotIdentifier).max(8).optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.values(value).every((items) => !items?.length)) {
    ctx.addIssue({ code: "custom", message: "At least one entity hint is required." });
  }
});

const voiceEvalCaseSchema = z.object({
  id: z.string().min(3).max(80).regex(/^[a-z][a-z0-9_]*$/),
  condition: conditionSchema,
  utterance: z.string().min(8).max(280),
  expected: z.object({
    target: targetSchema,
    workflow: workflowSchema,
    intent: intentSchema,
    risk: riskSchema,
    entityHints: entityHintsSchema,
  }).strict(),
}).strict();

const voiceEvalFixtureSchema = z.object({
  version: z.literal(1),
  description: z.string().min(20).max(240),
  cases: z.array(voiceEvalCaseSchema).min(30).max(50),
}).strict();

type VoiceEvalFixture = z.infer<typeof voiceEvalFixtureSchema>;

const forbiddenTextPatterns = [
  { label: "URL", pattern: /\b(?:https?|file):\/\//i },
  { label: "email address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "absolute user path", pattern: /(?:^|\s)\/(?:Users|home|private|tmp|var)\//i },
  { label: "Windows path", pattern: /\b[A-Z]:\\/i },
  { label: "credential-like text", pattern: /\b(?:api[_ -]?key|password|access[_ -]?token|secret key)\b/i },
  { label: "private subject data", pattern: /\b(?:patient|participant|subject id|medical record)\b/i },
];

export function validateVoiceEvalFixture(value: unknown): VoiceEvalFixture {
  const fixture = voiceEvalFixtureSchema.parse(value);
  const seenIds = new Set<string>();
  const workflows = new Map(getScientificWorkflowCatalog().map((workflow) => [workflow.id, workflow]));

  for (const evalCase of fixture.cases) {
    if (seenIds.has(evalCase.id)) {
      throw new Error(`Duplicate voice eval id: ${evalCase.id}`);
    }
    seenIds.add(evalCase.id);

    for (const forbidden of forbiddenTextPatterns) {
      if (forbidden.pattern.test(evalCase.utterance)) {
        throw new Error(`${evalCase.id} contains a forbidden ${forbidden.label}.`);
      }
    }

    const normalizedUtterance = evalCase.utterance.toUpperCase();
    const hints = evalCase.expected.entityHints;
    for (const id of [...(hints.pdbIds ?? []), ...(hints.emdbIds ?? []), ...(hints.uniprotIds ?? [])]) {
      if (!normalizedUtterance.includes(id.toUpperCase())) {
        throw new Error(`${evalCase.id} expects identifier ${id}, but the utterance does not contain it.`);
      }
    }

    if (evalCase.expected.intent === "run_workflow" && !evalCase.expected.workflow) {
      throw new Error(`${evalCase.id} must name a workflow for run_workflow intent.`);
    }
    if (evalCase.expected.intent !== "run_workflow" && evalCase.expected.workflow) {
      throw new Error(`${evalCase.id} assigns a workflow to a non-workflow intent.`);
    }

    const workflow = evalCase.expected.workflow ? workflows.get(evalCase.expected.workflow) : undefined;
    if (workflow && !workflow.apps.includes(evalCase.expected.target)) {
      throw new Error(`${evalCase.id} uses unsupported target ${evalCase.expected.target} for ${workflow.id}.`);
    }
  }

  assertCoverage(fixture);
  return fixture;
}

function assertCoverage(fixture: VoiceEvalFixture): void {
  const targets = new Set(fixture.cases.map((evalCase) => evalCase.expected.target));
  const risks = new Set(fixture.cases.map((evalCase) => evalCase.expected.risk));
  const conditions = new Set(fixture.cases.map((evalCase) => evalCase.condition));
  const workflows = new Set(fixture.cases.map((evalCase) => evalCase.expected.workflow).filter(Boolean));

  for (const target of targetSchema.options) {
    if (!targets.has(target)) {
      throw new Error(`Voice eval fixture does not cover target ${target}.`);
    }
  }
  for (const risk of riskSchema.options) {
    if (!risks.has(risk)) {
      throw new Error(`Voice eval fixture does not cover risk ${risk}.`);
    }
  }
  for (const condition of conditionSchema.options) {
    if (!conditions.has(condition)) {
      throw new Error(`Voice eval fixture does not cover condition ${condition}.`);
    }
  }
  for (const workflow of scientificWorkflowKinds) {
    if (!workflows.has(workflow)) {
      throw new Error(`Voice eval fixture does not cover workflow ${workflow}.`);
    }
  }
}

async function main(): Promise<void> {
  const raw = await fs.readFile(fixturePath, "utf8");
  const fixture = validateVoiceEvalFixture(JSON.parse(raw));
  const workflowCases = fixture.cases.filter((evalCase) => evalCase.expected.workflow).length;
  const confirmationCases = fixture.cases.filter((evalCase) => evalCase.expected.risk === "confirmation_required").length;
  console.log(JSON.stringify({
    ok: true,
    fixture: path.relative(process.cwd(), fixturePath),
    caseCount: fixture.cases.length,
    workflowCaseCount: workflowCases,
    confirmationCaseCount: confirmationCases,
    targets: targetSchema.options,
    workflowCount: scientificWorkflowKinds.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
