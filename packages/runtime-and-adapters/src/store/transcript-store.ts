import fs from "node:fs/promises";
import path from "node:path";
import { runtimeDir } from "../utils/paths.js";
import type { SessionUsage } from "../realtime/usage.js";

export class TranscriptStore {
  async append(sessionId: string, payload: unknown): Promise<void> {
    const dir = path.join(runtimeDir, "sessions", sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, "events.ndjson"), `${JSON.stringify(payload)}\n`, "utf8");
  }

  async writeUsage(sessionId: string, usage: SessionUsage): Promise<void> {
    const dir = path.join(runtimeDir, "sessions", sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "usage.json"), JSON.stringify(usage, null, 2), "utf8");
  }
}
