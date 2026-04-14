import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import type { SessionUiEvent } from "../../../packages/runtime-and-adapters/src/realtime/session-events.js";
import {
  getScientificWorkflowSpec,
  resolveScientificWorkflowRecipeId,
} from "../../../packages/runtime-and-adapters/src/examples/scientific-workflows.js";
import {
  fetchConfig,
  fetchExamples,
  fetchHealth,
  fetchOrganizationUsage,
  runRecipeWorkflow,
  type ManualActionResult,
  type ManualRecipeRunResponse,
  type OrganizationUsageSummaryResponse,
  type RealtimeSessionGuardrails,
  type RuntimeHealthResponse,
  updateSessionRecipe,
  updateSessionTarget,
  updateSessionVoiceMode,
} from "./lib/api";
import {
  buildScientificWorkflowLaunchCards,
  formatScientificInputSummary,
  getScientificWorkflowFromRecipe,
  readScientificWorkflowQueryState,
  type ScientificWorkflowLaunchCard,
} from "./lib/scientific-workflows";
import { resolveIdleDisconnectSeconds } from "./lib/session-guard";
import { useRealtimeConnection } from "./hooks/useRealtimeConnection";
const VoiceWidget = lazy(() =>
  import("./components/VoiceWidget").then((module) => ({ default: module.VoiceWidget })),
);
import { cleanWidgetText } from "./lib/voice-widget-state";
import { Header } from "./components/Header";
import { VoiceStage } from "./components/VoiceStage";
import { QuickWorkflows } from "./components/QuickWorkflows";
import { ArtifactPreview } from "./components/ArtifactPreview";
import { SessionLog } from "./components/SessionLog";
import { ErrorBanner } from "./components/ErrorBanner";
const SettingsShell = lazy(() =>
  import("./components/SettingsShell").then((module) => ({ default: module.SettingsShell })),
);
const OpenMicConfirmDialog = lazy(() =>
  import("./components/OpenMicConfirmDialog").then((module) => ({ default: module.OpenMicConfirmDialog })),
);
import type {
  ArtifactSummary,
  ConnectionState,
  GuardrailsSnapshot,
  LogLine,
  RecipeSummary,
  SettingsTab,
  UsageSnapshot,
  VoiceUiState,
} from "./components/types";

type TargetKind = "pymol" | "chimerax";
type VoiceMode = "push_to_talk" | "open_mic";
type RecipeManifest = {
  id: string;
  title: string;
  goal: string;
  apps: TargetKind[];
  category: string;
  difficulty: string;
  estimatedMinutes: number;
  task: string;
  dataType: string;
  voiceMode: VoiceMode;
  prompts: string[];
  checkpoints: string[];
  utterances: string[];
  sampleData: Array<{
    id: string;
    label: string;
    kind: string;
  }>;
  steps: Array<{
    id: string;
    title: string;
    summary: string;
    actions: Array<Record<string, unknown>>;
  }>;
};
type ToolArtifact = {
  kind: "image" | "session" | "model";
  path: string;
  label: string;
  url?: string;
  mimeType?: string;
};

