import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureAllowedExportPath,
  ensureAllowedStructureInputPath,
  resolveLocalStructureInputPath,
} from "../../packages/runtime-and-adapters/src/utils/path-policy.js";
import { resolveFromRoot } from "../../packages/runtime-and-adapters/src/utils/paths.js";

describe("path policy", () => {
  afterEach(() => {
    delete process.env.STRUCTURE_ALLOWED_PATHS;
    delete process.env.EXPORT_ALLOWED_PATHS;
  });

  it("rejects structure inputs that escape allowed roots through symlinked directories", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-paths-"));
    const allowedRoot = path.join(tempDir, "allowed");
    const externalRoot = path.join(tempDir, "external");
    const escapedFile = path.join(externalRoot, "secret-model.cif");
    const symlinkDir = path.join(allowedRoot, "models");

    await fs.mkdir(allowedRoot, { recursive: true });
    await fs.mkdir(externalRoot, { recursive: true });
    await fs.writeFile(escapedFile, "data_secret", "utf8");
    await fs.symlink(externalRoot, symlinkDir, "dir");
    process.env.STRUCTURE_ALLOWED_PATHS = allowedRoot;

    try {
      expect(() => ensureAllowedStructureInputPath(path.join(symlinkDir, "secret-model.cif"))).toThrow(/outside the allowed roots/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects export paths that escape allowed roots through symlinked directories", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-exports-"));
    const allowedRoot = path.join(tempDir, "exports");
    const externalRoot = path.join(tempDir, "external");
    const symlinkDir = path.join(allowedRoot, "images");

    await fs.mkdir(allowedRoot, { recursive: true });
    await fs.mkdir(externalRoot, { recursive: true });
    await fs.symlink(externalRoot, symlinkDir, "dir");
    process.env.EXPORT_ALLOWED_PATHS = allowedRoot;

    try {
      expect(() => ensureAllowedExportPath(path.join(symlinkDir, "escaped.png"))).toThrow(/outside the allowed roots/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects structure inputs with control characters in the resolved path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-path-text-"));
    const allowedRoot = path.join(tempDir, "allowed");
    const riskyFile = path.join(allowedRoot, "model\nsmuggle.cif");

    await fs.mkdir(allowedRoot, { recursive: true });
    await fs.writeFile(riskyFile, "data_demo", "utf8");
    process.env.STRUCTURE_ALLOWED_PATHS = allowedRoot;

    try {
      expect(() => ensureAllowedStructureInputPath(riskyFile)).toThrow(/unsupported control characters/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves built-in local structures from common id variants", async () => {
    const fixtureToken = `biovoice${randomUUID().replaceAll("-", "")}`;
    const directStem = `${fixtureToken}-direct`;
    const alphaFoldStem = `${fixtureToken}alpha`;
    const directPath = resolveFromRoot("examples", "data", "local", `${directStem}.pdb`);
    const alphaFoldPath = resolveFromRoot("examples", "data", "local", `af-${alphaFoldStem}.pdb`);
    await fs.mkdir(path.dirname(directPath), { recursive: true });
    await fs.writeFile(directPath, "ATOM\n", { encoding: "utf8", flag: "wx" });
    await fs.writeFile(alphaFoldPath, "ATOM\n", { encoding: "utf8", flag: "wx" });

    try {
      expect(resolveLocalStructureInputPath(undefined, [directStem.toUpperCase()], "structure")).toBe(directPath);
      expect(resolveLocalStructureInputPath(undefined, [alphaFoldStem.toUpperCase()], "structure")).toBe(alphaFoldPath);
      expect(resolveLocalStructureInputPath(undefined, [`af_${alphaFoldStem}`], "structure")).toBe(alphaFoldPath);
    } finally {
      await fs.rm(directPath, { force: true });
      await fs.rm(alphaFoldPath, { force: true });
    }
  });

  it("allows missing explicit paths only for documentation compilation", async () => {
    const missingPath = resolveFromRoot(".runtime", "tests", "path-policy", "missing-doc-input.pdb");
    await fs.rm(missingPath, { force: true });

    expect(() => resolveLocalStructureInputPath(missingPath, [], "structure")).toThrow(/does not exist/i);
    expect(resolveLocalStructureInputPath(
      missingPath,
      [],
      "structure",
      { allowMissingExplicitPath: true },
    )).toBe(missingPath);

    expect(() => resolveLocalStructureInputPath(
      undefined,
      ["__biovoice_missing_implicit_fixture__"],
      "structure",
      { allowMissingExplicitPath: true },
    )).toThrow(/does not exist/i);
  });

  it("keeps root and command-text checks enabled for missing documentation inputs", () => {
    const outsideRoot = path.join(os.tmpdir(), "biovoice-missing-doc-input.pdb");
    const controlCharacterPath = resolveFromRoot(".runtime", "tests", "path-policy", "missing\ndoc-input.pdb");

    expect(() => resolveLocalStructureInputPath(
      outsideRoot,
      [],
      "structure",
      { allowMissingExplicitPath: true },
    )).toThrow(/outside the allowed roots/i);
    expect(() => resolveLocalStructureInputPath(
      controlCharacterPath,
      [],
      "structure",
      { allowMissingExplicitPath: true },
    )).toThrow(/unsupported control characters/i);
  });

  it("rejects dangling symlinks when documentation inputs are missing", async () => {
    const fixtureToken = randomUUID().replaceAll("-", "");
    const fixtureDir = resolveFromRoot(".runtime", "tests", `path-policy-dangling-${fixtureToken}`);
    const danglingPath = path.join(fixtureDir, "model.pdb");
    const missingTarget = path.join(os.tmpdir(), `biovoice-missing-${fixtureToken}.pdb`);
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.symlink(missingTarget, danglingPath);

    try {
      expect(() => resolveLocalStructureInputPath(
        danglingPath,
        [],
        "structure",
        { allowMissingExplicitPath: true },
      )).toThrow(/dangling symbolic link/i);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it("requires explicit opt-in for private structure folders", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-private-root-"));
    const privateFile = path.join(tempDir, "model.pdb");
    await fs.writeFile(privateFile, "ATOM\n", "utf8");
    const canonicalPrivateFile = await fs.realpath(privateFile);

    try {
      expect(() => ensureAllowedStructureInputPath(privateFile)).toThrow(/outside the allowed roots/i);
      process.env.STRUCTURE_ALLOWED_PATHS = tempDir;
      expect(ensureAllowedStructureInputPath(privateFile)).toBe(canonicalPrivateFile);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("still validates explicit local structure paths through the allowed-root policy", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-local-explicit-"));
    const outsideFile = path.join(tempDir, "outside.pdb");
    await fs.writeFile(outsideFile, "ATOM\n", "utf8");

    try {
      expect(() => resolveLocalStructureInputPath(outsideFile, ["4hhb"], "structure")).toThrow(/outside the allowed roots/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects export paths with control characters in the resolved path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-protein-export-text-"));
    const allowedRoot = path.join(tempDir, "exports");
    const riskyPath = path.join(allowedRoot, "capture\nsmuggle.png");

    await fs.mkdir(allowedRoot, { recursive: true });
    process.env.EXPORT_ALLOWED_PATHS = allowedRoot;

    try {
      expect(() => ensureAllowedExportPath(riskyPath)).toThrow(/unsupported control characters/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
