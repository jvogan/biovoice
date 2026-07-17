import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunReceiptStore } from "../../packages/runtime-and-adapters/src/store/run-receipt-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("run receipt store", () => {
  it("persists detailed local receipts while returning compact summaries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "biovoice-receipts-"));
    tempDirs.push(dir);
    const store = new RunReceiptStore(dir);

    const created = await store.create({
      target: "pymol",
      source: "actions",
      summary: "  Color   the active model  ",
      checkpointAvailable: true,
      request: { actions: [{ type: "color" }] },
      result: {
        metrics: [{ kind: "distance", value: 3.2 }],
        artifacts: [{ kind: "image", label: "Hero view", path: "/tmp/hero.png" }],
        warnings: ["Example warning"],
      },
    });

    expect(created.summary).toBe("Color the active model");
    expect(created.evidenceLevel).toBe("measured");
    expect(created.checkpointAvailable).toBe(true);

    const summaries = await store.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).not.toHaveProperty("request");
    expect(summaries[0]).not.toHaveProperty("result");
    expect(summaries[0].artifacts).toEqual([
      { kind: "image", label: "Hero view", path: "/tmp/hero.png" },
    ]);

    const detailed = await store.get(created.id);
    expect(detailed?.request).toEqual({ actions: [{ type: "color" }] });
    expect(await store.get("../../not-a-receipt")).toBeNull();

    const replacement = await store.create({
      target: "pymol",
      source: "actions",
      summary: "A newer scene change",
      checkpointAvailable: true,
    });
    const afterReplacement = await store.list();
    expect(afterReplacement.find((receipt) => receipt.id === created.id)?.checkpointAvailable).toBe(false);
    expect(afterReplacement.find((receipt) => receipt.id === replacement.id)?.checkpointAvailable).toBe(true);
  });
});
