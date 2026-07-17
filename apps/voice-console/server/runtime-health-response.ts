export function prepareTargetHealthDetail(
  targetLabel: string,
  ready: boolean,
  detail: string | undefined,
  includeSensitive: boolean,
): string {
  if (ready) {
    return `${targetLabel} is command-ready.`;
  }
  if (includeSensitive && detail?.trim()) {
    return detail;
  }
  return `${targetLabel} is not currently command-ready.`;
}
