import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, Menu, powerSaveBlocker, screen, shell, systemPreferences } from "electron";

const FULL_BOUNDS = {
  width: 340,
  height: 486,
};

const MINI_BOUNDS = {
  width: 264,
  height: 84,
};

const launch = parseArgs(process.argv.slice(2));
let mainWindow = null;
let powerSaveBlockerId = null;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

void bootstrap().catch((error) => {
  console.error("[floating-companion] bootstrap failed", error);
  app.exit(1);
});

async function bootstrap() {
  await app.whenReady();
  ensurePowerSaveBlocker();
  await primeMediaAccess();
  installMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });

  app.on("window-all-closed", () => {
    stopPowerSaveBlocker();
    app.quit();
  });
}

async function createWindow() {
  const bounds = await readWindowBounds();
  const url = ensureOverlayUrl(launch.url);
  const mini = isMiniOverlayUrl(url);
  const targetBounds = clampToDisplay(bounds ?? defaultWindowBounds(mini), mini);

  mainWindow = new BrowserWindow({
    ...targetBounds,
    minWidth: mini ? MINI_BOUNDS.width : 328,
    minHeight: mini ? MINI_BOUNDS.height : 470,
    maxWidth: mini ? MINI_BOUNDS.width : 430,
    maxHeight: mini ? MINI_BOUNDS.height : 640,
    useContentSize: true,
    show: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    acceptFirstMouse: true,
    fullscreenable: false,
    closable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    title: `Realtime ${launch.target === "pymol" ? "PyMOL" : "ChimeraX"} Companion`,
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setFullScreenable(false);
  configureMediaPermissions(mainWindow);
  mainWindow.on("close", () => {
    void persistBounds(mainWindow);
  });
  mainWindow.on("moved", () => {
    void persistBounds(mainWindow);
  });
  mainWindow.on("resized", () => {
    void persistBounds(mainWindow);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: externalUrl }) => {
    void shell.openExternal(externalUrl);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[floating-companion] did-fail-load code=${code} description=${description}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.warn(`[floating-companion] renderer-console level=${level} source=${sourceId}:${line} message=${message}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[floating-companion] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("[floating-companion] renderer unresponsive");
  });
  mainWindow.webContents.on("responsive", () => {
    console.warn("[floating-companion] renderer responsive");
  });
  mainWindow.webContents.on("did-start-navigation", (_event, navigatedUrl, isInPlace, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    console.warn(`[floating-companion] did-start-navigation url=${navigatedUrl} inPlace=${String(isInPlace)}`);
  });
  mainWindow.webContents.on("did-navigate-in-page", (_event, navigatedUrl) => {
    syncWindowFromUrl(mainWindow, navigatedUrl);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    syncWindowFromUrl(mainWindow, mainWindow.webContents.getURL());
  });
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.setAlwaysOnTop(true, "floating", 1);

  await waitForLocalRuntime(url, 12_000).catch(() => {});
  await mainWindow.loadURL(url);
}

function ensurePowerSaveBlocker() {
  if (powerSaveBlockerId && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    return;
  }
  powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  console.warn(`[floating-companion] power-save-blocker started id=${powerSaveBlockerId}`);
}

function stopPowerSaveBlocker() {
  if (!powerSaveBlockerId) {
    return;
  }
  if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.warn(`[floating-companion] power-save-blocker stopped id=${powerSaveBlockerId}`);
  }
  powerSaveBlockerId = null;
}

async function primeMediaAccess() {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "not-determined") {
      await systemPreferences.askForMediaAccess("microphone");
    }
  } catch (error) {
    console.warn("[floating-companion] microphone access check failed", error);
  }
}

function configureMediaPermissions(window) {
  const ses = window.webContents.session;
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (permission !== "media") {
      return false;
    }
    return isTrustedCompanionOrigin(details?.requestingUrl ?? details?.securityOrigin ?? requestingOrigin);
  });
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }
    const securityOrigin = "securityOrigin" in details ? details.securityOrigin : undefined;
    const requestingUrl = "requestingUrl" in details ? details.requestingUrl : undefined;
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    const allow =
      isTrustedCompanionOrigin(requestingUrl ?? securityOrigin)
      && Array.isArray(mediaTypes)
      && mediaTypes.includes("audio");
    callback(allow);
  });
}

function isTrustedCompanionOrigin(urlString) {
  if (!urlString) {
    return false;
  }

  try {
    const url = new URL(urlString);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && url.pathname.startsWith("/");
  } catch {
    return false;
  }
}

function installMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "close" },
        { role: "quit" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function parseArgs(argv) {
  const args = new Map();
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const separatorIndex = token.indexOf("=");
    if (separatorIndex === -1) {
      args.set(token.slice(2), "1");
      continue;
    }
    const key = token.slice(2, separatorIndex);
    const value = token.slice(separatorIndex + 1);
    args.set(key, value || "1");
  }

  const url = args.get("url");
  const target = args.get("target");
  if (!url || (target !== "pymol" && target !== "chimerax")) {
    throw new Error("Usage: electron apps/floating-companion/main.mjs --url=<http://127.0.0.1:3000/?...> --target=<pymol|chimerax>");
  }

  return {
    url,
    target,
  };
}

function ensureOverlayUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("widget", "1");
  url.searchParams.set("overlay", "1");
  return url.toString();
}

async function waitForLocalRuntime(urlString, timeoutMs) {
  const url = new URL(urlString);
  const base = `${url.protocol}//${url.host}/api/health`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function defaultWindowBounds(mini = false) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workArea;
  const size = mini ? MINI_BOUNDS : FULL_BOUNDS;
  return {
    width: size.width,
    height: size.height,
    x: Math.round(display.workArea.x + width - size.width - 28),
    y: Math.round(display.workArea.y + Math.max(18, Math.min(72, height * 0.05))),
  };
}

function clampToDisplay(bounds, mini = false) {
  const size = mini ? MINI_BOUNDS : FULL_BOUNDS;
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const { x, y, width, height } = display.workArea;
  return {
    width: size.width,
    height: size.height,
    x: Math.max(x + 12, Math.min(bounds.x, x + width - size.width - 12)),
    y: Math.max(y + 12, Math.min(bounds.y, y + height - size.height - 12)),
  };
}

function syncWindowFromUrl(window, urlString) {
  if (!window || window.isDestroyed()) {
    return;
  }
  const mini = isMiniOverlayUrl(urlString);
  const nextSize = mini ? MINI_BOUNDS : FULL_BOUNDS;
  const current = window.getBounds();
  const nextBounds = clampToDisplay({ ...current, ...nextSize }, mini);
  window.setMinimumSize(nextSize.width, nextSize.height);
  window.setMaximumSize(nextSize.width, nextSize.height);
  window.setBounds(nextBounds, true);
  void persistBounds(window);
}

function isMiniOverlayUrl(urlString) {
  try {
    const url = new URL(urlString);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const params = new URLSearchParams(hash);
    return params.get("mini") === "1" || params.get("mini") === "true";
  } catch {
    return false;
  }
}

async function readWindowBounds() {
  try {
    const raw = await fs.readFile(getStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.[launch.target] ?? null;
  } catch {
    return null;
  }
}

async function persistBounds(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const nextBounds = window.getBounds();
  let current = {};
  try {
    current = JSON.parse(await fs.readFile(getStatePath(), "utf8"));
  } catch {
    current = {};
  }

  await fs.mkdir(path.dirname(getStatePath()), { recursive: true });
  await fs.writeFile(
    getStatePath(),
    JSON.stringify(
      {
        ...current,
        [launch.target]: {
          x: nextBounds.x,
          y: nextBounds.y,
          width: nextBounds.width,
          height: nextBounds.height,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function getStatePath() {
  return path.join(app.getPath("userData"), "floating-companion-state.json");
}
