import { useEffect, useRef, useState } from "react";
import {
  cleanWidgetText,
  compactInstrumentMessage,
  describeVoiceWidgetHint,
  resolveVoiceWidgetState,
  truncateInstrumentText,
  type VoiceMode,
} from "../lib/voice-widget-state";
import {
  buildInstrumentSvg,
  buildMinimizedInstrumentSvg,
  fullInstrumentDarkSvg,
  fullInstrumentLightSvg,
  miniInstrumentLightSvg,
  miniInstrumentSvg,
  type OverlayTheme,
  type TargetKind,
} from "../lib/instrument-svg";
import {
  readOverlayMiniState,
  readOverlayThemePreference,
  setOverlayMiniState,
  writeOverlayThemePreference,
} from "../lib/overlay-preferences";
import { AudioInputSelect } from "./AudioInputSelect";
import type { AudioInputDeviceSummary } from "./types";

// NOTE: The raw-SVG inner-HTML below is safe: SVG templates come from build-time
// `?raw` imports (not user content), and all dynamic substitutions pass through
// `escapeSvgText` in `instrument-svg.ts` before replacement.

export interface VoiceWidgetProps {
  target: TargetKind;
  targetReady: boolean;
  audioInputDevices: AudioInputDeviceSummary[];
  selectedAudioInputDeviceId: string;
  audioInputDisabled?: boolean;
  voiceMode: VoiceMode;
  overlayMode: boolean;
  phase: string;
  ready: boolean;
  connected: boolean;
  connectBusy: boolean;
  connectDisabled: boolean;
  sessionPaused: boolean;
  localMicEnabled: boolean;
  workflowLabel: string;
  hint: string | null;
  elapsedLabel: string;
  idleCountdownLabel: string;
  idleSecondsRemaining: number | null;
  idleMaxSeconds: number;
  autoSleepEnabled: boolean;
  sessionNotice?: string | null;
  sessionNoticeTone?: "warn" | "error";
  openMicArmed: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onPauseToggle: () => void;
  onToggleOpenMic: () => void;
  undoAvailable?: boolean;
  undoBusy?: boolean;
  undoFeedback?: { tone: "success" | "error"; message: string } | null;
  onUndo?: () => void;
  onAudioInputDeviceChange: (deviceId: string) => void;
  onPushToTalkStart: () => void;
  onPushToTalkEnd: () => void;
  onToggleTarget: () => void;
  onOpenFullConsole: () => void;
  onCloseOverlay?: () => void;
}

