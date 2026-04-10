import { z } from "zod";
import { targetKindSchema, voiceModeSchema } from "../schemas/index.js";
import {
  createEmptySessionUsage,
  sessionUsageGuardStateSchema,
  sessionUsageSchema,
} from "./usage.js";

export const sessionStatusSchema = z.object({
  sessionId: z.string(),
  callId: z.string().default(""),
  status: z.enum(["awaiting_call", "connecting", "connected", "error", "disconnected"]),
  sidebandStatus: z.enum(["pending_call", "connecting", "connected", "reconnecting", "error", "disconnected"]).default("pending_call"),
  target: targetKindSchema,
  voiceMode: voiceModeSchema,
  advancedMode: z.boolean().default(false),
  recipeId: z.string().optional(),
  lastError: z.string().optional(),
  controllerReady: z.boolean().default(false),
  controllerReadyAt: z.string().optional(),
  configSyncPending: z.boolean().default(false),
  lastSidebandEventAt: z.string().optional(),
  lastRealtimeEventType: z.string().optional(),
  lastRealtimeEventAt: z.string().optional(),
  lastSessionUpdatedAt: z.string().optional(),
  targetState: z.record(z.string(), z.unknown()).optional(),
  eventSubscribers: z.number().int().min(0).default(0),
  toolBusy: z.boolean().default(false),
  usage: sessionUsageSchema.default(createEmptySessionUsage()),
  usageGuardrails: sessionUsageGuardStateSchema,
});

export const sessionUiEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  kind: z.enum(["status", "log", "transcript", "tool_call", "tool_result", "usage", "raw"]),
  level: z.enum(["info", "warn", "error"]).optional(),
  text: z.string().optional(),
  speaker: z.enum(["user", "assistant", "system"]).optional(),
  partial: z.boolean().optional(),
  eventType: z.string().optional(),
  payload: z.unknown().optional(),
});

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionUiEvent = z.infer<typeof sessionUiEventSchema>;
