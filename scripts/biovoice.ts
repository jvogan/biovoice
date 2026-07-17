import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseVariantMutationArgument,
  scientificWorkflowKinds,
  scientificWorkflowRequestSchema,
  type ScientificWorkflowRequest,
} from "../packages/runtime-and-adapters/src/index.js";

const defaultBaseUrl = "http://127.0.0.1:3000";
const targets = ["pymol", "chimerax"] as const;
const commands = ["doctor", "capabilities", "plan", "run", "state", "capture", "undo", "receipts", "help"] as const;
const presentationModes = ["analysis", "demo", "publication"] as const;

type Target = (typeof targets)[number];
type Command = (typeof commands)[number];
type PresentationMode = (typeof presentationModes)[number];
type FetchLike = typeof fetch;

type FlagValues = Map<string, string[]>;

export class BiovoiceCliError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BiovoiceCliError";
    this.code = code;
    this.details = details;
  }
}

export interface ParsedCliCommand {
  command: Command;
  baseUrl: string;
  target?: Target;
  limit?: number;
  workflowRequest?: ScientificWorkflowRequest;
}

const commonFlags = new Set(["--base-url"]);
const targetFlags = new Set([...commonFlags, "--target"]);
const workflowFlags = new Set([
  ...targetFlags,
  "--workflow",
  "--presentation-mode",
  "--uniprot",
  "--experimental-pdb-id",
  "--emdb-id",
  "--structure-format",
  "--pdb-format",
  "--model",
  "--experimental",
  "--pae",
  "--map",
  "--bundle",
  "--scorefile",
  "--candidate",
  "--comparison",
  "--mutation",
  "--neighborhood-angstroms",
  "--top-n",
  "--interface-chains",
  "--focus-residue",
  "--ligand",
]);
const repeatableFlags = new Set(["--candidate", "--focus-residue", "--mutation"]);

