import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocalStorage } from '@hooks/useLocalStorage';
import { searchJobs } from '@lib/api';
import { RateGovernor } from '@lib/governor';
import type { Job, SeenJob, Watch } from '@lib/types';

const STORAGE_KEY = 'job-fetcher:jobs';
const GOVERNOR_KEY = 'job-fetcher:interval';

/** Drop postings older than this so localStorage can't grow without bound. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export type FeedStatus =
  | { phase: 'idle' }
  | { phase: 'polling' }
  | { phase: 'waiting'; nextRunAt: number }
  | { phase: 'rate-limited'; until: number; message: string }
  | { phase: 'error'; message: string };

export interface UseJobFeed {
  jobs: SeenJob[];
  status: FeedStatus;
  intervalMs: number;
  runs: number;
  refresh: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearJobs: () => void;
}

export function useJobFeed(watches: Watch[], onNewJobs: (jobs: Job[]) => void): UseJobFeed {
  const [jobs, setJobs] = useLocalStorage<SeenJob[]>(STORAGE_KEY, []);
  const [status, setStatus] = useState<FeedStatus>({ phase: 'idle' });
  const [runs, setRuns] = useState(0);
  const [intervalMs, setIntervalMs] = useState(0);

  const governorRef = useRef<RateGovernor | null>(null);
  if (governorRef.current === null) {
    governorRef.current = new RateGovernor();
    const saved = Number(window.localStorage.getItem(GOVERNOR_KEY));
    if (saved) governorRef.current.restore(saved);
  }

  // Ids already surfaced, seeded from what was persisted. Kept as a ref so the
  // "is this new?" test doesn't depend on a state value the loop closed over.
  const knownIdsRef = useRef<Set<string> | null>(null);
  if (knownIdsRef.current === null) {
    knownIdsRef.current = new Set(jobs.map((job) => job.id));
  }

  // The polling loop reads these through refs so that adding a watch or
  // receiving results doesn't tear down and restart the timer mid-cycle.
  const watchesRef = useRef(watches);
  watchesRef.current = watches;
  const onNewJobsRef = useRef(onNewJobs);
  onNewJobsRef.current = onNewJobs;

  const runningRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);

  const runCycle = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const governor = governorRef.current;
      const known = knownIdsRef.current;
      if (!governor || !known || runningRef.current) return;

      const enabled = watchesRef.current.filter((w) => w.enabled);
      if (enabled.length === 0) {
        setStatus({ phase: 'idle' });
        return;
      }

      runningRef.current = true;
      setStatus({ phase: 'polling' });

      const found: Job[] = [];
      const totals = { requests: 0, full: 0, truncated: 0 };
      let failure: FeedStatus | null = null;

      for (const watch of enabled) {
        if (signal.aborted) break;

        const result = await searchJobs(watch, signal);

        if (result.status === 'rate-limited') {
          governor.recordBlocked(result.retryAfterMs);
          failure = {
            phase: 'rate-limited',
            until: Date.now() + result.retryAfterMs,
            message: result.message,
          };
          break;
        }
        if (result.status === 'error') {
          failure = { phase: 'error', message: result.message };
          continue;
        }

        totals.requests += result.stats.requests;
        totals.full += result.stats.full;
        totals.truncated += result.stats.truncated;

        // Decide what's new out here: a state updater has to stay pure, and
        // under StrictMode it runs twice — which would double-count `found`.
        const fresh = result.jobs.filter((job) => !known.has(job.id));
        if (fresh.length === 0) continue;

        for (const job of fresh) known.add(job.id);
        found.push(...fresh);

        // Tag each posting with the watch that surfaced it before merging, so
        // the list can be filtered per watch without a second lookup.
        const now = Date.now();
        const tagged: SeenJob[] = fresh.map((job) => ({
          ...job,
          watchId: watch.id,
          firstSeenAt: now,
          read: false,
        }));
        setJobs((prev) => [...tagged, ...prev].filter((j) => j.firstSeenAt > now - RETENTION_MS));
      }

      if (!signal.aborted) {
        if (failure?.phase !== 'rate-limited') governor.endCycle(totals);
        window.localStorage.setItem(GOVERNOR_KEY, String(governor.intervalMs));
        setIntervalMs(governor.intervalMs);
        setRuns((n) => n + 1);
        if (found.length > 0) onNewJobsRef.current(found);
        if (failure) setStatus(failure);
      }

      runningRef.current = false;
    },
    [setJobs],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let cancelled = false;

    const loop = async (): Promise<void> => {
      while (!cancelled) {
        await runCycle(controller.signal);
        if (cancelled) return;

        const governor = governorRef.current;
        const delay = governor?.nextDelayMs() ?? 60_000;
        setStatus((prev) =>
          prev.phase === 'rate-limited' ? prev : { phase: 'waiting', nextRunAt: Date.now() + delay },
        );

        // Resolves early when "Check now" calls wake(), so a manual refresh
        // doesn't have to wait out the remaining interval.
        await new Promise<void>((resolve) => {
          wakeRef.current = resolve;
          timer = window.setTimeout(resolve, delay);
        });
        window.clearTimeout(timer);
        wakeRef.current = null;
      }
    };

    void loop();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
      wakeRef.current?.();
    };
  }, [runCycle]);

  const refresh = useCallback(() => wakeRef.current?.(), []);

  const markRead = useCallback(
    (id: string) => setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, read: true } : j))),
    [setJobs],
  );

  const markAllRead = useCallback(
    () => setJobs((prev) => prev.map((j) => (j.read ? j : { ...j, read: true }))),
    [setJobs],
  );

  const clearJobs = useCallback(() => {
    knownIdsRef.current?.clear();
    setJobs([]);
  }, [setJobs]);

  return { jobs, status, intervalMs, runs, refresh, markRead, markAllRead, clearJobs };
}
