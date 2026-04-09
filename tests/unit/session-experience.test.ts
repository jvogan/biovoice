import { describe, expect, it } from "vitest";
import { buildStartPathOptions } from "../../apps/voice-console/src/lib/session-experience";

describe("session experience start paths", () => {
  it("keeps the agent launch command aligned with supported agent-runtime flags", () => {
    const options = buildStartPathOptions({
      target: "pymol",
      recipeId: "pymol-binding-pocket-story",
      baseUrl: "http://localhost:3010",
      widgetEnabled: true,
    });

    const agentLaunch = options.find((option) => option.id === "agent_launch");
    const guidedUi = options.find((option) => option.id === "guided_ui");

    expect(agentLaunch?.primaryActionValue).toContain("npm run agent:start -- pymol");
    expect(agentLaunch?.primaryActionValue).toContain("--recipe pymol-binding-pocket-story");
    expect(agentLaunch?.primaryActionValue).not.toContain("--widget");
    expect(guidedUi?.primaryActionValue).toContain("widget=1");
  });
});