export function normalizeLoopbackBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BiovoiceCliError("invalid_base_url", "--base-url must be a valid loopback HTTP URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BiovoiceCliError("invalid_base_url", "--base-url must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new BiovoiceCliError("invalid_base_url", "--base-url cannot contain credentials, a query, or a fragment.");
  }
  if (url.pathname !== "/") {
    throw new BiovoiceCliError("invalid_base_url", "--base-url cannot contain a path.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv4Loopback = /^127(?:\.\d{1,3}){3}$/.test(hostname)
    && hostname.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  if (hostname !== "localhost" && hostname !== "::1" && !isIpv4Loopback) {
    throw new BiovoiceCliError("non_loopback_base_url", "--base-url must point to localhost or a loopback IP address.");
  }

  return url.toString().replace(/\/$/, "");
}

export function parseCliArgs(argv: string[]): ParsedCliCommand {
  if (argv.length > 128) {
    throw new BiovoiceCliError("too_many_arguments", "Too many command-line arguments.");
  }

  const rawCommand = argv[0] ?? "help";
  const command = rawCommand === "--help" || rawCommand === "-h" ? "help" : rawCommand;
  if (!commands.includes(command as Command)) {
    throw new BiovoiceCliError("unknown_command", `Unknown command: ${safeDisplayValue(command)}`);
  }

  const typedCommand = command as Command;
  const allowedFlags = typedCommand === "plan" || typedCommand === "run"
    ? workflowFlags
    : typedCommand === "state" || typedCommand === "capture" || typedCommand === "undo"
    ? targetFlags
    : typedCommand === "receipts"
    ? new Set([...commonFlags, "--limit"])
    : commonFlags;
  const values = parseFlags(argv.slice(1), allowedFlags);
  const baseUrl = normalizeLoopbackBaseUrl(readSingleFlag(values, "--base-url") ?? defaultBaseUrl);

  if (typedCommand === "help") {
    return { command: typedCommand, baseUrl };
  }
  if (typedCommand === "doctor" || typedCommand === "capabilities") {
    return { command: typedCommand, baseUrl };
  }
  if (typedCommand === "receipts") {
    const rawLimit = readSingleFlag(values, "--limit");
    const limit = rawLimit === undefined ? 20 : parseBoundedInteger(rawLimit, "--limit", 1, 100);
    return { command: typedCommand, baseUrl, limit };
  }

  const target = parseTarget(requireFlag(values, "--target"));
  if (typedCommand === "state" || typedCommand === "capture" || typedCommand === "undo") {
    return { command: typedCommand, baseUrl, target };
  }

  const workflowRequest = buildWorkflowRequest(typedCommand, target, values);
  return { command: typedCommand, baseUrl, target, workflowRequest };
}

function parseFlags(argv: string[], allowedFlags: Set<string>): FlagValues {
  const values: FlagValues = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--") || !allowedFlags.has(flag)) {
      throw new BiovoiceCliError("unknown_flag", `Unknown or misplaced flag: ${safeDisplayValue(flag ?? "")}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new BiovoiceCliError("missing_flag_value", `${flag} requires a value.`);
    }
    assertBoundedText(value, flag, 4096);
    const existing = values.get(flag) ?? [];
    if (existing.length > 0 && !repeatableFlags.has(flag)) {
      throw new BiovoiceCliError("duplicate_flag", `${flag} can only be provided once.`);
    }
    existing.push(value);
    values.set(flag, existing);
  }
  return values;
}

function buildWorkflowRequest(command: "plan" | "run", target: Target, values: FlagValues): ScientificWorkflowRequest {
  const workflow = requireFlag(values, "--workflow");
  if (!scientificWorkflowKinds.includes(workflow as (typeof scientificWorkflowKinds)[number])) {
    throw new BiovoiceCliError("invalid_workflow", `Unknown scientific workflow: ${safeDisplayValue(workflow)}`);
  }

  const typedWorkflow = workflow as (typeof scientificWorkflowKinds)[number];
  const presentationMode = parsePresentationMode(readSingleFlag(values, "--presentation-mode") ?? "analysis");
  const interfaceChains = parseInterfaceChains(readSingleFlag(values, "--interface-chains"));
  const focusResidues = readRepeatedSafeTokens(values, "--focus-residue", 64, 80);
  const model = readSafePath(values, "--model");
  const dryRun = command === "plan";

  if (typedWorkflow.startsWith("alphafold_")) {
    rejectFlags(values, [
      "--bundle",
      "--scorefile",
      "--candidate",
      "--comparison",
      "--mutation",
      "--neighborhood-angstroms",
      "--top-n",
      "--ligand",
    ], "AlphaFold workflows");
    const uniprotId = readSafeIdentifier(values, "--uniprot", 40)?.toUpperCase();
    const experimentalPdbId = readPdbId(values);
    const emdbId = readEmdbId(values);
    const paePath = readSafePath(values, "--pae");
    const structureFormat = readFormat(values, "--structure-format");
    const pdbFormat = readFormat(values, "--pdb-format");

    return parseScientificRequest({
      target,
      workflow: typedWorkflow,
      dryRun,
      presentationMode,
      inputs: compactObject({
        modelPath: model,
        uniprotId,
        experimentalPath: readSafePath(values, "--experimental"),
        experimentalPdbId,
        experimentalPdbFormat: pdbFormat ?? structureFormat,
        pdbFormat,
        structureFormat,
        paePath,
        useAfdbPae: typedWorkflow === "alphafold_pae_guided_triage" && uniprotId && !model && !paePath ? true : undefined,
        cryoMapPath: readSafePath(values, "--map"),
        cryoMapEmdbId: emdbId,
        emdbId,
        interfaceChains,
        focusResidues,
      }),
    });
  }

  if (typedWorkflow === "variant_environment_review") {
    rejectFlags(values, [
      "--experimental-pdb-id",
      "--emdb-id",
      "--structure-format",
      "--pdb-format",
      "--experimental",
      "--pae",
      "--map",
      "--bundle",
      "--scorefile",
      "--candidate",
      "--top-n",
      "--interface-chains",
      "--focus-residue",
    ], "variant environment review");
    const rawNeighborhood = readSingleFlag(values, "--neighborhood-angstroms");
    return parseScientificRequest({
      target,
      workflow: typedWorkflow,
      dryRun,
      presentationMode,
      inputs: compactObject({
        modelPath: model,
        uniprotId: readSafeIdentifier(values, "--uniprot", 40)?.toUpperCase(),
        mutations: readMutations(values),
        comparisonPath: readSafePath(values, "--comparison"),
        ligandCode: readSafeIdentifier(values, "--ligand", 20)?.toUpperCase(),
        neighborhoodAngstroms: rawNeighborhood === undefined
          ? undefined
          : parseBoundedNumber(rawNeighborhood, "--neighborhood-angstroms", 2, 12),
      }),
    });
  }

  rejectFlags(values, [
    "--uniprot",
    "--experimental-pdb-id",
    "--emdb-id",
    "--structure-format",
    "--pdb-format",
    "--experimental",
    "--pae",
    "--map",
    "--comparison",
    "--mutation",
    "--neighborhood-angstroms",
  ], "Rosetta workflows");

  const candidatePaths = readRepeatedPaths(values, "--candidate", 24);
  const ligandCode = readSafeIdentifier(values, "--ligand", 20)?.toUpperCase();
  const rawTopN = readSingleFlag(values, "--top-n");
  const topN = rawTopN === undefined ? undefined : parseBoundedInteger(rawTopN, "--top-n", 1, 8);

  return parseScientificRequest({
    target,
    workflow: typedWorkflow,
    dryRun,
    presentationMode,
    inputs: compactObject({
      bundlePath: readSafePath(values, "--bundle"),
      candidatePaths,
      scorefilePath: readSafePath(values, "--scorefile"),
      referencePath: model,
      ligandCode,
      interfaceChains,
      focusResidues,
      topN,
    }),
  });
}

function parseScientificRequest(value: unknown): ScientificWorkflowRequest {
  const parsed = scientificWorkflowRequestSchema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
      .join("; ");
    throw new BiovoiceCliError("invalid_workflow_request", message);
  }
  return parsed.data;
}

export async function executeCliCommand(parsed: ParsedCliCommand, fetchImpl: FetchLike = fetch): Promise<Record<string, unknown>> {
  if (parsed.command === "help") {
    return buildHelpResponse();
  }

  if (parsed.command === "doctor") {
    const result = await fetchJson(fetchImpl, parsed.baseUrl, "/api/doctor", { method: "GET" }, 30_000);
    const ready = asRecord(result).ok === true;
    return {
      ...successEnvelope(parsed.command, result),
      ok: ready,
      ready,
    };
  }
  if (parsed.command === "capabilities") {
    const config = await fetchJson(fetchImpl, parsed.baseUrl, "/api/config", { method: "GET" }, 30_000);
    return successEnvelope(parsed.command, normalizeCapabilities(config));
  }
  if (parsed.command === "plan" || parsed.command === "run") {
    const result = await fetchJson(fetchImpl, parsed.baseUrl, "/api/workflows/run", {
      method: "POST",
      body: JSON.stringify(parsed.workflowRequest),
    }, 180_000);
    return {
      ...successEnvelope(parsed.command, result),
      target: parsed.target,
      workflow: parsed.workflowRequest?.workflow,
      dryRun: parsed.command === "plan",
    };
  }
  if (parsed.command === "state") {
    const result = await fetchJson(fetchImpl, parsed.baseUrl, `/api/targets/${parsed.target}/state`, { method: "GET" }, 30_000);
    return { ...successEnvelope(parsed.command, result), target: parsed.target };
  }
  if (parsed.command === "capture") {
    const result = await fetchJson(fetchImpl, parsed.baseUrl, "/api/capture", {
      method: "POST",
      body: JSON.stringify({ target: parsed.target, attachToConversation: false }),
    }, 180_000);
    return { ...successEnvelope(parsed.command, result), target: parsed.target };
  }
  if (parsed.command === "undo") {
    const result = await fetchJson(fetchImpl, parsed.baseUrl, `/api/targets/${parsed.target}/undo`, {
      method: "POST",
      body: JSON.stringify({ target: parsed.target }),
    }, 60_000);
    return { ...successEnvelope(parsed.command, result), target: parsed.target };
  }

  const result = await fetchJson(fetchImpl, parsed.baseUrl, `/api/receipts?limit=${parsed.limit}`, { method: "GET" }, 30_000);
  return successEnvelope(parsed.command, result);
}

async function fetchJson(
  fetchImpl: FetchLike,
  baseUrl: string,
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      ...init,
      redirect: "error",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new BiovoiceCliError("invalid_api_response", "BioVoice returned a non-JSON response.", {
          status: response.status,
          endpoint,
        });
      }
    }
    if (!response.ok) {
      throw new BiovoiceCliError("api_error", `BioVoice API returned HTTP ${response.status}.`, {
        status: response.status,
        endpoint,
        serverError: extractServerError(body),
      });
    }
    return body;
  } catch (error) {
    if (error instanceof BiovoiceCliError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new BiovoiceCliError("api_timeout", `BioVoice did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, { endpoint });
    }
    throw new BiovoiceCliError("api_unavailable", "Could not reach the local BioVoice server.", { endpoint });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCapabilities(value: unknown): Record<string, unknown> {
  const config = asRecord(value);
  const runtime = asRecord(config.runtime);
  const runtimeTargets = asRecord(runtime.targets);
  return {
    appId: readString(config.appId),
    serverMode: readString(config.serverMode),
    startedAt: readString(config.startedAt),
    defaultTarget: targets.includes(config.defaultTarget as Target) ? config.defaultTarget : undefined,
    realtimeReady: config.realtimeReady === true,
    targets: targets.map((target) => ({
      id: target,
      ready: asRecord(runtimeTargets[target]).ready === true,
    })),
    workflows: asArray(config.scientificWorkflows).map(normalizeWorkflow).filter(isPresent),
    examples: asArray(config.examples).map(normalizeExample).filter(isPresent),
    commands: [
      { id: "doctor", risk: "read_only" },
      { id: "capabilities", risk: "read_only" },
      { id: "plan", risk: "local_io" },
      { id: "run", risk: "reversible" },
      { id: "state", risk: "read_only" },
      { id: "capture", risk: "local_io" },
      { id: "undo", risk: "reversible" },
      { id: "receipts", risk: "read_only" },
    ],
  };
}

function normalizeWorkflow(value: unknown): Record<string, unknown> | null {
  const workflow = asRecord(value);
  const id = readString(workflow.id);
  if (!id || !scientificWorkflowKinds.includes(id as (typeof scientificWorkflowKinds)[number])) {
    return null;
  }
  const candidateTargets = asArray(workflow.candidates)
    .map((candidate) => asRecord(candidate).target)
    .filter((target): target is Target => targets.includes(target as Target));
  const workflowTargets = asArray(workflow.apps)
    .filter((target): target is Target => targets.includes(target as Target));
  return compactObject({
    id,
    title: readString(workflow.title),
    goal: readString(workflow.goal) ?? readString(workflow.summary),
    category: readString(workflow.category) ?? readString(workflow.group)?.toLowerCase(),
    targets: [...new Set([...workflowTargets, ...candidateTargets])],
    defaultTarget: targets.includes(workflow.defaultTarget as Target) ? workflow.defaultTarget : undefined,
    risk: "reversible",
    evidenceLevel: readString(workflow.evidenceLevel),
    assumptions: asArray(workflow.assumptions).filter((assumption): assumption is string => typeof assumption === "string"),
    estimatedMinutes: readFiniteNumber(workflow.estimatedMinutes),
    inputHints: asArray(workflow.inputHints).filter((hint): hint is string => typeof hint === "string"),
  });
}

function normalizeExample(value: unknown): Record<string, unknown> | null {
  const example = asRecord(value);
  const id = readString(example.id);
  if (!id) {
    return null;
  }
  return compactObject({
    id,
    title: readString(example.title),
    category: readString(example.category),
    targets: asArray(example.apps).filter((app): app is Target => targets.includes(app as Target)),
    goal: readString(example.goal),
    difficulty: readString(example.difficulty),
    estimatedMinutes: readFiniteNumber(example.estimatedMinutes),
  });
}

function buildHelpResponse(): Record<string, unknown> {
  return {
    ok: true,
    command: "help",
    usage: "npm run --silent biovoice -- <command> [options]",
    commands: {
      doctor: "Check the local server, credential presence, target applications, and capture privacy policy.",
      capabilities: "List available targets, workflows, and example recipes.",
      plan: "Validate and dry-run a scientific workflow without changing the target; database-backed inputs may be downloaded into the local scientific cache.",
      run: "Run a scientific workflow.",
      state: "Read the current target scene state.",
      capture: "Capture the current viewport locally without attaching it to a model conversation.",
      undo: "Restore the checkpoint created before the most recent action bundle.",
      receipts: "List recent local run receipts.",
    },
    commonOptions: {
      "--base-url": "Loopback BioVoice server URL; defaults to http://127.0.0.1:3000.",
      "--target": "pymol or chimerax.",
    },
  };
}

function successEnvelope(command: Command, result: unknown): Record<string, unknown> {
  return { ok: true, command, result };
}

function parseTarget(value: string): Target {
  if (!targets.includes(value as Target)) {
    throw new BiovoiceCliError("invalid_target", "--target must be pymol or chimerax.");
  }
  return value as Target;
}

function parsePresentationMode(value: string): PresentationMode {
  if (!presentationModes.includes(value as PresentationMode)) {
    throw new BiovoiceCliError("invalid_presentation_mode", "--presentation-mode must be analysis, demo, or publication.");
  }
  return value as PresentationMode;
}

function readFormat(values: FlagValues, flag: string): "pdb" | "cif" | undefined {
  const value = readSingleFlag(values, flag);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "pdb" && value !== "cif") {
    throw new BiovoiceCliError("invalid_format", `${flag} must be pdb or cif.`);
  }
  return value;
}