export function App() {
  const initialQueryTarget = readQueryTarget();
  const initialQueryVoiceMode = readQueryVoiceMode();
  const initialQueryRecipeId = useRef(readQueryRecipeId());
  const initialQueryWidgetMode = useRef(readQueryBoolean("widget"));
  const initialQueryOverlayMode = useRef(readQueryBoolean("overlay"));
  const initialQueryNoSleep = useRef(readQueryBoolean("nosleep"));
  const initialQueryScientific = useRef(readScientificWorkflowQueryState());
  const widgetMode = initialQueryWidgetMode.current;
  const overlayMode = initialQueryOverlayMode.current;
  const initialScientificTarget = initialQueryTarget
    ?? (initialQueryScientific.current.workflowId
      ? getScientificWorkflowSpec(initialQueryScientific.current.workflowId).defaultTarget
      : "pymol");
  const [target, setTarget] = useState<TargetKind>(initialScientificTarget);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(initialQueryVoiceMode ?? "push_to_talk");
  const [autoSleepEnabled] = useState(!initialQueryNoSleep.current);
  const [keyboardPttEnabled] = useState(true);
  const [openMicArmed, setOpenMicArmed] = useState(false);
  const [examples, setExamples] = useState<RecipeManifest[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>(() => defaultServerBaseUrl());
  const [realtimeIdleWarningSeconds, setRealtimeIdleWarningSeconds] = useState(30);
  const [realtimePttIdleDisconnectSeconds, setRealtimePttIdleDisconnectSeconds] = useState(900);
  const [realtimeOpenMicIdleDisconnectSeconds, setRealtimeOpenMicIdleDisconnectSeconds] = useState(180);
  const [realtimeSessionGuardrails, setRealtimeSessionGuardrails] = useState<RealtimeSessionGuardrails>({
    maxSessionMinutes: 25,
    maxResponsesPerSession: 18,
    maxTranscriptionsPerSession: 36,
    maxBillableTokensPerSession: 24000,
    maxActiveSessions: 2,
    warningRatio: 0.8,
  });
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [usageReady, setUsageReady] = useState(false);
  const [realtimeCredentialValidated, setRealtimeCredentialValidated] = useState(false);
  const [usageScopeValidated, setUsageScopeValidated] = useState(false);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthResponse["runtime"] | null>(null);
  const [organizationUsage, setOrganizationUsage] = useState<OrganizationUsageSummaryResponse | null>(null);
  const [organizationUsageError, setOrganizationUsageError] = useState<string | null>(null);
  const [manualRunError, setManualRunError] = useState<string | null>(null);
  const [manualPreviewArtifact, setManualPreviewArtifact] = useState<ArtifactSummary | null>(null);
  const [manualLogEntries, setManualLogEntries] = useState<LogLine[]>([]);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // New-shell state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDrawerLoaded, setSettingsDrawerLoaded] = useState(false);
  const [openMicDialogLoaded, setOpenMicDialogLoaded] = useState(false);
  const [openMicConfirmOpen, setOpenMicConfirmOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("runtime");
  const [quickWorkflowBusyId, setQuickWorkflowBusyId] = useState<string | null>(null);
  const [logClearIndex, setLogClearIndex] = useState(0);

  const sessionSyncRef = useRef<{
    sessionId: string | null;
    skipTarget: boolean;
    skipVoiceMode: boolean;
    skipRecipe: boolean;
  }>({
    sessionId: null,
    skipTarget: false,
    skipVoiceMode: false,
    skipRecipe: false,
  });

  const connection = useRealtimeConnection({
    target,
    voiceMode,
    recipeId: selectedRecipeId,
    muted: false,
    openMicArmed,
    captureRawEvents: false,
    idleDisconnectSeconds: autoSleepEnabled
      ? resolveIdleDisconnectSeconds(voiceMode, realtimePttIdleDisconnectSeconds, realtimeOpenMicIdleDisconnectSeconds)
      : 0,
    idleWarningSeconds: realtimeIdleWarningSeconds,
    sessionGuardrails: realtimeSessionGuardrails,
  });

  useEffect(() => {
    void fetchConfig()
      .then((config) => {
        if (!initialQueryTarget && !initialQueryScientific.current.workflowId) {
          setTarget(config.defaultTarget);
        }
        setPublicBaseUrl(normalizeServerBaseUrl(config.publicBaseUrl));
        setRealtimeIdleWarningSeconds(config.realtimeIdleWarningSeconds);
        setRealtimePttIdleDisconnectSeconds(config.realtimePttIdleDisconnectSeconds);
        setRealtimeOpenMicIdleDisconnectSeconds(config.realtimeOpenMicIdleDisconnectSeconds);
        setRealtimeSessionGuardrails(config.realtimeSessionGuardrails);
        setRealtimeReady(config.realtimeReady);
        setUsageReady(config.usageReady);
        setRealtimeCredentialValidated(config.realtimeCredentialValidated);
        setUsageScopeValidated(config.usageScopeValidated);
        setRuntimeHealth(config.runtime);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setConfigLoaded(true);
      });

    void fetchExamples<RecipeManifest[]>()
      .then((catalog) => {
        setExamples(catalog);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    document.body.classList.toggle("overlay-mode", initialQueryOverlayMode.current);
    return () => {
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  useEffect(() => {
    if (!usageReady || !usageScopeValidated) return;
    void loadOrganizationUsage();
  }, [usageReady, usageScopeValidated]);

  useEffect(() => {
    let cancelled = false;
    const refreshHealth = async () => {
      try {
        const health = await fetchHealth();
        if (cancelled) return;
        setRealtimeIdleWarningSeconds(health.realtimeIdleWarningSeconds);
        setRealtimePttIdleDisconnectSeconds(health.realtimePttIdleDisconnectSeconds);
        setRealtimeOpenMicIdleDisconnectSeconds(health.realtimeOpenMicIdleDisconnectSeconds);
        setRealtimeSessionGuardrails(health.realtimeSessionGuardrails);
        setRealtimeReady(health.realtimeReady);
        setUsageReady(health.usageReady);
        setRealtimeCredentialValidated(health.realtimeCredentialValidated);
        setUsageScopeValidated(health.usageScopeValidated);
        setRuntimeHealth(health.runtime);
      } catch {
        if (cancelled) return;
      }
    };

    void refreshHealth();
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!examples.length) return;

    const queryWorkflowId = initialQueryScientific.current.workflowId;
    const queryRecipeId = initialQueryRecipeId.current;
    if (queryWorkflowId) {
      const resolvedWorkflowRecipeId = resolveScientificWorkflowRecipeId(queryWorkflowId, target);
      if (resolvedWorkflowRecipeId) {
        const queryWorkflowMatch = examples.find((recipe) => recipe.id === resolvedWorkflowRecipeId && recipe.apps.includes(target));
        if (queryWorkflowMatch && selectedRecipeId !== resolvedWorkflowRecipeId) {
          setSelectedRecipeId(resolvedWorkflowRecipeId);
          return;
        }
      }
    }

    if (queryRecipeId) {
      const queryMatch = examples.find((recipe) => recipe.id === queryRecipeId && recipe.apps.includes(target));
      if (queryMatch && selectedRecipeId !== queryRecipeId) {
        setSelectedRecipeId(queryRecipeId);
        initialQueryRecipeId.current = null;
        return;
      }
      if (selectedRecipeId === queryRecipeId) {
        initialQueryRecipeId.current = null;
        return;
      }
    }

    const visibleCurrent = examples.find((recipe) => recipe.id === selectedRecipeId && recipe.apps.includes(target));
    if (visibleCurrent) return;

    const fallback = examples.find((recipe) => recipe.apps.includes(target)) ?? examples[0];
    setSelectedRecipeId(fallback?.id);
  }, [examples, selectedRecipeId, target]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("target") === target) {
      return;
    }
    url.searchParams.set("target", target);
    window.history.replaceState(null, "", url.toString());
  }, [target]);

  useEffect(() => {
    if (voiceMode !== "open_mic" && openMicArmed) {
      setOpenMicArmed(false);
    }
  }, [openMicArmed, voiceMode]);

  useEffect(() => {
    if (!overlayMode) {
      return;
    }
    if (voiceMode !== "open_mic") {
      setVoiceMode("open_mic");
    }
    if (!connection.connected && openMicArmed) {
      setOpenMicArmed(false);
    }
  }, [connection.connected, openMicArmed, overlayMode, voiceMode]);

  useEffect(() => {
    if (connection.sessionId === sessionSyncRef.current.sessionId) {
      return;
    }

    sessionSyncRef.current = {
      sessionId: connection.sessionId,
      skipTarget: Boolean(connection.sessionId),
      skipVoiceMode: Boolean(connection.sessionId),
      skipRecipe: Boolean(connection.sessionId),
    };
  }, [connection.sessionId]);

  useEffect(() => {
    if (!connection.sessionId) return;
    if (sessionSyncRef.current.sessionId === connection.sessionId && sessionSyncRef.current.skipTarget) {
      sessionSyncRef.current.skipTarget = false;
      return;
    }
    if (!connection.sessionAccessToken) return;
    void updateSessionTarget(connection.sessionId, connection.sessionAccessToken, target).catch(() => {});
  }, [connection.sessionAccessToken, connection.sessionId, target]);

  useEffect(() => {
    if (!connection.sessionId) return;
    if (sessionSyncRef.current.sessionId === connection.sessionId && sessionSyncRef.current.skipVoiceMode) {
      sessionSyncRef.current.skipVoiceMode = false;
      return;
    }
    if (!connection.sessionAccessToken) return;
    void updateSessionVoiceMode(connection.sessionId, connection.sessionAccessToken, voiceMode).catch(() => {});
  }, [connection.sessionAccessToken, connection.sessionId, voiceMode]);

  useEffect(() => {
    if (!connection.sessionId) return;
    if (sessionSyncRef.current.sessionId === connection.sessionId && sessionSyncRef.current.skipRecipe) {
      sessionSyncRef.current.skipRecipe = false;
      return;
    }
    if (!connection.sessionAccessToken) return;
    void updateSessionRecipe(connection.sessionId, connection.sessionAccessToken, selectedRecipeId).catch(() => {});
  }, [connection.sessionAccessToken, connection.sessionId, selectedRecipeId]);

  const visibleExamples = examples.filter((recipe) => recipe.apps.includes(target));
  const selectedRecipe = visibleExamples.find((recipe) => recipe.id === selectedRecipeId) ?? null;
  const stageArtifactPreview = findLatestStageArtifactPreview(connection.events);
  const latestWidgetAction = summarizeLatestWidgetAction(connection.events);
  const connectBusy = !connection.connected && (connection.phase === "arming" || connection.phase === "connecting");
  const targetRuntimeReady = target === "pymol" ? runtimeHealth?.targets.pymol.ready : runtimeHealth?.targets.chimerax.ready;
  const targetUnavailable = targetRuntimeReady === false;
  const activeRealtimeSessionCount =
    (runtimeHealth?.sessions.awaitingCall ?? 0)
    + (runtimeHealth?.sessions.connecting ?? 0)
    + (runtimeHealth?.sessions.connected ?? 0);
  const activeSessionCapReached =
    !connection.connected
    && configLoaded
    && activeRealtimeSessionCount >= realtimeSessionGuardrails.maxActiveSessions;
  const manualWorkflowLaunchDisabled = !configLoaded || targetUnavailable || connectBusy || connection.connected;
  const connectDisabled = !configLoaded || !realtimeReady || connectBusy || targetUnavailable || activeSessionCapReached;
  const expandedConsoleHref = buildExpandedConsoleHref();
  const controllerLabel =
    !connection.connected
      ? "OFF"
      : connection.status?.controllerReady
      ? "READY"
      : connection.status?.sidebandStatus?.replaceAll("_", " ").toUpperCase() ?? "WAIT";
  const widgetHint = overlayMode && !["executing", "confirming", "error"].includes(connection.phase)
    ? null
    : latestWidgetAction;
  const realtimeKeyLabel = !configLoaded ? "LOADING" : realtimeReady ? "SET" : "MISSING";
  const usageKeyLabel = !configLoaded ? "LOADING" : usageReady ? "SET" : "MISSING";
  const scientificQueryState = initialQueryScientific.current;
  const scientificLaunchCards: ScientificWorkflowLaunchCard[] = buildScientificWorkflowLaunchCards({
    target,
    baseUrl: publicBaseUrl,
    recipes: visibleExamples,
    workflowId: scientificQueryState.workflowId ?? getScientificWorkflowFromRecipe(selectedRecipe?.id) ?? undefined,
    scientificInputs: scientificQueryState.scientificInputs,
  });
  const activeScientificWorkflowId = scientificQueryState.workflowId ?? getScientificWorkflowFromRecipe(selectedRecipe?.id) ?? null;
  const activeScientificWorkflowCard = activeScientificWorkflowId
    ? scientificLaunchCards.find((card) => card.id === activeScientificWorkflowId) ?? null
    : null;
  const scientificInputSummary = formatScientificInputSummary(scientificQueryState.scientificInputs);
  const scientificInputsPinned = hasScientificInputs(scientificQueryState.scientificInputs);
  const activeIdleDisconnectSeconds = resolveIdleDisconnectSeconds(
    voiceMode,
    realtimePttIdleDisconnectSeconds,
    realtimeOpenMicIdleDisconnectSeconds,
  );
  const idleCountdownLabel = connection.idleSecondsRemaining != null ? formatDuration(connection.idleSecondsRemaining) : "—";
  const [elapsedNow, setElapsedNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!connection.connectedAt) {
      return;
    }
    const timer = window.setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connection.connectedAt]);
  const elapsedLabel = connection.connectedAt ? formatDuration(Math.max(0, Math.floor((elapsedNow - connection.connectedAt) / 1000))) : "0s";
  const widgetWorkflowLabel = selectedRecipe?.title ?? activeScientificWorkflowCard?.title ?? "—";
  const guardrailsSnapshot: GuardrailsSnapshot = {
    voiceMode,
    idleDisconnectSeconds: activeIdleDisconnectSeconds,
    maxSessionMinutes: realtimeSessionGuardrails.maxSessionMinutes,
    maxResponsesPerSession: realtimeSessionGuardrails.maxResponsesPerSession,
    maxTranscriptionsPerSession: realtimeSessionGuardrails.maxTranscriptionsPerSession,
    maxBillableTokensPerSession: realtimeSessionGuardrails.maxBillableTokensPerSession,
    maxActiveSessions: realtimeSessionGuardrails.maxActiveSessions,
    warningRatio: realtimeSessionGuardrails.warningRatio,
    currentResponses: connection.status?.usage?.responseCount,
    currentTranscriptions: connection.status?.usage?.transcriptionCount,
    currentBillableTokens: connection.status?.usageGuardrails?.billableTokens,
    warningActive: connection.status?.usageGuardrails?.warningActive,
    warningMessage: connection.status?.usageGuardrails?.warningMessage,
    breachMessage: connection.status?.usageGuardrails?.breachMessage,
  };
  const sessionNoticeMessage =
    connection.status?.usageGuardrails?.breachMessage
    ?? connection.status?.usageGuardrails?.warningMessage
    ?? (connection.connected && connection.eventStreamState === "stalled"
      ? "Session event stream stalled. Voice may still be live; disconnect and reconnect if you want to avoid blind spend."
      : null)
    ?? (activeSessionCapReached
      ? "Realtime session limit reached. Disconnect another session or wait for a stale setup attempt to expire before starting a new call."
      : null)
    ?? (connection.idleWarningActive
      ? `Idle disconnect in ${idleCountdownLabel}. Start a new turn or pause the session if you want to keep it alive.`
      : null);
  const sessionNoticeTone: "warn" | "error" =
    connection.status?.usageGuardrails?.breachMessage
    || (connection.connected && connection.eventStreamState === "stalled")
      ? "error"
      : "warn";

  const handleSpaceKey = useEffectEvent((event: KeyboardEvent) => {
    if (!keyboardPttEnabled) return;
    if (voiceMode !== "push_to_talk") return;
    if (event.code !== "Space") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();

    if (event.type === "keydown" && !event.repeat) {
      connection.beginPushToTalk();
    }

    if (event.type === "keyup") {
      connection.endPushToTalk();
    }
  });

  useEffect(() => {
    if (!keyboardPttEnabled || voiceMode !== "push_to_talk") {
      return;
    }
    window.addEventListener("keydown", handleSpaceKey);
    window.addEventListener("keyup", handleSpaceKey);
    return () => {
      window.removeEventListener("keydown", handleSpaceKey);
      window.removeEventListener("keyup", handleSpaceKey);
    };
  }, [handleSpaceKey, keyboardPttEnabled, voiceMode]);

  function enableOpenMicAfterConfirmation() {
    setOpenMicConfirmOpen(false);
    setVoiceMode("open_mic");
    setOpenMicArmed(true);
  }

  function requestOpenMic() {
    if (voiceMode === "open_mic" && openMicArmed) {
      setOpenMicArmed(false);
      setVoiceMode("push_to_talk");
      return;
    }

    if (voiceMode === "open_mic") {
      setOpenMicArmed(true);
      return;
    }

    setOpenMicDialogLoaded(true);
    setOpenMicConfirmOpen(true);
  }

  function handleWidgetOpenMicToggle() {
    if (overlayMode) {
      if (!connection.connected || connectBusy || connection.sessionPaused) {
        return;
      }
      if (openMicArmed) {
        setOpenMicArmed(false);
        return;
      }
      if (!connection.ready || ["executing", "confirming", "error"].includes(connection.phase)) {
        return;
      }
      if (voiceMode !== "open_mic") {
        setVoiceMode("open_mic");
      }
      setOpenMicArmed(true);
      return;
    }

    if (voiceMode === "open_mic" && openMicArmed) {
      setOpenMicArmed(false);
      setVoiceMode("push_to_talk");
      return;
    }

    if (voiceMode !== "open_mic") {
      requestOpenMic();
      return;
    }

    setOpenMicArmed((value) => !value);
  }

  async function loadOrganizationUsage(): Promise<void> {
    setOrganizationUsageError(null);
    try {
      const summary = await fetchOrganizationUsage(7);
      setOrganizationUsage(summary);
    } catch (error) {
      setOrganizationUsageError(error instanceof Error ? error.message : String(error));
    }
  }

  if (widgetMode) {
    return (
      <div className={`app-shell widget-shell ${overlayMode ? "overlay-shell" : ""}`}>
        <audio ref={connection.remoteAudioRef} />
        <main className={`widget-shell-main ${overlayMode ? "overlay-shell-main" : ""}`}>
          <Suspense fallback={<div className="widget-shell-loading" aria-hidden="true" />}>
          <VoiceWidget
            autoSleepEnabled={autoSleepEnabled}
            connectBusy={connectBusy}
            connectDisabled={connectDisabled}
            connected={connection.connected}
            hint={widgetHint}
            idleCountdownLabel={idleCountdownLabel}
            idleMaxSeconds={activeIdleDisconnectSeconds}
            idleSecondsRemaining={connection.idleSecondsRemaining}
            localMicEnabled={connection.localMicEnabled}
            elapsedLabel={elapsedLabel}
            onConnect={() => void connection.connect()}
            onDisconnect={() => void connection.disconnect("Session manually disconnected from the widget.")}
            onOpenFullConsole={() => {
              if (overlayMode) {
                window.open(expandedConsoleHref, "_blank", "noopener,noreferrer");
                return;
              }
              window.location.assign(expandedConsoleHref);
            }}
            onCloseOverlay={overlayMode ? () => window.close() : undefined}
            onPauseToggle={() => (connection.sessionPaused ? connection.resumeSession() : connection.pauseSession())}
            onPushToTalkEnd={() => connection.endPushToTalk()}
            onPushToTalkStart={() => connection.beginPushToTalk()}
            overlayMode={overlayMode}
            onToggleOpenMic={handleWidgetOpenMicToggle}
            onToggleTarget={() => setTarget((current) => (current === "pymol" ? "chimerax" : "pymol"))}
            openMicArmed={openMicArmed}
            phase={connection.phase}
            ready={connection.ready}
            sessionPaused={connection.sessionPaused}
            sessionNotice={sessionNoticeMessage}
            sessionNoticeTone={sessionNoticeTone}
            target={target}
            targetReady={!targetUnavailable}
            voiceMode={voiceMode}
            workflowLabel={widgetWorkflowLabel}
          />
          </Suspense>
        </main>
        {openMicDialogLoaded ? (
          <Suspense fallback={null}>
            <OpenMicConfirmDialog
              open={openMicConfirmOpen}
              onCancel={() => setOpenMicConfirmOpen(false)}
              onConfirm={enableOpenMicAfterConfirmation}
              guardrails={guardrailsSnapshot}
            />
          </Suspense>
        ) : null}
      </div>
    );
  }

  // --- Derived values for the new shell layout ---

  const connectionState: ConnectionState = connection.error && connection.phase !== "idle"
    ? "error"
    : connection.connected
      ? "connected"
      : connectBusy
        ? "connecting"
        : "offline";

  const voiceUiState: VoiceUiState = (() => {
    if (connection.localMicEnabled || connection.phase === "listening") return "listening";
    if (["transcribing", "planning"].includes(connection.phase)) return "processing";
    if (["executing", "confirming"].includes(connection.phase)) return "executing";
    return "idle";
  })();

  const micDisabledForStage =
    !connection.connected
    || connection.sessionPaused
    || voiceMode !== "push_to_talk"
    || voiceUiState === "executing"
    || voiceUiState === "processing";

  const latestUserTranscript = (() => {
    for (let i = connection.events.length - 1; i >= 0; i -= 1) {
      const event = connection.events[i];
      if (event?.kind === "transcript" && event.speaker === "user" && event.text) {
        return cleanWidgetText(event.text);
      }
    }
    return "";
  })();

  const transcriptForStage = voiceUiState === "listening"
    ? latestUserTranscript || "Listening…"
    : voiceUiState === "processing"
      ? latestUserTranscript
      : voiceUiState === "executing"
        ? widgetHint ?? ""
        : latestUserTranscript;

  const quickWorkflows: RecipeSummary[] = visibleExamples.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    goal: recipe.goal,
    apps: recipe.apps,
    category: recipe.category,
    estimatedMinutes: recipe.estimatedMinutes,
    prompts: recipe.prompts,
  }));

  const artifactForPreview = chooseLatestArtifactPreview(stageArtifactPreview, manualPreviewArtifact);

  const eventLogEntries: LogLine[] = connection.events
    .slice(logClearIndex)
    .slice(-80)
    .flatMap<LogLine>((event) => {
      const timestamp = new Date(event.timestamp);
      if (event.kind === "transcript" && event.text) {
        return [{
          id: event.id,
          timestamp,
          type: "transcript",
          message: event.text,
        }];
      }
      if (event.kind === "tool_call" && event.payload && typeof event.payload === "object") {
        const toolName = (event.payload as { toolName?: string }).toolName ?? "tool";
        return [{
          id: event.id,
          timestamp,
          type: "command",
          message: toolName.replaceAll("_", " "),
        }];
      }
      if (event.kind === "tool_result" && event.text) {
        return [{
          id: event.id,
          timestamp,
          type: "success",
          message: cleanWidgetText(event.text),
        }];
      }
      if (event.kind === "log" && event.level === "error" && event.text) {
        return [{
          id: event.id,
          timestamp,
          type: "error",
          message: cleanWidgetText(event.text),
        }];
      }
      if (event.kind === "log" && event.text) {
        return [{
          id: event.id,
          timestamp,
          type: "system",
          message: cleanWidgetText(event.text),
        }];
      }
      return [];
    });
  const logEntries = [...eventLogEntries, ...manualLogEntries]
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    .slice(-80);

  const runtimeSnapshot = {
    data: connection.ready ? "READY" : connection.dataChannelReady ? "WAIT" : "CLOSED",
    eventStream: connection.eventStreamState.toUpperCase(),
    controller: controllerLabel,
    phase: connection.phase.toUpperCase(),
  };

  const authSnapshot = {
    realtimeKey: realtimeKeyLabel,
    realtimeValid: realtimeCredentialValidated,
    usageKey: usageKeyLabel,
    usageValid: usageScopeValidated,
  };

  const usageSnapshot: UsageSnapshot | undefined = organizationUsage
    ? {
        currentMonth: `Last ${organizationUsage.windowDays}d`,
        dollarsSpent: organizationUsage.totals.costUsd,
        totalTokens:
          organizationUsage.totals.inputTokens
          + organizationUsage.totals.outputTokens
          + organizationUsage.totals.inputAudioTokens
          + organizationUsage.totals.outputAudioTokens,
      }
    : undefined;

  const rawBannerMessage = manualRunError ?? loadError ?? connection.error ?? organizationUsageError ?? null;
  const bannerMessage = rawBannerMessage && rawBannerMessage !== dismissedError ? rawBannerMessage : null;

  const dismissBanner = () => {
    if (rawBannerMessage) {
      setDismissedError(rawBannerMessage);
    }
    setManualRunError(null);
  };

  const handleThemeToggle = () => {
    setIsDarkMode((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      try {
        window.localStorage.setItem("theme", next ? "dark" : "light");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  };

  const handleClearLog = () => {
    setLogClearIndex(connection.events.length);
    setManualLogEntries([]);
  };

  const handleOpenSettings = () => {
    setSettingsDrawerLoaded(true);
    setSettingsOpen(true);
  };

  const handleLaunchQuickWorkflow = async (workflow: RecipeSummary) => {
    setSelectedRecipeId(workflow.id);
    setQuickWorkflowBusyId(workflow.id);
    setManualRunError(null);
    try {
      const result = await runRecipeWorkflow({
        recipeId: workflow.id,
        target,
      });
      const completedAt = new Date();
      const latestImageArtifact = findLatestImageArtifactInManualRun(result);
      if (latestImageArtifact) {
        setManualPreviewArtifact({
          id: latestImageArtifact.path,
          kind: latestImageArtifact.kind,
          url: latestImageArtifact.url,
          label: latestImageArtifact.label,
          timestamp: completedAt.toISOString(),
        });
      }
      setManualLogEntries((previous) => [
        ...previous,
        buildManualWorkflowSuccessLogEntry(workflow, result, completedAt),
      ].slice(-20));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date();
      setManualRunError(message);
      setManualLogEntries((previous) => [
        ...previous,
        buildManualWorkflowFailureLogEntry(workflow, message, failedAt),
      ].slice(-20));
    } finally {
      setQuickWorkflowBusyId(null);
    }
  };

  const handlePowerClick = () => {
    if (connection.connected) {
      void connection.disconnect("Session manually disconnected from the console.");
      return;
    }
    void connection.connect();
  };

  const handleToggleTarget = (next: typeof target) => {
    if (next === target) return;
    setTarget(next);
  };

  const appName = target === "pymol" ? "BioVoice · PyMOL" : "BioVoice · ChimeraX";

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-50 font-sans selection:bg-cyan-500/30 flex flex-col overflow-hidden transition-colors duration-300">
      <audio ref={connection.remoteAudioRef} />

      <Header
        appName={appName}
        target={target}
        onTargetChange={handleToggleTarget}
        targetSwitchDisabled={connection.connected || connectBusy}
        connectionState={connectionState}
        onPowerClick={handlePowerClick}
        powerBusy={connectBusy}
        powerDisabled={connectDisabled && !connection.connected}
        isDarkMode={isDarkMode}
        onThemeToggle={handleThemeToggle}
        onSettingsClick={handleOpenSettings}
      />

      <ErrorBanner message={bannerMessage} onDismiss={dismissBanner} />
      {sessionNoticeMessage ? (
        <div className="mx-6 mt-4 rounded-2xl border border-amber-300/70 dark:border-amber-700/50 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
          {sessionNoticeMessage}
        </div>
      ) : null}

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 overflow-hidden">
        <div className="lg:col-span-7 flex flex-col gap-6 overflow-hidden min-h-0">
          <VoiceStage
            connectionState={connectionState}
            phase={connection.phase}
            voiceUiState={voiceUiState}
            voiceMode={voiceMode}
            onVoiceModeChange={setVoiceMode}
            transcript={transcriptForStage}
            onPushToTalkStart={() => connection.beginPushToTalk()}
            onPushToTalkEnd={() => connection.endPushToTalk()}
            micDisabled={micDisabledForStage}
            openMicArmed={openMicArmed}
            onToggleOpenMic={handleWidgetOpenMicToggle}
            hint={widgetHint}
          />

          <QuickWorkflows
            workflows={quickWorkflows}
            onLaunch={(workflow) => { void handleLaunchQuickWorkflow(workflow); }}
            disabled={manualWorkflowLaunchDisabled}
            busyId={quickWorkflowBusyId}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6 overflow-hidden min-h-0">
          <ArtifactPreview artifact={artifactForPreview} />
          <SessionLog entries={logEntries} onClear={handleClearLog} />
        </div>
      </main>

      {settingsDrawerLoaded ? (
        <Suspense fallback={null}>
          <SettingsShell
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            runtimeHealth={runtimeSnapshot}
            auth={authSnapshot}
            guardrails={guardrailsSnapshot}
            usage={usageSnapshot}
            activeTab={activeSettingsTab}
            onTabChange={setActiveSettingsTab}
            workflowsPanelProps={{
              target,
              recipes: quickWorkflows.map((recipe) => ({
                id: recipe.id,
                title: recipe.title,
                goal: recipe.goal,
                category: recipe.category,
                estimatedMinutes: recipe.estimatedMinutes,
              })),
              selectedRecipeId,
              onSelectRecipe: setSelectedRecipeId,
              onLaunchRecipe: (recipeId) => {
                const workflow = quickWorkflows.find((item) => item.id === recipeId);
                if (workflow) {
                  void handleLaunchQuickWorkflow(workflow);
                }
              },
              scientificLaunchCards: scientificLaunchCards.map((card) => ({
                id: card.id,
                title: card.title,
                summary: card.summary,
                group: card.group,
                intent: card.intent,
                bestRecipeId: card.bestRecipeId,
                inputHints: card.inputHints,
                voiceStarter: card.voiceStarter,
              })),
              activeScientificWorkflowId,
              scientificInputSummary,
              scientificInputsPinned,
              busyRecipeId: quickWorkflowBusyId,
              launchDisabled: manualWorkflowLaunchDisabled,
            }}
          />
        </Suspense>
      ) : null}
      {openMicDialogLoaded ? (
        <Suspense fallback={null}>
          <OpenMicConfirmDialog
            open={openMicConfirmOpen}
            onCancel={() => setOpenMicConfirmOpen(false)}
            onConfirm={enableOpenMicAfterConfirmation}
            guardrails={guardrailsSnapshot}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function hasScientificInputs(inputs: { uniprot?: string; model?: string; experimental?: string; pae?: string; map?: string; bundle?: string; scorefile?: string; topN?: number } | undefined): boolean {
  if (!inputs) {
    return false;
  }

  return Boolean(
    inputs.uniprot ||
    inputs.model ||
    inputs.experimental ||
    inputs.pae ||
    inputs.map ||
    inputs.bundle ||
    inputs.scorefile ||
    typeof inputs.topN === "number",
  );
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "0s";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) {
    return `${seconds}s`;
  }
  if (!seconds) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function readQueryTarget(): TargetKind | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("target");
  return value === "pymol" || value === "chimerax" ? value : null;
}

function readQueryVoiceMode(): VoiceMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("voice");
  return value === "push_to_talk" || value === "open_mic" ? value : null;
}

function readQueryRecipeId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("recipe");
  return value && value.trim() ? value.trim() : null;
}

function readQueryBoolean(name: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const value = new URLSearchParams(window.location.search).get(name);
  return value === "1" || value === "true";
}

function defaultServerBaseUrl(): string {
  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }

  const { protocol, hostname, port } = window.location;
  if (port === "5173") {
    return `${protocol}//${hostname}:3000`;
  }

  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function normalizeServerBaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    return defaultServerBaseUrl();
  }

  try {
    return new URL(value).origin;
  } catch {
    return defaultServerBaseUrl();
  }
}

