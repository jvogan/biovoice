export function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
