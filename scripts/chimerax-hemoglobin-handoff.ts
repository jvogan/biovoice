import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ChimeraXAdapter,
  resolveFromRoot,
  runtimeDir,
  type ChimeraXAction,
} from "../packages/runtime-and-adapters/src/index.js";

dotenv.config({ path: resolveFromRoot(".env") });

type BeatId =
  | "tetramer-overview"
  | "alpha-overlay"
  | "heme-close-up"
  | "exploded-compare"
  | "map-fit-overview"
  | "orthoplane-inspection"
  | "final-map-hero";

type CameraCue = {
  action: "turn" | "move";
  axis: "x" | "y" | "z";
  amount: number;
};

type Beat = {
  id: BeatId;
  title: string;
  holdMs: number;
  actions: ChimeraXAction[];
  drift: CameraCue[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const debugExportDir = path.join(runtimeDir, "exports", "chimerax-handoff-direct");
const debugCaptureBeats = process.env.CHIMERAX_HANDOFF_DEBUG_CAPTURE_BEATS === "1";

const dataPaths = {
  experimental: resolveFromRoot("examples", "data", "local", "8wj1.cif"),
  predicted: resolveFromRoot("examples", "data", "local", "af-p69905.pdb"),
  map: resolveFromRoot("examples", "data", "local", "emd_37575.map"),
} as const;

const holdPaddingMs = 32_000;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--plan")) {
    printPlan();
    return;
  }

  await ensureInputs();
  const adapter = buildAdapter();
  await dismissKnownChimeraXErrorDialog();
  await adapter.ensureReady();
  await activateChimeraX();
  await sleep(1_200);

  await runActions(adapter, buildSetupActions());

  for (const beat of buildBeats()) {
    console.log(`[handoff] beat ${beat.id}: ${beat.title}`);
    await runActions(adapter, beat.actions);
    await drift(adapter, beat.holdMs, beat.drift);
    const settleAction = deriveSettleAction(beat.actions);
    if (settleAction) {
      await runActions(adapter, [settleAction]);
      await sleep(1_100);
    }
    if (debugCaptureBeats) {
      await fs.mkdir(debugExportDir, { recursive: true });
      await runActions(adapter, [{
        type: "export",
        export: {
          format: "png",
          path: path.join(debugExportDir, `${beat.id}.png`),
          width: 2200,
          height: 1400,
        },
      }]);
    }
  }

  const finalExportPath = path.join(debugExportDir, "chimerax-hemoglobin-handoff-final.png");
  await fs.mkdir(debugExportDir, { recursive: true });
  await runActions(adapter, [
    { type: "preset", name: "map_hero" },
    {
      type: "export",
      export: {
        format: "png",
        path: finalExportPath,
        width: 2600,
        height: 1700,
      },
    },
  ]);

  console.log(JSON.stringify({
    ok: true,
    beats: buildBeats().map((beat) => beat.id),
    finalExportPath,
  }, null, 2));
}

function buildAdapter() {
  return new ChimeraXAdapter({
    port: Number(process.env.CHIMERAX_REST_PORT ?? 60958),
    timeoutMs: Number(process.env.CHIMERAX_TIMEOUT_MS ?? 30_000),
    autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
    enableExpertRawCommands: true,
  });
}

async function ensureInputs() {
  await Promise.all(Object.entries(dataPaths).map(async ([key, filePath]) => {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error("empty or missing");
      }
    } catch {
      throw new Error(`Missing required ${key} input at ${filePath}. Run \`npm run prepare:data\` first.`);
    }
  }));
}

async function activateChimeraX() {
  await new Promise((resolve) => {
    const child = spawn("osascript", ["-e", 'tell application "ChimeraX" to activate']);
    child.on("error", () => resolve(null));
    child.on("exit", () => resolve(null));
  });
}

async function dismissKnownChimeraXErrorDialog() {
  await new Promise((resolve) => {
    const script = `
      tell application "System Events"
        if exists process "ChimeraX" then
          tell process "ChimeraX"
            try
              if exists button "OK" of window 1 then click button "OK" of window 1
            end try
          end tell
        end if
      end tell
    `;
    const child = spawn("osascript", ["-e", script]);
    child.on("error", () => resolve(null));
    child.on("exit", () => resolve(null));
  });
}

