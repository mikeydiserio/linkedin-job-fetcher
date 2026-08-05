import { EXPERIENCE, WORKPLACE, type Watch } from '@lib/types';

import s from './WatchList.module.css';

interface WatchListProps {
  watches: Watch[];
  counts: Record<string, number>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

export function WatchList({ watches, counts, onToggle, onRemove }: WatchListProps) {
  if (watches.length === 0) {
    return <p className={s.empty}>No watches yet. Add one above to start polling.</p>;
  }

  return (
    <ul className={s.list}>
      {watches.map((watch) => {
        const tags = [
          ...watch.remote.map((c) => WORKPLACE[c]),
          ...watch.experience.map((c) => EXPERIENCE[c]),
        ];

        return (
          <li key={watch.id} className={s.item} data-enabled={watch.enabled}>
            <div className={s.head}>
              <span className={s.keywords}>{watch.keywords}</span>
              <span className={s.count}>{counts[watch.id] ?? 0}</span>
            </div>

            <p className={s.meta}>
              {watch.location || 'Anywhere'} · {watch.window}
            </p>

            {tags.length > 0 ? (
              <ul className={s.tags}>
                {tags.map((tag) => (
                  <li key={tag} className={s.tag}>
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className={s.controls}>
              <button type="button" className={s.control} onClick={() => onToggle(watch.id)}>
                {watch.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className={`${s.control} ${s.remove}`}
                onClick={() => onRemove(watch.id)}
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
