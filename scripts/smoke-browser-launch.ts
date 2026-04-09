import { browserSmokeUsage } from "./lib/launch-gate.js";
import { runInteractiveBrowserSmoke } from "./lib/browser-launch-smoke.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(browserSmokeUsage());
    return;
  }

  const url = readFlagValue(args, "--url");
  if (!url) {
    throw new Error(`Missing --url.\n\n${browserSmokeUsage()}`);
  }

  const target = normalizeTarget(readFlagValue(args, "--target") ?? new URL(url).searchParams.get("target") ?? undefined);
  if (!target) {
    throw new Error(`Unable to determine the target from --target or the launch URL.\n\n${browserSmokeUsage()}`);
  }

  const result = await runInteractiveBrowserSmoke(url, target);
  console.log(JSON.stringify({
    ok: true,
    ...result,
  }, null, 2));
}

function readFlagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function normalizeTarget(value: string | undefined): "pymol" | "chimerax" | undefined {
  if (value === "pymol") {
    return value;
  }
  if (value === "chimera" || value === "chimerax") {
    return "chimerax";
  }
  return undefined;
}

void main();
