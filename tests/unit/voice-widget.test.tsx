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
      sessionNotice: "Realtime session limit reached.",
    });

    expect(screen.getByText("Realtime session limit reached.")).toBeTruthy();
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
