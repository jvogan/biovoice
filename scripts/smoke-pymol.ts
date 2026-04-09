import fs from "node:fs/promises";
import { PymolAdapter } from "../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";
import { getRecipe, resolveFromRoot } from "../packages/runtime-and-adapters/src/index.js";

async function main() {
  const managedRpcUrl = await getManagedPymolRpcUrl();
  const adapter = new PymolAdapter({
    rpcUrl: process.env.PYMOL_RPC_URL ?? managedRpcUrl ?? undefined,
    baseUrl: process.env.PYMOL_RPC_BASE_URL ?? "http://127.0.0.1",
    startPort: Number(process.env.PYMOL_RPC_START_PORT ?? 9123),
    timeoutMs: Number(process.env.PYMOL_TIMEOUT_MS ?? 8000),
    renderTimeoutMs: Number(process.env.PYMOL_RENDER_TIMEOUT_MS ?? 120000),
    autolaunch: process.env.ENABLE_AUTOLAUNCH !== "false",
  });

  const recipe = getRecipe("pymol-binding-pocket-story");
  for (const step of recipe.steps) {
    console.log(`Running step: ${step.title}`);
    const actions = step.actions.map((action) => {
      if (action.type !== "export") {
        return action;
      }

      return {
        ...action,
        export: {
          ...action.export,
          rayTrace: false,
          width: Math.min(action.export.width ?? 2200, 1600),
          height: Math.min(action.export.height ?? 1500, 1100),
        },
      };
    });
    const result = await adapter.execute(actions as never, false);
    console.log(result.commandsExecuted.join("\n"));
  }
}

async function getManagedPymolRpcUrl(): Promise<string | null> {
  const stateRpcUrl = await readManagedStateRpcUrl();
  if (stateRpcUrl && await isResponsivePymolRpcUrl(stateRpcUrl)) {
    return stateRpcUrl;
  }

  try {
    const response = await fetch("http://localhost:3000/api/health", {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      appId?: string;
      runtime?: {
        targets?: {
          pymol?: {
            endpoint?: string;
            commandReady?: boolean;
          };
        };
      };
    };

    if (payload.appId !== "biovoice") {
      return null;
    }

    const runtimeEndpoint = payload.runtime?.targets?.pymol?.endpoint ?? null;
    if (runtimeEndpoint && (payload.runtime?.targets?.pymol?.commandReady ?? true) && await isResponsivePymolRpcUrl(runtimeEndpoint)) {
      return runtimeEndpoint;
    }
    return null;
  } catch {
    return null;
  }
}

async function readManagedStateRpcUrl(): Promise<string | null> {
  try {
    const raw = await fs.readFile(resolveFromRoot(".runtime", "agent-runtime", "state.json"), "utf8");
    const state = JSON.parse(raw) as {
      target?: string;
      targetEndpoint?: string;
      targetPort?: number;
      targetPid?: number;
      targetValidatedAt?: string;
      url?: string;
    };

    if (state.target === "pymol" && typeof state.targetEndpoint === "string" && state.targetEndpoint.startsWith("http")) {
      return state.targetEndpoint;
    }

    if (state.target === "pymol" && typeof state.url === "string") {
      const healthUrl = new URL("/api/health", state.url);
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const payload = await response.json() as {
          runtime?: {
            targets?: {
              pymol?: {
                endpoint?: string;
                commandReady?: boolean;
              };
            };
          };
        };
        const targetHealth = payload.runtime?.targets?.pymol;
        if (targetHealth?.endpoint && (targetHealth.commandReady ?? true)) {
          return targetHealth.endpoint;
        }
        return null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function isResponsivePymolRpcUrl(rpcUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
      },
      body: [
        "<?xml version=\"1.0\"?>",
        "<methodCall>",
        "<methodName>get_viewport</methodName>",
        "<params></params>",
        "</methodCall>",
      ].join(""),
      signal: AbortSignal.timeout(1_500),
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return /<array>/i.test(body) && /<int>/i.test(body);
  } catch {
    return false;
  }
}

void main();
