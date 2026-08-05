/** "2m", "3h", "4d" — compact enough for a dense list. */
export function relativeTime(iso: string | null, fallback: string | null): string {
  if (!iso) return fallback ?? '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return fallback ?? '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Poll cadence, phrased for a status line rather than a log. */
export function humanInterval(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

export function countdown(msRemaining: number): string {
  const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const mins = Math.floor(seconds / 60);
  return mins > 0 ? `${mins}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}
