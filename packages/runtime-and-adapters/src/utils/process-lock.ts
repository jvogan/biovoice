import fs from "node:fs/promises";
import path from "node:path";
import { runtimeDir } from "./paths.js";

export async function withProcessLock<T>(
  name: string,
  timeoutMs: number,
  task: () => Promise<T>,
  options?: {
    staleAfterMs?: number;
    pollMs?: number;
  },
): Promise<T> {
  const lockPath = path.join(runtimeDir, `${name}.lock`);
  const deadline = Date.now() + timeoutMs;
  const staleAfterMs = options?.staleAfterMs ?? Math.max(timeoutMs, 60_000);
  const pollMs = options?.pollMs ?? 500;

  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
      try {
        return await task();
      } finally {
        await handle.close().catch(() => {});
        await fs.rm(lockPath, { force: true }).catch(() => {});
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }

      const stale = await isStaleLock(lockPath, staleAfterMs);
      if (stale) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }

      await sleep(pollMs);
    }
  }

  throw new Error(`Timed out waiting for the ${name} lock.`);
}

export async function isProcessLockActive(name: string, options?: { staleAfterMs?: number }): Promise<boolean> {
  const lockPath = path.join(runtimeDir, `${name}.lock`);
  try {
    await fs.access(lockPath);
    if (await isStaleLock(lockPath, options?.staleAfterMs ?? 60_000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const stats = await fs.stat(lockPath);
    if (Date.now() - stats.mtimeMs > staleAfterMs) {
      return true;
    }

    const lockHolderPid = await readLockHolderPid(lockPath);
    if (typeof lockHolderPid === "number" && lockHolderPid > 0 && !isPidAlive(lockHolderPid)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function readLockHolderPid(lockPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
