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

// NOTE: The raw-SVG inner-HTML below is safe: SVG templates come from build-time
// `?raw` imports (not user content), and all dynamic substitutions pass through
// `escapeSvgText` in `instrument-svg.ts` before replacement.

export interface VoiceWidgetProps {
  target: TargetKind;
  targetReady: boolean;
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
  openMicArmed: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onPauseToggle: () => void;
  onToggleOpenMic: () => void;
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
  const holdButtonLabel = !props.connected
    ? "Pause unavailable"
    : props.sessionPaused
    ? "Resume session"
    : "Pause session";
  const micArmActive = props.voiceMode === "open_mic" && props.openMicArmed;
  const micArmButtonLabel = micArmActive ? "Return to push to talk" : "Enable open mic";
  const modeLabel = props.voiceMode === "push_to_talk" ? "PTT" : "OPEN";
  const openMicLabel = props.voiceMode === "open_mic" && props.openMicArmed ? "ptt" : "open mic";
  const hint = describeVoiceWidgetHint({
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
  const contextLabel = `${statusLabel.toUpperCase()} • ${modeLabel} • ${props.elapsedLabel}`;
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
    : props.voiceMode === "open_mic"
    ? props.openMicArmed
      ? "open mic live"
      : "arm open mic"
    : "hold to speak";
  const messageLabel = cleanWidgetText(props.hint ?? guidanceMessage);
  const terminalText = props.hint
    ? `LAST > ${compactInstrumentMessage(messageLabel)}`
    : compactInstrumentMessage(messageLabel);

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
        data-pressed-control={overlayPressedControl ?? undefined}
        data-hold-disabled={!props.connected || props.connectBusy ? "true" : undefined}
        data-mic-arm-disabled={props.connectBusy ? "true" : undefined}
        data-overlay-theme={overlayTheme}
        data-overlay-target={props.target}
        data-power-disabled={powerButtonDisabled ? "true" : undefined}
        data-talk-disabled={micDisabled ? "true" : undefined}
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
              className="instrument-hitbox instrument-hitbox-mini-talk"
              type="button"
              aria-label={props.voiceMode === "push_to_talk" ? "Hold to speak" : "Voice session indicator"}
              aria-pressed={micActive}
              disabled={micDisabled}
              onPointerCancel={() => {
                setOverlayPressedControl(null);
                props.onPushToTalkEnd();
              }}
              onPointerDown={() => {
                setOverlayPressedControl("mini-talk");
                props.onPushToTalkStart();
              }}
              onPointerLeave={() => {
                setOverlayPressedControl(null);
                props.onPushToTalkEnd();
              }}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                props.onPushToTalkEnd();
              }}
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
              className={`instrument-svg-shell instrument-svg-shell-full state-${widgetState} ${props.connected ? "is-online" : "is-offline"} ${props.sessionPaused ? "is-paused" : ""} ${props.voiceMode === "open_mic" && props.openMicArmed ? "is-open-mic" : ""}`}
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
              aria-label={props.voiceMode === "push_to_talk" ? "Hold to speak" : "Voice session indicator"}
              aria-pressed={micActive}
              disabled={micDisabled}
              onPointerCancel={() => {
                setOverlayPressedControl(null);
                props.onPushToTalkEnd();
              }}
              onPointerDown={() => {
                setOverlayPressedControl("talk");
                props.onPushToTalkStart();
              }}
              onPointerLeave={() => {
                setOverlayPressedControl(null);
                props.onPushToTalkEnd();
              }}
              onPointerUp={() => {
                setOverlayPressedControl(null);
                props.onPushToTalkEnd();
              }}
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
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={powerButtonActive ? props.onDisconnect : props.onConnect}
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
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={props.connected ? props.onPauseToggle : undefined}
            />
            <button
              className="instrument-hitbox instrument-hitbox-safety"
              type="button"
              aria-label={micArmButtonLabel}
              aria-pressed={micArmActive}
              disabled={props.connectBusy}
              onPointerCancel={() => setOverlayPressedControl(null)}
              onPointerDown={() => setOverlayPressedControl("safety")}
              onPointerLeave={() => setOverlayPressedControl(null)}
              onPointerUp={() => setOverlayPressedControl(null)}
              onClick={props.onToggleOpenMic}
            />
            {overlayMenuOpen ? (
              <div className="instrument-menu" ref={overlayMenuRef} role="menu" aria-label="Widget menu">
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
