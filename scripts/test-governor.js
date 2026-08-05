/**
 * Deterministic checks on the rate-control logic — no network.
 *   node scripts/test-governor.js
 */
import assert from 'node:assert/strict';
import { RateGovernor, TokenBucket } from '../src/governor.js';

let failures = 0;
// Must await fn(): an async test's rejection escapes a synchronous try/catch,
// which would report a green "ok" for a test that never actually asserted.
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const secs = (ms) => Math.round(ms / 1000);

console.log('\nRateGovernor');

await test('probes downward to the floor on clean cycles, then stops', () => {
  const g = new RateGovernor({ startIntervalMs: 150_000, minIntervalMs: 45_000, stepMs: 15_000 });
  for (let i = 0; i < 200; i++) {
    g.recordSuccess();
    g.endCycle();
  }
  assert.equal(secs(g.intervalMs), 45, `expected floor 45s, got ${secs(g.intervalMs)}s`);
  assert.equal(g.snapshot().atFloor, true);
});

await test('never dips below the floor', () => {
  const g = new RateGovernor({ startIntervalMs: 46_000, minIntervalMs: 45_000, stepMs: 30_000 });
  for (let i = 0; i < 50; i++) {
    g.recordSuccess();
    g.endCycle();
  }
  assert.ok(g.intervalMs >= 45_000, `dipped to ${g.intervalMs}`);
});

await test('a block doubles the interval and pauses', () => {
  const g = new RateGovernor({ startIntervalMs: 60_000 });
  g.recordBlocked(5 * 60_000);
  assert.equal(secs(g.intervalMs), 120);
  assert.equal(g.isPaused, true);
  assert.ok(g.pausedUntil > Date.now());
});

await test('a block also halves the request budget', () => {
  const g = new RateGovernor({ requestsPerMin: 12 });
  g.recordBlocked();
  assert.equal(g.bucket.ratePerMin, 6);
});

await test('repeated blocks back off multiplicatively, capped at max', () => {
  const g = new RateGovernor({ startIntervalMs: 60_000, maxIntervalMs: 600_000 });
  for (let i = 0; i < 10; i++) g.recordBlocked(1000);
  assert.equal(secs(g.intervalMs), 600, `expected cap 600s, got ${secs(g.intervalMs)}s`);
});

await test('baseline truncation (~67%) does NOT trigger backoff', () => {
  // This is the measured healthy-endpoint rate; treating it as congestion
  // would park the poller at its slowest cadence forever.
  const g = new RateGovernor({ startIntervalMs: 150_000, stepMs: 15_000 });
  for (let cycle = 0; cycle < 6; cycle++) {
    g.recordTruncated();
    g.recordTruncated();
    g.recordSuccess();
    g.endCycle();
  }
  assert.ok(g.truncationRate > 0.6, `expected a high baseline, got ${g.truncationRate}`);
  assert.ok(g.intervalMs < 150_000, 'should still have sped up despite thin responses');
});

await test('near-total truncation does trigger a mild slow-down', () => {
  const g = new RateGovernor({ startIntervalMs: 100_000 });
  for (let i = 0; i < 20; i++) g.recordTruncated();
  g.endCycle();
  assert.ok(g.intervalMs > 100_000, `expected slow-down, got ${secs(g.intervalMs)}s`);
});

await test('jitter stays within +/-15% of the interval', () => {
  const g = new RateGovernor({ startIntervalMs: 100_000 });
  for (let i = 0; i < 500; i++) {
    const d = g.nextDelayMs();
    assert.ok(d >= 85_000 && d <= 115_000, `jitter out of band: ${d}`);
  }
});

await test('restore() clamps a persisted interval into range', () => {
  const g = new RateGovernor({ minIntervalMs: 45_000, maxIntervalMs: 600_000 });
  g.restore(5_000);
  assert.equal(secs(g.intervalMs), 45);
  g.restore(9_999_999);
  assert.equal(secs(g.intervalMs), 600);
});

console.log('\nTokenBucket');

await test('allows a burst then throttles', async () => {
  const b = new TokenBucket({ ratePerMin: 60, burst: 3 });
  const start = Date.now();
  await b.acquire();
  await b.acquire();
  await b.acquire();
  assert.ok(Date.now() - start < 50, 'burst should be immediate');
});

await test('4th request waits for a refill', async () => {
  const b = new TokenBucket({ ratePerMin: 60, burst: 2 });
  await b.acquire();
  await b.acquire();
  const start = Date.now();
  await b.acquire();
  const waited = Date.now() - start;
  // 60/min = one token per second.
  assert.ok(waited > 700, `expected a ~1s wait, waited ${waited}ms`);
});


console.log(failures ? `\n${failures} failing\n` : '\nAll passing\n');
process.exitCode = failures ? 1 : 0;
