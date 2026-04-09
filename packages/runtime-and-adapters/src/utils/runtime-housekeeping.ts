import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot, resolveFromRoot, runtimeDir } from "./paths.js";

export interface RuntimeCleanupOptions {
  exportRetentionMs: number;
  exportKeepLatest: number;
  exportMaxBytes: number;
  sessionRetentionMs: number;
  agentLogRetentionMs: number;
  agentLogKeepLatest: number;
  scientificCacheRetentionMs: number;
  scientificCacheKeepLatest: number;
  tempRetentionMs: number;
  tempKeepLatest: number;
}

export interface RuntimeCleanupSummary {
  removedPaths: string[];
  bytesRecovered: number;
  warnings: string[];
}

const DEFAULT_EXPORT_RETENTION_MS = 48 * 60 * 60 * 1000;
const DEFAULT_EXPORT_KEEP_LATEST = 40;
const DEFAULT_EXPORT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AGENT_LOG_RETENTION_MS = 72 * 60 * 60 * 1000;
const DEFAULT_AGENT_LOG_KEEP_LATEST = 12;
const DEFAULT_SCIENTIFIC_CACHE_RETENTION_MS = 72 * 60 * 60 * 1000;
const DEFAULT_SCIENTIFIC_CACHE_KEEP_LATEST = 60;
const DEFAULT_TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TEMP_KEEP_LATEST = 20;

export function getRuntimeCleanupOptions(): RuntimeCleanupOptions {
  return {
    exportRetentionMs: readHours("RUNTIME_EXPORT_RETENTION_HOURS", 48) * 60 * 60 * 1000,
    exportKeepLatest: readCount("RUNTIME_EXPORT_KEEP_LATEST", DEFAULT_EXPORT_KEEP_LATEST),
    exportMaxBytes: readMegabytes("RUNTIME_EXPORT_MAX_MB", 25) * 1024 * 1024,
    sessionRetentionMs: readHours("RUNTIME_SESSION_RETENTION_HOURS", 24) * 60 * 60 * 1000,
    agentLogRetentionMs: readHours("RUNTIME_AGENT_LOG_RETENTION_HOURS", 72) * 60 * 60 * 1000,
    agentLogKeepLatest: readCount("RUNTIME_AGENT_LOG_KEEP_LATEST", DEFAULT_AGENT_LOG_KEEP_LATEST),
    scientificCacheRetentionMs: readHours("RUNTIME_SCIENTIFIC_CACHE_RETENTION_HOURS", 72) * 60 * 60 * 1000,
    scientificCacheKeepLatest: readCount("RUNTIME_SCIENTIFIC_CACHE_KEEP_LATEST", DEFAULT_SCIENTIFIC_CACHE_KEEP_LATEST),
    tempRetentionMs: readHours("RUNTIME_TEMP_RETENTION_HOURS", 24) * 60 * 60 * 1000,
    tempKeepLatest: readCount("RUNTIME_TEMP_KEEP_LATEST", DEFAULT_TEMP_KEEP_LATEST),
  };
}

export async function cleanupRuntimeArtifacts(
  options: Partial<RuntimeCleanupOptions> = {},
): Promise<RuntimeCleanupSummary> {
  const merged: RuntimeCleanupOptions = {
    exportRetentionMs: options.exportRetentionMs ?? DEFAULT_EXPORT_RETENTION_MS,
    exportKeepLatest: options.exportKeepLatest ?? DEFAULT_EXPORT_KEEP_LATEST,
    exportMaxBytes: options.exportMaxBytes ?? DEFAULT_EXPORT_MAX_BYTES,
    sessionRetentionMs: options.sessionRetentionMs ?? DEFAULT_SESSION_RETENTION_MS,
    agentLogRetentionMs: options.agentLogRetentionMs ?? DEFAULT_AGENT_LOG_RETENTION_MS,
    agentLogKeepLatest: options.agentLogKeepLatest ?? DEFAULT_AGENT_LOG_KEEP_LATEST,
    scientificCacheRetentionMs: options.scientificCacheRetentionMs ?? DEFAULT_SCIENTIFIC_CACHE_RETENTION_MS,
    scientificCacheKeepLatest: options.scientificCacheKeepLatest ?? DEFAULT_SCIENTIFIC_CACHE_KEEP_LATEST,
    tempRetentionMs: options.tempRetentionMs ?? DEFAULT_TEMP_RETENTION_MS,
    tempKeepLatest: options.tempKeepLatest ?? DEFAULT_TEMP_KEEP_LATEST,
  };

  const summary: RuntimeCleanupSummary = {
    removedPaths: [],
    bytesRecovered: 0,
    warnings: [],
  };

  await pruneManagedDirectory(path.join(runtimeDir, "exports"), {
    retentionMs: merged.exportRetentionMs,
    keepLatest: merged.exportKeepLatest,
    maxBytes: merged.exportMaxBytes,
    summary,
    include: /\.(png|jpe?g|webp|cif|pse|pdb|cxs)$/i,
  });
  await pruneManagedDirectory(path.join(runtimeDir, "sessions"), {
    retentionMs: merged.sessionRetentionMs,
    keepLatest: 0,
    summary,
  });
  await pruneManagedDirectory(path.join(runtimeDir, "agent-runtime"), {
    retentionMs: merged.agentLogRetentionMs,
    keepLatest: merged.agentLogKeepLatest,
    summary,
    include: /\.log$/i,
  });
  await pruneManagedDirectory(path.join(runtimeDir, "floating-companion"), {
    retentionMs: merged.agentLogRetentionMs,
    keepLatest: merged.agentLogKeepLatest,
    summary,
    include: /\.log$/i,
  });
  await Promise.all([
    "alphafold",
    "pdb",
    "pae",
    "rosetta",
    "manifests",
  ].map((bucket) => pruneManagedDirectory(path.join(runtimeDir, "cache", "scientific", bucket), {
    retentionMs: merged.scientificCacheRetentionMs,
    keepLatest: merged.scientificCacheKeepLatest,
    summary,
    include: /\.(json|pdb|cif|mmcif|map)$/i,
  })));
  await pruneManagedDirectory(resolveFromRoot("tmp"), {
    retentionMs: merged.tempRetentionMs,
    keepLatest: merged.tempKeepLatest,
    summary,
    include: /\.(png|jpe?g|webp|json|log|txt)$/i,
  });

  return summary;
}

