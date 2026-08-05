import * as cheerio from 'cheerio';

/**
 * LinkedIn exposes an unauthenticated "guest" endpoint that backs the job list
 * you see when you're logged out. It accepts the same query params as the
 * logged-in search UI — including f_TPR, the "date posted" filter expressed in
 * seconds. That's the programmatic equivalent of editing f_TPR=r86400 -> r3600
 * in the browser URL bar.
 */
const SEARCH_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

/** Named windows, in seconds, for the f_TPR filter. */
export const TIME_WINDOWS = {
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '8h': 28800,
  '24h': 86400,
};

// LinkedIn returns 429 to anything that looks like a scraper. A browser-ish
// UA plus slow pacing keeps a single-user poller under the radar.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class RateLimitedError extends Error {
  constructor(retryAfterMs) {
    super('LinkedIn rate limited the request');
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

function buildUrl({ keywords, location, seconds, start, remote, experience }) {
  // Build the query by hand: URLSearchParams encodes spaces as "+", and this
  // endpoint takes "+" literally rather than as a space, which quietly wrecks
  // multi-word searches ("front end developer" returned 1 result instead of 10).
  // encodeURIComponent gives %20, which LinkedIn parses correctly.
  const parts = [`keywords=${encodeURIComponent(keywords)}`];
  if (location) parts.push(`location=${encodeURIComponent(location)}`);
  parts.push(`f_TPR=r${seconds}`, `start=${start}`);
  // 1 = on-site, 2 = remote, 3 = hybrid. LinkedIn accepts a comma list.
  if (remote?.length) parts.push(`f_WT=${encodeURIComponent(remote.join(','))}`);
  // 1 = internship .. 6 = executive.
  if (experience?.length) parts.push(`f_E=${encodeURIComponent(experience.join(','))}`);
  return `${SEARCH_URL}?${parts.join('&')}`;
}

/** Pull the numeric posting id out of whichever attribute carries it. */
function extractJobId($card, href) {
  const urn =
    $card.attr('data-entity-urn') ||
    $card.find('[data-entity-urn]').first().attr('data-entity-urn');
  if (urn) {
    const match = urn.match(/(\d{6,})/);
    if (match) return match[1];
  }
  const fromHref = href?.match(/-(\d{6,})(?:\?|$)/);
  if (fromHref) return fromHref[1];
  const anyDigits = href?.match(/(\d{8,})/);
  return anyDigits ? anyDigits[1] : null;
}

function text($el) {
  return $el.text().replace(/\s+/g, ' ').trim() || null;
}

/**
 * The guest endpoint returns a bare fragment of <li> job cards — no wrapper
 * document. Class names drift between `base-card` and `job-search-card`
 * variants, so match on either.
 */
export function parseJobCards(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('li').each((_, li) => {
    const $li = $(li);
    const $card = $li.find('.base-card, .job-search-card').first();
    const scope = $card.length ? $card : $li;

    const $link = scope
      .find('a.base-card__full-link, a.job-search-card__link, a[href*="/jobs/view/"]')
      .first();
    const rawHref = $link.attr('href');
    if (!rawHref) return;

    const id = extractJobId(scope, rawHref);
    if (!id) return;

    const title =
      text(scope.find('.base-search-card__title, .job-search-card__title').first()) ||
      text($link.find('span').first());
    if (!title) return;

    const company = text(
      scope.find('.base-search-card__subtitle, .job-search-card__subtitle').first(),
    );
    const companyUrl =
      scope.find('.base-search-card__subtitle a, .hidden-nested-link').first().attr('href') ||
      null;
    const location = text(
      scope.find('.job-search-card__location, .base-search-card__metadata span').first(),
    );

    const $time = scope.find('time').first();
    const postedAt = $time.attr('datetime') || null;
    const postedLabel = text($time);

    const logo =
      scope.find('img.artdeco-entity-image, img').first().attr('data-delayed-url') ||
      scope.find('img.artdeco-entity-image, img').first().attr('src') ||
      null;

    const salary = text(scope.find('.job-search-card__salary-info').first());

    jobs.push({
      id,
      title,
      company,
      companyUrl: companyUrl ? companyUrl.split('?')[0] : null,
      location,
      // Strip LinkedIn's tracking query string; the canonical view URL is enough.
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      postedAt,
      postedLabel,
      salary,
      logo,
    });
  });

  return jobs;
}

async function fetchPage(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-AU,en;q=0.9',
        Referer: 'https://www.linkedin.com/jobs',
      },
    });

    if (res.status === 429 || res.status === 999) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new RateLimitedError(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 10 * 60_000,
      );
    }
    // A 400 here means "no more pages", which is how the endpoint signals the end.
    if (res.status === 400) return null;
    if (!res.ok) throw new Error(`LinkedIn responded ${res.status}`);

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A full page from the guest endpoint holds this many cards. */
const PAGE_SIZE = 10;

