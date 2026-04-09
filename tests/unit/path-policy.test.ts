import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureAllowedExportPath,
  ensureAllowedStructureInputPath,
} from "../../packages/runtime-and-adapters/src/utils/path-policy.js";

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
