// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoiceWidget } from "../../apps/voice-console/src/components/VoiceWidget";

describe("voice widget guardrail notices", () => {
  it("renders session notices in the compact widget path", () => {
    render(
      <VoiceWidget
        target="pymol"
        targetReady
        voiceMode="push_to_talk"
        overlayMode={false}
        phase="idle"
        ready={false}
        connected={false}
        connectBusy={false}
        connectDisabled
        sessionPaused={false}
        localMicEnabled={false}
        workflowLabel="Binding Pocket Story"
        hint={null}
        elapsedLabel="0s"
        idleCountdownLabel=""
        idleSecondsRemaining={null}
        idleMaxSeconds={0}
        autoSleepEnabled
        sessionNotice="Realtime session limit reached."
        sessionNoticeTone="warn"
        openMicArmed={false}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onPauseToggle={() => {}}
        onToggleOpenMic={() => {}}
        onPushToTalkStart={() => {}}
        onPushToTalkEnd={() => {}}
        onToggleTarget={() => {}}
        onOpenFullConsole={() => {}}
      />,
    );

    expect(screen.getByText("Realtime session limit reached.")).toBeTruthy();
  });
});