function printPlan() {
  const beats = buildBeats();
  const holdMs = beats.reduce((sum, beat) => sum + beat.holdMs, 0);
  const runtimeMs = holdMs + holdPaddingMs;
  console.log("[chimerax-handoff] plan");
  for (const beat of beats) {
    console.log(`- ${beat.id}: ${beat.title} (${Math.round(beat.holdMs / 1000)}s hold)`);
  }
  console.log(`[chimerax-handoff] intentional hold time: ${Math.round(holdMs / 1000)}s`);
  console.log(`[chimerax-handoff] estimated total runtime: ${(runtimeMs / 60_000).toFixed(1)} min`);
}

async function runActions(adapter: ChimeraXAdapter, actions: ChimeraXAction[]) {
  if (!actions.length) {
    return;
  }
  await adapter.execute(actions as never, false);
  await activateChimeraX();
  await sleep(700);
}

async function drift(adapter: ChimeraXAdapter, totalMs: number, cues: CameraCue[]) {
  if (cues.length === 0) {
    await sleep(totalMs);
    return;
  }

  const intervalMs = Math.max(2_600, Math.floor(totalMs / (cues.length + 1)));
  const remainderMs = Math.max(0, totalMs - intervalMs * (cues.length + 1));

  await sleep(intervalMs);
  for (const cue of cues) {
    await runActions(adapter, [
      cue.action === "turn"
        ? { type: "camera", action: "turn", axis: cue.axis, amount: cue.amount }
        : { type: "camera", action: "move", axis: cue.axis, amount: cue.amount },
    ]);
    await sleep(intervalMs);
  }

  if (remainderMs > 0) {
    await sleep(remainderMs);
  }
}

function buildSetupActions(): ChimeraXAction[] {
  return [
    { type: "reset_workspace" },
    { type: "preset", name: "assembly_editorial" },
    {
      type: "open",
      source: "local",
      id: "8wj1",
      path: dataPaths.experimental,
      semanticRole: "experimental",
      aliases: ["experimental tetramer", "reference tetramer", "whole complex"],
    },
    {
      type: "open",
      source: "local",
      id: "af_p69905",
      path: dataPaths.predicted,
      semanticRole: "predicted",
      aliases: ["predicted alpha chain", "alphafold alpha chain", "prediction"],
    },
    raw("delete solvent"),
    raw("hide protein atoms"),
    { type: "visibility", mode: "hide", selection: "#1" },
    { type: "visibility", mode: "hide", selection: "#2" },
    { type: "style", selection: "#1", ribbon: true },
    { type: "style", selection: "#1 & ligand", atoms: "stick" },
    { type: "style", selection: "#2", ribbon: true },
    { type: "color", scheme: "bychain", selection: "#1" },
    { type: "color", scheme: "byelement", selection: "#1 & ligand" },
    { type: "color", color: "hot pink", selection: "#2" },
    { type: "preset", name: "assembly_editorial" },
    { type: "camera", action: "hero_frame", selection: "#1" },
  ];
}