export function VoiceWidget(props: VoiceWidgetProps) {
  const [overlayMinimized, setOverlayMinimized] = useState<boolean>(() => readOverlayMiniState());
  const [overlayTheme, setOverlayTheme] = useState<OverlayTheme>(() => readOverlayThemePreference());
  const [overlayPressedControl, setOverlayPressedControl] = useState<string | null>(null);
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
  const overlayMenuRef = useRef<HTMLDivElement | null>(null);
  const overlayConfigButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayActionRef = useRef<{ control: string; atMs: number } | null>(null);

  useEffect(() => {
    if (!props.overlayMode) {
      return;
    }
    const handleHashChange = () => {
      setOverlayMinimized(readOverlayMiniState());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [props.overlayMode]);

  useEffect(() => {
    if (!props.overlayMode) {
      return;
    }
    writeOverlayThemePreference(overlayTheme);
  }, [overlayTheme, props.overlayMode]);

  useEffect(() => {
    if (!overlayMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        setOverlayMenuOpen(false);
        return;
      }
      if (overlayMenuRef.current?.contains(target) || overlayConfigButtonRef.current?.contains(target)) {
        return;
      }
      setOverlayMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOverlayMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [overlayMenuOpen]);

  const widgetState = resolveVoiceWidgetState({
    phase: props.phase,
    connected: props.connected,
    sessionPaused: props.sessionPaused,
    localMicEnabled: props.localMicEnabled,
    ready: props.ready,
    connectBusy: props.connectBusy,
  });
  const showIdleBar =
    props.autoSleepEnabled
    && props.voiceMode === "open_mic"
    && props.openMicArmed
    && widgetState !== "offline"
    && widgetState !== "error"
    && props.idleSecondsRemaining != null
    && props.idleMaxSeconds > 0;
  const idleFraction = showIdleBar
    ? Math.max(0, Math.min(1, (props.idleSecondsRemaining ?? 0) / props.idleMaxSeconds))
    : 0;
  const micDisabled =
    !props.connected
    || props.sessionPaused
    || props.voiceMode !== "push_to_talk"
    || widgetState === "connecting"
    || widgetState === "executing"
    || widgetState === "error";
  const micActive = widgetState === "listening";
  const overlayMicToggleActive =
    props.connected
    && !props.sessionPaused
    && (
      props.localMicEnabled
      || props.phase === "listening"
      || (props.voiceMode === "open_mic" && props.openMicArmed)
    );
  const overlayMicDisabled =
    !props.connected
    || props.connectBusy
    || props.sessionPaused
    || widgetState === "error"
    || (!overlayMicToggleActive && (!props.ready || widgetState === "connecting" || widgetState === "executing"));
  const overlayTalkButtonLabel = overlayMicToggleActive ? "Turn mic off" : "Turn mic on";
  const targetSwitchDisabled = props.connected || props.connectBusy;
  const instrumentLabel = props.target === "pymol" ? "PyMOL" : "ChimeraX";
  const powerButtonActive = props.connected || props.connectBusy;
  const powerButtonDisabled = !powerButtonActive && (props.connectDisabled || !props.targetReady);
  const powerButtonLabel = !powerButtonActive && !props.targetReady
    ? `${instrumentLabel} target not ready`
    : props.connectBusy
    ? "Cancel connection"
    : props.connected
    ? "Disconnect session"
    : "Connect session";
  const miniPrimaryUsesPower = !props.connected;
  const miniPrimaryDisabled = miniPrimaryUsesPower ? powerButtonDisabled : overlayMicDisabled;
  const miniPrimaryLabel = miniPrimaryUsesPower ? "Connect session and prepare mic" : overlayTalkButtonLabel;
  const miniPrimaryPressed = miniPrimaryUsesPower ? powerButtonActive : overlayMicToggleActive;
  const miniPowerButtonLabel = `Mini power: ${powerButtonLabel}`;
  const holdButtonLabel = !props.connected
    ? "Pause unavailable"
    : props.sessionPaused
    ? "Resume session"
    : "Pause session";
  const modeLabel = props.voiceMode === "push_to_talk" ? "PTT" : "OPEN";
  const openMicLabel = props.voiceMode === "open_mic" && props.openMicArmed ? "ptt" : "open mic";
  const selectedAudioInputLabel =
    props.audioInputDevices.find((device) => device.deviceId === props.selectedAudioInputDeviceId)?.label
    ?? "System Default";
  const selectedAudioInputSummary = truncateInstrumentText(selectedAudioInputLabel, 19);
  const hint = props.overlayMode
    ? !props.connected
      ? props.connectBusy
        ? "arming session…"
        : "press power"
      : props.sessionPaused
      ? "resume session"
      : overlayMicToggleActive
      ? "mic on"
      : props.ready
        ? "tap mic on"
        : "wait for ready"
    : describeVoiceWidgetHint({
      widgetState,
      connectBusy: props.connectBusy,
      voiceMode: props.voiceMode,
      openMicArmed: props.openMicArmed,
    });
  const statusLabel = widgetState === "offline"
    ? "offline"
    : widgetState === "connecting"
    ? "arming"
    : widgetState === "executing"
    ? "running"
    : widgetState;
  const contextLabel = props.overlayMode
    ? `${statusLabel.toUpperCase()} • ${props.elapsedLabel}`
    : `${statusLabel.toUpperCase()} • ${modeLabel} • ${props.elapsedLabel}`;
  const guidanceMessage = !props.connected
    ? !props.targetReady
      ? "launch app first"
      : props.connectBusy
      ? "arming session"
      : "press power"
    : props.sessionPaused
    ? "resume session"
    : widgetState === "executing"
    ? "running command"
    : props.overlayMode
    ? overlayMicToggleActive
      ? "mic on"
      : props.ready
        ? "tap mic on"
        : "wait for ready"
    : props.voiceMode === "open_mic"
    ? props.openMicArmed
      ? "open mic live"
      : "arm open mic"
    : "hold to speak";
  const messageLabel = cleanWidgetText(props.hint ?? guidanceMessage);
  const terminalText = props.hint
    ? `LAST > ${compactInstrumentMessage(messageLabel)}`
    : compactInstrumentMessage(messageLabel);
  const logOverlayControl = (control: string, detail?: string) => {
    if (!props.overlayMode) {
      return;
    }
    const suffix = detail ? ` ${detail}` : "";
    console.info(`[overlay-control] ${control}${suffix}`);
  };
  const activateOverlayControl = (control: string, detail: string | undefined, action: () => void) => {
    const now = Date.now();
    const last = overlayActionRef.current;
    if (last && last.control === control && now - last.atMs < 250) {
      return;
    }
    overlayActionRef.current = { control, atMs: now };
    logOverlayControl(control, detail);
    action();
  };
  const activateMiniPrimaryControl = () => {
    if (miniPrimaryDisabled) {
      return;
    }
    if (miniPrimaryUsesPower) {
      activateOverlayControl("mini-talk", powerButtonActive ? "disconnect" : "connect", () => {
        if (powerButtonActive) {
          props.onDisconnect();
          return;
        }
        props.onConnect();
      });
      return;
    }
    activateOverlayControl("mini-talk", overlayMicToggleActive ? "off" : "on", props.onToggleOpenMic);
  };
  const activateMiniPowerControl = () => {
    if (powerButtonDisabled) {
      return;
    }
    activateOverlayControl("mini-power", powerButtonActive ? "disconnect" : "connect", () => {
      if (powerButtonActive) {
        props.onDisconnect();
        return;
      }
      props.onConnect();
    });
  };

  if (props.overlayMode) {
    const fullTemplate = overlayTheme === "light" ? fullInstrumentLightSvg : fullInstrumentDarkSvg;
    const miniTemplate = overlayTheme === "light" ? miniInstrumentLightSvg : miniInstrumentSvg;
    const renderFullSvg = buildInstrumentSvg({
      template: fullTemplate,
      theme: overlayTheme,
      appName: truncateInstrumentText(instrumentLabel, 12),
      statusLabel: statusLabel.toUpperCase(),
      contextText: truncateInstrumentText(contextLabel, 24),
      terminalText,
      powerLabel: truncateInstrumentText(powerButtonActive ? "STOP" : "POWER", 6),
      holdLabel: truncateInstrumentText(props.sessionPaused ? "RESUME" : "PAUSE", 6),
    });
    const renderMiniSvg = buildMinimizedInstrumentSvg({
      template: miniTemplate,
      target: props.target,
      statusText: `${props.target === "pymol" ? "PYMOL" : "CHX"} • ${statusLabel.toUpperCase()}`,
    });
    const toggleOverlayMini = () => {
      setOverlayMiniState(!overlayMinimized);
    };

    return (
      <section
        aria-live="polite"
        className={`voice-widget instrument-overlay instrument-overlay-${widgetState} ${overlayMinimized ? "is-mini" : "is-full"}`}
        data-no-global-ptt="true"
        data-live-mic-active={overlayMicToggleActive ? "true" : "false"}
        data-pressed-control={overlayPressedControl ?? undefined}
        data-hold-disabled={!props.connected || props.connectBusy ? "true" : undefined}
        data-overlay-theme={overlayTheme}
        data-overlay-target={props.target}
        data-power-disabled={powerButtonDisabled ? "true" : undefined}
        data-talk-disabled={(overlayMinimized ? miniPrimaryDisabled : overlayMicDisabled) ? "true" : undefined}
        data-target-switch-disabled={targetSwitchDisabled ? "true" : undefined}
      >
        {overlayMinimized ? (
          <div className="instrument-shell instrument-shell-mini">
            <div
              aria-hidden="true"
              className={`instrument-svg-shell instrument-svg-shell-mini state-${widgetState}`}
              dangerouslySetInnerHTML={{ __html: renderMiniSvg }}
            />
            <button
              className="instrument-hitbox instrument-hitbox-mini-power"
              type="button"
              aria-label={miniPowerButtonLabel}
              aria-pressed={powerButtonActive}
              disabled={powerButtonDisabled}
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("mini-power")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                activateMiniPowerControl();
              }}
              onClick={() => {
                activateMiniPowerControl();
              }}
            />
            <button
              className="instrument-hitbox instrument-hitbox-mini-talk"
              type="button"
              aria-label={miniPrimaryLabel}
              aria-pressed={miniPrimaryPressed}
              disabled={miniPrimaryDisabled}
              onPointerCancel={() => {
                setOverlayPressedControl(null);
              }}
              onPointerDown={() => {
                setOverlayPressedControl("mini-talk");
              }}
              onPointerLeave={() => {
                setOverlayPressedControl(null);
              }}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                activateMiniPrimaryControl();
              }}
              onClick={() => {
                activateMiniPrimaryControl();
              }}
            />
            <button
              className="instrument-hitbox instrument-hitbox-mini-restore"
              type="button"
              aria-label="Restore floating companion"
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("mini-restore")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={toggleOverlayMini}
            />
            <button
              className="instrument-hitbox instrument-hitbox-mini-close"
              type="button"
              aria-label="Close floating companion"
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("mini-close")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={props.onCloseOverlay}
            />
          </div>
        ) : (
          <div className="instrument-shell instrument-shell-full">
            <div
              aria-hidden="true"
              className={`instrument-svg-shell instrument-svg-shell-full state-${widgetState} ${props.connected ? "is-online" : "is-offline"} ${props.sessionPaused ? "is-paused" : ""} ${overlayMicToggleActive ? "is-live-mic" : ""}`}
              dangerouslySetInnerHTML={{ __html: renderFullSvg }}
            />
            <button
              className="instrument-hitbox instrument-hitbox-theme"
              type="button"
              aria-label={`Switch active app to ${props.target === "pymol" ? "ChimeraX" : "PyMOL"}`}
              disabled={targetSwitchDisabled}
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("target")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={props.onToggleTarget}
            />
            <button
              className="instrument-hitbox instrument-hitbox-minimize"
              type="button"
              aria-label="Minimize floating companion"
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("minimize")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={toggleOverlayMini}
            />
            <button
              className="instrument-hitbox instrument-hitbox-close"
              type="button"
              aria-label="Close floating companion"
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("close")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={props.onCloseOverlay}
            />
            <button
              className="instrument-hitbox instrument-hitbox-config"
              type="button"
              aria-label={overlayMenuOpen ? "Close widget menu" : "Open widget menu"}
              aria-expanded={overlayMenuOpen}
              aria-haspopup="menu"
              ref={overlayConfigButtonRef}
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("config")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={() => setOverlayMenuOpen((current) => !current)}
            />
            <button
              className="instrument-hitbox instrument-hitbox-talk"
              type="button"
              aria-label={overlayTalkButtonLabel}
              aria-pressed={overlayMicToggleActive}
              disabled={overlayMicDisabled}
              onPointerCancel={() => {
                setOverlayPressedControl(null);
              }}
              onPointerDown={() => {
                setOverlayPressedControl("talk");
              }}
              onPointerLeave={() => {
                setOverlayPressedControl(null);
              }}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                if (!overlayMicDisabled) {
                  activateOverlayControl("talk", overlayMicToggleActive ? "off" : "on", props.onToggleOpenMic);
                }
              }}
              onClick={() => {
                activateOverlayControl("talk", overlayMicToggleActive ? "off" : "on", props.onToggleOpenMic);
              }}
            />
            <button
              className="instrument-hitbox instrument-hitbox-power"
              type="button"
              aria-label={powerButtonLabel}
              aria-pressed={powerButtonActive}
              disabled={powerButtonDisabled}
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("power")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                if (powerButtonDisabled) {
                  return;
                }
                activateOverlayControl("power", powerButtonActive ? "disconnect" : "connect", () => {
                  if (powerButtonActive) {
                    props.onDisconnect();
                    return;
                  }
                  props.onConnect();
                });
              }}
              onClick={() => {
                activateOverlayControl("power", powerButtonActive ? "disconnect" : "connect", () => {
                  if (powerButtonActive) {
                    props.onDisconnect();
                    return;
                  }
                  props.onConnect();
                });
              }}
            />
            <button
              className="instrument-hitbox instrument-hitbox-hold"
              type="button"
              aria-label={holdButtonLabel}
              aria-pressed={props.connected && props.sessionPaused}
              disabled={!props.connected || props.connectBusy}
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("hold")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                if (!props.connected || props.connectBusy) {
                  return;
                }
                activateOverlayControl("pause", props.sessionPaused ? "resume" : "pause", props.onPauseToggle);
              }}
              onClick={props.connected ? () => {
                activateOverlayControl("pause", props.sessionPaused ? "resume" : "pause", props.onPauseToggle);
              } : undefined}
            />
            <button
              className="instrument-audio-chip"
              type="button"
              aria-label={`Audio input: ${selectedAudioInputLabel}. Open audio input menu`}
              title={`Audio input: ${selectedAudioInputLabel}`}
              onClick={() => setOverlayMenuOpen(true)}
            >
              <span className="instrument-audio-chip-label">Audio In</span>
              <span className="instrument-audio-chip-value">{selectedAudioInputSummary}</span>
            </button>
            {overlayMenuOpen ? (
              <div className="instrument-menu" ref={overlayMenuRef} role="menu" aria-label="Widget menu">
                <AudioInputSelect
                  id="instrument-audio-input"
                  devices={props.audioInputDevices}
                  selectedDeviceId={props.selectedAudioInputDeviceId}
                  onChange={props.onAudioInputDeviceChange}
                  disabled={props.audioInputDisabled}
                  className="instrument-menu-field"
                  labelClassName="instrument-menu-label"
                  selectClassName="instrument-menu-select"
                />
                <button
                  className="instrument-menu-button"
                  role="menuitem"
                  type="button"
                  disabled={!props.undoAvailable || props.undoBusy || !props.onUndo}
                  onClick={() => {
                    props.onUndo?.();
                    setOverlayMenuOpen(false);
                  }}
                >
                  {props.undoBusy ? "Undoing…" : "Undo Last Turn"}
                </button>
                <button
                  className="instrument-menu-button"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOverlayTheme((current) => current === "dark" ? "light" : "dark");
                    setOverlayMenuOpen(false);
                  }}
                >
                  Theme: {overlayTheme === "dark" ? "Dark" : "Light"}
                </button>
                <button
                  className="instrument-menu-button"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOverlayMenuOpen(false);
                    props.onOpenFullConsole();
                  }}
                >
                  Open Console
                </button>
              </div>
            ) : null}
            {props.sessionNotice ? (
              <div className={`voice-widget-notice voice-widget-notice-${props.sessionNoticeTone ?? "warn"}`}>
                {props.sessionNotice}
              </div>
            ) : null}
            {props.undoFeedback ? (
              <div className={`voice-widget-notice voice-widget-notice-${props.undoFeedback.tone}`} role={props.undoFeedback.tone === "error" ? "alert" : "status"}>
                {props.undoFeedback.message}
              </div>
            ) : null}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      className={`voice-widget voice-widget-${widgetState} ${props.overlayMode ? "is-overlay" : ""}`}
      data-no-global-ptt="true"
    >
      <div className="voice-widget-header">
        <div className="voice-widget-header-left">
          <span className={`voice-widget-dot voice-widget-dot-${widgetState}`} />
          <span className="voice-widget-app">{props.target === "pymol" ? "PyMOL" : "ChimeraX"}</span>
          <span className="voice-widget-mode">{modeLabel}</span>
        </div>
        <span className={`voice-widget-badge voice-widget-badge-${widgetState}`}>{widgetState}</span>
      </div>

      <div className="voice-widget-context">
        <div className="voice-widget-context-row">
          <span className="voice-widget-label">workflow</span>
          <div className="voice-widget-value">{props.workflowLabel}</div>
        </div>
        <div className="voice-widget-context-row">
          <span className="voice-widget-label">last</span>
          <div className="voice-widget-value voice-widget-value-muted">{props.hint ?? "—"}</div>
        </div>
      </div>

      {props.sessionNotice ? (
        <div className={`voice-widget-notice voice-widget-notice-${props.sessionNoticeTone ?? "warn"}`}>
          {props.sessionNotice}
        </div>
      ) : null}

      {props.undoFeedback ? (
        <div className={`voice-widget-notice voice-widget-notice-${props.undoFeedback.tone}`} role={props.undoFeedback.tone === "error" ? "alert" : "status"}>
          {props.undoFeedback.message}
        </div>
      ) : null}

      <AudioInputSelect
        id="voice-widget-audio-input"
        devices={props.audioInputDevices}
        selectedDeviceId={props.selectedAudioInputDeviceId}
        onChange={props.onAudioInputDeviceChange}
        disabled={props.audioInputDisabled}
        className="voice-widget-audio-input"
        labelClassName="voice-widget-label"
        selectClassName="voice-widget-select"
      />

      <div className="voice-widget-mic-wrap">
        <button
          aria-label={props.voiceMode === "push_to_talk" ? "Hold to speak" : "Voice session indicator"}
          aria-pressed={micActive}
          className={`voice-widget-mic ${micActive ? "is-listening" : ""} ${micDisabled ? "is-disabled" : ""}`}
          disabled={micDisabled}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && !micDisabled) {
              event.preventDefault();
              props.onPushToTalkStart();
            }
          }}
          onKeyUp={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.altKey && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              props.onPushToTalkEnd();
            }
          }}
          onPointerCancel={props.onPushToTalkEnd}
          onPointerDown={props.onPushToTalkStart}
          onPointerLeave={props.onPushToTalkEnd}
          onPointerUp={props.onPushToTalkEnd}
          type="button"
        >
          <span className="voice-widget-ring" />
          <MicGlyph />
        </button>
        <span className="voice-widget-mic-hint">{hint}</span>
      </div>

      <div className="voice-widget-controls">
        <div className="voice-widget-control-group">
          <button
            className="voice-widget-button"
            disabled={!props.undoAvailable || props.undoBusy || !props.onUndo}
            onClick={props.onUndo}
            title={props.undoAvailable ? "Undo last turn" : "Nothing to undo"}
            type="button"
          >
            {props.undoBusy ? "undoing…" : "undo"}
          </button>
          {!props.connected ? (
            <button
              className="voice-widget-button"
              disabled={props.connectDisabled}
              onClick={props.onConnect}
              type="button"
            >
              {props.connectBusy ? "arming…" : "connect"}
            </button>
          ) : null}
          {props.connected ? (
            <button className="voice-widget-button" onClick={props.onPauseToggle} type="button">
              {props.sessionPaused ? "resume" : "pause"}
            </button>
          ) : null}
          {props.connected ? (
            <button className="voice-widget-button voice-widget-button-end" onClick={props.onDisconnect} type="button">
              end
            </button>
          ) : null}
        </div>
        {props.connected ? (
          <button
            aria-pressed={props.voiceMode === "open_mic" && props.openMicArmed}
            className={`voice-widget-button ${props.voiceMode === "open_mic" && props.openMicArmed ? "is-armed" : ""}`}
            disabled={props.sessionPaused}
            onClick={props.onToggleOpenMic}
            type="button"
          >
            {openMicLabel}
          </button>
        ) : null}
      </div>

      <div className="voice-widget-footer">
        <button className="voice-widget-link" onClick={props.onOpenFullConsole} type="button">
          open full console
        </button>
      </div>

      <div className={`voice-widget-idle ${showIdleBar ? "visible" : ""}`}>
        <span className="voice-widget-idle-label">
          {showIdleBar ? `auto-sleep ${props.idleCountdownLabel}` : ""}
        </span>
        <div className="voice-widget-idle-track" aria-hidden={!showIdleBar}>
          <div className="voice-widget-idle-fill" style={{ width: `${Math.round(idleFraction * 100)}%` }} />
        </div>
      </div>
    </section>
  );
}

function MicGlyph(props: { className?: string }) {
  return (
    <svg className={props.className ?? "voice-widget-mic-icon"} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}
