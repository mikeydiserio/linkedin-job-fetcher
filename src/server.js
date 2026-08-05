import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as store from './store.js';
import { Poller } from './poller.js';
import { RateGovernor } from './governor.js';
import { notifyNewJobs, notifyMode } from './notify.js';
import { TIME_WINDOWS } from './linkedin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

const PORT = Number(process.env.API_PORT) || Number(process.env.PORT) || 3400;

const num = (name, fallback) => Number(process.env[name]) || fallback;

const app = express();
app.use(express.json());
// Present only after `vite build`; in dev the Vite server hosts the UI and
// proxies /api here, so its absence is expected.
app.use(express.static(DIST));

const poller = new Poller({
  governor: new RateGovernor({
    minIntervalMs: num('MIN_INTERVAL_SEC', 45) * 1000,
    startIntervalMs: num('START_INTERVAL_SEC', 150) * 1000,
    maxIntervalMs: num('MAX_INTERVAL_SEC', 1800) * 1000,
    requestsPerMin: num('REQUESTS_PER_MIN', 12),
  }),
});

/* ----------------------------- live updates ------------------------------ */

/** Open SSE connections. */
const clients = new Set();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, a reverse proxy may buffer the stream and defeat the point.
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Proxies and browsers drop an idle event stream; a comment frame keeps it warm.
const heartbeat = setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 25_000);
heartbeat.unref?.();

poller.on('jobs', (fresh) => {
  broadcast('jobs', { count: fresh.length });
  notifyNewJobs(fresh, { uiUrl: `http://localhost:${PORT}/` });
});

poller.on('cycle', (status) => broadcast('cycle', { runs: status.runs }));

/** Wrap an async handler so a rejection becomes a 500 instead of a hang. */
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[api] ${req.method} ${req.path}:`, err.message);
    res.status(500).json({ error: err.message });
  });

/* --------------------------------- API ---------------------------------- */

app.get(
  '/api/status',
  route(async (_req, res) => {
    const watches = await store.listWatches();
    const unread = await store.listJobs({ unreadOnly: true, limit: 10_000 });
    res.json({
      ...poller.status,
      rate: poller.governor.snapshot(),
      watchCount: watches.length,
      unreadCount: unread.length,
      windows: Object.keys(TIME_WINDOWS),
      notifyMode,
    });
  }),
);

app.get(
  '/api/watches',
  route(async (_req, res) => res.json(await store.listWatches())),
);

app.post(
  '/api/watches',
  route(async (req, res) => {
    const { keywords, location, window, remote, experience } = req.body ?? {};
    if (!keywords?.trim()) {
      return res.status(400).json({ error: 'keywords is required' });
    }
    if (window && !(window in TIME_WINDOWS)) {
      return res.status(400).json({
        error: `window must be one of: ${Object.keys(TIME_WINDOWS).join(', ')}`,
      });
    }
    const watch = await store.addWatch({
      keywords,
      location,
      window,
      remote: Array.isArray(remote) ? remote : [],
      experience: Array.isArray(experience) ? experience : [],
    });
    // Populate the new watch right away rather than waiting for the next tick.
    poller.runOnce().catch((err) => console.error('[poller]', err));
    res.status(201).json(watch);
  }),
);

app.patch(
  '/api/watches/:id',
  route(async (req, res) => {
    const allowed = ['enabled', 'window', 'keywords', 'location', 'remote', 'experience'];
    const patch = Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)),
    );
    const watch = await store.updateWatch(req.params.id, patch);
    if (!watch) return res.status(404).json({ error: 'watch not found' });
    res.json(watch);
  }),
);

app.delete(
  '/api/watches/:id',
  route(async (req, res) => {
    const ok = await store.removeWatch(req.params.id);
    if (!ok) return res.status(404).json({ error: 'watch not found' });
    res.status(204).end();
  }),
);

app.get(
  '/api/jobs',
  route(async (req, res) => {
    const jobs = await store.listJobs({
      watchId: req.query.watchId || null,
      unreadOnly: req.query.unread === 'true',
      limit: Math.min(Number(req.query.limit) || 300, 1000),
    });
    res.json(jobs);
  }),
);

app.post(
  '/api/jobs/read',
  route(async (req, res) => {
    const ids = req.body?.ids;
    const changed = Array.isArray(ids) ? await store.markRead(ids) : await store.markAllRead();
    res.json({ changed });
  }),
);

/** Manual "check now" button. */
app.post(
  '/api/refresh',
  route(async (_req, res) => {
    const fresh = await poller.runOnce();
    res.json({ found: fresh.length, jobs: fresh });
  }),
);

/* ------------------------------- lifecycle ------------------------------ */

const server = app.listen(PORT, async () => {
  console.log(`\n  Job Fetcher API → http://localhost:${PORT}`);
  await poller.start();
  const { intervalMs, minIntervalMs, requestsPerMin } = poller.governor.snapshot();
  console.log(
    `  Adaptive polling: starting at ${Math.round(intervalMs / 1000)}s, ` +
      `probing down toward ${Math.round(minIntervalMs / 1000)}s, ` +
      `ceiling ${requestsPerMin} req/min`,
  );
  console.log(`  Notifications: ${notifyMode}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nShutting down…');
    poller.stop();
    server.close(() => process.exit(0));
  });
}
