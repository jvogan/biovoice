function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(value: string): boolean {
  const normalized = normalizeHostname(value);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function urlPort(url: URL): number {
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === "https:" ? 443 : 80;
}

export function resolvePublicBaseUrlOrigin(input: {
  configuredPublicBaseUrl?: string;
  listenHost?: string;
  port: number;
}): string {
  const listenHost = (input.listenHost?.trim() || "127.0.0.1");
  const fallbackHost = listenHost === "0.0.0.0" ? "localhost" : listenHost;
  const fallbackOrigin = new URL(`http://${fallbackHost}:${input.port}`).origin;
  const configured = input.configuredPublicBaseUrl?.trim();
  if (!configured) {
    return fallbackOrigin;
  }

  try {
    const parsed = new URL(configured);
    if (
      (isLoopbackHostname(parsed.hostname) || normalizeHostname(parsed.hostname) === normalizeHostname(fallbackHost))
      && urlPort(parsed) !== input.port
    ) {
      parsed.port = String(input.port);
    }
    return parsed.origin;
  } catch {
    return fallbackOrigin;
  }
}
