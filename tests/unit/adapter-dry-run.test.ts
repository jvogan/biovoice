import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChimeraXAdapter } from "../../packages/runtime-and-adapters/src/adapters/chimerax-adapter.js";
import { PymolAdapter } from "../../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";
import { resolveFromRoot } from "../../packages/runtime-and-adapters/src/utils/paths.js";

describe("adapter dry-run compilation", () => {
  const localStructurePath = resolveFromRoot("examples", "data", "local", "1grl.pdb");

  it("compiles PyMOL actions without requiring a live RPC session", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });

    const result = await adapter.execute([
      { type: "preset", name: "pocket_hero" },
      { type: "measure", mode: "angle", selection1: "chain A and resi 25 and name CA", selection2: "chain A and resi 26 and name CA", selection3: "chain A and resi 27 and name CA" },
      { type: "camera", action: "pocket_frame", selection: "organic", buffer: 6 },
    ], true);

    expect(result.logs[0]).toContain("dry-run");
    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      "bg_color gray99",
      "angle angle_measurement, chain A and resi 25 and name CA, chain A and resi 26 and name CA, chain A and resi 27 and name CA",
      "clip slab, 10",
    ]));
  });

  it("compiles clean-slate reset actions for both targets", async () => {
    const pymol = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });
    const chimerax = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    const pymolResult = await pymol.execute([{ type: "reset_workspace" }], true);
    const chimeraxResult = await chimerax.execute([{ type: "reset_workspace" }], true);

    expect(pymolResult.commandsExecuted).toEqual(expect.arrayContaining([
      "reinitialize",
      "scene *, clear",
      "bg_color gray99",
    ]));
    expect(chimeraxResult.commandsExecuted).toEqual(expect.arrayContaining([
      "close all",
      "view delete all",
      "graphics bgColor #FBFBF7",
    ]));
  });

  it("compiles whole-structure transform actions for both targets", async () => {
    const pymol = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });
    const chimerax = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    const pymolResult = await pymol.execute([
      { type: "transform", mode: "translate", selection: { object: "af_prediction" }, axis: "x", amount: 18 },
      { type: "transform", mode: "rotate", selection: { object: "af_prediction" }, axis: "y", amount: 24 },
    ], true);
    const chimeraXResult = await chimerax.execute([
      { type: "transform", mode: "translate", selection: { model: "#2" }, axis: "x", amount: 18 },
      { type: "transform", mode: "rotate", selection: { model: "#2" }, axis: "y", amount: 24 },
    ], true);

    expect(pymolResult.commandsExecuted).toEqual(expect.arrayContaining([
      "translate [18,0,0], object=af_prediction, camera=1",
      "rotate y, 24, object=af_prediction, camera=1",
    ]));
    expect(chimeraXResult.commandsExecuted).toEqual(expect.arrayContaining([
      "move x 18 models #2",
      "turn y 24 center #2 models #2",
    ]));
  });

  it("quotes local input and export paths so real user files with spaces still work", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-"));
    const allowedRoot = path.join(tempDir, "Downloads");
    const localFile = path.join(allowedRoot, "demo folder", "model one.cif");
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, "data_demo", "utf8");
    const canonicalLocalFile = await fs.realpath(localFile);
    process.env.STRUCTURE_ALLOWED_PATHS = allowedRoot;
    try {
      const pymol = new PymolAdapter({
        baseUrl: "http://127.0.0.1",
        startPort: 9123,
        timeoutMs: 8_000,
        renderTimeoutMs: 45_000,
        autolaunch: false,
      });
      const chimerax = new ChimeraXAdapter({
        port: 60958,
        timeoutMs: 30_000,
        autolaunch: false,
      });

      const exportPath = resolveFromRoot("output", "demo still.png");
      const pymolResult = await pymol.execute([
        { type: "load", source: "local", path: localFile, object: "demo_model" },
        { type: "export", export: { format: "png", path: exportPath } },
      ], true);
      const chimeraxResult = await chimerax.execute([
        { type: "open", source: "local", path: localFile },
        { type: "export", export: { format: "png", path: exportPath } },
      ], true);

      expect(pymolResult.commandsExecuted).toEqual(expect.arrayContaining([
        `load "${canonicalLocalFile}", demo_model`,
        `png "${exportPath}", width=3200, height=2100, dpi=350, ray=1`,
      ]));
      expect(chimeraxResult.commandsExecuted).toEqual(expect.arrayContaining([
        `open "${canonicalLocalFile}"`,
        `save "${exportPath}" width 3200 height 2100`,
      ]));
    } finally {
      delete process.env.STRUCTURE_ALLOWED_PATHS;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("derives a stable PyMOL object name from a local filename when the action omits one", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });

    const result = await adapter.execute([
      { type: "load", source: "local", path: resolveFromRoot("examples", "data", "local", "af-p69905.pdb") },
    ], true);

    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      `load "${resolveFromRoot("examples", "data", "local", "af-p69905.pdb")}", af_p69905`,
    ]));
  });

  it("rejects PyMOL align actions that resolve to the same selection", async () => {
    const adapter = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });

    await expect(adapter.execute([
      { type: "align", method: "super", mobile: "all", target: "all" },
    ], true)).rejects.toThrow(/distinct mobile and target selections/i);
  });

  it("compiles ChimeraX actions without requiring a live REST endpoint", async () => {
    const adapter = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    const result = await adapter.execute([
      { type: "preset", name: "comparison_hero" },
      { type: "contacts", mode: "hbonds", selection1: "ligand", selection2: "protein & ligand :< 6" },
      { type: "contacts", mode: "contacts", selection1: "/A", selection2: "/B", distance: 4.0 },
      { type: "measure", mode: "torsion", selection1: "#1:10@N", selection2: "#1:10@CA", selection3: "#1:10@CB", selection4: "#1:10@CG" },
      { type: "view", action: "save", name: "comparison-hero" },
    ], true);

    expect(result.logs[0]).toContain("dry-run");
    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      "lighting full",
      "hbonds ligand restrict \"protein & ligand :< 6\" reveal true showDist true",
      "contacts /A restrict /B distanceOnly 4 reveal true showDist true",
      "torsion #1:10@N #1:10@CA #1:10@CB #1:10@CG",
      "view name comparison-hero",
    ]));
  });

  it("normalizes PyMOL-style grayscale color tokens for ChimeraX", async () => {
    const adapter = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    const result = await adapter.execute([
      { type: "color", color: "gray70", selection: "#1" },
      { type: "color", color: "grey85", selection: "#2" },
    ], true);

    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      "color #1 #B3B3B3",
      "color #2 #D9D9D9",
    ]));
  });

  it("compiles ChimeraX molmap actions into valid molmap plus rename commands", async () => {
    const adapter = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    const result = await adapter.execute([
      { type: "open", source: "local", id: "1grl", path: localStructurePath },
      { type: "volume", action: "molmap", selection: "#1", mapName: "#100", resolution: 6 },
      { type: "volume", action: "mesh", mapName: "#100", level: 0.02 },
    ], true);

    expect(result.commandsExecuted).toEqual(expect.arrayContaining([
      `open "${localStructurePath}"`,
      "molmap #1 6",
      "rename #2 id #100",
      "volume #100 style mesh level 0.02",
    ]));
  });

  it("rejects raw expert commands unless expert mode is enabled", async () => {
    const pymol = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });
    const chimerax = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    await expect(pymol.execute([{ type: "raw_command", command: "print('unsafe')" }], true)).rejects.toThrow(/raw_command is disabled/i);
    await expect(chimerax.execute([{ type: "raw_command", command: "open 1crn" }], true)).rejects.toThrow(/raw_command is disabled/i);

    const expertPymol = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
      enableExpertRawCommands: true,
    });
    const expertChimerax = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
      enableExpertRawCommands: true,
    });

    const expertPymolResult = await expertPymol.execute([{ type: "raw_command", command: "print('expert')" }], true);
    const expertChimeraxResult = await expertChimerax.execute([{ type: "raw_command", command: "open 1crn" }], true);

    expect(expertPymolResult.commandsExecuted).toContain("print('expert')");
    expect(expertChimeraxResult.commandsExecuted).toContain("open 1crn");
  });

  it("rejects export paths outside the allowed export roots", async () => {
    const pymol = new PymolAdapter({
      baseUrl: "http://127.0.0.1",
      startPort: 9123,
      timeoutMs: 8_000,
      renderTimeoutMs: 45_000,
      autolaunch: false,
    });
    const chimerax = new ChimeraXAdapter({
      port: 60958,
      timeoutMs: 30_000,
      autolaunch: false,
    });

    await expect(
      pymol.execute([{ type: "export", export: { format: "png", path: "/tmp/not-allowed-pymol.png" } }], true),
    ).rejects.toThrow(/outside the allowed roots/i);
    await expect(
      chimerax.execute([{ type: "export", export: { format: "png", path: "/tmp/not-allowed-chimerax.png" } }], true),
    ).rejects.toThrow(/outside the allowed roots/i);
  });
});
