// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceWidget, type VoiceWidgetProps } from "../../apps/voice-console/src/components/VoiceWidget";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function renderVoiceWidget(overrides: Partial<VoiceWidgetProps> = {}) {
  const props: VoiceWidgetProps = {
    target: "pymol",
    targetReady: true,
    audioInputDevices: [{ deviceId: "default", label: "System Default", source: "default" }],
    selectedAudioInputDeviceId: "default",
    audioInputDisabled: false,
    voiceMode: "push_to_talk",
    overlayMode: false,
    phase: "idle",
    ready: false,
    connected: false,
    connectBusy: false,
    connectDisabled: false,
    sessionPaused: false,
    localMicEnabled: false,
    workflowLabel: "Binding Pocket Story",
    hint: null,
    elapsedLabel: "0s",
    idleCountdownLabel: "",
    idleSecondsRemaining: null,
    idleMaxSeconds: 0,
    autoSleepEnabled: true,
    sessionNotice: null,
    sessionNoticeTone: "warn",
    openMicArmed: false,
    onConnect: () => {},
    onDisconnect: () => {},
    onPauseToggle: () => {},
    onToggleOpenMic: () => {},
    onAudioInputDeviceChange: () => {},
    onPushToTalkStart: () => {},
    onPushToTalkEnd: () => {},
    onToggleTarget: () => {},
    onOpenFullConsole: () => {},
    ...overrides,
  };
  return render(<VoiceWidget {...props} />);
}

describe("voice widget guardrail notices", () => {
  it("renders session notices in the compact widget path", () => {
    renderVoiceWidget({
      connectDisabled: true,
      sessionNotice: "Local Realtime slots are full, not a length timer.",
    });

    expect(screen.getByText("Local Realtime slots are full, not a length timer.")).toBeTruthy();
  });
});

describe("voice widget minimized overlay controls", () => {
  it("uses the mini primary button to connect while offline", () => {
    window.location.hash = "mini=1";
    const onConnect = vi.fn();
    const onToggleOpenMic = vi.fn();

    renderVoiceWidget({
      overlayMode: true,
      onConnect,
      onToggleOpenMic,
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect session and prepare mic" }));

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onToggleOpenMic).not.toHaveBeenCalled();
  });

  it("also exposes mini power as its own hitbox", () => {
    window.location.hash = "mini=1";
    const onConnect = vi.fn();

    renderVoiceWidget({
      overlayMode: true,
      onConnect,
    });

    fireEvent.click(screen.getByRole("button", { name: "Mini power: Connect session" }));

    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("uses the mini primary button to toggle the mic once connected", () => {
    window.location.hash = "mini=1";
    const onConnect = vi.fn();
    const onToggleOpenMic = vi.fn();

    renderVoiceWidget({
      overlayMode: true,
      connected: true,
      ready: true,
      phase: "ready",
      onConnect,
      onToggleOpenMic,
    });

    fireEvent.click(screen.getByRole("button", { name: "Turn mic on" }));

    expect(onToggleOpenMic).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("lets mini power disconnect while connected", () => {
    window.location.hash = "mini=1";
    const onDisconnect = vi.fn();
    const onToggleOpenMic = vi.fn();

    renderVoiceWidget({
      overlayMode: true,
      connected: true,
      ready: true,
      phase: "ready",
      onDisconnect,
      onToggleOpenMic,
    });

    fireEvent.click(screen.getByRole("button", { name: "Mini power: Disconnect session" }));

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onToggleOpenMic).not.toHaveBeenCalled();
  });
});

describe("voice widget audio input selector", () => {
  it("surfaces the selected audio input on the full overlay widget", () => {
    renderVoiceWidget({
      overlayMode: true,
      audioInputDevices: [
        { deviceId: "default", label: "System Default", source: "default" },
        { deviceId: "headset", label: "Lab Headset", source: "microphone" },
      ],
      selectedAudioInputDeviceId: "headset",
    });

    expect(screen.getByRole("button", { name: "Audio input: Lab Headset. Open audio input menu" })).toBeTruthy();
    expect(screen.getByText("Audio In")).toBeTruthy();
    expect(screen.getByText("Lab Headset")).toBeTruthy();
  });

  it("routes overlay menu audio input changes", () => {
    const onAudioInputDeviceChange = vi.fn();

    renderVoiceWidget({
      overlayMode: true,
      audioInputDevices: [
        { deviceId: "default", label: "System Default", source: "default" },
        { deviceId: "headset", label: "Lab Headset", source: "microphone" },
        { deviceId: "blackhole", label: "BlackHole 2ch", source: "system" },
      ],
      onAudioInputDeviceChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open widget menu" }));
    fireEvent.change(screen.getByLabelText("Audio In"), { target: { value: "blackhole" } });

    expect(onAudioInputDeviceChange).toHaveBeenCalledWith("blackhole");
  });

  it("exposes checkpoint-aware undo in the overlay menu", () => {
    const onUndo = vi.fn();
    renderVoiceWidget({
      overlayMode: true,
      undoAvailable: true,
      onUndo,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open widget menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Undo Last Turn" }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
