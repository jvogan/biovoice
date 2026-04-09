import { describe, expect, it } from "vitest";
import {
  parseChimeraXChainLines,
  parseChimeraXNamedViews,
  parseChimeraXWindowSize,
} from "../../packages/runtime-and-adapters/src/adapters/chimerax-adapter.js";

describe("chimerax state parsers", () => {
  it("parses wrapped named views from info output", () => {
    const lines = [
      "Named views: [assembly-hero](cxcmd:view assembly-hero), [assembly-",
      "overview](cxcmd:view assembly-overview), [map-fit-",
      "hero](cxcmd:view map-fit-hero)",
    ];

    expect(parseChimeraXNamedViews(lines)).toEqual([
      "assembly-hero",
      "assembly-overview",
      "map-fit-hero",
    ]);
  });

  it("parses chain listings from info chains output", () => {
    const lines = [
      "chain id #1/A chain_id A",
      "chain id #2.1/B chain_id B",
    ];

    expect(parseChimeraXChainLines(lines)).toEqual([
      { chain: "#1/A", summary: "chain_id A" },
      { chain: "#2.1/B", summary: "chain_id B" },
    ]);
  });

  it("parses window size output without an x separator", () => {
    expect(parseChimeraXWindowSize(["window size 582 506"])).toEqual({
      width: 582,
      height: 506,
    });
  });
});
