/**
 * Does searching "Melbourne" actually return suburb-level postings
 * (Cremorne, Richmond, Southbank...), or only ones literally tagged Melbourne?
 *
 *   node scripts/geo-check.js
 */
import { searchJobs, TIME_WINDOWS } from '../src/linkedin.js';

const tally = async (label, opts) => {
  const { jobs } = await searchJobs({ seconds: TIME_WINDOWS['24h'], maxPages: 5, ...opts });
  const byLoc = new Map();
  for (const j of jobs) byLoc.set(j.location, (byLoc.get(j.location) ?? 0) + 1);

  console.log(`\n${label} — ${jobs.length} jobs, ${byLoc.size} distinct locations`);
  [...byLoc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .forEach(([loc, n]) => console.log(`   ${String(n).padStart(3)}  ${loc}`));
  return jobs;
};

// Broad keyword so the sample is large enough for suburbs to show up.
const melbourne = await tally('Melbourne, Victoria, Australia', {
  keywords: 'engineer',
  location: 'Melbourne, Victoria, Australia',
});

const cremorne = await tally('Cremorne, Victoria, Australia', {
  keywords: 'engineer',
  location: 'Cremorne, Victoria, Australia',
});

// The real question: is a Cremorne-tagged posting reachable from a
// Melbourne-level search?
const melbIds = new Set(melbourne.map((j) => j.id));
const overlap = cremorne.filter((j) => melbIds.has(j.id));
console.log(
  `\nCremorne search returned ${cremorne.length}; ` +
    `${overlap.length} of those also appeared in the Melbourne search.`,
);

const suburbTagged = melbourne.filter((j) => j.location && !/^Melbourne,/.test(j.location));
console.log(
  `Melbourne search: ${suburbTagged.length}/${melbourne.length} results carry a ` +
    `non-"Melbourne," location string.`,
);