function hydrateArtifacts(
  artifacts: Array<{
    kind: "image" | "session" | "model";
    path: string;
    label: string;
    url?: string;
    mimeType?: string;
  }>,
): ToolArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    url: artifact.url ?? `/api/artifacts?path=${encodeURIComponent(artifact.path)}`,
  }));
}

export function buildManualWorkflowSuccessLogEntry(
  workflow: Pick<RecipeSummary, "id" | "title">,
  result: ManualRecipeRunResponse | ManualActionResult,
  timestamp = new Date(),
): LogLine {
  const artifacts = extractArtifactsFromManualRun(result);
  const primaryArtifact = findLatestImageArtifactInManualRun(result) ?? artifacts.at(-1) ?? null;
  const stepSummary = "stepResults" in result
    ? ` (${result.stepResults.length} step${result.stepResults.length === 1 ? "" : "s"})`
    : "";
  const artifactSummary = primaryArtifact
    ? ` · ${primaryArtifact.label}`
    : artifacts.length
      ? ` · ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`
      : "";

  return {
    id: `manual-run-${workflow.id}-${timestamp.getTime()}`,
    timestamp,
    type: "success",
    message: `Finished ${workflow.title}${stepSummary}${artifactSummary}`,
  };
}

export function buildManualWorkflowFailureLogEntry(
  workflow: Pick<RecipeSummary, "id" | "title">,
  message: string,
  timestamp = new Date(),
): LogLine {
  return {
    id: `manual-run-${workflow.id}-error-${timestamp.getTime()}`,
    timestamp,
    type: "error",
    message: `Failed ${workflow.title}: ${message}`,
  };
}