async function pruneManagedDirectory(
  dir: string,
  options: {
    retentionMs: number;
    keepLatest: number;
    maxBytes?: number;
    summary: RuntimeCleanupSummary;
    include?: RegExp;
  },
): Promise<void> {
  const resolvedDir = await resolveCleanupDirectory(dir, options.summary);
  if (!resolvedDir) {
    return;
  }
  await pruneDirectory(resolvedDir, options);
}

async function pruneDirectory(
  dir: string,
  options: {
    retentionMs: number;
    keepLatest: number;
    maxBytes?: number;
    summary: RuntimeCleanupSummary;
    include?: RegExp;
  },
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - options.retentionMs;
  const files: Array<{ path: string; mtimeMs: number; size: number }> = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat) {
      continue;
    }

    if (entry.isDirectory()) {
      if (stat.mtimeMs < cutoff && options.keepLatest <= 0) {
        const size = await estimatePathSize(entryPath);
        await removePath(entryPath, size, options.summary, true);
      }
      continue;
    }

    if (options.include && !options.include.test(entry.name)) {
      continue;
    }

    files.push({ path: entryPath, mtimeMs: stat.mtimeMs, size: stat.size });
  }

  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const keepLatest = Math.max(0, options.keepLatest);
  const preservedPaths = new Set(files.slice(0, keepLatest).map((file) => file.path));

  for (const file of files) {
    const shouldKeepByAge = file.mtimeMs >= cutoff;
    const shouldKeepByPosition = preservedPaths.has(file.path);
    if (shouldKeepByAge || shouldKeepByPosition) {
      continue;
    }

    await removePath(file.path, file.size, options.summary);
  }

  if (!options.maxBytes || options.maxBytes <= 0) {
    return;
  }

  const remainingEntries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const remainingFiles: Array<{ path: string; mtimeMs: number; size: number }> = [];
  for (const entry of remainingEntries) {
    if (!entry.isFile() || (options.include && !options.include.test(entry.name))) {
      continue;
    }
    const entryPath = path.join(dir, entry.name);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat) {
      continue;
    }
    remainingFiles.push({ path: entryPath, mtimeMs: stat.mtimeMs, size: stat.size });
  }

  const protectedAfterAgePrune = new Set(
    [...remainingFiles]
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, keepLatest)
      .map((file) => file.path),
  );
  let remainingBytes = remainingFiles.reduce((total, file) => total + file.size, 0);

  for (const file of [...remainingFiles].sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (remainingBytes <= options.maxBytes) {
      break;
    }
    if (protectedAfterAgePrune.has(file.path)) {
      continue;
    }

    await removePath(file.path, file.size, options.summary);
    remainingBytes -= file.size;
  }
}

async function resolveCleanupDirectory(candidate: string, summary: RuntimeCleanupSummary): Promise<string | null> {
  const resolved = await resolveCleanupPath(candidate);
  const normalizedProjectRoot = path.resolve(projectRoot);
  if (resolved === normalizedProjectRoot || resolved.startsWith(`${normalizedProjectRoot}${path.sep}`)) {
    return resolved;
  }

  summary.warnings.push(`Skipped cleanup for ${candidate}: resolved outside the project root.`);
  return null;
}

async function resolveCleanupPath(candidate: string): Promise<string> {
  const absolute = path.resolve(candidate);
  const missingSegments: string[] = [];
  let current = absolute;

  while (!await pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  let resolvedBase = path.resolve(current);
  try {
    resolvedBase = await fs.realpath(current);
  } catch {
    // Fall back to the absolute path when the leaf does not exist yet.
  }

  return missingSegments.reduce((resolved, segment) => path.join(resolved, segment), resolvedBase);
}

async function estimatePathSize(candidate: string): Promise<number> {
  const stat = await fs.stat(candidate).catch(() => null);
  if (!stat) {
    return 0;
  }
  if (stat.isFile()) {
    return stat.size;
  }

  const entries = await fs.readdir(candidate, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    total += await estimatePathSize(path.join(candidate, entry.name));
  }
  return total;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function removePath(candidate: string, size: number, summary: RuntimeCleanupSummary, recursive = false): Promise<void> {
  try {
    await fs.rm(candidate, { recursive, force: true });
    summary.removedPaths.push(candidate);
    summary.bytesRecovered += size;
  } catch (error) {
    summary.warnings.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readHours(name: string, fallbackHours: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallbackHours;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackHours;
  }
  return parsed;
}

function readCount(name: string, fallbackCount: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallbackCount;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackCount;
  }
  return Math.floor(parsed);
}

function readMegabytes(name: string, fallbackMegabytes: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallbackMegabytes;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackMegabytes;
  }
  return parsed;
}