/**
 * The guest endpoint is unreliable under repeated use: roughly half of requests
 * come back truncated (~3 KB, a single card) instead of a full page, regardless
 * of headers or query encoding. Measured over repeated identical requests:
 * [10, 1, 1, 1, 10, 1]. It is not a hard rate limit — no 429, just a short body.
 *
 * So a thin result is treated as suspect, not authoritative: retry, and union
 * everything we saw. Genuinely-narrow searches (a quiet hour) also return few
 * results, hence the low threshold and small retry budget — we'd rather spend
 * two extra requests than silently miss a posting.
 */
async function fetchPageWithRetry(url, { attempts = 3, retryDelayMs = 2500, limiter, stats } = {}) {
  const merged = new Map();

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Block here rather than at the cycle level, so retries and extra pages are
    // charged against the same budget as first attempts.
    if (limiter) await limiter.acquire();
    stats.requests++;

    const html = await fetchPage(url);
    // 400 is how the endpoint says "no such page".
    if (html === null) return { jobs: [], ended: true };

    const jobs = parseJobCards(html);
    for (const job of jobs) if (!merged.has(job.id)) merged.set(job.id, job);

    if (jobs.length >= PAGE_SIZE) stats.full++;
    else if (jobs.length > 0 && jobs.length <= 2) stats.truncated++;

    if (process.env.DEBUG_LINKEDIN) {
      console.log(
        `[linkedin] attempt ${attempt} bytes=${html.length} parsed=${jobs.length} ` +
          `union=${merged.size} ${url}`,
      );
    }

    // A full page is as much as this offset can give — no reason to retry.
    if (jobs.length >= PAGE_SIZE) break;
    // Zero cards comes back as a ~26-byte body: that's a real end-of-results,
    // not a truncation (truncated responses still carry one card). Don't burn
    // retries on it.
    if (jobs.length === 0) break;
    // Anything above the "obviously truncated" band is plausibly the real tail.
    if (jobs.length > 2) break;
    if (attempt < attempts) await sleep(retryDelayMs);
  }

  return { jobs: [...merged.values()], ended: false };
}

/**
 * Fetch every job posted within `seconds` for a search, paging until exhausted.
 *
 * @returns {Promise<Array<object>>} de-duplicated job records, newest first.
 */
export async function searchJobs({
  keywords,
  location,
  seconds = TIME_WINDOWS['1h'],
  remote = [],
  experience = [],
  maxPages = 5,
  pageDelayMs = 1200,
  limiter = null,
} = {}) {
  if (!keywords?.trim()) throw new Error('keywords are required');

  const seen = new Set();
  const all = [];
  // Surfaced to the governor so it can tell a healthy endpoint from a
  // throttling one without re-inspecting responses.
  const stats = { requests: 0, full: 0, truncated: 0 };

  for (let page = 0; page < maxPages; page++) {
    const url = buildUrl({
      keywords: keywords.trim(),
      location: location?.trim(),
      seconds,
      start: page * PAGE_SIZE,
      remote,
      experience,
    });

    const { jobs, ended } = await fetchPageWithRetry(url, { limiter, stats });
    if (ended) break;
    if (jobs.length === 0) break;

    let added = 0;
    for (const job of jobs) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      all.push(job);
      added++;
    }

    // A short page means there's nothing after it; a page of pure duplicates
    // means we've wrapped around. Either way, stop paging.
    if (added === 0 || jobs.length < PAGE_SIZE) break;
    if (page < maxPages - 1) await sleep(pageDelayMs);
  }

  return { jobs: all, stats };
}
