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

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Hard ceiling on outbound requests, independent of the interval logic.
 * The interval controls how often a *cycle* runs; this controls the burst
 * within one, so adding watches stretches cycles instead of multiplying load.
 */
export class TokenBucket {
  #capacity;
  #tokens;
  #refillPerMs;
  #last;

  constructor({ ratePerMin = 12, burst = 4 } = {}) {
    this.#capacity = burst;
    this.#tokens = burst;
    this.#refillPerMs = ratePerMin / 60_000;
    this.#last = Date.now();
  }

  get ratePerMin() {
    return this.#refillPerMs * 60_000;
  }

  setRatePerMin(rate) {
    this.#refill();
    this.#refillPerMs = rate / 60_000;
  }

  #refill() {
    const now = Date.now();
    this.#tokens = Math.min(this.#capacity, this.#tokens + (now - this.#last) * this.#refillPerMs);
    this.#last = now;
  }

  /** Resolves once a request may be sent. */
  async acquire() {
    for (;;) {
      this.#refill();
      if (this.#tokens >= 1) {
        this.#tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.#tokens) / this.#refillPerMs);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5000)));
    }
  }
}

export class RateGovernor {
  #min;
  #max;
  #interval;
  #stepMs;
  #backoffFactor;
  #cleanStreak;
  #pausedUntil = 0;
  /** Rolling window of recent per-request outcomes. */
  #recent = [];

  bucket;

  constructor({
    minIntervalMs = 45_000,
    maxIntervalMs = 30 * 60_000,
    startIntervalMs = 150_000,
    stepMs = 15_000,
    backoffFactor = 2,
    cleanCyclesToSpeedUp = 2,
    requestsPerMin = 12,
  } = {}) {
    this.#min = minIntervalMs;
    this.#max = maxIntervalMs;
    this.#interval = clamp(startIntervalMs, minIntervalMs, maxIntervalMs);
    this.#stepMs = stepMs;
    this.#backoffFactor = backoffFactor;
    this.cleanCyclesToSpeedUp = cleanCyclesToSpeedUp;
    this.#cleanStreak = 0;
    this.bucket = new TokenBucket({ ratePerMin: requestsPerMin });
  }

  /** Restore a previously-learned interval so a restart doesn't re-probe. */
  restore(intervalMs) {
    if (Number.isFinite(intervalMs)) {
      this.#interval = clamp(intervalMs, this.#min, this.#max);
    }
  }

  get intervalMs() {
    return this.#interval;
  }

  get pausedUntil() {
    return this.#pausedUntil;
  }

  get isPaused() {
    return Date.now() < this.#pausedUntil;
  }

  /**
   * Interval with +/-15% jitter. A poller that fires on an exact period is a
   * clean machine signature; a wobbling one is both stealthier and avoids
   * synchronising with any fixed-window counter on their side.
   */
  nextDelayMs() {
    const jitter = 0.85 + Math.random() * 0.3;
    return Math.round(this.#interval * jitter);
  }

  #note(outcome) {
    this.#recent.push(outcome);
    if (this.#recent.length > 40) this.#recent.shift();
  }

  /** A full, healthy page. */
  recordSuccess() {
    this.#note('ok');
  }

  /** A short body — the soft-throttle tell documented in linkedin.js. */
  recordTruncated() {
    this.#note('thin');
  }

  /** A hard refusal: 429 or LinkedIn's 999. */
  recordBlocked(retryAfterMs = 10 * 60_000) {
    this.#note('block');
    this.#cleanStreak = 0;
    this.#interval = clamp(this.#interval * this.#backoffFactor, this.#min, this.#max);
    this.#pausedUntil = Date.now() + retryAfterMs;
    // Halve throughput too — the interval alone doesn't bound a burst.
    this.bucket.setRatePerMin(Math.max(2, this.bucket.ratePerMin / 2));
  }

  get truncationRate() {
    const window = this.#recent.slice(-20);
    if (window.length < 8) return 0;
    return window.filter((o) => o === 'thin').length / window.length;
  }

  /**
   * Called once per completed cycle. Decides whether to probe faster or ease
   * off, based on what the cycle's requests looked like.
   */
  endCycle() {
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
    if (this.#cleanStreak >= this.cleanCyclesToSpeedUp) {
      this.#cleanStreak = 0;
      this.#interval = clamp(this.#interval - this.#stepMs, this.#min, this.#max);
    }
  }

  snapshot() {
    return {
      intervalMs: this.#interval,
      minIntervalMs: this.#min,
      maxIntervalMs: this.#max,
      requestsPerMin: Math.round(this.bucket.ratePerMin * 10) / 10,
      truncationRate: Math.round(this.truncationRate * 100) / 100,
      pausedUntil: this.#pausedUntil || null,
      atFloor: this.#interval <= this.#min,
    };
  }
}
