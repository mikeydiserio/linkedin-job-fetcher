import { relativeTime } from '@lib/format';
import type { SeenJob } from '@lib/types';

import s from './JobCard.module.css';

interface JobCardProps {
  job: SeenJob;
  onRead: (id: string) => void;
}

export function JobCard({ job, onRead }: JobCardProps) {
  return (
    <li className={s.card} data-unread={!job.read}>
      <a
        className={s.link}
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onRead(job.id)}
      >
        {job.logo ? (
          <img className={s.logo} src={job.logo} alt="" width={40} height={40} loading="lazy" />
        ) : (
          <span className={s.logoFallback} aria-hidden="true">
            {job.company?.[0]?.toUpperCase() ?? '·'}
          </span>
        )}

        <span className={s.body}>
          <span className={s.title}>{job.title}</span>
          <span className={s.meta}>
            {[job.company, job.location].filter(Boolean).join(' · ')}
          </span>
          {job.salary ? <span className={s.salary}>{job.salary}</span> : null}
        </span>

        <span className={s.time}>{relativeTime(job.postedAt, job.postedLabel)}</span>
      </a>
    </li>
  );
}
