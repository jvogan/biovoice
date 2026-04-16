import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveFromRoot } from "../packages/runtime-and-adapters/src/utils/paths.js";

const projectRoot = resolveFromRoot();
const blockedTrackedFiles = [
  /^\.env$/,
  /^\.env\.(?!example$).+/,
  /(?:^|\/)node_modules\//,
  /^dist\//,
  /^\.runtime\//,
  /^tmp\//,
  /^widget_1\//,
  /^output\//,
  /(?:^|\/)local\//,
  /(?:^|\/)private\//,
  /^docs\/banners\//,
  /\.DS_Store$/,
];
const secretPatterns = [
  { label: "OpenAI-style API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g },
  { label: "GitHub personal access token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { label: "GitHub classic token", regex: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { label: "Hugging Face token", regex: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { label: "Private key block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { label: "Google API key", regex: /\bAIzaSy[A-Za-z0-9_-]{33}\b/g },
  { label: "AWS access key", regex: /\bAKIA[A-Z0-9]{16}\b/g },
  { label: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g },
];
const privacyPatterns = [
  { label: "macOS user-home path", regex: /\/Users\/[^/\s)]+/g },
  { label: "Linux user-home path", regex: /\/home\/[^/\s)]+/g },
  { label: "Windows user-home path", regex: /[A-Za-z]:\\Users\\[^\\\s)]+/g },
];
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".mp4",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

async function main(): Promise<void> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const trackedFiles = getTrackedFiles();

  if (!trackedFiles) {
    warnings.push("Git metadata is unavailable in this workspace, so tracked-file release checks were skipped.");
  } else {
    for (const file of trackedFiles) {
      if (blockedTrackedFiles.some((pattern) => pattern.test(file))) {
        failures.push(`Remove tracked local-only artifact before release: ${file}`);
        continue;
      }

      const secretMatches = await scanTrackedFileForLeaks(file);
      for (const match of secretMatches) {
        failures.push(`Potential ${match.label} found in tracked file ${file}`);
      }
    }

    const brokenLinks = await checkTrackedMarkdownLinks(trackedFiles);
    for (const brokenLink of brokenLinks) {
      failures.push(`Broken relative Markdown link in ${brokenLink.file}: ${brokenLink.href}`);
    }
  }

  const localEnvWarning = await inspectLocalEnv();
  if (localEnvWarning) {
    warnings.push(localEnvWarning);
  }
  warnings.push(...await inspectWorkspaceArtifacts());

  if (failures.length > 0) {
    console.error("Release readiness failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    if (warnings.length > 0) {
      console.error("");
      console.error("Warnings:");
      for (const warning of warnings) {
        console.error(`- ${warning}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log("Release readiness checks passed.");
  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function getTrackedFiles(): string[] | null {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function scanTrackedFileForLeaks(relativePath: string): Promise<Array<{ label: string }>> {
  const absolutePath = resolveFromRoot(relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  if (binaryExtensions.has(extension)) {
    return [];
  }

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat || stat.size > 2_000_000) {
    return [];
  }

  const content = await fs.readFile(absolutePath, "utf8").catch(() => null);
  if (!content) {
    return [];
  }

  return [...secretPatterns, ...privacyPatterns].filter(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(content);
  }).map(({ label }) => ({ label }));
}

async function checkTrackedMarkdownLinks(trackedFiles: string[]): Promise<Array<{ file: string; href: string }>> {
  const trackedSet = new Set(trackedFiles);
  const failures: Array<{ file: string; href: string }> = [];

  for (const file of trackedFiles.filter((candidate) => candidate.endsWith(".md"))) {
    const content = await fs.readFile(resolveFromRoot(file), "utf8").catch(() => null);
    if (!content) {
      continue;
    }

    const linkPattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of content.matchAll(linkPattern)) {
      const rawHref = match[1];
      if (!rawHref || shouldSkipMarkdownHref(rawHref)) {
        continue;
      }

      const hrefWithoutAnchor = rawHref.split("#", 1)[0];
      if (!hrefWithoutAnchor || shouldSkipMarkdownHref(hrefWithoutAnchor)) {
        continue;
      }

      const normalizedTarget = normalizeMarkdownTarget(file, hrefWithoutAnchor);
      if (!normalizedTarget) {
        failures.push({ file, href: rawHref });
        continue;
      }

      if (trackedSet.has(normalizedTarget)) {
        continue;
      }

      const stat = await fs.stat(resolveFromRoot(normalizedTarget)).catch(() => null);
      if (!stat) {
        failures.push({ file, href: rawHref });
      }
    }
  }

  return failures;
}

function shouldSkipMarkdownHref(href: string): boolean {
  return /^(?:https?:|mailto:|#|\/\/)/i.test(href);
}

function normalizeMarkdownTarget(sourceFile: string, href: string): string | null {
  const decoded = decodeURIComponent(href);
  const sourceDir = path.dirname(sourceFile);
  const normalized = path.normalize(path.join(sourceDir, decoded)).replaceAll("\\", "/");
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized === "." ? "README.md" : normalized.replace(/\/$/, "");
}

async function inspectLocalEnv(): Promise<string | null> {
  const envPath = resolveFromRoot(".env");
  const content = await fs.readFile(envPath, "utf8").catch(() => null);
  if (!content) {
    return null;
  }

  const containsLikelySecret = secretPatterns.some(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(content);
  });
  if (!containsLikelySecret) {
    return "A local .env file is present at repo root. Confirm it stays untracked before publishing.";
  }

  return "A local .env file with live-looking credentials is present at repo root. Keep it out of version control and release artifacts.";
}

async function inspectWorkspaceArtifacts(): Promise<string[]> {
  const warnings: string[] = [];
  const riskyWorkspaceFiles = ["docs/floating-companion-todo.md"];

  for (const relativePath of riskyWorkspaceFiles) {
    const absolutePath = resolveFromRoot(relativePath);
    const exists = await fs.access(absolutePath).then(() => true).catch(() => false);
    if (!exists) {
      continue;
    }
    warnings.push(`Review local-only workspace artifact before release: ${relativePath}`);
  }

  return warnings;
}

await main();
