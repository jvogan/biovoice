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
        responseLanguageMode="standard"
        onResponseLanguageModeChange={() => {}}
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

  it("toggles Klingon response mode separately from mic mode", () => {
    const onVoiceModeChange = vi.fn();
    const onResponseLanguageModeChange = vi.fn();

    render(
      <VoiceStage
        connectionState="connected"
        phase="ready"
        voiceUiState="idle"
        voiceMode="push_to_talk"
        onVoiceModeChange={onVoiceModeChange}
        responseLanguageMode="standard"
        onResponseLanguageModeChange={onResponseLanguageModeChange}
        transcript=""
        onPushToTalkStart={() => {}}
        onPushToTalkEnd={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Klingon response mode" }));

    expect(onResponseLanguageModeChange).toHaveBeenCalledWith("klingon");
    expect(onVoiceModeChange).not.toHaveBeenCalled();
  });
});
