import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type {
  SessionStatus,
  SessionUiEvent,
} from "../../../../packages/runtime-and-adapters/src/realtime/session-events.js";
import {
  buildSessionEventStreamUrl,
  connectRealtimeCall,
  disconnectSessionBeacon,
  disconnectSession,
  type ResponseLanguageMode,
} from "../lib/api";
import {
  buildSessionUsageGuardState,
  createEmptySessionUsage,
  type SessionUsageGuardrails,
} from "../../../../packages/runtime-and-adapters/src/realtime/usage.js";
import { computeIdleGuardState } from "../lib/session-guard";

type TargetKind = "pymol" | "chimerax";
type VoiceMode = "push_to_talk" | "open_mic";

type ConnectionPhase =
  | "idle"
  | "arming"
  | "connecting"
  | "ready"
  | "listening"
  | "transcribing"
  | "planning"
  | "executing"
  | "confirming"
  | "error";

type EventStreamState = "idle" | "connecting" | "open" | "stalled" | "closed";

const EVENT_STREAM_STALL_DELAY_MS = 4_000;
const EVENT_STREAM_USER_ERROR_DELAY_MS = 15_000;
const REMOTE_AUDIO_MIC_RESUME_DELAY_MS = 5_000;

export function isEventStreamErrorMessage(message: string | null | undefined): boolean {
  return message === "Session event stream disconnected."
    || message === "Session event stream closed."
    || message === "Session event stream stalled.";
}

export function isManualDisconnectReason(message: string | null | undefined): boolean {
  return message === "Session manually disconnected from the console."
    || message === "Session manually disconnected from the widget.";
}

export function isAssistantResponseStartEvent(eventType: string | null | undefined): boolean {
  if (!eventType) {
    return false;
  }
  return /^response\.created$/i.test(eventType)
    || /^response\.output_item\.created$/i.test(eventType)
    || /^response\.content_part\.added$/i.test(eventType)
    || /^response\.output_(?:audio|audio_transcript|text)\.delta$/i.test(eventType)
    || /^response\.function_call_arguments\.(?:delta|done)$/i.test(eventType);
}

export function isAssistantResponseEndEvent(eventType: string | null | undefined): boolean {
  return Boolean(eventType && /^response\.done$/i.test(eventType));
}

export function isInputSpeechStartEvent(eventType: string | null | undefined): boolean {
  return Boolean(eventType && /^input_audio_buffer\.speech_started$/i.test(eventType));
}

export function isInputSpeechEndEvent(eventType: string | null | undefined): boolean {
  return Boolean(eventType && /^input_audio_buffer\.(?:speech_stopped|committed)$/i.test(eventType));
}

interface HookOptions {
  target: TargetKind;
  voiceMode: VoiceMode;
  responseLanguageMode: ResponseLanguageMode;
  recipeId?: string;
  instructionContext?: string;
  muted: boolean;
  openMicArmed: boolean;
  captureRawEvents?: boolean;
  idleDisconnectSeconds: number;
  idleWarningSeconds: number;
  sessionGuardrails: SessionUsageGuardrails;
}