function buildBeats(): Beat[] {
  return [
    {
      id: "tetramer-overview",
      title: "Establish the experimental tetramer before any comparison work",
      holdMs: 44_000,
      actions: [
        { type: "preset", name: "assembly_editorial" },
        { type: "visibility", mode: "show", selection: "#1" },
        { type: "style", selection: "#1 & ligand", atoms: "stick" },
        { type: "camera", action: "hero_frame", selection: "#1" },
      ],
      drift: driftArc(2.4, 2.2, -0.8, 1.8, 1.8, 0.5, 1.4),
    },
    {
      id: "alpha-overlay",
      title: "Align the AlphaFold alpha chain to experimental chain A",
      holdMs: 42_000,
      actions: [
        { type: "align", method: "matchmaker", mobile: "#2", target: "#1/A" },
        { type: "style", selection: "#1/A:58,87 | #2:58,87 | #1/A & ligand", atoms: "stick" },
        { type: "camera", action: "comparison_frame", selection: "#1/A | #2 | #1/A & ligand" },
      ],
      drift: driftArc(2.1, 2.1, -0.6, 1.6, 1.6, 0.3, 1.1),
    },
    {
      id: "heme-close-up",
      title: "Tighten into the heme neighborhood and local chain-A agreement",
      holdMs: 58_000,
      actions: [
        { type: "visibility", mode: "hide", selection: "#1/B" },
        { type: "label", action: "show", selection: "#1/A:58@CA", text: "His58" },
        { type: "label", action: "show", selection: "#1/A:87@CA", text: "His87" },
        { type: "style", selection: "#1/A:58,87 | #2:58,87 | #1/A & ligand", atoms: "stick" },
        { type: "camera", action: "comparison_frame", selection: "#1/A | #2 | #1/A & ligand" },
      ],
      drift: driftArc(1.9, 1.9, -0.7, 1.4, 1.4, 0.3, -0.2, 1.0),
    },
    {
      id: "exploded-compare",
      title: "Explode the aligned prediction away from the tetramer for a cleaner comparison",
      holdMs: 54_000,
      actions: [
        { type: "label", action: "clear", selection: "#1/A" },
        { type: "transform", mode: "translate", selection: { reference: "predictedModel" }, axis: "x", amount: 18 },
        { type: "transform", mode: "rotate", selection: { reference: "predictedModel" }, axis: "y", amount: 24 },
        { type: "camera", action: "comparison_frame", selection: "#1/A | #2 | #1/A & ligand" },
      ],
      drift: driftArc(1.8, 1.8, -0.5, 1.4, 1.4, 0.2, 0.9),
    },
    {
      id: "map-fit-overview",
      title: "Hand off into the cryo map and validate the fitted whole assembly",
      holdMs: 62_000,
      actions: [
        { type: "camera", action: "clip", clipMode: "off" },
        { type: "visibility", mode: "show", selection: "#1" },
        { type: "close", target: "#2" },
        { type: "open", source: "local", id: "EMD-37575", path: dataPaths.map },
        { type: "volume", action: "mesh", mapName: "#2", level: 2.25 },
        { type: "color", selection: "#2", color: "#87919A" },
        { type: "fit", mobile: "#1", map: "#2" },
        { type: "camera", action: "hero_frame", selection: "#1" },
      ],
      drift: driftArc(2.0, 2.0, -0.6, 1.5, 1.5, 0.4, 1.0),
    },
    {
      id: "orthoplane-inspection",
      title: "Step briefly into orthoplane inspection, then come back out cleanly",
      holdMs: 24_000,
      actions: [
        { type: "volume", action: "orthoplanes", mapName: "#2" },
        { type: "camera", action: "clip", clipMode: "front", amount: 12 },
        { type: "camera", action: "turn", axis: "y", amount: 8 },
        { type: "camera", action: "turn", axis: "x", amount: 4 },
        { type: "volume", action: "mesh", mapName: "#2", level: 2.25 },
        { type: "color", selection: "#2", color: "#87919A" },
        { type: "camera", action: "clip", clipMode: "off" },
      ],
      drift: driftArc(1.1, 1.1, -0.3, 0.8),
    },
    {
      id: "final-map-hero",
      title: "Finish on the local heme-centered map-plus-model hero",
      holdMs: 76_000,
      actions: [
        { type: "preset", name: "map_hero" },
        { type: "visibility", mode: "hide", selection: "#1/B" },
        { type: "style", selection: "#1/A:58,87 | #1/A & ligand", atoms: "stick" },
        { type: "camera", action: "comparison_frame", selection: "#1/A" },
        { type: "camera", action: "turn", axis: "y", amount: 6 },
        { type: "camera", action: "turn", axis: "x", amount: 2 },
        { type: "camera", action: "clip", clipMode: "off" },
        { type: "volume", action: "mesh", mapName: "#2", level: 2.35 },
        { type: "color", selection: "#2", color: "#8A9098" },
      ],
      drift: driftArc(1.7, 1.7, -0.5, 1.3, 1.3, 0.2, 1.0, -0.2),
    },
  ];
}

function driftArc(...amounts: number[]): CameraCue[] {
  return amounts.map((amount, index) => ({
    action: "turn",
    axis: index === 2 || index === 5 || index === 7 ? "x" : "y",
    amount,
  }));
}

function deriveSettleAction(actions: ChimeraXAction[]): ChimeraXAction | null {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action.type !== "camera") {
      continue;
    }
    if (
      action.action === "hero_frame"
      || action.action === "pocket_frame"
      || action.action === "comparison_frame"
      || action.action === "map_cutaway"
      || action.action === "view"
      || action.action === "zoom"
    ) {
      return action;
    }
  }
  return null;
}

function raw(command: string): ChimeraXAction {
  return {
    type: "raw_command",
    command,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
