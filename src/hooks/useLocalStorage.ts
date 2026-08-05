import { useCallback, useState } from 'react';

/**
 * State mirrored into localStorage.
 *
 * Persistence is deliberately best-effort: a private-mode browser or a full
 * quota throws on write, and losing a cached job list is not worth breaking
 * the render over. Reads that fail fall back to the initial value.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (update: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Quota or private mode — keep the in-memory value and move on.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
