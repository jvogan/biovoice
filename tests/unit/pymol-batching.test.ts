import { describe, expect, it } from "vitest";
import { createPymolCommandBatches } from "../../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";

describe("createPymolCommandBatches", () => {
  it("groups lightweight visual commands into a single RPC batch", () => {
    const batches = createPymolCommandBatches(
      [
        "hide everything, all",
        "show cartoon, polymer.protein",
        "util.cbc polymer.protein",
      ],
      8_000,
      45_000,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]?.command).toContain("hide everything, all\nshow cartoon, polymer.protein\nutil.cbc polymer.protein");
    expect(batches[0]?.timeoutMs).toBe(8_000);
  });

  it("keeps load and render commands isolated and scales heavy ray traces", () => {
    const batches = createPymolCommandBatches(
      [
        "fetch 1hsg, 1hsg, async=0",
        "show sticks, organic",
        "zoom organic, 6",
        "ray 2200, 1500",
        "png /tmp/out.png, width=2200, height=1500, dpi=300, ray=0",
      ],
      8_000,
      45_000,
    );

    expect(batches.map((batch) => batch.commandCount)).toEqual([1, 2, 1, 1]);
    expect(batches.map((batch) => batch.timeoutMs)).toEqual([45_000, 8_000, 90_000, 45_000]);
  });

  it("scales rendered PNG exports when PyMOL does the ray trace inline", () => {
    const batches = createPymolCommandBatches(
      [
        "show surface, polymer.protein",
        "png \"/tmp/out.png\", width=2200, height=1500, dpi=300, ray=1",
      ],
      8_000,
      45_000,
    );

    expect(batches.map((batch) => batch.commandCount)).toEqual([1, 1]);
    expect(batches.map((batch) => batch.timeoutMs)).toEqual([8_000, 90_000]);
  });

  it("uses the render timeout for large surface-heavy visual batches", () => {
    const batches = createPymolCommandBatches(
      [
        "distance cat_contact_a, chain A and resi 25 and name OD1, organic, 3.5, 2",
        "distance cat_contact_b, chain B and resi 25 and name OD1, organic, 3.5, 2",
        "show surface, pocket",
        "set transparency, 0.42, pocket",
        "bg_color gray98",
        "set antialias, 2",
        "set ambient, 0.22",
        "set direct, 0.48",
        "set stick_radius, 0.2",
        "set dash_radius, 0.06",
        "set dash_gap, 0.16",
        "set label_size, 20",
        "scene F1, store, Pocket story hero shot",
      ],
      8_000,
      45_000,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]?.timeoutMs).toBe(45_000);
  });

  it("gives medium-sized surface and label batches the render timeout budget", () => {
    const batches = createPymolCommandBatches(
      [
        "show surface, polymer.protein",
        "color gray70, polymer.protein",
        "set transparency, 0.55, polymer.protein",
        "label chain A and resi 20 and name CA, \"Chain A\"",
        "label chain B and resi 20 and name CA, \"Chain B\"",
        "label chain C and resi 20 and name CA, \"Chain C\"",
        "label chain D and resi 20 and name CA, \"Chain D\"",
      ],
      8_000,
      45_000,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]?.timeoutMs).toBe(45_000);
  });
});
