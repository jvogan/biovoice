import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  PymolAdapter,
  resolveFromRoot,
  runtimeDir,
  type PymolAction,
} from "../packages/runtime-and-adapters/src/index.js";

dotenv.config({ path: resolveFromRoot(".env") });

type ActId = "gpcr" | "kinase" | "protease" | "nuclear";
type BeatId = string;
type CameraCue = {
  action: "turn" | "move";
  axis: "x" | "y" | "z";
  amount: number;
};

type Beat = {
  id: BeatId;
  title: string;
  holdMs: number;
  actions: PymolAction[];
  drift: CameraCue[];
};

type Act = {
  id: ActId;
  pdbId: string;
  objectName: string;
  title: string;
  summary: string;
  setupActions: PymolAction[];
  beats: Beat[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const demoCacheDir = path.join(runtimeDir, "demo-cache", "pdb");
const debugExportDir = path.join(runtimeDir, "exports", "grand-tour");
const titleObject = "__grand_tour_title";
const debugCaptureHeroes = process.env.PYMOL_GRAND_TOUR_DEBUG_CAPTURE === "1";
const debugCaptureBeats = process.env.PYMOL_GRAND_TOUR_DEBUG_CAPTURE_BEATS === "1";

const ACT_ORDER: ActId[] = ["gpcr", "kinase", "protease", "nuclear"];
const ACT_ALIASES: Record<string, ActId> = {
  gpcr: "gpcr",
  "2rh1": "gpcr",
  beta2ar: "gpcr",
  kinase: "kinase",
  "1iep": "kinase",
  abl: "kinase",
  protease: "protease",
  "6lu7": "protease",
  mpro: "protease",
  nuclear: "nuclear",
  "3ert": "nuclear",
  er: "nuclear",
  eralpha: "nuclear",
};

async function main() {
  const args = process.argv.slice(2);
  const planOnly = args.includes("--plan");
  const selectedActs = resolveSelectedActs(args);
  const acts = buildActs();

  if (planOnly) {
    printPlan(acts.filter((act) => selectedActs.includes(act.id)));
    return;
  }

  const cacheMap = await preflightCache(selectedActs);
  const adapter = buildAdapter();

  await activatePymol();
  await sleep(1_200);

  for (const actId of selectedActs) {
    const act = acts.find((item) => item.id === actId);
    if (!act) {
      throw new Error(`Unknown act: ${actId}`);
    }
    const objectPath = cacheMap.get(act.pdbId);
    if (!objectPath) {
      throw new Error(`Missing cached structure for ${act.pdbId}.`);
    }
    await runAct(adapter, injectStructurePaths(act, objectPath));
  }

  console.log(JSON.stringify({
    ok: true,
    acts: selectedActs,
    cacheDir: demoCacheDir,
  }, null, 2));
}

function buildAdapter() {
  return new PymolAdapter({
    rpcUrl: process.env.PYMOL_RPC_URL,
    baseUrl: process.env.PYMOL_RPC_BASE_URL ?? "http://127.0.0.1",
    startPort: Number(process.env.PYMOL_RPC_START_PORT ?? 9123),
    timeoutMs: Number(process.env.PYMOL_TIMEOUT_MS ?? 8_000),
    renderTimeoutMs: Number(process.env.PYMOL_RENDER_TIMEOUT_MS ?? 120_000),
    autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
    enableExpertRawCommands: true,
  });
}

async function activatePymol() {
  await new Promise((resolve) => {
    const child = spawn("osascript", ["-e", 'tell application "PyMOL" to activate']);
    child.on("error", () => resolve(null));
    child.on("exit", () => resolve(null));
  });
}

function resolveSelectedActs(args: string[]): ActId[] {
  const actIndex = args.indexOf("--act");
  if (actIndex === -1) {
    return [...ACT_ORDER];
  }

  const rawValue = args[actIndex + 1];
  if (!rawValue) {
    throw new Error(`--act requires a value. Valid acts: ${ACT_ORDER.join(", ")}`);
  }

  const resolved = rawValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => {
      const act = ACT_ALIASES[value];
      if (!act) {
        throw new Error(`Unknown act "${value}". Valid acts: ${ACT_ORDER.join(", ")}`);
      }
      return act;
    });

  return Array.from(new Set(resolved));
}

function printPlan(acts: Act[]) {
  const holdMs = acts.reduce((sum, act) => sum + titleHoldMs + act.beats.reduce((beatSum, beat) => beatSum + beat.holdMs, 0), 0);
  const estimatedRuntimeMs = holdMs + acts.length * transitionBudgetMsPerAct;

  console.log("[grand-tour] plan");
  for (const act of acts) {
    const actHoldMs = titleHoldMs + act.beats.reduce((sum, beat) => sum + beat.holdMs, 0);
    console.log(`- ${act.id} | ${act.pdbId} | ${act.title} | hold ${Math.round(actHoldMs / 1000)}s`);
    for (const beat of act.beats) {
      console.log(`  - ${beat.id}: ${beat.title} (${Math.round(beat.holdMs / 1000)}s)`);
    }
  }
  console.log(`[grand-tour] intentional hold time: ${Math.round(holdMs / 1000)}s`);
  console.log(`[grand-tour] estimated total runtime: ${(estimatedRuntimeMs / 60_000).toFixed(1)} min`);
}

async function preflightCache(actIds: ActId[]): Promise<Map<string, string>> {
  await fs.mkdir(demoCacheDir, { recursive: true });
  const requiredPdbIds = Array.from(new Set(
    buildActs()
      .filter((act) => actIds.includes(act.id))
      .map((act) => act.pdbId),
  ));
  const cacheMap = new Map<string, string>();

  for (const pdbId of requiredPdbIds) {
    const filePath = path.join(demoCacheDir, `${pdbId}.pdb`);
    const usable = await hasUsableCacheFile(filePath);
    if (!usable) {
      await fetchPdbToCache(pdbId, filePath);
    }
    cacheMap.set(pdbId, filePath);
  }

  return cacheMap;
}

async function hasUsableCacheFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 10_000;
  } catch {
    return false;
  }
}

