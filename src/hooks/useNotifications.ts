import { useCallback, useState } from 'react';

import type { Job } from '@lib/types';

export type NotifyPermission = 'unsupported' | NotificationPermission;

export interface UseNotifications {
  permission: NotifyPermission;
  canPrompt: boolean;
  request: () => Promise<void>;
  notify: (jobs: Job[]) => void;
}

/**
 * Browser notifications for newly-seen postings.
 *
 * The Notification API replaces the desktop notifier the Node version used —
 * same effect, no native dependency, and it degrades to silence when the user
 * declines rather than erroring.
 */
export function useNotifications(): UseNotifications {
  const [permission, setPermission] = useState<NotifyPermission>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  }, []);

  const notify = useCallback(
    (jobs: Job[]) => {
      if (permission !== 'granted' || jobs.length === 0) return;

      const [first] = jobs;
      if (!first) return;

      // One notification per batch. Firing one per job turns a busy hour into
      // an unusable stack of toasts.
      const title =
        jobs.length === 1 ? first.title : `${jobs.length} new postings`;
      const body =
        jobs.length === 1
          ? [first.company, first.location].filter(Boolean).join(' · ')
          : jobs
              .slice(0, 3)
              .map((j) => j.title)
              .join('\n');

      const notification = new Notification(title, { body, tag: 'job-fetcher' });
      notification.onclick = () => {
        window.focus();
        if (jobs.length === 1) window.open(first.url, '_blank', 'noopener');
        notification.close();
      };
    },
    [permission],
  );

  return {
    permission,
    canPrompt: permission === 'default',
    request,
    notify,
  };
}
