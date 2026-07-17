// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "../../apps/voice-console/src/components/Header";
import { OpenMicConfirmDialog } from "../../apps/voice-console/src/components/OpenMicConfirmDialog";
import { ReadinessPanel } from "../../apps/voice-console/src/components/ReadinessPanel";
import { ReceiptsPanel } from "../../apps/voice-console/src/components/ReceiptsPanel";
import { SettingsDrawer } from "../../apps/voice-console/src/components/SettingsDrawer";
import { WorkflowsPanel } from "../../apps/voice-console/src/components/WorkflowsPanel";
import type { GuardrailsSnapshot } from "../../apps/voice-console/src/components/types";

const guardrails: GuardrailsSnapshot = {
  voiceMode: "push_to_talk",
  idleDisconnectSeconds: 180,
  maxSessionMinutes: 25,
  maxResponsesPerSession: 18,
  maxTranscriptionsPerSession: 36,
  maxBillableTokensPerSession: 120000,
  maxActiveSessions: 2,
  warningRatio: 0.8,
};

describe("operator undo control", () => {
  it("only enables Undo when the doctor reports a checkpoint", () => {
    const onUndo = vi.fn();
    const { rerender } = render(
      <Header
        target="pymol"
        onTargetChange={() => {}}
        connectionState="offline"
        onPowerClick={() => {}}
        isDarkMode
        onThemeToggle={() => {}}
        onSettingsClick={() => {}}
        undoAvailable={false}
        undoDisabledReason="Nothing to undo"
        onUndo={onUndo}
      />,
    );

    const undo = screen.getByRole("button", { name: "Undo last turn" });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(undo);
    expect(onUndo).not.toHaveBeenCalled();

    rerender(
      <Header
        target="pymol"
        onTargetChange={() => {}}
        connectionState="offline"
        onPowerClick={() => {}}
        isDarkMode
        onThemeToggle={() => {}}
        onSettingsClick={() => {}}
        undoAvailable
        onUndo={onUndo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo last turn" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe("first-run readiness", () => {
  it("shows actionable checks and copies the target-specific offline rehearsal", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const onReviewWorkflows = vi.fn();

    render(
      <ReadinessPanel
        doctor={{
          ok: false,
          checks: [
            { id: "key", label: "Realtime credential", status: "ready", detail: "Credential validated." },
            { id: "target", label: "PyMOL control", status: "blocked", detail: "PyMOL is not responding.", action: "Launch PyMOL." },
          ],
          targets: {
            pymol: { ready: false, undoAvailable: false },
            chimerax: { ready: true, undoAvailable: false },
          },
        }}
        loading={false}
        target="pymol"
        rehearsalRecipeId="pymol-alphafold-confidence"
        onRefresh={() => {}}
        onReviewWorkflows={onReviewWorkflows}
      />,
    );

    expect(screen.getByText("1 of 2 checks ready · PyMOL not ready")).toBeTruthy();
    expect(screen.getByText("Next: Launch PyMOL.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy rehearsal" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("npm run rehearse:workflow -- pymol-alphafold-confidence --target pymol --dry-run"));
    fireEvent.click(screen.getByRole("button", { name: "Review workflows" }));
    expect(onReviewWorkflows).toHaveBeenCalledTimes(1);
  });
});

describe("run receipts", () => {
  it("labels evidence and exposes review and download links", () => {
    render(
      <ReceiptsPanel
        loading={false}
        onRefresh={() => {}}
        receipts={[{
          id: "run/42",
          createdAt: "2026-07-17T12:00:00.000Z",
          target: "chimerax",
          summary: "Measured the active-site contact distance",
          evidenceLevel: "computed_measurement",
          checkpointAvailable: true,
          artifacts: [{ kind: "image", label: "Active site" }],
          warnings: ["One residue was unresolved."],
        }]}
      />,
    );

    expect(screen.getByText("Computed Measurement")).toBeTruthy();
    expect(screen.getByText("Checkpoint")).toBeTruthy();
    expect(screen.getByText("1 artifact")).toBeTruthy();
    const review = screen.getByRole("link", { name: "Review JSON" });
    expect(review.getAttribute("href")).toBe("/api/receipts/run%2F42");
    const download = screen.getByRole("link", { name: "Download JSON receipt for Measured the active-site contact distance" });
    expect(download.getAttribute("download")).toBe("biovoice-run-run-42.json");
  });
});

describe("scientific workflow groups", () => {
  it("presents variant review as its own workflow group", () => {
    render(
      <WorkflowsPanel
        target="pymol"
        recipes={[]}
        onSelectRecipe={() => {}}
        onLaunchRecipe={() => {}}
        onLaunchScientificWorkflow={() => {}}
        scientificLaunchCards={[{
          id: "variant_environment_review",
          title: "Variant Environment Review",
          summary: "Inspect mutation neighborhoods.",
          group: "Variant",
          intent: "mutation environment",
          bestRecipeId: "pymol-binding-pocket-story",
          inputHints: ["mutations"],
          voiceStarter: "Show these mutation sites.",
          evidenceLevel: "qualitative",
          assumptions: ["Residue numbering matches the structure.", "Geometry does not predict pathogenicity."],
          inputsReady: false,
          inputMessage: "Mutation input is required.",
        }]}
        activeScientificWorkflowId={null}
        scientificInputSummary="No scientific inputs pinned."
        scientificInputsPinned={false}
        busyRecipeId={null}
      />,
    );

    expect(screen.getByText("Variant")).toBeTruthy();
    expect(screen.getByText("Variant Environment Review")).toBeTruthy();
  });

  it("runs the selected scientific workflow in preview or execution mode", () => {
    const onLaunch = vi.fn();
    render(
      <WorkflowsPanel
        target="pymol"
        recipes={[]}
        onSelectRecipe={() => {}}
        onLaunchRecipe={() => {}}
        onLaunchScientificWorkflow={onLaunch}
        scientificLaunchCards={[{
          id: "variant_environment_review",
          title: "Variant Environment Review",
          summary: "Inspect mutation neighborhoods.",
          group: "Variant",
          intent: "mutation environment",
          bestRecipeId: "pymol-binding-pocket-story",
          inputHints: ["mutations"],
          voiceStarter: "Show these mutation sites.",
          evidenceLevel: "qualitative",
          assumptions: ["Geometry does not predict pathogenicity."],
          inputsReady: true,
        }]}
        activeScientificWorkflowId={null}
        scientificInputSummary="A:H58Y"
        scientificInputsPinned
        busyRecipeId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onLaunch).toHaveBeenNthCalledWith(1, "variant_environment_review", true);
    expect(onLaunch).toHaveBeenNthCalledWith(2, "variant_environment_review", false);
  });
});

describe("dialog accessibility", () => {
  it("marks settings as modal, focuses the close control, and restores focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open settings</button>
          <SettingsDrawer
            open={open}
            onClose={() => setOpen(false)}
            runtimeHealth={{ data: "READY", eventStream: "OPEN", controller: "READY", phase: "READY" }}
            auth={{ realtimeKey: "SET", realtimeValid: true, usageKey: "MISSING", usageValid: false }}
            guardrails={guardrails}
          />
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open settings" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close settings" })));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("puts safe cancellation first in the open-mic dialog", async () => {
    const onCancel = vi.fn();
    render(<OpenMicConfirmDialog open onCancel={onCancel} onConfirm={() => {}} guardrails={guardrails} />);
    const dialog = screen.getByRole("dialog", { name: "Open mic needs a deliberate opt-in" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stay on Push-to-Talk" })));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