async function fetchPdbToCache(pdbId: string, filePath: string): Promise<void> {
  const response = await fetch(`https://files.rcsb.org/download/${pdbId}.pdb`, {
    headers: {
      "user-agent": "biovoice-grand-tour/1.0",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${pdbId} from RCSB: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text.includes("ATOM") && !text.includes("HETATM")) {
    throw new Error(`Fetched ${pdbId}, but the payload did not look like a PDB file.`);
  }

  await fs.writeFile(filePath, text, "utf8");
}

function injectStructurePaths(act: Act, structurePath: string): Act {
  const injectPath = (action: PymolAction): PymolAction => {
    if (action.type === "load" && action.source === "local" && !action.path) {
      return {
        ...action,
        path: structurePath,
      };
    }
    return action;
  };

  return {
    ...act,
    setupActions: act.setupActions.map(injectPath),
    beats: act.beats.map((beat) => ({
      ...beat,
      actions: beat.actions.map(injectPath),
    })),
  };
}

async function runAct(adapter: PymolAdapter, act: Act) {
  console.log(`[grand-tour] act ${act.id}: ${act.title}`);
  await runActions(adapter, act.setupActions);
  await showTitle(adapter, act.title);
  for (const beat of act.beats) {
    console.log(`[grand-tour] beat ${act.id}/${beat.id}: ${beat.title}`);
    await runActions(adapter, beat.actions);
    await drift(adapter, beat.holdMs, beat.drift);
    const settleAction = deriveSettleAction(beat.actions);
    if (settleAction) {
      await runActions(adapter, [settleAction]);
      await sleep(1_400);
    }
    if (debugCaptureBeats) {
      await fs.mkdir(debugExportDir, { recursive: true });
      await runActions(adapter, [{
        type: "export",
        export: {
          format: "png",
          path: path.join(debugExportDir, `${act.id}-${beat.id}.png`),
          width: 2200,
          height: 1400,
          rayTrace: false,
        },
      }]);
    }
  }
  if (debugCaptureHeroes) {
    await fs.mkdir(debugExportDir, { recursive: true });
    await runActions(adapter, [{
      type: "export",
      export: {
        format: "png",
        path: path.join(debugExportDir, `${act.id}.png`),
        width: 2200,
        height: 1400,
        rayTrace: false,
      },
    }]);
  }
}

async function runActions(adapter: PymolAdapter, actions: PymolAction[]) {
  if (actions.length === 0) {
    return;
  }
  await adapter.execute(actions, false);
  await activatePymol();
  await sleep(600);
}

async function showTitle(adapter: PymolAdapter, title: string) {
  await runActions(adapter, [
    ...titleCardActions(title),
  ]);
  await sleep(titleHoldMs);
  await runActions(adapter, [raw(`delete ${titleObject}`)]);
}

async function drift(adapter: PymolAdapter, totalMs: number, cues: CameraCue[]) {
  if (cues.length === 0) {
    await sleep(totalMs);
    return;
  }

  const intervalMs = Math.max(2_300, Math.floor(totalMs / (cues.length + 1)));
  const remainderMs = Math.max(0, totalMs - intervalMs * (cues.length + 1));

  await sleep(intervalMs);
  for (const cue of cues) {
    await runActions(adapter, [
      cue.action === "turn"
        ? { type: "camera", action: "turn", axis: cue.axis, degrees: cue.amount }
        : { type: "camera", action: "move", axis: cue.axis, amount: cue.amount },
    ]);
    await sleep(intervalMs);
  }

  if (remainderMs > 0) {
    await sleep(remainderMs);
  }
}

function buildActs(): Act[] {
  return [
    buildGpcrAct(),
    buildKinaseAct(),
    buildProteaseAct(),
    buildNuclearAct(),
  ];
}

function buildGpcrAct(): Act {
  return {
    id: "gpcr",
    pdbId: "2RH1",
    objectName: "gpcr_b2ar",
    title: "GPCR antagonist pocket | beta2AR / carazolol",
    summary: "beta-2 adrenergic receptor with carazolol in the orthosteric cavity",
    setupActions: [
      { type: "reset_workspace" },
      ...globalPaletteActions(),
      { type: "preset", name: "ligand_editorial" },
      { type: "load", source: "local", object: "gpcr_b2ar", semanticRole: "receptor" },
      raw("remove gpcr_b2ar and solvent"),
      raw("remove gpcr_b2ar and not (polymer.protein or resn CAU)"),
      raw("remove gpcr_b2ar and resi 1002-1161"),
      { type: "select", name: "gpcr_receptor", selection: "gpcr_b2ar and polymer.protein" },
      { type: "select", name: "gpcr_ligand", selection: "gpcr_b2ar and resn CAU" },
      { type: "select", name: "gpcr_pocket", selection: "byres (gpcr_receptor within 4.8 of gpcr_ligand)" },
      { type: "select", name: "gpcr_anchor", selection: "gpcr_b2ar and resi 113+203+312" },
      { type: "hide", representations: ["everything"] },
      { type: "show", representations: ["cartoon"], selection: "gpcr_receptor" },
      { type: "show", representations: ["sticks"], selection: "gpcr_ligand" },
      { type: "color", selection: "gpcr_receptor", color: "gt_receptor_blue" },
      { type: "color", selection: "gpcr_ligand", color: "gt_ligand_orange" },
      { type: "setting", name: "cartoon_transparency", value: 0.03, selection: "gpcr_receptor" },
      { type: "camera", action: "orient", selection: "gpcr_receptor" },
      { type: "camera", action: "zoom", selection: "gpcr_receptor", buffer: 8 },
    ],
    beats: [
      {
        id: "establish",
        title: "Establish the receptor body and ligand depth",
        holdMs: 22_000,
        actions: [
          { type: "hide", representations: ["surface", "sticks"], selection: "gpcr_pocket" },
          { type: "show", representations: ["sticks"], selection: "gpcr_ligand" },
          { type: "camera", action: "hero_frame", selection: "gpcr_receptor", buffer: 7 },
        ],
        drift: driftArc(3, 3, -1.2, 2.5, 2.5, 0.6),
      },
      {
        id: "reveal",
        title: "Cut into the orthosteric cavity before the close chemistry view",
        holdMs: 20_000,
        actions: [
          { type: "surface", selection: "gpcr_receptor", transparency: 0.9, color: "gt_receptor_blue" },
          { type: "show", representations: ["sticks"], selection: "gpcr_anchor and sidechain" },
          { type: "color", selection: "gpcr_anchor and sidechain", color: "gt_pocket_sand" },
          { type: "camera", action: "comparison_frame", selection: "gpcr_pocket", buffer: 10.5 },
          { type: "camera", action: "clip", clipMode: "slab", amount: 11, selection: "gpcr_pocket" },
        ],
        drift: driftArc(2.2, 2.2, -0.6, 1.6, 1.4, 0.3),
      },
      {
        id: "focus",
        title: "Reveal the orthosteric cavity around carazolol",
        holdMs: 35_000,
        actions: [
          { type: "hide", representations: ["surface"], selection: "gpcr_receptor" },
          { type: "show", representations: ["sticks"], selection: "gpcr_pocket and sidechain" },
          { type: "color", selection: "gpcr_pocket and sidechain", color: "gt_pocket_sand" },
          { type: "surface", selection: "gpcr_pocket", transparency: 0.62, color: "gt_pocket_ice" },
          { type: "measure", mode: "polar_contacts", name: "gpcr_hbonds", selection1: "gpcr_anchor", selection2: "gpcr_ligand", cutoff: 3.7 },
          { type: "label", action: "show", selection: "gpcr_b2ar and resi 113 and name CA", text: "Asp113" },
          { type: "label", action: "show", selection: "gpcr_b2ar and resi 203 and name CA", text: "Ser203" },
          { type: "label", action: "show", selection: "gpcr_b2ar and resi 312 and name CA", text: "Asn312" },
          { type: "camera", action: "pocket_frame", selection: "gpcr_pocket", buffer: 10 },
        ],
        drift: driftArc(2.5, 2.5, -0.8, 2, 1.8, 0.4, -0.3),
      },
      {
        id: "interpret",
        title: "Tighten the cavity and quiet the labels",
        holdMs: 36_000,
        actions: [
          raw("delete gpcr_hbonds"),
          { type: "setting", name: "transparency", value: 0.72, selection: "gpcr_pocket" },
          { type: "hide", representations: ["sticks"], selection: "gpcr_pocket and sidechain and not resi 113+203+312" },
          { type: "camera", action: "clip", clipMode: "slab", amount: 3, selection: "gpcr_pocket" },
          { type: "camera", action: "pocket_frame", selection: "gpcr_ligand", buffer: 8 },
        ],
        drift: driftArc(2, 2, -0.8, 1.5, 1.5, -0.2),
      },
      {
        id: "hero",
        title: "Hold the final GPCR pocket hero",
        holdMs: 45_000,
        actions: [
          raw("delete gpcr_hbonds"),
          { type: "label", action: "clear", selection: "gpcr_receptor" },
          { type: "show", representations: ["sticks"], selection: "gpcr_pocket and sidechain and resi 113+203+312" },
          { type: "camera", action: "clip", clipMode: "slab", amount: 7, selection: "gpcr_pocket" },
          { type: "camera", action: "pocket_frame", selection: "gpcr_pocket", buffer: 8 },
        ],
        drift: driftArc(1.8, 1.8, -0.6, 1.6, 1.6, 0.2, 1.4),
      },
    ],
  };
}

function buildKinaseAct(): Act {
  return {
    id: "kinase",
    pdbId: "1IEP",
    objectName: "abl_imatinib",
    title: "Kinase inhibitor state | Abl / imatinib",
    summary: "Abl kinase domain captured in the imatinib-bound inactive state",
    setupActions: [
      { type: "reset_workspace" },
      ...globalPaletteActions(),
      { type: "preset", name: "comparison_hero" },
      { type: "load", source: "local", object: "abl_imatinib", semanticRole: "receptor" },
      raw("remove abl_imatinib and chain B"),
      raw("remove abl_imatinib and solvent"),
      raw("remove abl_imatinib and resn CL"),
      { type: "select", name: "abl_protein", selection: "abl_imatinib and chain A and polymer.protein" },
      { type: "select", name: "abl_ligand", selection: "abl_imatinib and chain A and resn STI" },
      { type: "select", name: "abl_n_lobe", selection: "abl_protein and resi 225-312" },
      { type: "select", name: "abl_c_lobe", selection: "abl_protein and resi 313-500" },
      { type: "select", name: "abl_activation_loop", selection: "abl_protein and resi 381-402" },
      { type: "select", name: "abl_hinge", selection: "abl_protein and resi 315-320" },
      { type: "select", name: "abl_key_residues", selection: "abl_protein and resi 315+318+381+382" },
      { type: "select", name: "abl_pocket", selection: "byres (abl_protein within 4.6 of abl_ligand)" },
      { type: "select", name: "abl_context", selection: "(byres (abl_protein within 7.5 of abl_ligand)) or abl_activation_loop or abl_hinge" },
      { type: "select", name: "abl_anchor", selection: "abl_hinge or abl_key_residues" },
      { type: "hide", representations: ["everything"] },
      { type: "show", representations: ["cartoon"], selection: "abl_protein" },
      { type: "show", representations: ["sticks"], selection: "abl_ligand" },
      { type: "color", selection: "abl_n_lobe", color: "gt_kinase_nlobe" },
      { type: "color", selection: "abl_c_lobe", color: "gt_kinase_clobe" },
      { type: "color", selection: "abl_activation_loop", color: "gt_loop_gold" },
      { type: "color", selection: "abl_ligand", color: "gt_ligand_magenta" },
      { type: "camera", action: "orient", selection: "abl_protein" },
      { type: "camera", action: "zoom", selection: "abl_protein", buffer: 8 },
    ],
    beats: [
      {
        id: "establish",
        title: "Show the bilobed kinase architecture",
        holdMs: 22_000,
        actions: [
          { type: "camera", action: "hero_frame", selection: "abl_protein", buffer: 8 },
        ],
        drift: driftArc(3.2, 3.2, -1.2, 2.4, 2.4, 0.8),
      },
      {
        id: "cleft",
        title: "Inspect the ATP cleft before pushing into the inhibitor pocket",
        holdMs: 20_000,
        actions: [
          { type: "show", representations: ["sticks"], selection: "abl_hinge and sidechain or abl_activation_loop and sidechain" },
          { type: "color", selection: "abl_hinge and sidechain", color: "gt_loop_gold" },
          { type: "surface", selection: "abl_pocket", transparency: 0.8, color: "gt_pocket_ice" },
          { type: "camera", action: "comparison_frame", selection: "abl_context", buffer: 9.5 },
          { type: "camera", action: "clip", clipMode: "slab", amount: 10, selection: "abl_context" },
        ],
        drift: driftArc(2.1, 2.1, -0.5, 1.4, 1.4, 0.2),
      },
      {
        id: "focus",
        title: "Bring the imatinib pocket into view",
        holdMs: 35_000,
        actions: [
          { type: "hide", representations: ["surface"], selection: "abl_pocket" },
          { type: "show", representations: ["sticks"], selection: "abl_key_residues and sidechain" },
          { type: "color", selection: "abl_key_residues and sidechain", color: "gt_loop_gold" },
          { type: "surface", selection: "abl_pocket", transparency: 0.68, color: "gt_pocket_ice" },
          { type: "measure", mode: "polar_contacts", name: "abl_hbonds", selection1: "abl_ligand", selection2: "abl_anchor", cutoff: 3.8 },
          { type: "label", action: "show", selection: "abl_imatinib and chain A and resi 315 and name CA", text: "Thr315" },
          { type: "label", action: "show", selection: "abl_imatinib and chain A and resi 381 and name CA", text: "Asp381" },
          { type: "camera", action: "comparison_frame", selection: "abl_context", buffer: 8 },
        ],
        drift: driftArc(2.2, 2.2, -0.8, 1.8, 1.8, 0.4, -0.3),
      },
      {
        id: "interpret",
        title: "Emphasize the inactive kinase conformation",
        holdMs: 36_000,
        actions: [
          raw("delete abl_hbonds"),
          { type: "label", action: "clear", selection: "abl_protein" },
          { type: "hide", representations: ["surface"], selection: "abl_pocket" },
          { type: "hide", representations: ["sticks"], selection: "abl_pocket and sidechain and not abl_anchor" },
          { type: "show", representations: ["sticks"], selection: "abl_ligand or abl_anchor and sidechain or abl_activation_loop and sidechain" },
          { type: "camera", action: "comparison_frame", selection: "abl_context", buffer: 8 },
        ],
        drift: driftArc(2, 2, -0.7, 1.5, 1.5, -0.3),
      },
      {
        id: "hero",
        title: "Hold the Abl / imatinib editorial frame",
        holdMs: 45_000,
        actions: [
          raw("delete abl_hbonds"),
          { type: "label", action: "clear", selection: "abl_protein" },
          { type: "hide", representations: ["surface"], selection: "abl_pocket" },
          { type: "hide", representations: ["sticks"], selection: "abl_pocket and sidechain" },
          { type: "hide", representations: ["sticks"], selection: "abl_activation_loop" },
          { type: "show", representations: ["sticks"], selection: "abl_ligand or abl_hinge and sidechain" },
          { type: "camera", action: "comparison_frame", selection: "abl_context", buffer: 7.5 },
        ],
        drift: driftArc(1.6, 1.6, -0.5, 1.5, 1.5, 0.2, 1.1),
      },
    ],
  };
}

function buildProteaseAct(): Act {
  return {
    id: "protease",
    pdbId: "6LU7",
    objectName: "mpro_n3",
    title: "Protease chemistry | SARS-CoV-2 Mpro / N3",
    summary: "Main protease active-site chemistry with the covalent peptidomimetic inhibitor",
    setupActions: [
      { type: "reset_workspace" },
      ...globalPaletteActions(),
      { type: "preset", name: "ligand_editorial" },
      { type: "load", source: "local", object: "mpro_n3", semanticRole: "receptor" },
      raw("remove mpro_n3 and solvent"),
      raw("remove mpro_n3 and not (((chain A or chain B) and polymer.protein) or chain C)"),
      { type: "select", name: "mpro_protein", selection: "mpro_n3 and chain A and polymer.protein" },
      { type: "select", name: "mpro_partner", selection: "mpro_n3 and chain B and polymer.protein" },
      { type: "select", name: "mpro_ligand", selection: "mpro_n3 and chain C" },
      { type: "select", name: "mpro_dyad", selection: "mpro_n3 and chain A and resi 41+145" },
      { type: "select", name: "mpro_pocket", selection: "byres (mpro_protein within 4.8 of mpro_ligand)" },
      { type: "select", name: "mpro_context", selection: "(byres (mpro_protein within 7.5 of mpro_ligand)) or mpro_dyad" },
      { type: "select", name: "mpro_anchor", selection: "mpro_dyad or mpro_pocket and resi 163+166+187+189" },
      { type: "hide", representations: ["everything"] },
      { type: "show", representations: ["cartoon"], selection: "mpro_protein" },
      { type: "show", representations: ["cartoon"], selection: "mpro_partner" },
      { type: "show", representations: ["sticks"], selection: "mpro_ligand" },
      { type: "show", representations: ["sticks"], selection: "mpro_dyad and sidechain" },
      { type: "color", selection: "mpro_protein", color: "gt_protease_body" },
      { type: "color", selection: "mpro_partner", color: "gt_partner_fog" },
      { type: "color", selection: "mpro_ligand", color: "gt_ligand_orange" },
      { type: "color", selection: "mpro_dyad and sidechain", color: "gt_ligand_magenta" },
      { type: "setting", name: "cartoon_transparency", value: 0.68, selection: "mpro_partner" },
      { type: "camera", action: "orient", selection: "mpro_protein" },
      { type: "camera", action: "zoom", selection: "mpro_protein", buffer: 7 },
    ],
    beats: [
      {
        id: "establish",
        title: "Set the inhibitor inside the protease dimer context",
        holdMs: 22_000,
        actions: [
          { type: "camera", action: "hero_frame", selection: "mpro_protein or mpro_partner", buffer: 7.5 },
        ],
        drift: driftArc(3, 3, -1.1, 2.3, 2.3, 0.7),
      },
      {
        id: "handoff",
        title: "Fade the partner and hand the eye into the active site",
        holdMs: 20_000,
        actions: [
          { type: "hide", representations: ["cartoon"], selection: "mpro_partner" },
          { type: "camera", action: "comparison_frame", selection: "mpro_context", buffer: 9 },
          { type: "camera", action: "clip", clipMode: "slab", amount: 10, selection: "mpro_context" },
        ],
        drift: driftArc(2.1, 2.1, -0.5, 1.5, 1.5, 0.2),
      },
      {
        id: "focus",
        title: "Zoom into the catalytic dyad and ligand occupancy",
        holdMs: 35_000,
        actions: [
          { type: "show", representations: ["sticks"], selection: "mpro_pocket and sidechain" },
          { type: "color", selection: "mpro_pocket and sidechain", color: "gt_pocket_sage" },
          { type: "surface", selection: "mpro_pocket", transparency: 0.66, color: "gt_pocket_ice" },
          { type: "measure", mode: "polar_contacts", name: "mpro_hbonds", selection1: "mpro_ligand", selection2: "mpro_anchor", cutoff: 3.8 },
          { type: "label", action: "show", selection: "mpro_n3 and chain A and resi 41 and name CA", text: "His41" },
          { type: "label", action: "show", selection: "mpro_n3 and chain A and resi 145 and name CA", text: "Cys145" },
          { type: "camera", action: "pocket_frame", selection: "mpro_pocket", buffer: 10 },
        ],
        drift: driftArc(2.3, 2.3, -0.7, 1.8, 1.8, 0.4, -0.2),
      },
      {
        id: "interpret",
        title: "Broaden the view while keeping the chemistry legible",
        holdMs: 36_000,
        actions: [
          raw("delete mpro_hbonds"),
          { type: "hide", representations: ["sticks"], selection: "mpro_pocket and sidechain and not mpro_dyad" },
          { type: "setting", name: "transparency", value: 0.74, selection: "mpro_pocket" },
          { type: "show", representations: ["sticks"], selection: "mpro_anchor and sidechain" },
          { type: "camera", action: "comparison_frame", selection: "mpro_context", buffer: 8.5 },
        ],
        drift: driftArc(2, 2, -0.5, 1.5, 1.5, -0.2),
      },
      {
        id: "hero",
        title: "Hold the Mpro active-site hero frame",
        holdMs: 45_000,
        actions: [
          raw("delete mpro_hbonds"),
          { type: "label", action: "clear", selection: "mpro_protein" },
          { type: "surface", selection: "mpro_pocket", transparency: 0.8, color: "gt_pocket_ice" },
          { type: "hide", representations: ["sticks"], selection: "mpro_pocket and sidechain and not mpro_anchor" },
          { type: "show", representations: ["sticks"], selection: "mpro_ligand or mpro_dyad and sidechain" },
          { type: "camera", action: "comparison_frame", selection: "mpro_context", buffer: 7.5 },
        ],
        drift: driftArc(1.7, 1.7, -0.5, 1.6, 1.6, 0.2, 1.2),
      },
    ],
  };
}

function buildNuclearAct(): Act {
  return {
    id: "nuclear",
    pdbId: "3ERT",
    objectName: "er_oht",
    title: "Nuclear receptor antagonist | ER alpha / 4-hydroxytamoxifen",
    summary: "Estrogen receptor alpha ligand-binding domain with helix-12 displacement",
    setupActions: [
      { type: "reset_workspace" },
      ...globalPaletteActions(),
      { type: "preset", name: "ligand_editorial" },
      { type: "load", source: "local", object: "er_oht", semanticRole: "receptor" },
      raw("remove er_oht and solvent"),
      raw("remove er_oht and not (polymer.protein or resn OHT)"),
      { type: "select", name: "er_protein", selection: "er_oht and chain A and polymer.protein" },
      { type: "select", name: "er_ligand", selection: "er_oht and resn OHT" },
      { type: "select", name: "er_h12", selection: "er_protein and resi 538-548" },
      { type: "select", name: "er_contacts", selection: "byres (er_protein within 3.9 of er_ligand)" },
      { type: "select", name: "er_pocket", selection: "byres (er_protein within 4.8 of er_ligand)" },
      { type: "select", name: "er_context", selection: "er_pocket or er_h12" },
      { type: "hide", representations: ["everything"] },
      { type: "show", representations: ["cartoon"], selection: "er_protein" },
      { type: "show", representations: ["sticks"], selection: "er_ligand" },
      { type: "color", selection: "er_protein", color: "gt_er_body" },
      { type: "color", selection: "er_h12", color: "gt_ligand_magenta" },
      { type: "color", selection: "er_ligand", color: "gt_ligand_gold" },
      { type: "camera", action: "orient", selection: "er_protein" },
      { type: "camera", action: "zoom", selection: "er_protein", buffer: 7 },
    ],
    beats: [
      {
        id: "establish",
        title: "Set the ligand-binding domain and helix 12 context",
        holdMs: 22_000,
        actions: [
          { type: "camera", action: "hero_frame", selection: "er_protein", buffer: 7 },
        ],
        drift: driftArc(2.8, 2.8, -1.0, 2.1, 2.1, 0.6),
      },
      {
        id: "sweep",
        title: "Sweep across helix 12 before dropping into the ligand pocket",
        holdMs: 20_000,
        actions: [
          { type: "show", representations: ["sticks"], selection: "er_h12 and sidechain" },
          { type: "surface", selection: "er_pocket", transparency: 0.8, color: "gt_rose_shell" },
          { type: "camera", action: "comparison_frame", selection: "er_context", buffer: 9.5 },
          { type: "camera", action: "clip", clipMode: "slab", amount: 10, selection: "er_context" },
        ],
        drift: driftArc(2.0, 2.0, -0.6, 1.5, 1.5, 0.2),
      },
      {
        id: "focus",
        title: "Bring OHT and the antagonist pocket into view",
        holdMs: 35_000,
        actions: [
          { type: "show", representations: ["sticks"], selection: "er_contacts and sidechain" },
          { type: "color", selection: "er_contacts and sidechain", color: "gt_pocket_sand" },
          { type: "surface", selection: "er_pocket", transparency: 0.68, color: "gt_rose_shell" },
          { type: "camera", action: "pocket_frame", selection: "er_pocket", buffer: 10 },
        ],
        drift: driftArc(2.1, 2.1, -0.7, 1.7, 1.7, 0.4, -0.2),
      },
      {
        id: "interpret",
        title: "Shape the antagonist pose and helix-12 relationship",
        holdMs: 36_000,
        actions: [
          { type: "hide", representations: ["surface"], selection: "er_pocket" },
          { type: "hide", representations: ["sticks"], selection: "er_contacts and sidechain" },
          { type: "show", representations: ["sticks"], selection: "er_ligand or er_h12 and sidechain" },
          { type: "camera", action: "comparison_frame", selection: "er_context", buffer: 10.5 },
        ],
        drift: driftArc(1.9, 1.9, -0.5, 1.5, 1.5, -0.2),
      },
      {
        id: "hero",
        title: "Hold the ER alpha antagonist finale",
        holdMs: 47_000,
        actions: [
          { type: "label", action: "clear", selection: "er_protein" },
          { type: "hide", representations: ["surface"], selection: "er_pocket" },
          { type: "hide", representations: ["sticks"], selection: "er_pocket and sidechain" },
          { type: "hide", representations: ["sticks"], selection: "er_h12 and sidechain" },
          { type: "show", representations: ["sticks"], selection: "er_ligand" },
          { type: "camera", action: "hero_frame", selection: "er_protein", buffer: 5.5 },
        ],
        drift: driftArc(1.6, 1.6, -0.5, 1.4, 1.4, 0.2, 1.2),
      },
    ],
  };
}

function globalPaletteActions(): PymolAction[] {
  const colors: Array<[string, [number, number, number]]> = [
    ["gt_title_ink", [0.12, 0.14, 0.18]],
    ["gt_title_outline", [0.97, 0.98, 1.0]],
    ["gt_receptor_blue", [0.22, 0.39, 0.63]],
    ["gt_ligand_orange", [0.97, 0.60, 0.22]],
    ["gt_ligand_gold", [0.92, 0.74, 0.22]],
    ["gt_ligand_magenta", [0.83, 0.30, 0.54]],
    ["gt_pocket_ice", [0.72, 0.88, 0.93]],
    ["gt_pocket_sand", [0.84, 0.79, 0.70]],
    ["gt_pocket_sage", [0.62, 0.75, 0.60]],
    ["gt_kinase_nlobe", [0.55, 0.72, 0.85]],
    ["gt_kinase_clobe", [0.43, 0.56, 0.73]],
    ["gt_loop_gold", [0.89, 0.70, 0.26]],
    ["gt_protease_body", [0.51, 0.61, 0.67]],
    ["gt_partner_fog", [0.78, 0.81, 0.84]],
    ["gt_er_body", [0.80, 0.77, 0.70]],
    ["gt_rose_shell", [0.90, 0.76, 0.82]],
  ];

  return colors.map(([name, [r, g, b]]) => raw(`set_color ${name}, [${r}, ${g}, ${b}]`));
}

function titleCardActions(title: string): PymolAction[] {
  return [
    raw(`delete ${titleObject}`),
    raw(`pseudoatom ${titleObject}`),
    raw(`hide everything, ${titleObject}`),
    raw(`label ${titleObject}, "${escapeForPymolLabel(title)}"`),
    raw(`set label_size, 26, ${titleObject}`),
    raw(`set label_color, gt_title_ink, ${titleObject}`),
    raw(`set label_outline_color, gt_title_outline, ${titleObject}`),
    raw(`set label_position, [0, 24, 0], ${titleObject}`),
    raw(`show labels, ${titleObject}`),
  ];
}

function raw(command: string): PymolAction {
  return {
    type: "raw_command",
    command,
  };
}

function driftArc(...amounts: number[]): CameraCue[] {
  return amounts.map((amount, index) => ({
    action: "turn",
    axis: index === 2 || index === 5 ? "x" : "y",
    amount,
  }));
}

function deriveSettleAction(actions: PymolAction[]): PymolAction | null {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action.type !== "camera") {
      continue;
    }

    if (action.action === "hero_frame" || action.action === "pocket_frame" || action.action === "comparison_frame" || action.action === "zoom" || action.action === "orient") {
      return action;
    }
  }

  return null;
}

function escapeForPymolLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

const titleHoldMs = 2_600;
const transitionBudgetMsPerAct = 45_000;

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
