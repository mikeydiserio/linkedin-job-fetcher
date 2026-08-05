import { JobCard } from '@components/JobCard/JobCard';
import type { SeenJob, Watch } from '@lib/types';

import s from './JobList.module.css';

export type JobFilter = 'all' | 'unread';

interface JobListProps {
  jobs: SeenJob[];
  watches: Watch[];
  filter: JobFilter;
  activeWatchId: string | null;
  hasWatches: boolean;
  onFilterChange: (filter: JobFilter) => void;
  onWatchChange: (id: string | null) => void;
  onRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function JobList({
  jobs,
  watches,
  filter,
  activeWatchId,
  hasWatches,
  onFilterChange,
  onWatchChange,
  onRead,
  onMarkAllRead,
}: JobListProps) {
  const visible = jobs.filter(
    (job) =>
      (filter === 'all' || !job.read) && (activeWatchId === null || job.watchId === activeWatchId),
  );

  return (
    <section className={s.wrapper}>
      <div className={s.toolbar}>
        <div className={s.tabs} role="group" aria-label="Filter postings">
          <button
            type="button"
            className={s.tab}
            data-active={filter === 'all'}
            onClick={() => onFilterChange('all')}
          >
            All
          </button>
          <button
            type="button"
            className={s.tab}
            data-active={filter === 'unread'}
            onClick={() => onFilterChange('unread')}
          >
            Unread
          </button>
        </div>

        <select
          className={s.select}
          value={activeWatchId ?? ''}
          onChange={(e) => onWatchChange(e.target.value || null)}
          aria-label="Filter by watch"
        >
          <option value="">All watches</option>
          {watches.map((watch) => (
            <option key={watch.id} value={watch.id}>
              {watch.keywords}
            </option>
          ))}
        </select>

        <button type="button" className={s.markRead} onClick={onMarkAllRead}>
          Mark all read
        </button>
      </div>

      {visible.length === 0 ? (
        <p className={s.empty}>
          {hasWatches
            ? 'Nothing yet. Postings appear here as they land inside the look-back window.'
            : 'Add a watch to start monitoring.'}
        </p>
      ) : (
        <ul className={s.list}>
          {visible.map((job) => (
            <JobCard key={job.id} job={job} onRead={onRead} />
          ))}
        </ul>
      )}
    </section>
  );
}
