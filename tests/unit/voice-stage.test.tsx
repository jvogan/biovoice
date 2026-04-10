// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceStage } from "../../apps/voice-console/src/components/VoiceStage";

describe("voice stage mode controls", () => {
  it("routes open-mic entry through the explicit toggle handler", () => {
    const onVoiceModeChange = vi.fn();
    const onToggleOpenMic = vi.fn();

    render(
      <VoiceStage
        connectionState="connected"
        phase="ready"
        voiceUiState="idle"
        voiceMode="push_to_talk"
        onVoiceModeChange={onVoiceModeChange}
        transcript=""
        onPushToTalkStart={() => {}}
        onPushToTalkEnd={() => {}}
        openMicArmed={false}
        onToggleOpenMic={onToggleOpenMic}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Mic" }));

    expect(onToggleOpenMic).toHaveBeenCalledTimes(1);
    expect(onVoiceModeChange).not.toHaveBeenCalledWith("open_mic");
  });
});
