import {
  buildScientificLaunchCommand,
  buildScientificWorkflowUrl,
  type ScientificLaunchInputs,
} from "../../../../packages/runtime-and-adapters/src/examples/scientific-workflows.js";
import type { ScientificWorkflowKind } from "../../../../packages/runtime-and-adapters/src/schemas/scientific.js";

export interface SessionPolicyConfig {
  idleWarningMs: number;
  pttIdleDisconnectMs: number;
  openMicIdleDisconnectMs: number;
}

export interface StartPathOption {
  id: "guided_ui" | "agent_launch" | "rehearsal";
  title: string;
  description: string;
  bestFor: string;
  costNote: string;
  primaryActionLabel: string;
  primaryActionValue: string;
  steps: string[];
}

const DEFAULT_IDLE_WARNING_MS = 60_000;
const DEFAULT_PTT_IDLE_DISCONNECT_MS = 15 * 60_000;
const DEFAULT_OPEN_MIC_IDLE_DISCONNECT_MS = 3 * 60_000;

export function coerceSessionPolicyConfig(raw?: Partial<SessionPolicyConfig> | null): SessionPolicyConfig {
  return {
    idleWarningMs: clampDuration(raw?.idleWarningMs, DEFAULT_IDLE_WARNING_MS, 15_000, 10 * 60_000),
    pttIdleDisconnectMs: clampDuration(raw?.pttIdleDisconnectMs, DEFAULT_PTT_IDLE_DISCONNECT_MS, 60_000, 30 * 60_000),
    openMicIdleDisconnectMs: clampDuration(raw?.openMicIdleDisconnectMs, DEFAULT_OPEN_MIC_IDLE_DISCONNECT_MS, 60_000, 30 * 60_000),
  };
}

export function formatDurationShort(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes >= 1) {
    return `${minutes}m`;
  }

  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  return `${seconds}s`;
}

export function formatDurationLabel(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes >= 1) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function buildStartPathOptions(input: {
  target: "pymol" | "chimerax";
  recipeId?: string;
  workflowId?: ScientificWorkflowKind;
  scientificInputs?: ScientificLaunchInputs;
  baseUrl?: string;
  widgetEnabled?: boolean;
}): StartPathOption[] {
  const targetLabel = input.target === "pymol" ? "PyMOL" : "ChimeraX";
  const agentCommand = buildScientificLaunchCommand({
    target: input.target,
    recipeId: input.recipeId,
    workflowId: input.workflowId,
    scientificInputs: input.scientificInputs,
    audience: false,
    voice: undefined,
    advanced: false,
    overlay: false,
  });
  const guidedUrl = buildScientificWorkflowUrl(input.baseUrl ?? "http://localhost:3000", {
    target: input.target,
    recipeId: input.recipeId,
    workflowId: input.workflowId,
    scientificInputs: input.scientificInputs,
    widget: input.widgetEnabled ?? true,
  });
  const rehearsalCommand = buildRehearsalCommand({
    target: input.target,
    recipeId: input.recipeId,
    workflowId: input.workflowId,
    scientificInputs: input.scientificInputs,
  });

  return [
    {
      id: "guided_ui",
      title: "Guided UI Start",
      description: `Open the full console, connect Realtime only when you are ready, and drive ${targetLabel} from the recipe panel.`,
      bestFor: "first-time users and careful demos",
      costNote: "Lowest accidental spend: push-to-talk, explicit connect, and a fresh session when you disconnect.",
      primaryActionLabel: "Open Console",
      primaryActionValue: guidedUrl,
      steps: [
        `Open ${guidedUrl}`,
        "Pick a workflow from the library and keep voice mode on push-to-talk.",
        "Connect the voice session, then hold Space or Hold To Talk for each turn.",
      ],
    },
    {
      id: "agent_launch",
      title: "Agent Launch",
      description: `Tell Codex or Claude Code to open ${targetLabel}, start the managed console, and hand you a ready URL.`,
      bestFor: "repeatable launches and remote operator handoff",
      costNote: "Good default when you want one command to open the desktop app but still connect voice only on demand.",
      primaryActionLabel: "Agent Command",
      primaryActionValue: agentCommand,
      steps: [
        `Run ${agentCommand}`,
        "Open the recommended URL that the agent returns.",
        "Use the floating widget or the full control deck to connect and talk.",
      ],
    },
    {
      id: "rehearsal",
      title: "No-Voice Rehearsal",
      description: `Run the exact same structured recipe without Realtime first, then switch to live voice once the scene is in the right starting pose.`,
      bestFor: "training, dry runs, and low-risk setup",
      costNote: "No Realtime cost because the desktop actions run directly without a voice session.",
      primaryActionLabel: "Rehearsal Command",
      primaryActionValue: rehearsalCommand,
      steps: [
        `Run ${rehearsalCommand}`,
        "Inspect the exported capture or updated desktop scene.",
        "When the scene looks right, connect Realtime and continue live from there.",
      ],
    },
  ];
}

function buildRehearsalCommand(input: {
  target: "pymol" | "chimerax";
  recipeId?: string;
  workflowId?: ScientificWorkflowKind;
  scientificInputs?: ScientificLaunchInputs;
}): string {
  const identifier = input.recipeId ?? input.workflowId ?? fallbackRecipeId(input.target);
  const parts = ["npm run rehearse:workflow --", identifier, "--target", input.target, "--capture"];
  appendScientificArgs(parts, input.scientificInputs);
  return parts.join(" ");
}

function appendScientificArgs(parts: string[], inputs?: ScientificLaunchInputs): void {
  if (!inputs) {
    return;
  }
  if (inputs.uniprot) parts.push("--uniprot", inputs.uniprot);
  if (inputs.model) parts.push("--model", inputs.model);
  if (inputs.experimental) parts.push("--experimental", inputs.experimental);
  if (inputs.pae) parts.push("--pae", inputs.pae);
  if (inputs.map) parts.push("--map", inputs.map);
  if (inputs.bundle) parts.push("--bundle", inputs.bundle);
  if (inputs.scorefile) parts.push("--scorefile", inputs.scorefile);
  if (typeof inputs.topN === "number" && Number.isFinite(inputs.topN)) parts.push("--top-n", String(Math.max(1, Math.round(inputs.topN))));
}

function fallbackRecipeId(target: "pymol" | "chimerax"): string {
  return target === "pymol" ? "pymol-binding-pocket-story" : "chimerax-ligand-interaction-explainer";
}

function clampDuration(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value as number)));
}
