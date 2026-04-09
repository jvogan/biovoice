import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { localDataDir, resolveFromRoot, runtimeDir } from "./paths.js";

const exportDir = path.join(runtimeDir, "exports");
const outputDir = resolveFromRoot("output");
const DISALLOWED_COMMAND_PATH_CHARS = /[\u0000-\u001f\u007f]/;

function resolvePolicyPath(candidate: string): string {
  const absolute = path.resolve(candidate);
  const missingSegments: string[] = [];
  let current = absolute;

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  let resolvedBase = path.resolve(current);
  try {
    resolvedBase = fs.realpathSync.native(current);
  } catch {
    // Fall back to the absolute path when the leaf does not exist yet.
  }

  return missingSegments.reduce((resolved, segment) => path.join(resolved, segment), resolvedBase);
}

function parseConfiguredRoots(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => resolvePolicyPath(value))));
}

export function getAllowedStructureInputRoots(): string[] {
  return uniquePaths([
    localDataDir,
    runtimeDir,
    outputDir,
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Downloads"),
    ...parseConfiguredRoots(process.env.STRUCTURE_ALLOWED_PATHS),
  ]);
}

export function getAllowedExportRoots(): string[] {
  return uniquePaths([
    exportDir,
    outputDir,
    ...parseConfiguredRoots(process.env.EXPORT_ALLOWED_PATHS),
  ]);
}

export function isPathInsideRoots(candidate: string, roots: string[]): boolean {
  const resolved = resolvePolicyPath(candidate);
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

export function ensureAllowedStructureInputPath(candidate: string, label = "Structure path"): string {
  const resolved = resolvePolicyPath(candidate);
  assertSafeCommandPath(resolved, label);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!isPathInsideRoots(resolved, getAllowedStructureInputRoots())) {
    throw new Error(
      `${label} is outside the allowed roots. Move it under examples/data/local, .runtime, output, Desktop, Documents, Downloads, or extend STRUCTURE_ALLOWED_PATHS.`,
    );
  }
  return resolved;
}

export function ensureAllowedExportPath(candidate: string): string {
  const resolved = resolvePolicyPath(candidate);
  assertSafeCommandPath(resolved, "Export path");
  if (!isPathInsideRoots(resolved, getAllowedExportRoots())) {
    throw new Error(
      `Export path is outside the allowed roots. Save under .runtime/exports, output, or extend EXPORT_ALLOWED_PATHS.`,
    );
  }
  return resolved;
}

export function defaultExportPath(target: string, format: string): string {
  return path.join(exportDir, `${target}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${format}`);
}

export function quoteCommandValue(value: string): string {
  assertSafeCommandPath(value, "Command value");
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function assertSafeCommandPath(value: string, label: string): void {
  if (DISALLOWED_COMMAND_PATH_CHARS.test(value)) {
    throw new Error(`${label} contains unsupported control characters.`);
  }
}
