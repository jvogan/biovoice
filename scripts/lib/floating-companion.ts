import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveFromRoot, type TargetKind } from "../../packages/runtime-and-adapters/src/index.js";

export type FloatingCompanionState = {
  pid: number;
  target: TargetKind;
  url: string;
  logPath: string;
  startedAt: string;
};

export async function launchFloatingCompanion(input: {
  target: TargetKind;
  url: string;
}): Promise<FloatingCompanionState> {
  const electronCommand = resolveElectronCommand();
  const entryPath = resolveFromRoot("apps", "floating-companion", "main.mjs");
  const logsDir = resolveFromRoot(".runtime", "floating-companion");
  await fsPromises.mkdir(logsDir, { recursive: true });

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const logPath = path.join(logsDir, `${input.target}-${timestamp}.log`);
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(
    electronCommand,
    [
      entryPath,
      `--url=${input.url}`,
      `--target=${input.target}`,
    ],
    {
      cwd: resolveFromRoot(),
      env: process.env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );

  child.unref();
  fs.closeSync(logFd);

  return {
    pid: child.pid ?? -1,
    target: input.target,
    url: input.url,
    logPath,
    startedAt: new Date().toISOString(),
  };
}

export async function stopFloatingCompanion(companion: FloatingCompanionState | undefined | null): Promise<void> {
  if (!companion?.pid || companion.pid <= 0) {
    return;
  }

  if (!await isPidAlive(companion.pid)) {
    return;
  }

  process.kill(companion.pid, "SIGTERM");
  await waitForExit(companion.pid, 5_000);
}

function resolveElectronCommand(): string {
  const command = resolveFromRoot("node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  if (!fs.existsSync(command)) {
    throw new Error("Electron is not installed. Run `npm install` in the repo before using overlay mode.");
  }
  return command;
}

async function isPidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await isPidAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}
