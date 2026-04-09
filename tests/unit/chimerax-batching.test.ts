import { describe, expect, it } from "vitest";
import { createChimeraXCommandBatches } from "../../packages/runtime-and-adapters/src/adapters/chimerax-adapter.js";

describe("createChimeraXCommandBatches", () => {
  it("groups cheap style and camera commands together", () => {
    const batches = createChimeraXCommandBatches([
      "color #1 bychain cartoons",
      "cartoon protein",
      "style ligand stick",
      "view ligand orient",
      "zoom 1.2",
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.commands).toEqual([
      "color #1 bychain cartoons",
      "cartoon protein",
      "style ligand stick",
      "view ligand orient",
      "zoom 1.2",
    ]);
  });

  it("keeps heavy commands isolated as barriers", () => {
    const batches = createChimeraXCommandBatches([
      "open 1hsg",
      "color #1 bychain cartoons",
      "surface protein & ligand :< 6",
      "transparency protein & ligand :< 6 55 target s",
      "save /tmp/out.png width 2200 height 1500",
    ]);

    expect(batches.map((batch) => batch.commands)).toEqual([
      ["open 1hsg"],
      ["color #1 bychain cartoons"],
      ["surface protein & ligand :< 6"],
      ["transparency protein & ligand :< 6 55 target s"],
      ["save /tmp/out.png width 2200 height 1500"],
    ]);
  });
});
