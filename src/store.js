import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.json');

// Jobs older than this are dropped on write so the file can't grow forever.
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const EMPTY = { watches: [], jobs: [], meta: {}, version: 1 };

let state = null;
let writeQueue = Promise.resolve();

export async function load() {
  if (state) return state;
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    state = { ...EMPTY, ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[store] could not read ${DB_PATH}, starting fresh:`, err.message);
    }
    state = structuredClone(EMPTY);
  }
  return state;
}

/**
 * Serialise writes through a promise chain and write via a temp file + rename
 * so a crash mid-write can't truncate the database.
 */
function persist() {
  writeQueue = writeQueue.then(async () => {
    const cutoff = Date.now() - RETENTION_MS;
    state.jobs = state.jobs.filter((j) => new Date(j.firstSeenAt).getTime() >= cutoff);

    await mkdir(dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, DB_PATH);
  });
  return writeQueue.catch((err) => console.error('[store] write failed:', err.message));
}

/* --------------------------------- meta --------------------------------- */

/** Small key/value scratch space — currently the governor's learned cadence. */
export async function getMeta(key) {
  const s = await load();
  return s.meta?.[key];
}

export async function setMeta(key, value) {
  const s = await load();
  s.meta ??= {};
  s.meta[key] = value;
  await persist();
  return value;
}

/* ------------------------------- watches -------------------------------- */

export async function listWatches() {
  const s = await load();
  return s.watches;
}

export async function addWatch({
  keywords,
  location,
  window = '1h',
  remote = [],
  experience = [],
}) {
  const s = await load();
  const watch = {
    id: randomUUID(),
    keywords: keywords.trim(),
    location: location?.trim() || '',
    window,
    remote,
    experience,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastError: null,
  };
  s.watches.push(watch);
  await persist();
  return watch;
}

export async function updateWatch(id, patch) {
  const s = await load();
  const watch = s.watches.find((w) => w.id === id);
  if (!watch) return null;
  Object.assign(watch, patch);
  await persist();
  return watch;
}

export async function removeWatch(id) {
  const s = await load();
  const before = s.watches.length;
  s.watches = s.watches.filter((w) => w.id !== id);
  if (s.watches.length === before) return false;
  // Orphaned jobs would otherwise linger in the feed with no parent watch.
  s.jobs = s.jobs.filter((j) => j.watchId !== id);
  await persist();
  return true;
}

/* --------------------------------- jobs --------------------------------- */

/**
 * Insert jobs we haven't seen before for this watch.
 * @returns {Promise<Array<object>>} only the genuinely new records.
 */
export async function recordJobs(watchId, jobs) {
  const s = await load();
  const known = new Set(s.jobs.filter((j) => j.watchId === watchId).map((j) => j.id));

  const fresh = jobs
    .filter((job) => !known.has(job.id))
    .map((job) => ({
      ...job,
      watchId,
      firstSeenAt: new Date().toISOString(),
      read: false,
    }));

  if (fresh.length) {
    s.jobs.push(...fresh);
    await persist();
  }
  return fresh;
}

export async function listJobs({ watchId = null, unreadOnly = false, limit = 300 } = {}) {
  const s = await load();
  const byWatch = new Map(s.watches.map((w) => [w.id, w]));

  return s.jobs
    .filter((j) => (watchId ? j.watchId === watchId : true))
    .filter((j) => (unreadOnly ? !j.read : true))
    .map((j) => ({
      ...j,
      watchLabel: byWatch.get(j.watchId)?.keywords ?? 'removed watch',
    }))
    .sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt))
    .slice(0, limit);
}

export async function markRead(ids) {
  const s = await load();
  const set = new Set(ids);
  let changed = 0;
  for (const job of s.jobs) {
    if (set.has(job.id) && !job.read) {
      job.read = true;
      changed++;
    }
  }
  if (changed) await persist();
  return changed;
}

export async function markAllRead() {
  const s = await load();
  let changed = 0;
  for (const job of s.jobs) {
    if (!job.read) {
      job.read = true;
      changed++;
    }
  }
  if (changed) await persist();
  return changed;
}