function readPdbId(values: FlagValues): string | undefined {
  const value = readSingleFlag(values, "--experimental-pdb-id")?.toUpperCase();
  if (value === undefined) {
    return undefined;
  }
  if (!/^[A-Z0-9]{4}$/.test(value)) {
    throw new BiovoiceCliError("invalid_pdb_id", "--experimental-pdb-id must be a four-character PDB accession.");
  }
  return value;
}

function readEmdbId(values: FlagValues): string | undefined {
  const value = readSingleFlag(values, "--emdb-id")?.toUpperCase();
  if (value === undefined) {
    return undefined;
  }
  if (!/^(EMD[-_]?)?\d{3,8}$/.test(value)) {
    throw new BiovoiceCliError("invalid_emdb_id", "--emdb-id must look like EMD-1234.");
  }
  return value;
}

function parseInterfaceChains(value: string | undefined): [string, string] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const chains = value.split(",").map((chain) => chain.trim());
  if (chains.length !== 2 || chains.some((chain) => !/^[A-Za-z0-9_.-]{1,12}$/.test(chain))) {
    throw new BiovoiceCliError("invalid_interface_chains", "--interface-chains must contain two safe chain IDs separated by a comma.");
  }
  return [chains[0], chains[1]];
}

function readSafeIdentifier(values: FlagValues, flag: string, maxLength: number): string | undefined {
  const value = readSingleFlag(values, flag);
  if (value === undefined) {
    return undefined;
  }
  if (value.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new BiovoiceCliError("invalid_identifier", `${flag} contains an invalid identifier.`);
  }
  return value;
}

