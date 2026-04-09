import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isProcessLockActive, withProcessLock } from "../../packages/runtime-and-adapters/src/utils/process-lock.js";
import { runtimeDir } from "../../packages/runtime-and-adapters/src/utils/paths.js";

const lockPath = path.join(runtimeDir, "unit-process-lock.lock");

afterEach(async () => {
  await fs.rm(lockPath, { force: true }).catch(() => {});
});

describe("process locks", () => {
  it("treats dead-holder lock files as inactive immediately", async () => {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: "2026-04-09T00:00:00.000Z",
    }), "utf8");

    await expect(isProcessLockActive("unit-process-lock", { staleAfterMs: 60 * 60 * 1000 })).resolves.toBe(false);
  });

  it("reclaims a dead-holder lock before acquiring it", async () => {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: "2026-04-09T00:00:00.000Z",
    }), "utf8");

    await expect(withProcessLock("unit-process-lock", 1_000, async () => "acquired", {
      staleAfterMs: 60 * 60 * 1000,
      pollMs: 10,
    })).resolves.toBe("acquired");
  });
});
