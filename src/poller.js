import { EventEmitter } from 'node:events';
import { searchJobs, TIME_WINDOWS, RateLimitedError } from './linkedin.js';
import { RateGovernor } from './governor.js';
import * as store from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs every watch on a self-tuning loop.
 *
 * Cadence is owned by the RateGovernor rather than a fixed setInterval: the
 * loop reschedules itself after each cycle using whatever interval the
 * governor has converged on. Watches are still checked sequentially with a gap
 * — a burst of parallel requests is the fastest way to earn a 429.
 *
 * Emits:
 *   'jobs'  (freshJobs)  — as soon as a watch yields postings we've not seen
 *   'cycle' (status)     — after every completed pass
 *
 * Emitting per-watch rather than per-cycle matters: with several watches a
 * cycle can take tens of seconds, and waiting for it to finish would add that
 * delay to every alert.
 */
export class Poller extends EventEmitter {
  #governor;
  #watchGapMs;
  #timer = null;
  #running = false;
  #stopped = true;

  status = {
    startedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    lastRunFound: 0,
    lastRunRequests: 0,
    totalFound: 0,
    totalRequests: 0,
    runs: 0,
    lastError: null,
  };

  constructor({ watchGapMs = 2500, governor } = {}) {
    super();
    this.#watchGapMs = watchGapMs;
    this.#governor = governor ?? new RateGovernor();
  }

  get governor() {
    return this.#governor;
  }

  async start() {
    this.#stopped = false;
    this.status.startedAt = new Date().toISOString();

    // Pick up the interval learned before the last restart, so a long-running
    // install doesn't re-probe from scratch every time it's relaunched.
    const learned = await store.getMeta('learnedIntervalMs');
    if (learned) this.#governor.restore(learned);

    this.#loop();
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(delayMs) {
    if (this.#stopped) return;
    this.status.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.#timer = setTimeout(() => this.#loop(), delayMs);
    this.#timer.unref?.();
  }

  async #loop() {
    if (this.#stopped) return;
    try {
      await this.runOnce();
    } catch (err) {
      console.error('[poller]', err.message);
    }

    // A hard block outranks the normal cadence.
    const pauseMs = this.#governor.pausedUntil - Date.now();
    this.#schedule(pauseMs > 0 ? pauseMs : this.#governor.nextDelayMs());
  }

  /** Check every enabled watch once. Safe to call concurrently — it no-ops. */
  async runOnce() {
    if (this.#running || this.#stopped) return [];
    if (this.#governor.isPaused) {
      const mins = Math.ceil((this.#governor.pausedUntil - Date.now()) / 60_000);
      console.log(`[poller] paused after a block, ~${mins}m remaining`);
      return [];
    }

    this.#running = true;
    const allNew = [];
    let requests = 0;

    try {
      const watches = (await store.listWatches()).filter((w) => w.enabled);

      for (const [i, watch] of watches.entries()) {
        if (this.#stopped) break;
        try {
          const seconds = TIME_WINDOWS[watch.window] ?? TIME_WINDOWS['1h'];
          const { jobs, stats } = await searchJobs({
            keywords: watch.keywords,
            location: watch.location,
            seconds,
            remote: watch.remote,
            experience: watch.experience,
            limiter: this.#governor.bucket,
          });

          requests += stats.requests;
          for (let n = 0; n < stats.full; n++) this.#governor.recordSuccess();
          for (let n = 0; n < stats.truncated; n++) this.#governor.recordTruncated();

          const fresh = await store.recordJobs(watch.id, jobs);
          allNew.push(...fresh);

          await store.updateWatch(watch.id, {
            lastCheckedAt: new Date().toISOString(),
            lastError: null,
          });

          if (fresh.length) {
            console.log(
              `[poller] ${watch.keywords} @ ${watch.location || 'anywhere'} — ` +
                `${fresh.length} new (${jobs.length} in window)`,
            );
            // Announce immediately, not at end of cycle.
            this.emit('jobs', fresh);
          }
        } catch (err) {
          if (err instanceof RateLimitedError) {
            this.#governor.recordBlocked(err.retryAfterMs);
            console.warn(
              `[poller] blocked — backing off to ` +
                `${Math.round(this.#governor.intervalMs / 1000)}s cadence, ` +
                `pausing ${Math.round(err.retryAfterMs / 60_000)}m`,
            );
            await store.updateWatch(watch.id, { lastError: 'Rate limited by LinkedIn' });
            break;
          }
          console.error(`[poller] watch "${watch.keywords}" failed:`, err.message);
          await store.updateWatch(watch.id, { lastError: err.message });
        }

        if (i < watches.length - 1) await sleep(this.#watchGapMs);
      }

      const before = this.#governor.intervalMs;
      this.#governor.endCycle();
      if (this.#governor.intervalMs !== before) {
        await store.setMeta('learnedIntervalMs', this.#governor.intervalMs);
        console.log(
          `[poller] cadence ${Math.round(before / 1000)}s → ` +
            `${Math.round(this.#governor.intervalMs / 1000)}s ` +
            `(thin responses ${Math.round(this.#governor.truncationRate * 100)}%)`,
        );
      }

      this.status.lastRunAt = new Date().toISOString();
      this.status.lastRunFound = allNew.length;
      this.status.lastRunRequests = requests;
      this.status.totalFound += allNew.length;
      this.status.totalRequests += requests;
      this.status.runs++;
      this.status.lastError = null;
      this.emit('cycle', this.status);
    } catch (err) {
      this.status.lastError = err.message;
      throw err;
    } finally {
      this.#running = false;
    }

    return allNew;
  }
}
