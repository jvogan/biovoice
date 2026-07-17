import fs from "node:fs/promises";
import path from "node:path";
import type { ActionResult, TargetKind } from "../schemas/index.js";
import { runtimeDir } from "../utils/paths.js";

export interface RunReceiptArtifact {
  kind: string;
  label: string;
  path?: string;
  url?: string;
  mimeType?: string;
}

export interface RunReceiptSummary {
  id: string;
  createdAt: string;
  target: TargetKind;
  summary: string;
  source: string;
  evidenceLevel: string;
  checkpointAvailable: boolean;
  artifacts: RunReceiptArtifact[];
  warnings: string[];
}

export interface RunReceipt extends RunReceiptSummary {
  request?: unknown;
  result?: unknown;
}

export interface CreateRunReceiptInput {
  target: TargetKind;
  summary: string;
  source: string;
  evidenceLevel?: string;
  checkpointAvailable?: boolean;
  artifacts?: RunReceiptArtifact[];
  warnings?: string[];
  request?: unknown;
  result?: unknown;
}

const RECEIPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECEIPTS_RETURNED = 100;

export class RunReceiptStore {
  private readonly dir: string;

  constructor(dir = path.join(runtimeDir, "receipts")) {
    this.dir = dir;
  }

  async create(input: CreateRunReceiptInput): Promise<RunReceipt> {
    if (input.checkpointAvailable) {
      await this.clearCheckpointAvailability(input.target);
    }
    const id = crypto.randomUUID();
    const receipt: RunReceipt = {
      id,
      createdAt: new Date().toISOString(),
      target: input.target,
      summary: normalizeSummary(input.summary),
      source: input.source,
      evidenceLevel: input.evidenceLevel ?? inferEvidenceLevel(input.result),
      checkpointAvailable: input.checkpointAvailable ?? false,
      artifacts: input.artifacts ?? extractArtifacts(input.result),
      warnings: input.warnings ?? extractWarnings(input.result),
      ...(typeof input.request === "undefined" ? {} : { request: input.request }),
      ...(typeof input.result === "undefined" ? {} : { result: input.result }),
    };

    await this.write(receipt);
    return receipt;
  }

  async clearCheckpointAvailability(target: TargetKind): Promise<void> {
    const entries = await fs.readdir(this.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(this.dir, entry.name);
      const receipt = await this.read(filePath).catch(() => null);
      if (!receipt || receipt.target !== target || !receipt.checkpointAvailable) continue;
      await this.write({ ...receipt, checkpointAvailable: false });
    }
  }

  async list(limit = 20): Promise<RunReceiptSummary[]> {
    const safeLimit = Math.max(1, Math.min(MAX_RECEIPTS_RETURNED, Math.floor(limit) || 20));
    const entries = await fs.readdir(this.dir, { withFileTypes: true }).catch(() => []);
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(this.dir, entry.name);
        const stat = await fs.stat(filePath).catch(() => null);
        return stat ? { filePath, mtimeMs: stat.mtimeMs } : null;
      }));

    const receipts: RunReceiptSummary[] = [];
    for (const candidate of candidates
      .filter((value): value is { filePath: string; mtimeMs: number } => Boolean(value))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, safeLimit)) {
      const receipt = await this.read(candidate.filePath).catch(() => null);
      if (receipt) {
        receipts.push(toSummary(receipt));
      }
    }
    return receipts;
  }

  async get(id: string): Promise<RunReceipt | null> {
    if (!RECEIPT_ID_PATTERN.test(id)) {
      return null;
    }
    return this.read(this.pathFor(id)).catch(() => null);
  }

  private pathFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private async write(receipt: RunReceipt): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const finalPath = this.pathFor(receipt.id);
    const tempPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tempPath, finalPath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  private async read(filePath: string): Promise<RunReceipt> {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as RunReceipt;
  }
}

function normalizeSummary(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return (trimmed || "BioVoice run").slice(0, 400);
}

function toSummary(receipt: RunReceipt): RunReceiptSummary {
  const { request: _request, result: _result, ...summary } = receipt;
  return summary;
}

function extractArtifacts(result: unknown): RunReceiptArtifact[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const direct = (result as { artifacts?: unknown }).artifacts;
  if (Array.isArray(direct)) {
    return direct.flatMap(normalizeArtifact);
  }
  const stepResults = (result as { stepResults?: unknown }).stepResults;
  if (Array.isArray(stepResults)) {
    return stepResults.flatMap((step) => {
      if (!step || typeof step !== "object") return [];
      const actionResult = (step as { result?: unknown }).result;
      return extractArtifacts(actionResult);
    });
  }
  return [];
}

function normalizeArtifact(value: unknown): RunReceiptArtifact[] {
  if (!value || typeof value !== "object") return [];
  const artifact = value as Partial<ActionResult["artifacts"][number]>;
  if (typeof artifact.kind !== "string" || typeof artifact.label !== "string") return [];
  return [{
    kind: artifact.kind,
    label: artifact.label,
    ...(typeof artifact.path === "string" ? { path: artifact.path } : {}),
    ...(typeof artifact.url === "string" ? { url: artifact.url } : {}),
    ...(typeof artifact.mimeType === "string" ? { mimeType: artifact.mimeType } : {}),
  }];
}

function extractWarnings(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const warnings = (result as { warnings?: unknown }).warnings;
  const direct = Array.isArray(warnings) ? warnings.filter((value): value is string => typeof value === "string") : [];
  const stepResults = (result as { stepResults?: unknown }).stepResults;
  if (!Array.isArray(stepResults)) return direct;
  return [
    ...direct,
    ...stepResults.flatMap((step) => {
      if (!step || typeof step !== "object") return [];
      return extractWarnings((step as { result?: unknown }).result);
    }),
  ];
}

function inferEvidenceLevel(result: unknown): string {
  if (!result || typeof result !== "object") return "executed";
  const explicit = (result as { evidenceLevel?: unknown }).evidenceLevel;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if ((result as { dryRun?: unknown }).dryRun === true) return "planned";
  if (hasMetrics(result)) return "measured";
  const artifacts = extractArtifacts(result);
  if (artifacts.some((artifact) => artifact.kind === "image")) return "visual";
  return "executed";
}

function hasMetrics(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const metrics = (result as { metrics?: unknown }).metrics;
  if (Array.isArray(metrics) && metrics.length > 0) return true;
  const stepResults = (result as { stepResults?: unknown }).stepResults;
  return Array.isArray(stepResults) && stepResults.some((step) => {
    if (!step || typeof step !== "object") return false;
    return hasMetrics((step as { result?: unknown }).result);
  });
}