export function useRealtimeConnection(options: HookOptions) {
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionAccessToken, setSessionAccessToken] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionUiEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [localMicEnabled, setLocalMicEnabled] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [eventStreamState, setEventStreamState] = useState<EventStreamState>("idle");
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [lastInteractionAt, setLastInteractionAt] = useState<number | null>(null);
  const [idleSecondsRemaining, setIdleSecondsRemaining] = useState<number | null>(null);
  const [idleWarningActive, setIdleWarningActive] = useState(false);
  const [idleDisconnectReason, setIdleDisconnectReason] = useState<string | null>(null);
  const [assistantResponseActive, setAssistantResponseActive] = useState(false);
  const [remoteAudioPlaying, setRemoteAudioPlaying] = useState(false);
  const [remoteAudioCooldownUntil, setRemoteAudioCooldownUntil] = useState<number | null>(null);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const dataChannelReadyRef = useRef(false);
  const controllerReadyRef = useRef(false);
  const closingRef = useRef(false);
  const eventStreamStallTimerRef = useRef<number | null>(null);
  const eventStreamUserErrorTimerRef = useRef<number | null>(null);
  const phaseResetTimerRef = useRef<number | null>(null);
  const connectInFlightRef = useRef(false);
  const connectAbortControllerRef = useRef<AbortController | null>(null);
  const connectAttemptRef = useRef(0);
  const idleDisconnectingRef = useRef(false);
  const guardrailDisconnectingRef = useRef(false);
  const pushToTalkActiveRef = useRef(false);
  const seenEventIdsRef = useRef<string[]>([]);
  const seenEventIdsSetRef = useRef<Set<string>>(new Set());

  function markInteraction(): void {
    setLastInteractionAt(Date.now());
    setIdleDisconnectReason(null);
  }

  function clearEventStreamTimers(): void {
    if (eventStreamStallTimerRef.current) {
      window.clearTimeout(eventStreamStallTimerRef.current);
      eventStreamStallTimerRef.current = null;
    }
    if (eventStreamUserErrorTimerRef.current) {
      window.clearTimeout(eventStreamUserErrorTimerRef.current);
      eventStreamUserErrorTimerRef.current = null;
    }
  }

  const handleServerEvent = useEffectEvent((incoming: SessionUiEvent) => {
    if (seenEventIdsSetRef.current.has(incoming.id)) {
      return;
    }
    seenEventIdsSetRef.current.add(incoming.id);
    seenEventIdsRef.current.push(incoming.id);
    if (seenEventIdsRef.current.length > 400) {
      const evicted = seenEventIdsRef.current.splice(0, seenEventIdsRef.current.length - 400);
      for (const id of evicted) {
        seenEventIdsSetRef.current.delete(id);
      }
    }

    clearEventStreamTimers();
    markInteraction();
    setError((previous) => (isEventStreamErrorMessage(previous) ? null : previous));

    if (incoming.kind === "raw") {
      if (isInputSpeechStartEvent(incoming.eventType)) {
        if (options.voiceMode === "open_mic" && options.openMicArmed && !sessionPaused) {
          setPhase("listening");
          markInteraction();
        }
      } else if (isInputSpeechEndEvent(incoming.eventType)) {
        if (options.voiceMode === "open_mic" && options.openMicArmed && !sessionPaused) {
          setPhase("transcribing");
          markInteraction();
        }
      } else if (isAssistantResponseStartEvent(incoming.eventType)) {
        setAssistantResponseActive(true);
        if (options.voiceMode === "open_mic" && !sessionPaused) {
          setPhase((previous) => (
            previous === "executing" || previous === "confirming" ? previous : "planning"
          ));
        }
      } else if (isAssistantResponseEndEvent(incoming.eventType)) {
        setAssistantResponseActive(false);
        if (!closingRef.current && controllerReadyRef.current && dataChannelReadyRef.current && !sessionPaused) {
          setPhase(status?.toolBusy ? "executing" : "ready");
          markInteraction();
        }
      } else if (incoming.eventType === "error") {
        setAssistantResponseActive(false);
      }

      if (!options.captureRawEvents) {
        return;
      }
    }

    if (incoming.kind !== "usage") {
      startTransition(() => {
        setEvents((previous) => [...previous.slice(-149), incoming]);
      });
    }

    if ((incoming.kind === "status" || incoming.kind === "usage") && incoming.payload && typeof incoming.payload === "object") {
      const nextStatus = incoming.payload as SessionStatus;
      setStatus(nextStatus);
      controllerReadyRef.current = nextStatus.controllerReady;

      if (incoming.kind === "status" && nextStatus.status === "disconnected" && !closingRef.current) {
        void disconnect(nextStatus.lastError ?? incoming.text ?? "Realtime session ended.");
        return;
      }

      if (nextStatus.controllerReady && dataChannelReadyRef.current && !nextStatus.toolBusy) {
        setPhase("ready");
      }

      if (nextStatus.status === "error") {
        setPhase("error");
      }
    }

    if (incoming.kind === "transcript" && incoming.speaker === "user") {
      setPhase("planning");
    }

    if (incoming.kind === "tool_call") {
      setPhase("executing");
    }

    if (incoming.kind === "tool_result") {
      setPhase("confirming");
      if (phaseResetTimerRef.current) {
        window.clearTimeout(phaseResetTimerRef.current);
      }
      phaseResetTimerRef.current = window.setTimeout(() => {
        if (!closingRef.current && controllerReadyRef.current && dataChannelReadyRef.current) {
          setPhase("ready");
        }
      }, 500);
    }

    if (incoming.kind === "log" && incoming.level === "error") {
      setError(incoming.text ?? "Unknown server error.");
      setPhase("error");
    }
  });

  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (audio) {
      audio.muted = options.muted;
    }
  }, [options.muted]);

  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (!audio) {
      return;
    }

    const handlePlaybackStart = () => {
      setRemoteAudioPlaying(true);
      setRemoteAudioCooldownUntil(null);
    };
    const handlePlaybackStop = () => {
      setRemoteAudioPlaying(false);
      setRemoteAudioCooldownUntil(Date.now() + REMOTE_AUDIO_MIC_RESUME_DELAY_MS);
    };

    audio.addEventListener("play", handlePlaybackStart);
    audio.addEventListener("playing", handlePlaybackStart);
    audio.addEventListener("pause", handlePlaybackStop);
    audio.addEventListener("ended", handlePlaybackStop);
    audio.addEventListener("emptied", handlePlaybackStop);
    audio.addEventListener("abort", handlePlaybackStop);

    return () => {
      audio.removeEventListener("play", handlePlaybackStart);
      audio.removeEventListener("playing", handlePlaybackStart);
      audio.removeEventListener("pause", handlePlaybackStop);
      audio.removeEventListener("ended", handlePlaybackStop);
      audio.removeEventListener("emptied", handlePlaybackStop);
      audio.removeEventListener("abort", handlePlaybackStop);
    };
  }, []);

  useEffect(() => {
    if (!remoteAudioCooldownUntil) {
      return;
    }
    const remainingMs = remoteAudioCooldownUntil - Date.now();
    if (remainingMs <= 0) {
      setRemoteAudioCooldownUntil(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setRemoteAudioCooldownUntil((current) => (
        current === remoteAudioCooldownUntil ? null : current
      ));
    }, remainingMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [remoteAudioCooldownUntil]);

  useEffect(() => {
    const assistantAudioOutputActive =
      remoteAudioPlaying
      || remoteAudioCooldownUntil != null;
    const blockOpenMicTrack =
      assistantResponseActive
      || assistantAudioOutputActive
      || status?.toolBusy === true
      || ["arming", "connecting", "transcribing", "planning", "executing", "confirming", "error"].includes(phase);
    const allowOpenMicTrack =
      options.voiceMode === "open_mic"
      && !blockOpenMicTrack;
    const shouldEnableTrack =
      allowOpenMicTrack
      && options.openMicArmed
      && status?.controllerReady === true
      && dataChannelReady
      && !sessionPaused;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = shouldEnableTrack;
    });
    setLocalMicEnabled(shouldEnableTrack);
  }, [assistantResponseActive, dataChannelReady, options.openMicArmed, options.voiceMode, phase, remoteAudioCooldownUntil, remoteAudioPlaying, sessionPaused, status?.controllerReady, status?.toolBusy]);

  useEffect(() => {
    if (!sessionId || !connected || options.idleDisconnectSeconds <= 0) {
      setIdleSecondsRemaining(null);
      setIdleWarningActive(false);
      idleDisconnectingRef.current = false;
      return;
    }

    const sessionBusy =
      phase === "arming"
      || phase === "connecting"
      || phase === "listening"
      || phase === "transcribing"
      || phase === "planning"
      || phase === "executing"
      || phase === "confirming"
      || status?.toolBusy === true
      || status?.configSyncPending === true;

    const updateIdleState = () => {
      if (sessionBusy) {
        setIdleSecondsRemaining(options.idleDisconnectSeconds);
        setIdleWarningActive(false);
        return;
      }
      const guard = computeIdleGuardState(
        lastInteractionAt,
        Date.now(),
        options.idleDisconnectSeconds,
        options.idleWarningSeconds,
      );
      setIdleSecondsRemaining(guard.secondsRemaining);
      setIdleWarningActive(guard.warningActive);
      if (!guard.expired || idleDisconnectingRef.current) {
        return;
      }

      idleDisconnectingRef.current = true;
      const timeoutMinutes = Math.max(1, Math.round(options.idleDisconnectSeconds / 60));
      const reason = `idle-timeout:${timeoutMinutes}m`;
      void disconnect(reason);
    };

    updateIdleState();
    const timer = window.setInterval(updateIdleState, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    connected,
    lastInteractionAt,
    options.idleDisconnectSeconds,
    options.idleWarningSeconds,
    phase,
    sessionId,
    status?.configSyncPending,
    status?.toolBusy,
  ]);

  useEffect(() => {
    if (!connected || !connectedAt) {
      guardrailDisconnectingRef.current = false;
      return;
    }

    const disconnectForGuardrail = () => {
      const usage = status?.usage ?? createEmptySessionUsage();
      const guardState = buildSessionUsageGuardState(
        usage,
        options.sessionGuardrails,
        connectedAt,
        Date.now(),
      );
      if (!guardState.breachMessage) {
        return;
      }
      if (guardrailDisconnectingRef.current) {
        return;
      }
      guardrailDisconnectingRef.current = true;
      void disconnect(`guardrail:${guardState.breachReason ?? "unknown"}`);
    };

    disconnectForGuardrail();
    const timer = window.setInterval(disconnectForGuardrail, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [connected, connectedAt, disconnect, options.sessionGuardrails, status?.usage]);

  useEffect(() => {
    if (!sessionId || !sessionAccessToken) return;
    setEventStreamState("connecting");
    const eventSource = new EventSource(buildSessionEventStreamUrl(sessionId));
    eventSourceRef.current = eventSource;
    eventSource.onopen = () => {
      setEventStreamState("open");
      clearEventStreamTimers();
      setError((previous) => (isEventStreamErrorMessage(previous) ? null : previous));
      setPhase((previous) => {
        if (previous === "error" || previous === "listening" || previous === "transcribing" || previous === "planning" || previous === "executing" || previous === "confirming") {
          return previous;
        }
        if (controllerReadyRef.current && dataChannelReadyRef.current && !sessionPaused) {
          return "ready";
        }
        return previous === "idle" ? previous : "connecting";
      });
    };
    eventSource.onmessage = (message) => {
      handleServerEvent(JSON.parse(message.data) as SessionUiEvent);
    };
    eventSource.onerror = () => {
      if (closingRef.current) return;
      setEventStreamState(eventSource.readyState === EventSource.CONNECTING ? "connecting" : "stalled");
      setPhase((previous) => {
        if (previous === "error" || previous === "listening" || previous === "transcribing" || previous === "planning" || previous === "executing" || previous === "confirming") {
          return previous;
        }
        if (controllerReadyRef.current && dataChannelReadyRef.current && !sessionPaused) {
          return "ready";
        }
        return "connecting";
      });
      if (!eventStreamStallTimerRef.current) {
        eventStreamStallTimerRef.current = window.setTimeout(() => {
          if (closingRef.current) return;
          if (eventSourceRef.current !== eventSource) return;
          if (eventSource.readyState === EventSource.OPEN) return;
          setEventStreamState("stalled");
        }, EVENT_STREAM_STALL_DELAY_MS);
      }
      if (!eventStreamUserErrorTimerRef.current) {
        eventStreamUserErrorTimerRef.current = window.setTimeout(() => {
          if (closingRef.current) return;
          if (eventSourceRef.current !== eventSource) return;
          if (eventSource.readyState === EventSource.OPEN) return;
          setEventStreamState("stalled");
          setError((previous) => previous ?? "Session event stream stalled.");
        }, EVENT_STREAM_USER_ERROR_DELAY_MS);
      }
    };
    return () => {
      clearEventStreamTimers();
      setEventStreamState("closed");
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [handleServerEvent, sessionAccessToken, sessionId]);

  useEffect(() => {
    if (!sessionId || !sessionAccessToken) {
      return;
    }

    const disconnectOnPageHide = () => {
      disconnectSessionBeacon(sessionId, sessionAccessToken, "pagehide");
      forceStopPushToTalk(true);
    };
    const handleBlur = () => {
      forceStopPushToTalk(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        forceStopPushToTalk(true);
      }
    };

    window.addEventListener("pagehide", disconnectOnPageHide);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", disconnectOnPageHide);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [options.voiceMode, sessionAccessToken, sessionId]);

  async function connect(): Promise<void> {
    if (connectInFlightRef.current || connected || phase === "arming" || phase === "connecting") {
      return;
    }
    connectInFlightRef.current = true;
    const attemptId = connectAttemptRef.current + 1;
    connectAttemptRef.current = attemptId;
    const abortController = new AbortController();
    connectAbortControllerRef.current = abortController;
    closingRef.current = true;
    releaseLocalTransport();
    closingRef.current = false;
    setEvents([]);
    setSessionId(null);
    setSessionAccessToken(null);
    setCallId(null);
    setStatus(null);
    setEventStreamState("idle");
    setError(null);
    setPhase("arming");
    setSessionPaused(false);
    setIdleSecondsRemaining(null);
    setIdleWarningActive(false);
    setIdleDisconnectReason(null);
    idleDisconnectingRef.current = false;
    guardrailDisconnectingRef.current = false;
    setAssistantResponseActive(false);
    seenEventIdsRef.current = [];
    seenEventIdsSetRef.current.clear();

    let createdSessionId: string | null = null;
    let createdSessionAccessToken: string | null = null;
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      localStreamRef.current = localStream;

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;

      const remoteAudio = remoteAudioRef.current;
      if (remoteAudio) {
        remoteAudio.srcObject = remoteStream;
        remoteAudio.autoplay = true;
        remoteAudio.muted = options.muted;
      }

      for (const track of localStream.getTracks()) {
        track.enabled = false;
        peerConnection.addTrack(track, localStream);
      }
      setLocalMicEnabled(false);

      peerConnection.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
          remoteStream.addTrack(track);
        }
      };

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        dataChannelReadyRef.current = true;
        setDataChannelReady(true);
        setConnected(true);
        setConnectedAt(Date.now());
        setPhase(controllerReadyRef.current ? "ready" : "connecting");
        markInteraction();
      };
      dataChannel.onclose = () => {
        if (closingRef.current) return;
        dataChannelReadyRef.current = false;
        setDataChannelReady(false);
        setConnected(false);
        setPhase("error");
        setError("Realtime data channel closed.");
      };
      dataChannel.onerror = () => {
        if (closingRef.current) return;
        setError("Realtime data channel error.");
        setPhase("error");
      };

      peerConnection.onconnectionstatechange = () => {
        if (closingRef.current) return;
        const state = peerConnection.connectionState;
        if (state === "connected" && controllerReadyRef.current && dataChannelReadyRef.current) {
          setError(null);
          setPhase("ready");
          return;
        }

        if (state === "disconnected") {
          setPhase("connecting");
          return;
        }

        if (state === "failed" || state === "closed") {
          setError(`Peer connection ${state}.`);
          setPhase("error");
          releaseLocalTransport();
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      setPhase("connecting");

      const connection = await connectRealtimeCall({
        target: options.target,
        voiceMode: options.voiceMode,
        responseLanguageMode: options.responseLanguageMode,
        recipeId: options.recipeId,
        offerSdp: offer.sdp ?? "",
        instructionContext: options.instructionContext,
      }, {
        signal: abortController.signal,
      });
      createdSessionId = connection.sessionId;
      createdSessionAccessToken = connection.sessionAccessToken;
      if (abortController.signal.aborted || attemptId !== connectAttemptRef.current) {
        await disconnectSession(createdSessionId, createdSessionAccessToken, "connect-aborted-before-answer").catch(() => {});
        closingRef.current = true;
        releaseLocalTransport();
        closingRef.current = false;
        return;
      }
      setSessionId(connection.sessionId);
      setSessionAccessToken(connection.sessionAccessToken);
      markInteraction();

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: connection.answerSdp,
      });
      if (abortController.signal.aborted || attemptId !== connectAttemptRef.current) {
        await disconnectSession(createdSessionId, createdSessionAccessToken, "connect-aborted-after-answer").catch(() => {});
        closingRef.current = true;
        releaseLocalTransport();
        closingRef.current = false;
        return;
      }

      setCallId(connection.callId);
    } catch (connectError) {
      const cancelled = abortController.signal.aborted || attemptId !== connectAttemptRef.current;
      if (createdSessionId && createdSessionAccessToken) {
        await disconnectSession(createdSessionId, createdSessionAccessToken, "connect-failed").catch(() => {});
      }
      closingRef.current = true;
      releaseLocalTransport();
      closingRef.current = false;
      if (!cancelled) {
        setError(connectError instanceof Error ? connectError.message : String(connectError));
        setPhase("error");
      }
    } finally {
      if (connectAbortControllerRef.current === abortController) {
        connectAbortControllerRef.current = null;
      }
      connectInFlightRef.current = false;
    }
  }

  async function disconnect(reason?: string): Promise<void> {
    const benignDisconnect = isManualDisconnectReason(reason);
    const currentSessionId = sessionId;
    const currentSessionAccessToken = sessionAccessToken;
    connectAttemptRef.current += 1;
    connectAbortControllerRef.current?.abort();
    connectAbortControllerRef.current = null;
    closingRef.current = true;

    releaseLocalTransport();
    setSessionId(null);
    setSessionAccessToken(null);
    setCallId(null);
    setStatus(null);
    setEventStreamState("idle");
    setPhase("idle");
    setError(benignDisconnect ? null : reason ?? null);
    setSessionPaused(false);
    setConnectedAt(null);
    setLastInteractionAt(null);
    setIdleSecondsRemaining(null);
    setIdleWarningActive(false);
    setIdleDisconnectReason(benignDisconnect ? null : reason ?? null);
    pushToTalkActiveRef.current = false;
    setAssistantResponseActive(false);
    setRemoteAudioPlaying(false);
    setRemoteAudioCooldownUntil(null);
    seenEventIdsRef.current = [];
    seenEventIdsSetRef.current.clear();
    connectInFlightRef.current = false;
    idleDisconnectingRef.current = false;
    guardrailDisconnectingRef.current = false;
    closingRef.current = false;

    if (currentSessionId && currentSessionAccessToken) {
      void disconnectSession(currentSessionId, currentSessionAccessToken, reason).catch(() => {});
    }
  }

  function forceStopPushToTalk(cancelResponse: boolean): void {
    if (options.voiceMode !== "push_to_talk") return;
    pushToTalkActiveRef.current = false;

    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    setLocalMicEnabled(false);

    const dataChannel = dataChannelRef.current;
    if (cancelResponse && dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "response.cancel" }));
      dataChannel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
      dataChannel.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    }
  }

  function beginPushToTalk(): void {
    if (options.voiceMode !== "push_to_talk" || sessionPaused || !controllerReadyRef.current || !dataChannelReadyRef.current) return;
    if (["arming", "connecting", "transcribing", "planning", "executing", "confirming", "error"].includes(phase)) return;
    if (status?.toolBusy) return;
    if (pushToTalkActiveRef.current) return;
    pushToTalkActiveRef.current = true;
    const dataChannel = dataChannelRef.current;
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    }
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    setLocalMicEnabled(true);
    setPhase("listening");
    markInteraction();
  }

  function endPushToTalk(): void {
    if (options.voiceMode !== "push_to_talk" || !dataChannelReadyRef.current) return;
    if (!pushToTalkActiveRef.current) return;
    forceStopPushToTalk(false);

    const dataChannel = dataChannelRef.current;
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      dataChannel.send(JSON.stringify({ type: "response.create" }));
      setPhase("transcribing");
      markInteraction();
    }
  }

  function cancelCurrentTurn(): void {
    forceStopPushToTalk(true);
    setPhase(controllerReadyRef.current && dataChannelReadyRef.current ? "ready" : "connecting");
    markInteraction();
  }

  function refreshIdleGuard(): void {
    markInteraction();
  }

  function pauseSession(): void {
    const dataChannel = dataChannelRef.current;
    if (dataChannel?.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "response.cancel" }));
      dataChannel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
      dataChannel.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    }
    remoteAudioRef.current?.pause();
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    setLocalMicEnabled(false);
    if (options.voiceMode === "push_to_talk") {
      forceStopPushToTalk(true);
    }
    setSessionPaused(true);
    setPhase(controllerReadyRef.current && dataChannelReadyRef.current ? "ready" : phase);
    markInteraction();
  }

  function resumeSession(): void {
    setSessionPaused(false);
    if (controllerReadyRef.current && dataChannelReadyRef.current) {
      setPhase("ready");
    }
    markInteraction();
  }

  const ready = connected && dataChannelReady && status?.controllerReady === true;

  function releaseLocalTransport(): void {
    clearEventStreamTimers();
    if (phaseResetTimerRef.current) {
      window.clearTimeout(phaseResetTimerRef.current);
      phaseResetTimerRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    const dataChannel = dataChannelRef.current;
    if (dataChannel) {
      dataChannel.onopen = null;
      dataChannel.onclose = null;
      dataChannel.onerror = null;
      dataChannel.close();
      dataChannelRef.current = null;
    }
    const peerConnection = peerConnectionRef.current;
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnectionRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;

    dataChannelReadyRef.current = false;
    controllerReadyRef.current = false;
    setConnected(false);
    setConnectedAt(null);
    setDataChannelReady(false);
    setLocalMicEnabled(false);
    setEventStreamState("closed");
    setAssistantResponseActive(false);
    setRemoteAudioPlaying(false);
    setRemoteAudioCooldownUntil(null);
    pushToTalkActiveRef.current = false;
  }

  return {
    phase,
    sessionId,
    sessionAccessToken,
    callId,
    events,
    status,
    error,
    ready,
    connected,
    dataChannelReady,
    eventStreamState,
    connectedAt,
    localMicEnabled,
    sessionPaused,
    lastInteractionAt,
    idleSecondsRemaining,
    idleWarningActive,
    idleDisconnectReason,
    remoteAudioRef,
    connect,
    disconnect,
    beginPushToTalk,
    endPushToTalk,
    cancelCurrentTurn,
    pauseSession,
    resumeSession,
    refreshIdleGuard,
  };
}
