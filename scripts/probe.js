/**
 * Live sanity check against LinkedIn's guest endpoint.
 *   node scripts/probe.js "front end developer" "Melbourne, Victoria, Australia" 24h
 */
import { searchJobs, TIME_WINDOWS } from '../src/linkedin.js';

const [, , keywords = 'front end developer', location = 'Melbourne, Victoria, Australia', win = '24h'] =
  process.argv;

const seconds = TIME_WINDOWS[win] ?? TIME_WINDOWS['24h'];
console.log(`Searching "${keywords}" in "${location}" (f_TPR=r${seconds})\n`);

try {
  const { jobs, stats } = await searchJobs({ keywords, location, seconds, maxPages: 2 });
  console.log(
    `Parsed ${jobs.length} jobs in ${stats.requests} request(s) ` +
      `(${stats.full} full, ${stats.truncated} truncated).\n`,
  );
  for (const job of jobs.slice(0, 8)) {
    console.log(`  ${job.title}`);
    console.log(`    ${job.company ?? '—'} · ${job.location ?? '—'} · ${job.postedLabel ?? '—'}`);
    console.log(`    ${job.url}\n`);
  }
  const missing = ['title', 'company', 'location', 'url'].filter(
    (f) => jobs.length && !jobs.every((j) => j[f]),
  );
  if (missing.length) console.warn(`Warning: some records missing → ${missing.join(', ')}`);
  // Set exitCode rather than calling process.exit — an abrupt exit while the
  // fetch keep-alive socket is closing trips a libuv assertion on Windows.
  process.exitCode = jobs.length ? 0 : 2;
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
}
