import { resolveFromRoot, type TargetKind } from "../../packages/runtime-and-adapters/src/index.js";
import type {
  ActionEnvelope,
  CaptureViewRequest,
  ScientificWorkflowRequest,
} from "../../packages/runtime-and-adapters/src/schemas/index.js";

const defaultTargets: TargetKind[] = ["pymol", "chimerax"];

export interface VerifyLaunchOptions {
  targets: TargetKind[];
  runBroadCheck: boolean;
  runBrowserSmoke: boolean;
  keepRunning: boolean;
  helpRequested: boolean;
}

export interface LaunchGateScenario {
  target: TargetKind;
  recipeId: string;
  actionEnvelope: ActionEnvelope;
  captureRequest: CaptureViewRequest;
  workflowRequest: ScientificWorkflowRequest;
  expectedStateMarker: string;
}

export interface BrowserSmokeResult {
  url: string;
  target?: TargetKind;
  htmlBytes: number;
  assetUrls: string[];
  assets: Array<{
    url: string;
    status: number;
    contentType: string | null;
    bytes: number;
  }>;
}

export function parseVerifyLaunchArgs(argv: string[]): VerifyLaunchOptions {
  const selectedTargets: TargetKind[] = [];
  let runBroadCheck = true;
  let runBrowserSmoke = false;
  let keepRunning = false;
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target") {
      selectedTargets.push(parseTarget(argv[index + 1]));
      index += 1;
      continue;
    }
    if (token === "--targets") {
      const raw = argv[index + 1] ?? "";
      for (const entry of raw.split(",")) {
        if (!entry.trim()) {
          continue;
        }
        selectedTargets.push(parseTarget(entry));
      }
      index += 1;
      continue;
    }
    if (token === "--browser" || token === "--browser-smoke") {
      runBrowserSmoke = true;
      continue;
    }
    if (token === "--skip-check") {
      runBroadCheck = false;
      continue;
    }
    if (token === "--keep-running") {
      keepRunning = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      helpRequested = true;
      continue;
    }
    throw new Error(`Unknown flag: ${token}`);
  }

  return {
    targets: uniqueTargets(selectedTargets.length ? selectedTargets : defaultTargets),
    runBroadCheck,
    runBrowserSmoke,
    keepRunning,
    helpRequested,
  };
}

export function verifyLaunchUsage(): string {
  return [
    "Usage: tsx scripts/verify-launch.ts [options]",
    "",
    "Options:",
    "  --target <pymol|chimera|chimerax>   Run only one managed target check. Repeatable.",
    "  --targets <csv>                     Comma-separated target list.",
    "  --browser                           Run the optional launch-page and asset smoke.",
    "  --skip-check                        Skip `npm run check` before the managed launch checks.",
    "  --keep-running                      Leave the last verified managed target running.",
    "  --help                              Show this message.",
  ].join("\n");
}

export function browserSmokeUsage(): string {
  return [
    "Usage: tsx scripts/smoke-browser-launch.ts --url <launchUrl> [--target <pymol|chimera|chimerax>]",
    "",
    "Options:",
    "  --url <launchUrl>                   Recommended launch URL from the managed start flow.",
    "  --target <pymol|chimera|chimerax>   Optional. Defaults to the URL query string target when present.",
    "  --help                              Show this message.",
  ].join("\n");
}

