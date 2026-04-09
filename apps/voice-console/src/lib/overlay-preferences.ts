import type { OverlayTheme } from "./instrument-svg";

export type { OverlayTheme };

const THEME_KEY = "biovoice.overlay-theme";

export function readOverlayThemePreference(): OverlayTheme {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // Storage unavailable (private mode, quota) — fall through to media query.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function writeOverlayThemePreference(theme: OverlayTheme): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage failures — preference is best-effort.
  }
}

export function readOverlayMiniState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(rawHash);
  return params.get("mini") === "1" || params.get("mini") === "true";
}

export function setOverlayMiniState(minimized: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(
    window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
  );
  if (minimized) {
    params.set("mini", "1");
  } else {
    params.delete("mini");
  }
  const nextHash = params.toString();
  const currentHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (currentHash === nextHash) {
    return;
  }
  window.location.hash = nextHash;
}
