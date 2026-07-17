import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { SessionUiEvent } from "../../../packages/runtime-and-adapters/src/realtime/session-events.js";
import {
  getScientificWorkflowSpec,
  resolveScientificWorkflowRecipeId,
  type ScientificLaunchInputs,
} from "../../../packages/runtime-and-adapters/src/examples/scientific-workflows.js";
import type { ScientificWorkflowKind } from "../../../packages/runtime-and-adapters/src/schemas/scientific.js";
import {
  fetchConfig,
  fetchDoctor,
  fetchExamples,
  fetchHealth,
  fetchOrganizationUsage,
  fetchRunReceipts,
  grantNextViewportShare,
  runRecipeWorkflow,
  runScientificWorkflow,
  undoLastTurn,
  type DoctorResponse,
  type ManualActionResult,
  type ManualRecipeRunResponse,
  type OrganizationUsageSummaryResponse,
  type ResponseLanguageMode,
  type RealtimeSessionGuardrails,
  type RuntimeHealthResponse,
  type RunReceiptSummary,
  updateSessionResponseLanguageMode,
  updateSessionRecipe,
  updateSessionTarget,
  updateSessionVoiceMode,
} from "./lib/api";
import {
  buildScientificWorkflowLaunchCards,
  buildScientificWorkflowInputs,
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
  AudioInputDeviceSummary,
  AudioInputSourceKind,
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
type UndoNotice = { tone: "success" | "error"; message: string };
const DEFAULT_AUDIO_INPUT_DEVICE_ID = "default";
const AUDIO_INPUT_STORAGE_KEY = "biovoice.audioInputDeviceId";
const VIRTUAL_AUDIO_INPUT_PATTERN = /blackhole|loopback|soundflower|background music|audio hijack|rogue amoeba|obs|vb-audio|cable output|system audio|aggregate|multi-output/i;
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
  const initialQueryResponseLanguageMode = readQueryResponseLanguageMode();
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
  const [responseLanguageMode, setResponseLanguageMode] = useState<ResponseLanguageMode>(initialQueryResponseLanguageMode ?? "standard");
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
    maxBillableTokensPerSession: 120000,
    maxActiveSessions: 2,
    warningRatio: 0.8,
  });
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [usageReady, setUsageReady] = useState(false);
  const [captureUploadsEnabled, setCaptureUploadsEnabled] = useState(false);
  const [captureShareState, setCaptureShareState] = useState<"idle" | "busy" | "granted" | "error">("idle");
  const [realtimeCredentialValidated, setRealtimeCredentialValidated] = useState(false);
  const [usageScopeValidated, setUsageScopeValidated] = useState(false);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthResponse["runtime"] | null>(null);
  const [managedScientificLaunch, setManagedScientificLaunch] = useState<{
    target: TargetKind;
    workflowId?: ScientificWorkflowKind;
    scientificInputs: ScientificLaunchInputs;
  } | null>(null);
  const [manualScientificWorkflowId, setManualScientificWorkflowId] = useState<ScientificWorkflowKind | null>(null);
  const [organizationUsage, setOrganizationUsage] = useState<OrganizationUsageSummaryResponse | null>(null);
  const [organizationUsageError, setOrganizationUsageError] = useState<string | null>(null);
  const [manualRunError, setManualRunError] = useState<string | null>(null);
  const [manualPreviewArtifact, setManualPreviewArtifact] = useState<ArtifactSummary | null>(null);
  const [manualLogEntries, setManualLogEntries] = useState<LogLine[]>([]);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<DoctorResponse | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(true);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [runReceipts, setRunReceipts] = useState<RunReceiptSummary[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoNotice, setUndoNotice] = useState<UndoNotice | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDeviceSummary[]>(() => [
    buildDefaultAudioInputDevice(),
  ]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string>(() => readStoredAudioInputDeviceId());

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
  const lastStatusResponseLanguageModeRef = useRef<ResponseLanguageMode | null>(null);
  const selectedAudioInputSource = resolveSelectedAudioInputSource(audioInputDevices, selectedAudioInputDeviceId);
  const runtimeHealthMountedRef = useRef(true);
  const previousConnectedRef = useRef(false);
  const openMicConfirmedRef = useRef(false);
  const operatorStateMountedRef = useRef(true);
  const lastToolResultRefreshRef = useRef<string | null>(null);
  const captureShareExpiryTimerRef = useRef<number | null>(null);
  const lastCaptureToolCallRef = useRef<string | null>(null);

  const sessionSyncRef = useRef<{
    sessionId: string | null;
    skipTarget: boolean;
    skipVoiceMode: boolean;
    skipResponseLanguageMode: boolean;
    skipRecipe: boolean;
  }>({
    sessionId: null,
    skipTarget: false,
    skipVoiceMode: false,
    skipResponseLanguageMode: false,
    skipRecipe: false,
  });

  const connection = useRealtimeConnection({
    target,
    voiceMode,
    responseLanguageMode,
    recipeId: selectedRecipeId,
    muted: false,
    audioInputDeviceId: selectedAudioInputDeviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID ? null : selectedAudioInputDeviceId,
    audioInputSource: selectedAudioInputSource,
    openMicArmed,
    captureRawEvents: false,
    idleDisconnectSeconds: autoSleepEnabled
      ? resolveIdleDisconnectSeconds(voiceMode, realtimePttIdleDisconnectSeconds, realtimeOpenMicIdleDisconnectSeconds)
      : 0,
    idleWarningSeconds: realtimeIdleWarningSeconds,
    sessionGuardrails: realtimeSessionGuardrails,
  });

  const refreshDoctorState = useCallback(async () => {
    setDoctorLoading(true);
    try {
      const snapshot = await fetchDoctor(target);
      if (operatorStateMountedRef.current) {
        setDoctor(snapshot);
        setDoctorError(null);
      }
    } catch (error) {
      if (operatorStateMountedRef.current) {
        setDoctorError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operatorStateMountedRef.current) setDoctorLoading(false);
    }
  }, [target]);

  const refreshRunReceipts = useCallback(async () => {
    setReceiptsLoading(true);
    setReceiptsError(null);
    try {
      const receipts = await fetchRunReceipts(20);
      if (operatorStateMountedRef.current) setRunReceipts(receipts);
    } catch (error) {
      if (operatorStateMountedRef.current) {
        setReceiptsError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operatorStateMountedRef.current) setReceiptsLoading(false);
    }
  }, []);

  const refreshAudioInputs = useEffectEvent(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setAudioInputDevices([buildDefaultAudioInputDevice()]);
      return;
    }

    const mediaDevices = await navigator.mediaDevices.enumerateDevices();
    const nextDevices = buildAudioInputDeviceSummaries(mediaDevices);
    setAudioInputDevices(nextDevices);
    setSelectedAudioInputDeviceId((current) => {
      if (nextDevices.some((device) => device.deviceId === current)) {
        return current;
      }
      writeStoredAudioInputDeviceId(DEFAULT_AUDIO_INPUT_DEVICE_ID);
      return DEFAULT_AUDIO_INPUT_DEVICE_ID;
    });
  });

  useEffect(() => {
    void refreshAudioInputs().catch(() => {
      setAudioInputDevices([buildDefaultAudioInputDevice()]);
    });

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshAudioInputs().catch(() => {});
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshAudioInputs]);

  useEffect(() => {
    if (!connection.connected) {
      return;
    }
    void refreshAudioInputs().catch(() => {});
  }, [connection.connected, refreshAudioInputs]);

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
        setCaptureUploadsEnabled(config.captureUploadsEnabled);
        setRealtimeCredentialValidated(config.realtimeCredentialValidated);
        setUsageScopeValidated(config.usageScopeValidated);
        setRuntimeHealth(config.runtime);
        setManagedScientificLaunch(config.managedScientificLaunch ?? null);
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

  const refreshRuntimeHealth = useEffectEvent(async () => {
    try {
      const health = await fetchHealth();
      if (!runtimeHealthMountedRef.current) return;
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
      // Keep the last health snapshot visible until the next successful poll.
    }
  });

  useEffect(() => {
    runtimeHealthMountedRef.current = true;
    void refreshRuntimeHealth();
    const timer = window.setInterval(() => {
      void refreshRuntimeHealth();
    }, 10_000);

    return () => {
      runtimeHealthMountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refreshRuntimeHealth]);

  useEffect(() => {
    operatorStateMountedRef.current = true;
    void refreshDoctorState();
    const timer = window.setInterval(() => {
      void refreshDoctorState();
    }, 20_000);
    return () => {
      operatorStateMountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refreshDoctorState]);

  useEffect(() => {
    if (!settingsOpen || activeSettingsTab !== "runs") return;
    void refreshRunReceipts();
  }, [activeSettingsTab, refreshRunReceipts, settingsOpen]);

  useEffect(() => {
    const wasConnected = previousConnectedRef.current;
    previousConnectedRef.current = connection.connected;
    if (!wasConnected || connection.connected) {
      return;
    }

    setRuntimeHealth((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        sessions: {
          ...current.sessions,
          total: Math.max(0, current.sessions.total - 1),
          active: Math.max(0, current.sessions.active - 1),
          connected: Math.max(0, current.sessions.connected - 1),
        },
      };
    });
    void refreshRuntimeHealth();
  }, [connection.connected, refreshRuntimeHealth]);

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
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    const shouldEnable = responseLanguageMode === "klingon";
    const alreadyEnabled = url.searchParams.get("klingon") === "1";
    if (shouldEnable === alreadyEnabled && !url.searchParams.has("response_language")) {
      return;
    }
    if (shouldEnable) {
      url.searchParams.set("klingon", "1");
    } else {
      url.searchParams.delete("klingon");
    }
    url.searchParams.delete("response_language");
    window.history.replaceState(null, "", url.toString());
  }, [responseLanguageMode]);

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
      skipResponseLanguageMode: Boolean(connection.sessionId),
      skipRecipe: Boolean(connection.sessionId),
    };
  }, [connection.sessionId]);

  useEffect(() => {
    if (captureShareExpiryTimerRef.current !== null) {
      window.clearTimeout(captureShareExpiryTimerRef.current);
      captureShareExpiryTimerRef.current = null;
    }
    lastCaptureToolCallRef.current = null;
    setCaptureShareState("idle");
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
    if (sessionSyncRef.current.sessionId === connection.sessionId && sessionSyncRef.current.skipResponseLanguageMode) {
      sessionSyncRef.current.skipResponseLanguageMode = false;
      return;
    }
    if (connection.status?.responseLanguageMode === responseLanguageMode) return;
    if (!connection.sessionAccessToken) return;
    void updateSessionResponseLanguageMode(connection.sessionId, connection.sessionAccessToken, responseLanguageMode).catch(() => {});
  }, [connection.sessionAccessToken, connection.sessionId, connection.status?.responseLanguageMode, responseLanguageMode]);

  useEffect(() => {
    const mode = connection.status?.responseLanguageMode;
    if (mode !== "standard" && mode !== "klingon") {
      return;
    }
    if (lastStatusResponseLanguageModeRef.current === mode) {
      return;
    }
    lastStatusResponseLanguageModeRef.current = mode;
    setResponseLanguageMode(mode);
  }, [connection.status?.responseLanguageMode]);

  useEffect(() => {
    if (!connection.sessionId) return;
    if (sessionSyncRef.current.sessionId === connection.sessionId && sessionSyncRef.current.skipRecipe) {
      sessionSyncRef.current.skipRecipe = false;
      return;
    }
    if (!connection.sessionAccessToken) return;
    void updateSessionRecipe(connection.sessionId, connection.sessionAccessToken, selectedRecipeId).catch(() => {});
  }, [connection.sessionAccessToken, connection.sessionId, selectedRecipeId]);

  const latestToolResultId = (() => {
    for (let index = connection.events.length - 1; index >= 0; index -= 1) {
      if (connection.events[index]?.kind === "tool_result") return connection.events[index]!.id;
    }
    return null;
  })();

  const latestCaptureAttachmentCallId = (() => {
    for (let index = connection.events.length - 1; index >= 0; index -= 1) {
      const event = connection.events[index];
      if (event?.kind !== "tool_call" || !event.payload || typeof event.payload !== "object") continue;
      const payload = event.payload as { toolName?: unknown; argumentsJson?: unknown };
      if (payload.toolName !== "capture_view" || typeof payload.argumentsJson !== "string") continue;
      try {
        const args = JSON.parse(payload.argumentsJson) as { attachToConversation?: unknown };
        if (args.attachToConversation === true) return event.id;
      } catch {
        // The server will reject malformed tool arguments without consuming consent.
      }
    }
    return null;
  })();

  useEffect(() => {
    if (!latestToolResultId || lastToolResultRefreshRef.current === latestToolResultId) return;
    lastToolResultRefreshRef.current = latestToolResultId;
    void refreshDoctorState();
    void refreshRunReceipts();
  }, [latestToolResultId, refreshDoctorState, refreshRunReceipts]);

  useEffect(() => {
    if (!latestCaptureAttachmentCallId || lastCaptureToolCallRef.current === latestCaptureAttachmentCallId) return;
    lastCaptureToolCallRef.current = latestCaptureAttachmentCallId;
    if (captureShareExpiryTimerRef.current !== null) {
      window.clearTimeout(captureShareExpiryTimerRef.current);
      captureShareExpiryTimerRef.current = null;
    }
    setCaptureShareState("idle");
  }, [latestCaptureAttachmentCallId]);

  useEffect(() => {
    setUndoNotice(null);
  }, [target]);

  const visibleExamples = examples.filter((recipe) => recipe.apps.includes(target));
  const selectedRecipe = visibleExamples.find((recipe) => recipe.id === selectedRecipeId) ?? null;
  const stageArtifactPreview = findLatestStageArtifactPreview(connection.events);
  const latestWidgetAction = summarizeLatestWidgetAction(connection.events);
  const undoAvailable = !doctorError && doctor?.targets[target].undoAvailable === true;
  const undoBlockedByActiveWork = quickWorkflowBusyId !== null
    || connection.status?.toolBusy === true
    || ["executing", "confirming"].includes(connection.phase);
  const undoControlAvailable = undoAvailable && !undoBlockedByActiveWork;
  const undoDisabledReason = undoBlockedByActiveWork
    ? "Wait for the current turn to finish"
    : doctorLoading && !doctor
      ? "Checking for a scene checkpoint"
      : doctorError
        ? "Undo status unavailable"
        : doctor?.targets[target].ready === false
          ? `${target === "pymol" ? "PyMOL" : "ChimeraX"} is not ready`
          : "Nothing to undo";
  const connectBusy = !connection.connected && (connection.phase === "arming" || connection.phase === "connecting");
  const targetRuntimeReady = target === "pymol" ? runtimeHealth?.targets.pymol.ready : runtimeHealth?.targets.chimerax.ready;
  const targetUnavailable = targetRuntimeReady === false;
  const activeRealtimeSessionCount =
    runtimeHealth?.sessions.active
    ?? (
      (runtimeHealth?.sessions.awaitingCall ?? 0)
      + (runtimeHealth?.sessions.connecting ?? 0)
      + (runtimeHealth?.sessions.connected ?? 0)
    );
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
  const managedInputs = managedScientificLaunch?.target === target
    ? managedScientificLaunch.scientificInputs
    : undefined;
  const scientificInputs: ScientificLaunchInputs = {
    ...(managedInputs ?? {}),
    ...scientificQueryState.scientificInputs,
  };
  const resolvedScientificWorkflowId: ScientificWorkflowKind | undefined = scientificQueryState.workflowId
    ?? (managedScientificLaunch?.target === target ? managedScientificLaunch.workflowId : undefined)
    ?? getScientificWorkflowFromRecipe(selectedRecipe?.id)
    ?? undefined;
  const scientificLaunchCards: ScientificWorkflowLaunchCard[] = buildScientificWorkflowLaunchCards({
    target,
    baseUrl: publicBaseUrl,
    recipes: visibleExamples,
    workflowId: resolvedScientificWorkflowId,
    scientificInputs,
  });
  const activeScientificWorkflowId = manualScientificWorkflowId ?? resolvedScientificWorkflowId ?? null;
  const activeScientificWorkflowCard = activeScientificWorkflowId
    ? scientificLaunchCards.find((card) => card.id === activeScientificWorkflowId) ?? null
    : null;
  const scientificInputSummary = formatScientificInputSummary(scientificInputs);
  const scientificInputsPinned = hasScientificInputs(scientificInputs);
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
      ? "Local Realtime slots are full, not a length timer. End another session or wait for stale setup cleanup."
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
    openMicConfirmedRef.current = true;
    setVoiceMode("open_mic");
    setOpenMicArmed(true);
  }

  function requestOpenMic() {
    if (voiceMode === "open_mic" && openMicArmed) {
      setOpenMicArmed(false);
      setVoiceMode("push_to_talk");
      return;
    }

    if (!openMicConfirmationRequired(voiceMode, openMicConfirmedRef.current)) {
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
      requestOpenMic();
      return;
    }

    if (voiceMode === "open_mic" && openMicArmed) {
      setOpenMicArmed(false);
      setVoiceMode("push_to_talk");
      return;
    }

    if (openMicConfirmationRequired(voiceMode, openMicConfirmedRef.current)) {
      requestOpenMic();
      return;
    }

    setOpenMicArmed((value) => !value);
  }

  function handleAudioInputDeviceChange(deviceId: string) {
    if (connection.connected || connectBusy) {
      return;
    }
    const nextDeviceId = audioInputDevices.some((device) => device.deviceId === deviceId)
      ? deviceId
      : DEFAULT_AUDIO_INPUT_DEVICE_ID;
    setSelectedAudioInputDeviceId(nextDeviceId);
    writeStoredAudioInputDeviceId(nextDeviceId);
  }

  async function handleUndoLastTurn(): Promise<void> {
    if (!undoControlAvailable || undoBusy) return;
    setUndoBusy(true);
    setUndoNotice(null);
    try {
      const result = await undoLastTurn(target);
      if (result.error) throw new Error(result.error);
      const targetLabel = target === "pymol" ? "PyMOL" : "ChimeraX";
      const message = `Restored ${targetLabel} to the scene before the last turn.`;
      const completedAt = new Date();
      setUndoNotice({ tone: "success", message });
      setManualLogEntries((previous) => [
        ...previous,
        {
          id: `undo-${completedAt.getTime()}`,
          timestamp: completedAt,
          type: "success" as const,
          message,
          details: result.warnings.length > 0 ? result.warnings.join(" · ") : undefined,
        },
      ].slice(-20));
    } catch (error) {
      setUndoNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await Promise.allSettled([refreshDoctorState(), refreshRunReceipts()]);
      if (operatorStateMountedRef.current) setUndoBusy(false);
    }
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
            audioInputDevices={audioInputDevices}
            audioInputDisabled={connection.connected || connectBusy}
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
            onAudioInputDeviceChange={handleAudioInputDeviceChange}
            onToggleOpenMic={handleWidgetOpenMicToggle}
            onUndo={() => { void handleUndoLastTurn(); }}
            undoAvailable={undoControlAvailable}
            undoBusy={undoBusy}
            undoFeedback={undoNotice}
            onToggleTarget={() => setTarget((current) => (current === "pymol" ? "chimerax" : "pymol"))}
            openMicArmed={openMicArmed}
            phase={connection.phase}
            ready={connection.ready}
            sessionPaused={connection.sessionPaused}
            sessionNotice={sessionNoticeMessage}
            sessionNoticeTone={sessionNoticeTone}
            selectedAudioInputDeviceId={selectedAudioInputDeviceId}
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

  const handleGrantNextViewportShare = async () => {
    if (!connection.sessionId || !connection.sessionAccessToken) return;
    const grantedSessionId = connection.sessionId;
    if (captureShareExpiryTimerRef.current !== null) {
      window.clearTimeout(captureShareExpiryTimerRef.current);
      captureShareExpiryTimerRef.current = null;
    }
    setCaptureShareState("busy");
    try {
      const grant = await grantNextViewportShare(connection.sessionId, connection.sessionAccessToken);
      if (sessionSyncRef.current.sessionId !== grantedSessionId) return;
      setCaptureShareState("granted");
      const delayMs = Math.max(0, Date.parse(grant.expiresAt) - Date.now());
      captureShareExpiryTimerRef.current = window.setTimeout(() => {
        captureShareExpiryTimerRef.current = null;
        if (sessionSyncRef.current.sessionId === grantedSessionId) {
          setCaptureShareState((current) => current === "granted" ? "idle" : current);
        }
      }, delayMs);
    } catch {
      if (sessionSyncRef.current.sessionId === grantedSessionId) {
        setCaptureShareState("error");
      }
    }
  };

  const handleClearLog = () => {
    setLogClearIndex(connection.events.length);
    setManualLogEntries([]);
  };

  const handleOpenSettings = () => {
    setSettingsDrawerLoaded(true);
    setSettingsOpen(true);
    void refreshDoctorState();
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
      await Promise.allSettled([refreshDoctorState(), refreshRunReceipts()]);
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

  const handleLaunchScientificWorkflow = async (workflowId: string, dryRun: boolean) => {
    const card = scientificLaunchCards.find((candidate) => candidate.id === workflowId);
    if (!card) return;
    setQuickWorkflowBusyId(workflowId);
    setManualRunError(null);
    try {
      const result = await runScientificWorkflow({
        target,
        workflow: card.id,
        recipeId: card.bestRecipeId,
        dryRun,
        presentationMode: "demo",
        inputs: buildScientificWorkflowInputs(card.id, scientificInputs),
      });
      const completedAt = new Date();
      const actionResult: ManualActionResult = result;
      const latestImageArtifact = findLatestImageArtifactInManualRun(actionResult);
      if (latestImageArtifact) {
        setManualPreviewArtifact({
          id: latestImageArtifact.path,
          kind: latestImageArtifact.kind,
          url: latestImageArtifact.url,
          label: latestImageArtifact.label,
          timestamp: completedAt.toISOString(),
        });
      }
      setManualScientificWorkflowId(card.id);
      setManualLogEntries((previous) => [
        ...previous,
        buildManualWorkflowSuccessLogEntry({
          id: workflowId,
          title: `${card.title}${dryRun ? " dry run" : ""}`,
        }, actionResult, completedAt),
      ].slice(-20));
      await Promise.allSettled([refreshDoctorState(), refreshRunReceipts()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date();
      setManualRunError(message);
      setManualLogEntries((previous) => [
        ...previous,
        buildManualWorkflowFailureLogEntry({ id: workflowId, title: card.title }, message, failedAt),
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
        undoAvailable={undoControlAvailable}
        undoBusy={undoBusy}
        undoDisabledReason={undoDisabledReason}
        onUndo={() => { void handleUndoLastTurn(); }}
      />

      <ErrorBanner message={bannerMessage} onDismiss={dismissBanner} />
      {undoNotice ? (
        <div
          className={`mx-6 mt-4 rounded-xl border px-4 py-2.5 text-sm ${
            undoNotice.tone === "success"
              ? "border-emerald-300/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-rose-300/70 bg-rose-50/80 text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/30 dark:text-rose-200"
          }`}
          role={undoNotice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {undoNotice.message}
        </div>
      ) : null}
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
            responseLanguageMode={responseLanguageMode}
            onResponseLanguageModeChange={setResponseLanguageMode}
            audioInputDevices={audioInputDevices}
            selectedAudioInputDeviceId={selectedAudioInputDeviceId}
            onAudioInputDeviceChange={handleAudioInputDeviceChange}
            audioInputDisabled={connection.connected || connectBusy}
            transcript={transcriptForStage}
            onPushToTalkStart={() => connection.beginPushToTalk()}
            onPushToTalkEnd={() => connection.endPushToTalk()}
            micDisabled={micDisabledForStage}
            openMicArmed={openMicArmed}
            onToggleOpenMic={handleWidgetOpenMicToggle}
            hint={widgetHint}
            captureSharingEnabled={captureUploadsEnabled}
            captureShareState={captureShareState}
            onGrantNextViewportShare={() => { void handleGrantNextViewportShare(); }}
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
            doctor={doctor}
            doctorLoading={doctorLoading}
            doctorError={doctorError}
            doctorTarget={target}
            onRefreshDoctor={() => { void refreshDoctorState(); }}
            receipts={runReceipts}
            receiptsLoading={receiptsLoading}
            receiptsError={receiptsError}
            onRefreshReceipts={() => { void refreshRunReceipts(); }}
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
              onLaunchScientificWorkflow: (workflowId, dryRun) => {
                void handleLaunchScientificWorkflow(workflowId, dryRun);
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
                evidenceLevel: card.evidenceLevel,
                assumptions: card.assumptions,
                inputsReady: card.inputsReady,
                inputMessage: card.inputMessage,
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

export function openMicConfirmationRequired(voiceMode: VoiceMode, confirmedThisPage: boolean): boolean {
  return voiceMode !== "open_mic" || !confirmedThisPage;
}

function hasScientificInputs(inputs: ScientificLaunchInputs | undefined): boolean {
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
    inputs.experimentalPdbId ||
    inputs.emdbId ||
    inputs.mutations?.length ||
    inputs.comparison ||
    inputs.ligand ||
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

function readQueryResponseLanguageMode(): ResponseLanguageMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const responseLanguage = params.get("response_language")?.trim().toLowerCase();
  const klingonFlag = params.get("klingon")?.trim().toLowerCase();
  if (responseLanguage === "klingon" || klingonFlag === "1" || klingonFlag === "true") {
    return "klingon";
  }
  if (responseLanguage === "standard" || klingonFlag === "0" || klingonFlag === "false") {
    return "standard";
  }
  return null;
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
    case "wait_for_user":
      return "waiting quietly";
    case "run_pymol_actions":
      return "running PyMOL actions";
    case "run_chimerax_actions":
      return "running ChimeraX actions";
    case "resolve_structure_asset":
      return "resolving structure asset";
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

function buildDefaultAudioInputDevice(): AudioInputDeviceSummary {
  return {
    deviceId: DEFAULT_AUDIO_INPUT_DEVICE_ID,
    label: "System Default",
    source: "default",
  };
}

function buildAudioInputDeviceSummaries(mediaDevices: MediaDeviceInfo[]): AudioInputDeviceSummary[] {
  const devices: AudioInputDeviceSummary[] = [buildDefaultAudioInputDevice()];
  const seen = new Set<string>([DEFAULT_AUDIO_INPUT_DEVICE_ID]);
  let unnamedIndex = 1;

  for (const device of mediaDevices) {
    if (device.kind !== "audioinput") {
      continue;
    }
    const deviceId = device.deviceId.trim();
    if (!deviceId || seen.has(deviceId)) {
      continue;
    }
    seen.add(deviceId);

    const fallbackLabel = deviceId === "communications" ? "Communications Default" : `Microphone ${unnamedIndex}`;
    const label = device.label.trim() || fallbackLabel;
    if (!device.label.trim()) {
      unnamedIndex += 1;
    }

    devices.push({
      deviceId,
      label,
      source: inferAudioInputSource(label, deviceId),
    });
  }

  return devices;
}

function inferAudioInputSource(label: string, deviceId: string): AudioInputSourceKind {
  if (deviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID) {
    return "default";
  }
  return VIRTUAL_AUDIO_INPUT_PATTERN.test(label) ? "system" : "microphone";
}

function resolveSelectedAudioInputSource(
  devices: AudioInputDeviceSummary[],
  selectedDeviceId: string,
): AudioInputSourceKind {
  return devices.find((device) => device.deviceId === selectedDeviceId)?.source ?? "default";
}

function readStoredAudioInputDeviceId(): string {
  if (typeof window === "undefined") {
    return DEFAULT_AUDIO_INPUT_DEVICE_ID;
  }
  try {
    return window.localStorage.getItem(AUDIO_INPUT_STORAGE_KEY) || DEFAULT_AUDIO_INPUT_DEVICE_ID;
  } catch {
    return DEFAULT_AUDIO_INPUT_DEVICE_ID;
  }
}

function writeStoredAudioInputDeviceId(deviceId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (deviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID) {
      window.localStorage.removeItem(AUDIO_INPUT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AUDIO_INPUT_STORAGE_KEY, deviceId);
  } catch {
    // Ignore local storage failures; the selected input still applies in memory.
  }
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
