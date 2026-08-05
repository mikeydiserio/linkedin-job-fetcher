import { useCallback, useState } from 'react';

import { JobList, type JobFilter } from '@components/JobList/JobList';
import { TopBar } from '@components/TopBar/TopBar';
import { WatchForm } from '@components/WatchForm/WatchForm';
import { WatchList } from '@components/WatchList/WatchList';
import { useJobFeed } from '@hooks/useJobFeed';
import { useNotifications } from '@hooks/useNotifications';
import { useWatches, type WatchDraft } from '@hooks/useWatches';

import s from './App.module.css';

export function App() {
  const { watches, addWatch, removeWatch, toggleWatch } = useWatches();
  const { canPrompt, request, notify } = useNotifications();

  const [filter, setFilter] = useState<JobFilter>('all');
  const [activeWatchId, setActiveWatchId] = useState<string | null>(null);

  const { jobs, status, intervalMs, refresh, markRead, markAllRead } = useJobFeed(watches, notify);

  // Derived, not state — recomputing a count is cheaper than keeping it in sync.
  const unreadCount = jobs.filter((job) => !job.read).length;
  const counts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.watchId] = (acc[job.watchId] ?? 0) + 1;
    return acc;
  }, {});

  const handleAdd = useCallback(
    (draft: WatchDraft) => {
      addWatch(draft);
      // Populate the new watch right away rather than waiting for the next tick.
      refresh();
    },
    [addWatch, refresh],
  );

  const handleRemove = useCallback(
    (id: string) => {
      removeWatch(id);
      setActiveWatchId((current) => (current === id ? null : current));
    },
    [removeWatch],
  );

  return (
    <div className={s.shell}>
      <TopBar
        status={status}
        intervalMs={intervalMs}
        unreadCount={unreadCount}
        canPrompt={canPrompt}
        onEnableAlerts={() => void request()}
        onRefresh={refresh}
      />

      <main className={s.layout}>
        <aside className={s.sidebar}>
          <section className={s.panel}>
            <h2 className={s.heading}>New watch</h2>
            <WatchForm onSubmit={handleAdd} />
          </section>

          <section className={s.panel}>
            <h2 className={s.heading}>Watches</h2>
            <WatchList
              watches={watches}
              counts={counts}
              onToggle={toggleWatch}
              onRemove={handleRemove}
            />
          </section>
        </aside>

        <JobList
          jobs={jobs}
          watches={watches}
          filter={filter}
          activeWatchId={activeWatchId}
          hasWatches={watches.length > 0}
          onFilterChange={setFilter}
          onWatchChange={setActiveWatchId}
          onRead={markRead}
          onMarkAllRead={markAllRead}
        />
      </main>
    </div>
  );
}
