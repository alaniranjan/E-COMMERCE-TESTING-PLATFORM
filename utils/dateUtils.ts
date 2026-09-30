export function isoNow(): string {
  return new Date().toISOString();
}

/** File-name-safe timestamp, e.g. 2026-09-23T14-20-05-123Z */
export function fileTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