function extractArtifactsFromManualRun(result: ManualRecipeRunResponse | ManualActionResult): ToolArtifact[] {
  if ("stepResults" in result) {
    return hydrateArtifacts(
      result.stepResults.flatMap((step) => step.result.artifacts),
    );
  }
  return hydrateArtifacts(result.artifacts);
}

function extractArtifacts(event: SessionUiEvent): ToolArtifact[] {
  const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as { artifacts?: unknown };
  if (!Array.isArray(payload.artifacts)) {
    return [];
  }
  return hydrateArtifacts(
    payload.artifacts
      .filter((artifact): artifact is ToolArtifact => Boolean(artifact && typeof artifact === "object" && typeof (artifact as ToolArtifact).path === "string" && typeof (artifact as ToolArtifact).label === "string")),
  );
}

function summarizeLatestWidgetAction(events: SessionUiEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.kind === "tool_result" && event.text) {
      return cleanWidgetText(event.text);
    }
    if (event.kind === "tool_call" && event.payload && typeof event.payload === "object") {
      const toolName = (event.payload as { toolName?: string }).toolName;
      if (toolName) {
        return describeToolName(toolName);
      }
    }
    if (event.kind === "log" && event.level === "error" && event.text) {
      return cleanWidgetText(event.text);
    }
  }
  return null;
}

