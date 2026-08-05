import { el, timeAgo, inFuture, duration } from './dom.js';

export function renderWatches(root, countEl, watches, { onToggle, onDelete }) {
  countEl.textContent = watches.length;
  root.replaceChildren(
    ...watches.map((w) => {
      const li = el('li', { className: `watch${w.enabled ? '' : ' is-off'}` });

      li.append(
        el(
          'div',
          { className: 'watch-top' },
          el('span', { className: 'watch-title', textContent: w.keywords }),
        ),
        el('div', {
          className: 'watch-meta',
          textContent: [
            w.location || 'Anywhere',
            `past ${w.window}`,
            w.lastCheckedAt ? `checked ${timeAgo(w.lastCheckedAt)}` : 'not checked yet',
          ].join(' · '),
        }),
      );

      if (w.lastError) li.append(el('div', { className: 'watch-err', textContent: w.lastError }));

      const toggle = el('button', { textContent: w.enabled ? 'Pause' : 'Resume' });
      toggle.onclick = () => onToggle(w);

      const del = el('button', { className: 'del', textContent: 'Delete' });
      del.onclick = () => onDelete(w);

      li.append(el('div', { className: 'watch-actions' }, toggle, del));
      return li;
    }),
  );
}

export function renderJobs(root, emptyEl, jobs, filter, { onOpen }) {
  const visible = filter === 'unread' ? jobs.filter((j) => !j.read) : jobs;

  emptyEl.hidden = visible.length > 0;
  emptyEl.textContent =
    filter === 'unread' && jobs.length
      ? 'Nothing unread — you’re all caught up.'
      : 'No postings yet. Add a watch and results will appear here as they’re posted.';

  root.replaceChildren(
    ...visible.map((job) => {
      const li = el('li', { className: `job${job.read ? '' : ' is-new'}` });

      const logo = job.logo
        ? el('img', { className: 'job-logo', src: job.logo, alt: '', loading: 'lazy' })
        : el('div', {
            className: 'job-logo-fallback',
            textContent: (job.company || '?').charAt(0).toUpperCase(),
          });

      const link = el('a', {
        href: job.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        textContent: job.title,
      });
      link.onclick = () => onOpen(job);

      const meta = el('div', { className: 'job-meta' });
      if (job.location) meta.append(el('span', { textContent: job.location }));
      if (job.postedLabel) meta.append(el('span', { textContent: job.postedLabel }));
      if (job.salary) meta.append(el('span', { className: 'job-salary', textContent: job.salary }));
      meta.append(
        el('span', { textContent: `found ${timeAgo(job.firstSeenAt)}` }),
        el('span', { textContent: `via “${job.watchLabel}”` }),
      );

      const body = el(
        'div',
        { className: 'job-body' },
        el('h3', { className: 'job-title' }, link),
        job.company && el('div', { className: 'job-company', textContent: job.company }),
        meta,
      );

      const openLink = el('a', {
        className: 'job-open',
        href: job.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        textContent: 'Open ↗',
      });
      openLink.onclick = () => onOpen(job);

      li.append(
        logo,
        body,
        el(
          'div',
          { className: 'job-side' },
          !job.read && el('span', { className: 'tag-new', textContent: 'New' }),
          openLink,
        ),
      );
      return li;
    }),
  );
}

/** The governor's state, so the tuning isn't a black box. */
export function renderHealth(root, status) {
  const r = status.rate ?? {};
  const rows = [
    ['Cadence', r.intervalMs ? duration(r.intervalMs) : '—'],
    ['Next check', status.nextRunAt ? inFuture(status.nextRunAt) : '—'],
    ['Budget', r.requestsPerMin ? `${r.requestsPerMin}/min` : '—'],
    ['Thin responses', r.truncationRate != null ? `${Math.round(r.truncationRate * 100)}%` : '—'],
    ['Requests', String(status.totalRequests ?? 0)],
  ];
  if (r.atFloor) rows.push(['State', 'at fastest safe rate']);
  if (r.pausedUntil && new Date(r.pausedUntil) > new Date()) {
    rows.push(['State', `backed off ${inFuture(r.pausedUntil)}`]);
  }

  root.replaceChildren(
    ...rows.flatMap(([k, v]) => [
      el('dt', { textContent: k }),
      el('dd', { textContent: v, className: v === 'at fastest safe rate' ? 'good' : '' }),
    ]),
  );
}
