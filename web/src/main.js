import './style.css';
import { api } from './api.js';
import { duration, timeAgo } from './dom.js';
import { renderWatches, renderJobs, renderHealth } from './render.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  status: $('#status'),
  rate: $('#rate'),
  refreshBtn: $('#refresh-btn'),
  notifyBtn: $('#notify-btn'),
  form: $('#watch-form'),
  formError: $('#form-error'),
  watchList: $('#watch-list'),
  watchCount: $('#watch-count'),
  jobList: $('#job-list'),
  empty: $('#empty'),
  unreadBadge: $('#unread-badge'),
  markAll: $('#mark-all'),
  health: $('#health'),
};

let filter = 'all';
/** Ids already announced, so re-renders don't re-notify. */
const notified = new Set();
let firstLoad = true;
/** Set from the server's NOTIFY mode; avoids double-alerting. */
let browserAlertsEnabled = false;

/* ----------------------------- notifications ---------------------------- */

function announce(jobs) {
  // Skip the initial load, or you'd get a burst for the whole backlog.
  if (firstLoad) {
    jobs.forEach((j) => notified.add(j.id));
    firstLoad = false;
    return;
  }
  // The server fires OS-level toasts by default; duplicating them in the
  // browser would mean two alerts for one job.
  if (!browserAlertsEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const fresh = jobs.filter((j) => !j.read && !notified.has(j.id));
  fresh.forEach((j) => notified.add(j.id));
  if (!fresh.length) return;

  if (fresh.length === 1) {
    const [job] = fresh;
    const n = new Notification(job.title, {
      body: `${job.company ?? ''}${job.location ? ` — ${job.location}` : ''}`,
      tag: job.id,
    });
    n.onclick = () => {
      window.open(job.url, '_blank', 'noopener');
      n.close();
    };
  } else {
    new Notification(`${fresh.length} new job postings`, {
      body: fresh.slice(0, 3).map((j) => j.title).join('\n'),
      tag: 'job-batch',
    });
  }
}

/* -------------------------------- refresh ------------------------------- */

const markRead = async (ids) => {
  await api.markRead(ids);
  refresh();
};

async function refresh() {
  try {
    const [status, watches, jobs] = await Promise.all([api.status(), api.watches(), api.jobs()]);

    renderWatches(els.watchList, els.watchCount, watches, {
      onToggle: async (w) => {
        await api.patchWatch(w.id, { enabled: !w.enabled });
        refresh();
      },
      onDelete: async (w) => {
        if (!confirm(`Delete watch "${w.keywords}" and its results?`)) return;
        await api.deleteWatch(w.id);
        refresh();
      },
    });

    renderJobs(els.jobList, els.empty, jobs, filter, { onOpen: (job) => markRead([job.id]) });
    renderHealth(els.health, status);
    announce(jobs);

    els.unreadBadge.hidden = status.unreadCount === 0;
    els.unreadBadge.textContent = status.unreadCount;
    document.title = status.unreadCount ? `(${status.unreadCount}) Job Fetcher` : 'Job Fetcher';

    browserAlertsEnabled = status.notifyMode === 'browser' || status.notifyMode === 'both';
    els.notifyBtn.hidden =
      !browserAlertsEnabled || !('Notification' in window) || Notification.permission !== 'default';

    els.rate.textContent = status.rate ? `every ~${duration(status.rate.intervalMs)}` : '';
    els.status.textContent = status.lastRunAt ? `checked ${timeAgo(status.lastRunAt)}` : 'starting';
  } catch (err) {
    els.status.textContent = `offline — ${err.message}`;
  }
}

/**
 * Push channel. The server emits the moment a watch yields new postings, so
 * the UI updates without waiting on its own timer.
 */
function connectStream() {
  const source = new EventSource('/api/stream');
  source.addEventListener('jobs', refresh);
  source.addEventListener('cycle', refresh);
  // EventSource reconnects on its own; this is only for visibility.
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) setTimeout(connectStream, 3000);
  };
}

/* -------------------------------- wiring -------------------------------- */

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.hidden = true;

  const data = new FormData(els.form);
  const submit = els.form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Adding…';

  try {
    await api.addWatch({
      keywords: data.get('keywords'),
      location: data.get('location'),
      window: data.get('window'),
      remote: data.getAll('remote'),
    });
    els.form.reset();
    refresh();
  } catch (err) {
    els.formError.textContent = err.message;
    els.formError.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Add watch';
  }
});

els.refreshBtn.addEventListener('click', async () => {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = 'Checking…';
  try {
    await api.refresh();
    await refresh();
  } catch (err) {
    els.status.textContent = err.message;
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Check now';
  }
});

els.markAll.addEventListener('click', () => markRead(null));

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    filter = chip.dataset.filter;
    refresh();
  });
});

els.notifyBtn.addEventListener('click', async () => {
  await Notification.requestPermission();
  els.notifyBtn.hidden = Notification.permission !== 'default';
});

refresh();
connectStream();
// Fallback only — the stream is the real update path. Also keeps the relative
// timestamps ("2m ago") from going stale on an idle page.
setInterval(refresh, 60_000);
