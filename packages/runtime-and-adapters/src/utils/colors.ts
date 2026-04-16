const GRAY_ALIAS_RE = /\bgr+a+y\b|\bgr+e+y\b/gi;
const GRAY_PERCENT_RE = /^gr[ae]y([0-9]{1,3})$/i;

const PY_MOL_COLOR_ALIASES = new Map<string, string>([
  ["very light gray", "gray90"],
  ["very light grey", "gray90"],
  ["light gray", "gray80"],
  ["light grey", "gray80"],
  ["pale gray", "gray85"],
  ["pale grey", "gray85"],
  ["medium gray", "gray60"],
  ["medium grey", "gray60"],
  ["dark gray", "gray40"],
  ["dark grey", "gray40"],
  ["very dark gray", "gray25"],
  ["very dark grey", "gray25"],
  ["warm gray", "gray70"],
  ["warm grey", "gray70"],
  ["slate gray", "slate"],
  ["slate grey", "slate"],
  ["hot pink", "hotpink"],
]);

export function normalizePymolColorSpec(color: string): string {
  return PY_MOL_COLOR_ALIASES.get(normalizeColorAliasKey(color)) ?? color.trim();
}

export function normalizeChimeraXColorSpec(color: string): string {
  const normalized = normalizePymolColorSpec(color);
  const match = GRAY_PERCENT_RE.exec(normalized);
  if (!match) {
    return normalized;
  }
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return normalized;
  }
  const channel = Math.round((percent / 100) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `#${channel}${channel}${channel}`;
}

function normalizeColorAliasKey(color: string): string {
  return color
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(GRAY_ALIAS_RE, "gray")
    .replace(/\s+/g, " ");
}
