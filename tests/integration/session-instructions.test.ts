import { describe, expect, it } from "vitest";
import {
  buildRealtimeTools,
  buildSessionInstructions,
} from "../../packages/runtime-and-adapters/src/index.js";

describe("realtime session config helpers", () => {
  it("builds focused instructions for the active target", () => {
    const instructions = buildSessionInstructions("pymol", "push_to_talk", "Binding Pocket Story");
    expect(instructions).toContain("PyMOL");
    expect(instructions).toContain("Binding Pocket Story");
    expect(instructions).toContain("bundle");
    expect(instructions).toContain("get_target_state");
    expect(instructions).toContain("run_scientific_workflow");
    expect(instructions).toContain("capture_view");
    expect(instructions).toContain("Advanced expert commands are disabled");
  });

  it("only enables raw expert commands in advanced mode", () => {
    const standardInstructions = buildSessionInstructions("chimerax", "push_to_talk", "Homolog Alignment Showcase");
    const advancedInstructions = buildSessionInstructions("chimerax", "push_to_talk", "Homolog Alignment Showcase", true);

    expect(standardInstructions).toContain("Do not emit raw_command");
    expect(advancedInstructions).toContain("Advanced expert commands are enabled");
  });

  it("returns only the active target tool plus shared tools", () => {
    const tools = buildRealtimeTools("chimerax");
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("run_chimerax_actions");
    expect(names).not.toContain("run_pymol_actions");
    expect(names).toContain("get_target_state");
    expect(names).toContain("run_scientific_workflow");
    expect(names).toContain("capture_view");
  });
});