function readSafePath(values: FlagValues, flag: string): string | undefined {
  const value = readSingleFlag(values, flag);
  if (value === undefined) {
    return undefined;
  }
  validateSafePath(value, flag);
  return value;
}

function readRepeatedPaths(values: FlagValues, flag: string, maxItems: number): string[] | undefined {
  const items = values.get(flag);
  if (!items?.length) {
    return undefined;
  }
  if (items.length > maxItems) {
    throw new BiovoiceCliError("too_many_values", `${flag} accepts at most ${maxItems} values.`);
  }
  for (const item of items) {
    validateSafePath(item, flag);
  }
  return items;
}

function validateSafePath(value: string, flag: string): void {
  assertBoundedText(value, flag, 400);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new BiovoiceCliError("url_not_allowed", `${flag} accepts a local path, not a URL.`);
  }
}

function readRepeatedSafeTokens(values: FlagValues, flag: string, maxItems: number, maxLength: number): string[] | undefined {
  const items = values.get(flag);
  if (!items?.length) {
    return undefined;
  }
  if (items.length > maxItems) {
    throw new BiovoiceCliError("too_many_values", `${flag} accepts at most ${maxItems} values.`);
  }
  for (const item of items) {
    if (item.length > maxLength || !/^[A-Za-z0-9_.:+-]+$/.test(item)) {
      throw new BiovoiceCliError("invalid_value", `${flag} contains an invalid value.`);
    }
  }
  return items;
}

