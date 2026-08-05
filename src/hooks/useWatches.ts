import { useCallback } from 'react';

import { useLocalStorage } from '@hooks/useLocalStorage';
import type { ExperienceCode, TimeWindow, Watch, WorkplaceCode } from '@lib/types';

const STORAGE_KEY = 'job-fetcher:watches';

export interface WatchDraft {
  keywords: string;
  location: string;
  window: TimeWindow;
  remote: WorkplaceCode[];
  experience: ExperienceCode[];
}

export interface UseWatches {
  watches: Watch[];
  addWatch: (draft: WatchDraft) => Watch;
  removeWatch: (id: string) => void;
  toggleWatch: (id: string) => void;
}

export function useWatches(): UseWatches {
  const [watches, setWatches] = useLocalStorage<Watch[]>(STORAGE_KEY, []);

  const addWatch = useCallback(
    (draft: WatchDraft): Watch => {
      const watch: Watch = {
        ...draft,
        id: crypto.randomUUID(),
        enabled: true,
        createdAt: Date.now(),
      };
      setWatches((prev) => [...prev, watch]);
      return watch;
    },
    [setWatches],
  );

  const removeWatch = useCallback(
    (id: string) => setWatches((prev) => prev.filter((w) => w.id !== id)),
    [setWatches],
  );

  const toggleWatch = useCallback(
    (id: string) =>
      setWatches((prev) => prev.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))),
    [setWatches],
  );

  return { watches, addWatch, removeWatch, toggleWatch };
}
