import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_NAMES = new Set(["biovoice", "biovoice-console", "realtime-protein-structure"]);

function searchForProjectRoot(startDir: string): string | null {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (parsed.name && REPO_NAMES.has(parsed.name)) {
          return current;
        }
      } catch {
        // Ignore parse errors and continue walking upward.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

function findProjectRoot(): string {
  const candidateRoots = [
    searchForProjectRoot(process.cwd()),
    searchForProjectRoot(__dirname),
  ].filter((value): value is string => Boolean(value));

  if (candidateRoots.length) {
    return candidateRoots[0];
  }

  return process.cwd();
}

export const projectRoot = findProjectRoot();
export const runtimeDir = path.join(projectRoot, ".runtime");
export const examplesDir = path.join(projectRoot, "examples");
export const localDataDir = path.join(examplesDir, "data", "local");

export function resolveFromRoot(...segments: string[]): string {
  return path.join(projectRoot, ...segments);
}
