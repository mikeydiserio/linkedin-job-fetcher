import type { FetchStats } from '@lib/types';

/**
 * Adaptive rate control for an endpoint whose limits are undocumented.
 *
 * There is no published "requests per hour" figure for LinkedIn's guest
 * endpoint, and any number hardcoded here would be a guess. So instead of
 * assuming a limit, this finds one: AIMD (additive increase, multiplicative
 * decrease) — the same idea TCP uses to find link capacity it was never told.
 *
 *   clean cycles      -> shorten the interval by a fixed step (probe faster)
 *   truncation spike  -> lengthen it slightly (early warning of soft throttle)
 *   429 / 999         -> double it and pause (hard signal, treat as expensive)
 *
 * Speeding up is cheap and reversible; getting blocked is not. Hence slow
 * additive gains and aggressive multiplicative retreats.
 */

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

type Outcome = 'ok' | 'thin' | 'block';

export interface GovernorSnapshot {
  intervalMs: number;
  minIntervalMs: number;
  truncationRate: number;
  pausedUntil: number | null;
  atFloor: boolean;
}

export interface GovernorOptions {
  minIntervalMs?: number;
  maxIntervalMs?: number;
  startIntervalMs?: number;
  stepMs?: number;
  backoffFactor?: number;
  cleanCyclesToSpeedUp?: number;
}

export class RateGovernor {
  readonly #min: number;
  readonly #max: number;
  readonly #stepMs: number;
  readonly #backoffFactor: number;
  readonly #cleanCyclesToSpeedUp: number;

  #interval: number;
  #cleanStreak = 0;
  #pausedUntil = 0;
  /** Rolling window of recent per-request outcomes. */
  #recent: Outcome[] = [];

  constructor({
    minIntervalMs = 45_000,
    maxIntervalMs = 30 * 60_000,
    startIntervalMs = 150_000,
    stepMs = 15_000,
    backoffFactor = 2,
    cleanCyclesToSpeedUp = 2,
  }: GovernorOptions = {}) {
    this.#min = minIntervalMs;
    this.#max = maxIntervalMs;
    this.#stepMs = stepMs;
    this.#backoffFactor = backoffFactor;
    this.#cleanCyclesToSpeedUp = cleanCyclesToSpeedUp;
    this.#interval = clamp(startIntervalMs, minIntervalMs, maxIntervalMs);
  }

  /** Restore a previously-learned interval so a reload doesn't re-probe. */
  restore(intervalMs: number): void {
    if (Number.isFinite(intervalMs)) {
      this.#interval = clamp(intervalMs, this.#min, this.#max);
    }
  }

  get intervalMs(): number {
    return this.#interval;
  }

  get isPaused(): boolean {
    return Date.now() < this.#pausedUntil;
  }

  /**
   * Interval with +/-15% jitter. A poller that fires on an exact period is a
   * clean machine signature; a wobbling one is both stealthier and avoids
   * synchronising with any fixed-window counter on their side.
   */
  nextDelayMs(): number {
    const base = this.isPaused ? Math.max(this.#interval, this.#pausedUntil - Date.now()) : this.#interval;
    return Math.round(base * (0.85 + Math.random() * 0.3));
  }

  #note(outcome: Outcome): void {
    this.#recent.push(outcome);
    if (this.#recent.length > 40) this.#recent.shift();
  }

  /** A hard refusal: 429 or LinkedIn's 999. */
  recordBlocked(retryAfterMs = 10 * 60_000): void {
    this.#note('block');
    this.#cleanStreak = 0;
    this.#interval = clamp(this.#interval * this.#backoffFactor, this.#min, this.#max);
    this.#pausedUntil = Date.now() + retryAfterMs;
  }

  get truncationRate(): number {
    const window = this.#recent.slice(-20);
    if (window.length < 8) return 0;
    return window.filter((o) => o === 'thin').length / window.length;
  }

  /**
   * Called once per completed cycle. Decides whether to probe faster or ease
   * off, based on what the cycle's requests looked like.
   */
  endCycle(stats: FetchStats): void {
    for (let i = 0; i < stats.truncated; i++) this.#note('thin');
    for (let i = 0; i < stats.full; i++) this.#note('ok');

    if (this.#recent.at(-1) === 'block') return;

    // Truncation is NOT a load signal: it shows up on the very first request of
    // a cold session and hovers around 50-67% regardless of how slowly we poll.
    // So it can't drive throttling — a threshold near the baseline would back
    // off forever for no reason. Backoff is driven by hard refusals (429/999);
    // this only catches a dramatic departure from that baseline.
    if (this.truncationRate > 0.9) {
      this.#cleanStreak = 0;
      this.#interval = clamp(this.#interval * 1.3, this.#min, this.#max);
      return;
    }

    this.#cleanStreak++;
    if (this.#cleanStreak >= this.#cleanCyclesToSpeedUp) {
      this.#cleanStreak = 0;
      this.#interval = clamp(this.#interval - this.#stepMs, this.#min, this.#max);
    }
  }

  snapshot(): GovernorSnapshot {
    return {
      intervalMs: this.#interval,
      minIntervalMs: this.#min,
      truncationRate: Math.round(this.truncationRate * 100) / 100,
      pausedUntil: this.#pausedUntil || null,
      atFloor: this.#interval <= this.#min,
    };
  }
}