function readMutations(values: FlagValues): Array<{ position: string; chain?: string; from?: string; to?: string }> {
  const items = values.get("--mutation") ?? [];
  if (!items.length) {
    throw new BiovoiceCliError("missing_required_flag", "At least one --mutation is required for variant environment review.");
  }
  if (items.length > 12) {
    throw new BiovoiceCliError("too_many_values", "--mutation accepts at most 12 values.");
  }

  return items.map((item) => {
    try {
      return parseVariantMutationArgument(item);
    } catch (error) {
      throw new BiovoiceCliError(
        "invalid_mutation",
        error instanceof Error ? error.message : "Invalid --mutation value.",
      );
    }
  });
}

function rejectFlags(values: FlagValues, flags: string[], context: string): void {
  const invalid = flags.find((flag) => values.has(flag));
  if (invalid) {
    throw new BiovoiceCliError("incompatible_flag", `${invalid} is not supported by ${context}.`);
  }
}

function readSingleFlag(values: FlagValues, flag: string): string | undefined {
  return values.get(flag)?.[0];
}

function requireFlag(values: FlagValues, flag: string): string {
  const value = readSingleFlag(values, flag);
  if (value === undefined) {
    throw new BiovoiceCliError("missing_required_flag", `${flag} is required.`);
  }
  return value;
}