export function buildLaunchGateScenario(target: TargetKind): LaunchGateScenario {
  const fixturePath = resolveFromRoot("examples", "data", "local", "1hsg.pdb");

  if (target === "pymol") {
    return {
      target,
      recipeId: "pymol-binding-pocket-story",
      actionEnvelope: {
        target,
        summary: "Launch-gate PyMOL managed-route smoke.",
        actions: [
          { type: "reset_workspace" },
          { type: "load", source: "local", path: fixturePath, object: "launch_gate_model" },
          { type: "show", representations: ["cartoon"], selection: "launch_gate_model" },
          { type: "camera", action: "hero_frame", selection: "launch_gate_model", buffer: 6 },
        ],
      },
      captureRequest: {
        target,
        width: 960,
        height: 640,
      },
      workflowRequest: {
        target,
        workflow: "alphafold_vs_experiment_overlay",
        presentationMode: "analysis",
        dryRun: true,
        inputs: {
          modelPath: resolveFromRoot("examples", "data", "local", "af-p69905.pdb"),
          experimentalPath: resolveFromRoot("examples", "data", "local", "4hhb.pdb"),
        },
      },
      expectedStateMarker: "launch_gate_model",
    };
  }

  return {
    target,
    recipeId: "chimerax-ligand-interaction-explainer",
    actionEnvelope: {
      target,
      summary: "Launch-gate ChimeraX managed-route smoke.",
      actions: [
        { type: "reset_workspace" },
        { type: "open", source: "local", path: fixturePath },
        { type: "style", selection: "#1", ribbon: true },
        { type: "camera", action: "hero_frame", selection: "#1" },
      ],
    },
    captureRequest: {
      target,
      width: 960,
      height: 640,
    },
    workflowRequest: {
      target,
      workflow: "rosetta_top_design_compare",
      presentationMode: "analysis",
      dryRun: true,
      inputs: {
        bundlePath: resolveFromRoot("examples", "data", "local", "rosetta_demo"),
        scorefilePath: resolveFromRoot("examples", "data", "local", "rosetta_demo", "score.sc"),
        referencePath: resolveFromRoot("examples", "data", "local", "rosetta_demo", "reference_scaffold.pdb"),
        topN: 2,
      },
    },
    expectedStateMarker: "1hsg",
  };
}

export async function smokeLaunchPage(url: string, expectedTarget?: TargetKind): Promise<BrowserSmokeResult> {
  const pageUrl = new URL(url);
  const targetParam = pageUrl.searchParams.get("target");
  if (expectedTarget && targetParam !== expectedTarget) {
    throw new Error(`Launch URL target mismatch: expected ${expectedTarget}, received ${targetParam ?? "none"}.`);
  }

  const response = await fetch(pageUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Launch page request failed (${response.status}).`);
  }

  const html = await response.text();
  if (!/<div[^>]+id=["']root["']/i.test(html)) {
    throw new Error("Launch page is missing the root mount node.");
  }

  const assetUrls = await extractLocalLaunchAssetUrls(html, pageUrl.toString());
  if (!assetUrls.length) {
    throw new Error("Launch page did not expose any same-origin JS or CSS assets.");
  }

  const assets: BrowserSmokeResult["assets"] = [];
  for (const assetUrl of assetUrls) {
    const assetResponse = await fetch(assetUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!assetResponse.ok) {
      throw new Error(`Launch asset request failed for ${assetUrl} (${assetResponse.status}).`);
    }
    const bytes = (await assetResponse.arrayBuffer()).byteLength;
    if (bytes <= 0) {
      throw new Error(`Launch asset was empty: ${assetUrl}`);
    }
    assets.push({
      url: assetUrl,
      status: assetResponse.status,
      contentType: assetResponse.headers.get("content-type"),
      bytes,
    });
  }

  return {
    url: pageUrl.toString(),
    target: expectedTarget,
    htmlBytes: Buffer.byteLength(html),
    assetUrls,
    assets,
  };
}

export async function extractLocalLaunchAssetUrls(html: string, pageUrl: string): Promise<string[]> {
  const page = new URL(pageUrl);
  const urls = new Set<string>();

  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    const raw = match[2];
    const assetUrl = new URL(raw, page);
    if (assetUrl.origin !== page.origin) {
      continue;
    }
    if (assetUrl.pathname.startsWith("/api/")) {
      continue;
    }
    urls.add(assetUrl.toString());
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (readHtmlAttribute(tag, "rel") ?? "").toLowerCase();
    if (!rel.includes("stylesheet") && !rel.includes("modulepreload")) {
      continue;
    }

    const raw = readHtmlAttribute(tag, "href");
    if (!raw) {
      continue;
    }

    const assetUrl = new URL(raw, page);
    if (assetUrl.origin !== page.origin) {
      continue;
    }
    if (assetUrl.pathname.startsWith("/api/")) {
      continue;
    }
    urls.add(assetUrl.toString());
  }

  return [...urls];
}

function parseTarget(value: string | undefined): TargetKind {
  if (value === "pymol") {
    return value;
  }
  if (value === "chimera" || value === "chimerax") {
    return "chimerax";
  }
  throw new Error(`Unknown target: ${value ?? "missing"}`);
}

function uniqueTargets(targets: TargetKind[]): TargetKind[] {
  return [...new Set(targets)];
}

function readHtmlAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = tag.match(pattern);
  return match?.[2];
}