function describeToolName(toolName: string): string {
  switch (toolName) {
    case "run_pymol_actions":
      return "running PyMOL actions";
    case "run_chimerax_actions":
      return "running ChimeraX actions";
    case "run_scientific_workflow":
      return "staging scientific workflow";
    case "capture_view":
      return "capturing current view";
    case "export_artifact":
      return "exporting artifact";
    default:
      return toolName.replaceAll("_", " ");
  }
}

export function findLatestStageArtifactPreview(events: SessionUiEvent[]): ArtifactSummary | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const artifacts = extractArtifacts(event);
    const imageArtifact = artifacts.find((artifact) => artifact.kind === "image" && typeof artifact.url === "string");
    if (imageArtifact) {
      return {
        id: imageArtifact.path,
        kind: imageArtifact.kind,
        url: imageArtifact.url,
        label: imageArtifact.label,
        timestamp: event.timestamp,
      };
    }
  }
  return null;
}

function findLatestImageArtifactInManualRun(result: ManualRecipeRunResponse | ManualActionResult): ToolArtifact | null {
  const artifacts = extractArtifactsFromManualRun(result);
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];
    if (artifact?.kind === "image" && typeof artifact.url === "string") {
      return artifact;
    }
  }
  return null;
}

export function chooseLatestArtifactPreview(
  stageArtifact: ArtifactSummary | null,
  manualArtifact: ArtifactSummary | null,
): ArtifactSummary | null {
  if (!stageArtifact) {
    return manualArtifact;
  }
  if (!manualArtifact) {
    return stageArtifact;
  }
  const stageTimestamp = stageArtifact.timestamp ? Date.parse(stageArtifact.timestamp) : 0;
  const manualTimestamp = manualArtifact.timestamp ? Date.parse(manualArtifact.timestamp) : 0;
  return manualTimestamp >= stageTimestamp ? manualArtifact : stageArtifact;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, input, select, textarea, a[href], summary, [contenteditable=\"true\"], [role=\"button\"], [role=\"textbox\"], [role=\"link\"], [role=\"menuitem\"], [data-no-global-ptt=\"true\"]",
    ),
  );
}

function buildExpandedConsoleHref(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("widget");
  url.searchParams.delete("overlay");
  return url.toString();
}
