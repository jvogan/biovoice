import fullInstrumentDarkSvg from "../assets/widget/widget-full-dark.svg?raw";
import fullInstrumentLightSvg from "../assets/widget/widget-full-light.svg?raw";
import miniInstrumentSvg from "../assets/widget/widget-minimized.svg?raw";
import miniInstrumentLightSvg from "../assets/widget/widget-minimized-light.svg?raw";

export { fullInstrumentDarkSvg, fullInstrumentLightSvg, miniInstrumentSvg, miniInstrumentLightSvg };

export type OverlayTheme = "dark" | "light";
export type TargetKind = "pymol" | "chimerax";

function escapeSvgText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

// Restricted to <text> closers so nested <tspan> cannot truncate matches.
function replaceSvgTextById(svg: string, id: string, text: string): string {
  const pattern = new RegExp(`(<text[^>]*\\sid="${id}"[^>]*>)([\\s\\S]*?)(</text>)`);
  return svg.replace(pattern, `$1${escapeSvgText(text)}$3`);
}

export function buildInstrumentSvg(input: {
  template: string;
  theme: OverlayTheme;
  appName: string;
  statusLabel: string;
  contextText: string;
  terminalText: string;
  powerLabel?: string;
  holdLabel?: string;
}): string {
  let svg = input.template;
  svg = replaceSvgTextById(svg, "app-name", input.appName);
  svg = replaceSvgTextById(svg, "status-label", input.statusLabel);
  svg = replaceSvgTextById(svg, "context-text", input.contextText);
  svg = replaceSvgTextById(svg, "terminal-text", input.terminalText);
  if (input.powerLabel) {
    svg = replaceSvgTextById(svg, "label-power", input.powerLabel);
  }
  if (input.holdLabel) {
    svg = replaceSvgTextById(svg, "label-hold", input.holdLabel);
  }
  return svg;
}

export function buildMinimizedInstrumentSvg(input: {
  template: string;
  target: TargetKind;
  statusText: string;
}): string {
  const ledFill = input.target === "pymol" ? "#ECC94B" : "#4FD1C5";
  // Mini SVGs carry id="mini-target-status" on the status text and
  // id="mini-target-indicator" on the LED circle, so both replacements are
  // tolerant of template edits.
  let svg = replaceSvgTextById(
    input.template,
    "mini-target-status",
    // Fallback for older mini SVGs that still use the literal placeholder.
    input.statusText,
  );
  if (svg === input.template) {
    svg = input.template.replace(
      /PYMOL\s*[•:]\s*OFFLINE/,
      escapeSvgText(input.statusText),
    );
  }
  svg = svg.replace(
    /(<circle[^>]+id="mini-target-indicator"[^>]+fill=")([^"]+)(")/,
    `$1${ledFill}$3`,
  );
  return svg;
}