function parseBoundedInteger(value: string, flag: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) {
    throw new BiovoiceCliError("invalid_integer", `${flag} must be an integer from ${min} to ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BiovoiceCliError("invalid_integer", `${flag} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function parseBoundedNumber(value: string, flag: string, min: number, max: number): number {
  if (!/^(?:\d+|\d+\.\d+)$/.test(value)) {
    throw new BiovoiceCliError("invalid_number", `${flag} must be a number from ${min} to ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new BiovoiceCliError("invalid_number", `${flag} must be a number from ${min} to ${max}.`);
  }
  return parsed;
}

function assertBoundedText(value: string, label: string, maxLength: number): void {
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BiovoiceCliError("invalid_text", `${label} must be non-empty, bounded text without control characters.`);
  }
}

function safeDisplayValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function extractServerError(value: unknown): string | undefined {
  const error = readString(asRecord(value).error);
  return error?.slice(0, 400);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function errorEnvelope(error: unknown): Record<string, unknown> {
  if (error instanceof BiovoiceCliError) {
    return compactObject({
      ok: false,
      error: compactObject({
        code: error.code,
        message: error.message,
        details: error.details,
      }),
    });
  }
  return {
    ok: false,
    error: {
      code: "unexpected_error",
      message: error instanceof Error ? error.message.slice(0, 400) : "Unexpected error.",
    },
  };
}

async function main(): Promise<void> {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    const output = await executeCliCommand(parsed);
    console.log(JSON.stringify(output, null, 2));
    if (output.ok === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(JSON.stringify(errorEnvelope(error), null, 2));
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  void main();
}
