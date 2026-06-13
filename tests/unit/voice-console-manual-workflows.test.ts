import { describe, expect, it } from "vitest";
import type { SessionUiEvent } from "../../packages/runtime-and-adapters/src/realtime/session-events.js";
import {
  buildManualWorkflowFailureLogEntry,
  buildManualWorkflowSuccessLogEntry,
  chooseLatestArtifactPreview,
  findLatestStageArtifactPreview,
} from "../../apps/voice-console/src/App";
import {
  isAssistantResponseEndEvent,
  isAssistantResponseStartEvent,
  isEventStreamErrorMessage,
  isInputSpeechEndEvent,
  isInputSpeechStartEvent,
  isManualDisconnectReason,
} from "../../apps/voice-console/src/hooks/useRealtimeConnection";

describe("voice console manual workflow helpers", () => {
  it("keeps the artifact preview tied to the artifact-bearing event timestamp", () => {
    const events: SessionUiEvent[] = [
      {
        id: "event-1",
        timestamp: "2026-04-09T18:00:00.000Z",
        kind: "tool_result",
        text: "Captured viewport",
        payload: {
          artifacts: [
            {
              kind: "image",
              path: "/tmp/hero.png",
              label: "Hero capture",
              url: "/api/artifacts?path=%2Ftmp%2Fhero.png",
            },
          ],
        },
      },
      {
        id: "event-2",
        timestamp: "2026-04-09T18:00:05.000Z",
        kind: "tool_result",
        text: "Updated labels",
        payload: {
          metrics: [],
        },
      },
    ];

    expect(findLatestStageArtifactPreview(events)).toEqual({
      id: "/tmp/hero.png",
      kind: "image",
      url: "/api/artifacts?path=%2Ftmp%2Fhero.png",
      label: "Hero capture",
      timestamp: "2026-04-09T18:00:00.000Z",
    });
  });

  it("builds a manual success log entry from the route response", () => {
    const timestamp = new Date("2026-04-09T18:10:00.000Z");
    const entry = buildManualWorkflowSuccessLogEntry(
      {
        id: "binding-pocket",
        title: "Binding Pocket",
      },
      {
        recipeId: "binding-pocket",
        target: "pymol",
        dryRun: false,
        stepResults: [
          {
            stepId: "capture",
            title: "Capture",
            summary: "Capture the latest view",
            result: {
              target: "pymol",
              commandsExecuted: [],
              logs: [],
              artifacts: [
                {
                  kind: "image",
                  path: "/tmp/pocket.png",
                  label: "Pocket capture",
                  url: "/api/artifacts?path=%2Ftmp%2Fpocket.png",
                },
              ],
              metrics: [],
              warnings: [],
            },
          },
        ],
      },
      timestamp,
    );

    expect(entry).toEqual({
      id: "manual-run-binding-pocket-1775758200000",
      timestamp,
      type: "success",
      message: "Finished Binding Pocket (1 step) · Pocket capture",
    });
  });

  it("builds a manual failure log entry without mutating connection state", () => {
    const timestamp = new Date("2026-04-09T18:11:00.000Z");
    const entry = buildManualWorkflowFailureLogEntry(
      {
        id: "binding-pocket",
        title: "Binding Pocket",
      },
      "Server timed out",
      timestamp,
    );

    expect(entry).toEqual({
      id: "manual-run-binding-pocket-error-1775758260000",
      timestamp,
      type: "error",
      message: "Failed Binding Pocket: Server timed out",
    });
  });

  it("prefers the newest artifact preview by timestamp", () => {
    expect(chooseLatestArtifactPreview(
      {
        id: "stage",
        kind: "image",
        label: "Stage",
        timestamp: "2026-04-09T18:00:00.000Z",
      },
      {
        id: "manual",
        kind: "image",
        label: "Manual",
        timestamp: "2026-04-09T18:00:01.000Z",
      },
    )?.id).toBe("manual");

    expect(chooseLatestArtifactPreview(
      {
        id: "stage",
        kind: "image",
        label: "Stage",
        timestamp: "2026-04-09T18:00:02.000Z",
      },
      {
        id: "manual",
        kind: "image",
        label: "Manual",
        timestamp: "2026-04-09T18:00:01.000Z",
      },
    )?.id).toBe("stage");
  });

  it("classifies only session-event transport messages as stream errors", () => {
    expect(isEventStreamErrorMessage("Session event stream disconnected.")).toBe(true);
    expect(isEventStreamErrorMessage("Session event stream closed.")).toBe(true);
    expect(isEventStreamErrorMessage("Session event stream stalled.")).toBe(true);
    expect(isEventStreamErrorMessage("Peer connection failed.")).toBe(false);
    expect(isEventStreamErrorMessage(null)).toBe(false);
  });

  it("treats manual disconnect reasons as benign", () => {
    expect(isManualDisconnectReason("Session manually disconnected from the console.")).toBe(true);
    expect(isManualDisconnectReason("Session manually disconnected from the widget.")).toBe(true);
    expect(isManualDisconnectReason("Session event stream disconnected.")).toBe(false);
    expect(isManualDisconnectReason(null)).toBe(false);
  });

  it("detects open-mic speech lifecycle events", () => {
    expect(isInputSpeechStartEvent("input_audio_buffer.speech_started")).toBe(true);
    expect(isInputSpeechEndEvent("input_audio_buffer.speech_stopped")).toBe(true);
    expect(isInputSpeechEndEvent("input_audio_buffer.committed")).toBe(true);
    expect(isInputSpeechStartEvent("response.created")).toBe(false);
  });

  it("detects assistant response lifecycle events", () => {
    expect(isAssistantResponseStartEvent("response.created")).toBe(true);
    expect(isAssistantResponseStartEvent("response.output_audio.delta")).toBe(true);
    expect(isAssistantResponseStartEvent("response.output_audio_transcript.delta")).toBe(true);
    expect(isAssistantResponseStartEvent("response.function_call_arguments.done")).toBe(true);
    expect(isAssistantResponseEndEvent("response.done")).toBe(true);
    expect(isAssistantResponseEndEvent("response.output_text.delta")).toBe(false);
  });
});
