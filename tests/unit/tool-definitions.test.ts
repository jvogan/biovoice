import { describe, expect, it } from "vitest";
import { buildRealtimeTools } from "../../packages/runtime-and-adapters/src/realtime/tool-definitions.js";

function getTool(name: string, target: "pymol" | "chimerax") {
  const tool = buildRealtimeTools(target).find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool as NonNullable<typeof tool>;
}

function getActionVariant(toolName: string, target: "pymol" | "chimerax", actionType: string) {
  const tool = getTool(toolName, target) as unknown as {
    parameters: {
      properties: {
        actions: {
          items: {
            oneOf: Array<{
              properties: Record<string, unknown> & {
                type: {
                  enum: string[];
                };
              };
              required?: string[];
            } & Record<string, unknown>>;
          };
        };
      };
    };
  };

  const variant = tool.parameters.properties.actions.items.oneOf.find((candidate) => candidate.properties.type.enum?.[0] === actionType);
  expect(variant).toBeDefined();
  return variant as NonNullable<typeof variant>;
}

describe("realtime tool definitions", () => {
  it("keeps the PyMOL align action aligned with the runtime schema", () => {
    const align = getActionVariant("run_pymol_actions", "pymol", "align");
    expect(align.required).toEqual(expect.arrayContaining(["mobile", "target"]));
    expect(align.properties).toHaveProperty("mobile");
    expect(align.properties).toHaveProperty("target");
    expect(align.properties).not.toHaveProperty("targetSelection");
  });

  it("exposes the full PyMOL map action surface for voice planning", () => {
    const map = getActionVariant("run_pymol_actions", "pymol", "map");
    expect(map.required).toEqual(expect.arrayContaining(["selection", "mapName"]));
    expect(map.properties).toHaveProperty("grid");
    expect(map.properties).toHaveProperty("buffer");
    expect(map.properties).toHaveProperty("level");
    expect(map.properties).toHaveProperty("carve");

    const mapDisplay = getActionVariant("run_pymol_actions", "pymol", "map_display");
    expect(mapDisplay.required).toEqual(expect.arrayContaining(["mapName"]));
    expect(mapDisplay.properties).toHaveProperty("displayAs");
    expect(mapDisplay.properties).toHaveProperty("color");
  });

  it("exposes the richer PyMOL measurement and preset surface", () => {
    const measure = getActionVariant("run_pymol_actions", "pymol", "measure");
    expect(measure.properties).toHaveProperty("selection3");
    expect(measure.properties).toHaveProperty("selection4");
    expect(measure.properties).toHaveProperty("cutoff");

    const transform = getActionVariant("run_pymol_actions", "pymol", "transform");
    expect(transform.properties).toHaveProperty("frames");
    expect(transform.properties).toHaveProperty("center");
    expect(transform.properties).toHaveProperty("coordinateSystem");

    const contacts = getActionVariant("run_pymol_actions", "pymol", "contacts");
    expect(contacts.required).toEqual(expect.arrayContaining(["selection1"]));
    expect(contacts.properties).toHaveProperty("distance");
    expect(((contacts.properties as Record<string, unknown>).mode as { enum: string[] }).enum).toEqual(
      expect.arrayContaining(["polar_contacts", "hbonds", "contacts", "clashes"]),
    );

    const cartoon = getActionVariant("run_pymol_actions", "pymol", "cartoon");
    expect(cartoon.properties).toHaveProperty("style");
    expect(cartoon.properties).toHaveProperty("radius");
    expect(((cartoon.properties as Record<string, unknown>).style as { enum: string[] }).enum).toEqual(
      expect.arrayContaining(["tube", "pipe", "putty"]),
    );

    const preset = getActionVariant("run_pymol_actions", "pymol", "preset");
    expect(((preset.properties as Record<string, unknown>).name as { enum: string[] }).enum).toEqual(
      expect.arrayContaining(["pocket_hero", "comparison_hero", "map_hero", "confidence_putty", "cartoon_overview"]),
    );

    const symmetry = getActionVariant("run_pymol_actions", "pymol", "symmetry");
    expect(symmetry.required).toEqual(expect.arrayContaining(["prefix", "object", "selection"]));
    expect(symmetry.properties).toHaveProperty("cutoff");

    const label = getActionVariant("run_pymol_actions", "pymol", "label");
    expect(label.properties).toHaveProperty("action");

    const load = getActionVariant("run_pymol_actions", "pymol", "load");
    expect(load.properties).toHaveProperty("semanticRole");
    expect(load.properties).toHaveProperty("aliases");
  });

  it("keeps the ChimeraX align action aligned with the runtime schema", () => {
    const align = getActionVariant("run_chimerax_actions", "chimerax", "align");
    expect(align.required).toEqual(expect.arrayContaining(["mobile", "target"]));
    expect(align.properties).toHaveProperty("mobile");
    expect(align.properties).toHaveProperty("target");
    expect(align.properties).not.toHaveProperty("targetSelection");
  });

  it("exposes ChimeraX open, style, and volume fields used by the adapters", () => {
    const open = getActionVariant("run_chimerax_actions", "chimerax", "open");
    expect(open.properties).toHaveProperty("path");
    expect(open.properties).toHaveProperty("semanticRole");
    expect(open.properties).toHaveProperty("aliases");

    const visibility = getActionVariant("run_chimerax_actions", "chimerax", "visibility");
    expect(visibility.required).toEqual(expect.arrayContaining(["mode"]));
    expect(visibility.properties).toHaveProperty("selection");

    const style = getActionVariant("run_chimerax_actions", "chimerax", "style");
    expect(style.properties).toHaveProperty("zoneNear");
    expect(style.properties).toHaveProperty("zoneDistance");
    expect(style.properties).toHaveProperty("zoneMaxComponents");
    expect(style.properties).toHaveProperty("transparency");

    const fit = getActionVariant("run_chimerax_actions", "chimerax", "fit");
    expect(fit.required).toEqual(expect.arrayContaining(["mobile", "map"]));

    const symmetry = getActionVariant("run_chimerax_actions", "chimerax", "symmetry");
    expect(symmetry.properties).toHaveProperty("assemblyId");
    expect(symmetry.properties).toHaveProperty("copies");

    const layout = getActionVariant("run_chimerax_actions", "chimerax", "layout");
    expect(layout.required).toEqual(expect.arrayContaining(["mode"]));

    const volume = getActionVariant("run_chimerax_actions", "chimerax", "volume");
    expect(volume.properties).toHaveProperty("mapName");
    expect(volume.properties).toHaveProperty("resolution");
    expect(volume.properties).toHaveProperty("level");
    expect(volume.properties).toHaveProperty("transparency");
    expect(((volume.properties as Record<string, unknown>).action as { enum: string[] }).enum).toEqual(
      expect.arrayContaining(["show", "hide"]),
    );

    const preset = getActionVariant("run_chimerax_actions", "chimerax", "preset");
    expect(((preset.properties as Record<string, unknown>).name as { enum: string[] }).enum).toEqual(
      expect.arrayContaining(["comparison_hero", "confidence_hero", "cartoon_overview"]),
    );
  });

  it("exposes ChimeraX measurement, view, and lighting controls", () => {
    const measure = getActionVariant("run_chimerax_actions", "chimerax", "measure");
    expect(measure.properties).toHaveProperty("selection3");
    expect(measure.properties).toHaveProperty("selection4");

    const view = getActionVariant("run_chimerax_actions", "chimerax", "view");
    expect(view.properties).toHaveProperty("name");
    expect(view.properties).toHaveProperty("frames");

    const lighting = getActionVariant("run_chimerax_actions", "chimerax", "lighting");
    expect(lighting.required).toEqual(expect.arrayContaining(["mode"]));

    const camera = getActionVariant("run_chimerax_actions", "chimerax", "camera");
    expect(camera.properties).toHaveProperty("clipMode");

    const label = getActionVariant("run_chimerax_actions", "chimerax", "label");
    expect(label.properties).toHaveProperty("action");
  });

  it("describes ChimeraX staged storyboard affordances to Realtime", () => {
    const tool = getTool("run_chimerax_actions", "chimerax") as unknown as {
      description: string;
    };
    expect(tool.description).toContain("staged non-atomic/BILD storyboard demos");
    expect(tool.description).toContain("model-level show/hide");

    const visibility = getActionVariant("run_chimerax_actions", "chimerax", "visibility");
    const visibilitySelection = (visibility.properties as Record<string, unknown>).selection as { description?: string };
    expect(visibilitySelection.description).toContain("staged BILD scenes");
    expect(visibilitySelection.description).toContain("#2-5");

    const transform = getActionVariant("run_chimerax_actions", "chimerax", "transform");
    const transformSelection = (transform.properties as Record<string, unknown>).selection as { description?: string };
    expect(transformSelection.description).toContain("staged storyboard scenes");
    expect(transformSelection.description).toContain("explode");

    const label = getActionVariant("run_chimerax_actions", "chimerax", "label");
    const labelText = (label.properties as Record<string, unknown>).text as { description?: string };
    expect(labelText.description).toContain("Avoid this for Generic3DModel/BILD storyboard scenes");
  });

  it("keeps target-specific export formats separated", () => {
    const pymolExport = getActionVariant("run_pymol_actions", "pymol", "export");
    expect(((pymolExport.properties as Record<string, unknown>).export as { properties: { format: { enum: string[] } } }).properties.format.enum).toEqual(
      ["png", "pse", "session"],
    );

    const chimeraxExport = getActionVariant("run_chimerax_actions", "chimerax", "export");
    expect(((chimeraxExport.properties as Record<string, unknown>).export as { properties: { format: { enum: string[] } } }).properties.format.enum).toEqual(
      ["png", "cxs", "session"],
    );
  });

  it("keeps export_artifact target-aware", () => {
    const tool = getTool("export_artifact", "pymol") as unknown as {
      parameters: {
        type: string;
        properties: {
          target: { enum: string[] };
          format: { enum: string[] };
        };
        required: string[];
      };
    };

    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.required).toEqual(expect.arrayContaining(["target", "format"]));
    expect(tool.parameters.properties.target.enum).toEqual(["pymol", "chimerax"]);
    expect(tool.parameters.properties.format.enum).toEqual(["png", "pse", "cxs", "session"]);
  });

  it("exposes the domain-level scientific workflow tool", () => {
    const tool = getTool("run_scientific_workflow", "pymol") as unknown as {
      parameters: {
        required: string[];
        properties: {
          target: { enum: string[] };
          workflow: { enum: string[] };
          presentationMode: { enum: string[] };
          inputs: { oneOf: Array<{ properties: Record<string, unknown> }> };
        };
      };
    };

    expect(tool.parameters.required).toEqual(expect.arrayContaining(["target", "workflow", "inputs"]));
    expect(tool.parameters.properties.target.enum).toEqual(["pymol", "chimerax"]);
    expect(tool.parameters.properties.workflow.enum).toEqual(expect.arrayContaining([
      "alphafold_vs_experiment_overlay",
      "rosetta_top_design_compare",
    ]));
    expect(tool.parameters.properties.presentationMode.enum).toEqual(["analysis", "demo", "publication"]);
    expect(tool.parameters.properties.inputs.oneOf).toHaveLength(2);
    const alphaFoldInputs = tool.parameters.properties.inputs.oneOf.find((candidate) => "uniprotId" in candidate.properties);
    const rosettaInputs = tool.parameters.properties.inputs.oneOf.find((candidate) => "scorefilePath" in candidate.properties);
    expect(alphaFoldInputs?.properties).toEqual(expect.objectContaining({
      uniprotId: expect.any(Object),
      useAfdbPae: expect.any(Object),
      experimentalPdbId: expect.any(Object),
    }));
    expect(rosettaInputs?.properties).toEqual(expect.objectContaining({
      bundlePath: expect.any(Object),
      candidatePaths: expect.any(Object),
      scorefilePath: expect.any(Object),
    }));
  });

  it("exposes capture_view as a shared visual inspection tool", () => {
    const tool = getTool("capture_view", "chimerax") as unknown as {
      parameters: {
        type: string;
        properties: Record<string, unknown> & {
          target: { enum: string[] };
        };
        required: string[];
      };
    };

    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.required).toEqual(["target"]);
    expect(tool.parameters.properties.target.enum).toEqual(["pymol", "chimerax"]);
    expect(tool.parameters.properties).toHaveProperty("inspectionPrompt");
    expect(tool.parameters.properties).toHaveProperty("attachToConversation");
  });

  it("exposes the scientific asset resolver as a shared database-fetch tool", () => {
    const pymolTool = getTool("resolve_structure_asset", "pymol") as unknown as {
      description: string;
      parameters: {
        required: string[];
        properties: Record<string, unknown> & {
          source: { enum: string[] };
          target: { enum: string[] };
          format: { enum: string[] };
          semanticRole: { enum: string[] };
        };
        additionalProperties: boolean;
      };
    };
    const chimeraTool = getTool("resolve_structure_asset", "chimerax");

    expect(chimeraTool).toBeDefined();
    expect(pymolTool.description).toContain("approved databases");
    expect(pymolTool.parameters.required).toEqual(["source"]);
    expect(pymolTool.parameters.additionalProperties).toBe(false);
    expect(pymolTool.parameters.properties.source.enum).toEqual(["alphafold", "rcsb", "rcsb_search", "emdb", "uniprot"]);
    expect(pymolTool.parameters.properties.target.enum).toEqual(["pymol", "chimerax"]);
    expect(pymolTool.parameters.properties.format.enum).toEqual(["pdb", "cif"]);
    expect(pymolTool.parameters.properties).toHaveProperty("loadIntoTarget");
    expect(pymolTool.parameters.properties).toHaveProperty("pdbId");
    expect(pymolTool.parameters.properties).toHaveProperty("uniprotId");
    expect(pymolTool.parameters.properties).toHaveProperty("emdbId");
    expect(pymolTool.parameters.properties).toHaveProperty("query");
    expect(pymolTool.parameters.properties.semanticRole.enum).toEqual(expect.arrayContaining(["experimental", "predicted"]));
  });

  it("exposes wait_for_user as a shared quiet-turn tool", () => {
    const pymolTool = getTool("wait_for_user", "pymol") as unknown as {
      description: string;
      parameters: {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
    };
    const chimeraTool = getTool("wait_for_user", "chimerax");

    expect(chimeraTool).toBeDefined();
    expect(pymolTool.description).toContain("not receive a spoken response");
    expect(pymolTool.parameters.type).toBe("object");
    expect(pymolTool.parameters.properties).toEqual({});
    expect(pymolTool.parameters.required).toEqual([]);
    expect(pymolTool.parameters.additionalProperties).toBe(false);
  });

  it("exposes response language switching as a shared session tool", () => {
    const pymolTool = getTool("set_response_language_mode", "pymol") as unknown as {
      description: string;
      parameters: {
        type: string;
        properties: {
          mode: { enum: string[] };
        };
        required: string[];
        additionalProperties: boolean;
      };
    };
    const chimeraTool = getTool("set_response_language_mode", "chimerax");

    expect(chimeraTool).toBeDefined();
    expect(pymolTool.description).toContain("enter, start, enable, or stay in Klingon mode");
    expect(pymolTool.description).toContain("stop, exit, disable, or leave Klingon mode");
    expect(pymolTool.parameters.type).toBe("object");
    expect(pymolTool.parameters.properties.mode.enum).toEqual(["standard", "klingon"]);
    expect(pymolTool.parameters.required).toEqual(["mode"]);
    expect(pymolTool.parameters.additionalProperties).toBe(false);
  });

  it("hides raw_command unless advanced mode is enabled", () => {
    const standardTool = getTool("run_pymol_actions", "pymol") as unknown as {
      parameters: {
        properties: {
          actions: {
            items: {
              oneOf: Array<{
                properties: Record<string, unknown> & {
                  type: {
                    enum: string[];
                  };
                };
              }>;
            };
          };
        };
      };
    };
    const advancedTool = buildRealtimeTools("pymol", { advancedMode: true }).find((candidate) => candidate.name === "run_pymol_actions") as NonNullable<ReturnType<typeof buildRealtimeTools>[number]>;

    const standardActionTypes = standardTool.parameters.properties.actions.items.oneOf.map((candidate) => candidate.properties.type.enum[0]);
    const advancedActionTypes = ((advancedTool as unknown as typeof standardTool).parameters.properties.actions.items.oneOf).map((candidate) => candidate.properties.type.enum[0]);

    expect(standardActionTypes).not.toContain("raw_command");
    expect(advancedActionTypes).toContain("raw_command");
  });

  it("supports semantic reference selectors for both targets", () => {
    const pymolShow = getActionVariant("run_pymol_actions", "pymol", "show");
    const chimeraSelect = getActionVariant("run_chimerax_actions", "chimerax", "select");

    const pymolSelectionSchema = (pymolShow.properties as Record<string, unknown>).selection as {
      oneOf: Array<{
        properties?: Record<string, unknown>;
      }>;
    };
    const chimeraSelectionSchema = (chimeraSelect.properties as Record<string, unknown>).selection as {
      oneOf: Array<{
        properties?: Record<string, unknown>;
      }>;
    };

    const pymolStructured = pymolSelectionSchema.oneOf.find((candidate) => candidate.properties)?.properties ?? {};
    const chimeraStructured = chimeraSelectionSchema.oneOf.find((candidate) => candidate.properties)?.properties ?? {};

    expect(pymolStructured).toHaveProperty("reference");
    expect(pymolStructured).toHaveProperty("residueName");
    expect(pymolStructured).toHaveProperty("ligand");
    expect(chimeraStructured).toHaveProperty("reference");
    expect(chimeraStructured).toHaveProperty("residueName");
    expect(chimeraStructured).toHaveProperty("ligand");
  });

  it("keeps structure loading limited to approved sources", () => {
    const pymolLoad = getActionVariant("run_pymol_actions", "pymol", "load");
    const chimeraOpen = getActionVariant("run_chimerax_actions", "chimerax", "open");

    expect(((pymolLoad.properties as Record<string, unknown>).source as { enum: string[] }).enum).toEqual(["pdb", "local", "alphafold"]);
    expect(((chimeraOpen.properties as Record<string, unknown>).source as { enum: string[] }).enum).toEqual(["pdb", "local", "alphafold"]);
    expect(chimeraOpen.properties).not.toHaveProperty("url");
  });

  it("keeps raw_command out of the default session tool surface", () => {
    const pymolTool = getTool("run_pymol_actions", "pymol") as unknown as {
      parameters: {
        properties: {
          actions: {
            items: {
              oneOf: Array<{
                properties: {
                  type: { enum: string[] };
                };
              }>;
            };
          };
        };
      };
    };

    const actionTypes = pymolTool.parameters.properties.actions.items.oneOf.map((candidate) => candidate.properties.type.enum[0]);
    expect(actionTypes).not.toContain("raw_command");
  });

  it("exposes raw_command only when advanced mode is enabled", () => {
    const tool = buildRealtimeTools("chimerax", { advancedMode: true }).find((candidate) => candidate.name === "run_chimerax_actions");
    expect(tool).toBeDefined();
    const actionTypes = ((tool as unknown as {
      parameters: {
        properties: {
          actions: {
            items: {
              oneOf: Array<{
                properties: {
                  type: { enum: string[] };
                };
              }>;
            };
          };
        };
      };
    }).parameters.properties.actions.items.oneOf).map((candidate) => candidate.properties.type.enum[0]);

    expect(actionTypes).toContain("raw_command");
  });
});
