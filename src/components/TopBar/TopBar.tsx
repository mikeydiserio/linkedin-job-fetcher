import { useEffect, useState } from 'react';

import type { FeedStatus } from '@hooks/useJobFeed';
import { countdown, humanInterval } from '@lib/format';

import s from './TopBar.module.css';

interface TopBarProps {
  status: FeedStatus;
  intervalMs: number;
  unreadCount: number;
  canPrompt: boolean;
  onEnableAlerts: () => void;
  onRefresh: () => void;
}

function statusLabel(status: FeedStatus, now: number): string {
  switch (status.phase) {
    case 'idle':
      return 'no active watches';
    case 'polling':
      return 'checking…';
    case 'waiting':
      return `next in ${countdown(status.nextRunAt - now)}`;
    case 'rate-limited':
      return `rate limited · retrying in ${countdown(status.until - now)}`;
    case 'error':
      return status.message;
  }
}

export function TopBar({
  status,
  intervalMs,
  unreadCount,
  canPrompt,
  onEnableAlerts,
  onRefresh,
}: TopBarProps) {
  // A countdown has to re-render on its own; nothing else changes per second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const phase = status.phase;

  return (
    <header className={s.bar}>
      <div className={s.brand}>
        <span className={s.pulse} data-phase={phase} aria-hidden="true" />
        <h1 className={s.title}>Job Fetcher</h1>
        {unreadCount > 0 ? <span className={s.badge}>{unreadCount} new</span> : null}
      </div>

      <div className={s.actions}>
        {intervalMs > 0 ? (
          <span className={s.rate} title="Adaptive poll cadence">
            every {humanInterval(intervalMs)}
          </span>
        ) : null}
        <span className={s.status} data-phase={phase}>
          {statusLabel(status, now)}
        </span>
        {canPrompt ? (
          <button type="button" className={s.ghost} onClick={onEnableAlerts}>
            Enable alerts
          </button>
        ) : null}
        <button type="button" className={s.button} onClick={onRefresh} disabled={phase === 'polling'}>
          Check now
        </button>
      </div>
    </header>
  );
}
