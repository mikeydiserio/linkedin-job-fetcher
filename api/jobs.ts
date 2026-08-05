import * as cheerio from 'cheerio';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  TIME_WINDOWS,
  type FetchStats,
  type Job,
  type SearchResponse,
  type TimeWindow,
} from '../src/lib/types';

/**
 * LinkedIn exposes an unauthenticated "guest" endpoint that backs the job list
 * you see when logged out. It accepts the same query params as the logged-in
 * search UI — including f_TPR, the "date posted" filter expressed in seconds.
 */
const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** A full page from the guest endpoint holds this many cards. */
const PAGE_SIZE = 10;

/**
 * Serverless budget. Hobby functions are killed at 10s, and a killed function
 * returns nothing at all — worse than returning two pages. Every loop below
 * checks this before spending another request.
 */
const DEADLINE_MS = 8_000;

class RateLimitedError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super('LinkedIn rate limited the request');
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

interface SearchParams {
  keywords: string;
  location: string;
  seconds: number;
  start: number;
  remote: string[];
  experience: string[];
}

function buildUrl({ keywords, location, seconds, start, remote, experience }: SearchParams): string {
  // Build the query by hand: URLSearchParams encodes spaces as "+", and this
  // endpoint takes "+" literally rather than as a space, which quietly wrecks
  // multi-word searches ("front end developer" returned 1 result instead of 10).
  // encodeURIComponent gives %20, which LinkedIn parses correctly.
  const parts = [`keywords=${encodeURIComponent(keywords)}`];
  if (location) parts.push(`location=${encodeURIComponent(location)}`);
  parts.push(`f_TPR=r${seconds}`, `start=${start}`);
  if (remote.length) parts.push(`f_WT=${encodeURIComponent(remote.join(','))}`);
  if (experience.length) parts.push(`f_E=${encodeURIComponent(experience.join(','))}`);
  return `${SEARCH_URL}?${parts.join('&')}`;
}

/**
 * The subset of cheerio's selection API used below. Naming it structurally
 * keeps these helpers readable without threading cheerio's node generics
 * through every signature.
 */
interface Selection {
  readonly length: number;
  text(): string;
  attr(name: string): string | undefined;
  find(selector: string): Selection;
  first(): Selection;
}

/** Pull the numeric posting id out of whichever attribute carries it. */
function extractJobId($card: Selection, href: string): string | null {
  const urn =
    $card.attr('data-entity-urn') ??
    $card.find('[data-entity-urn]').first().attr('data-entity-urn');
  if (urn) {
    const match = urn.match(/(\d{6,})/);
    if (match?.[1]) return match[1];
  }
  const fromHref = href.match(/-(\d{6,})(?:\?|$)/);
  if (fromHref?.[1]) return fromHref[1];
  const anyDigits = href.match(/(\d{8,})/);
  return anyDigits?.[1] ?? null;
}

/**
 * The guest endpoint returns a bare fragment of <li> job cards — no wrapper
 * document. Class names drift between `base-card` and `job-search-card`
 * variants, so match on either.
 */
export function parseJobCards(html: string): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];

  const text = ($el: Selection): string | null => $el.text().replace(/\s+/g, ' ').trim() || null;

  $('li').each((_, li) => {
    const $li: Selection = $(li);
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
      text(scope.find('.base-search-card__title, .job-search-card__title').first()) ??
      text($link.find('span').first());
    if (!title) return;

    const companyUrl =
      scope.find('.base-search-card__subtitle a, .hidden-nested-link').first().attr('href') ?? null;
    const $img = scope.find('img.artdeco-entity-image, img').first();

    jobs.push({
      id,
      title,
      company: text(scope.find('.base-search-card__subtitle, .job-search-card__subtitle').first()),
      // Strip LinkedIn's tracking query string; the canonical URL is enough.
      companyUrl: companyUrl ? (companyUrl.split('?')[0] ?? null) : null,
      location: text(
        scope.find('.job-search-card__location, .base-search-card__metadata span').first(),
      ),
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      postedAt: scope.find('time').first().attr('datetime') ?? null,
      postedLabel: text(scope.find('time').first()),
      salary: text(scope.find('.job-search-card__salary-info').first()),
      logo: $img.attr('data-delayed-url') ?? $img.attr('src') ?? null,
    });
  });

  return jobs;
}

async function fetchPage(url: string, timeoutMs = 6_000): Promise<string | null> {
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

    // 999 is LinkedIn's own "go away" status, not a standard one.
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The guest endpoint is unreliable under repeated use: roughly half of requests
 * come back truncated (~3 KB, a single card) instead of a full page, regardless
 * of headers or query encoding. It is not a hard rate limit — no 429, just a
 * short body. So a thin result is treated as suspect, not authoritative: retry,
 * and union everything we saw.
 */
async function fetchPageWithRetry(
  url: string,
  stats: FetchStats,
  deadline: number,
): Promise<{ jobs: Job[]; ended: boolean }> {
  const merged = new Map<string, Job>();
  const attempts = 2;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (Date.now() > deadline) break;
    stats.requests++;

    const html = await fetchPage(url);
    if (html === null) return { jobs: [], ended: true };

    const jobs = parseJobCards(html);
    for (const job of jobs) if (!merged.has(job.id)) merged.set(job.id, job);

    if (jobs.length >= PAGE_SIZE) stats.full++;
    else if (jobs.length > 0 && jobs.length <= 2) stats.truncated++;

    // A full page is as much as this offset can give — no reason to retry.
    if (jobs.length >= PAGE_SIZE) break;
    // Zero cards comes back as a ~26-byte body: a real end-of-results, not a
    // truncation (truncated responses still carry one card). Don't burn retries.
    if (jobs.length === 0) break;
    // Anything above the "obviously truncated" band is plausibly the real tail.
    if (jobs.length > 2) break;
    if (attempt < attempts && Date.now() + 1_500 < deadline) await sleep(1_500);
  }

  return { jobs: [...merged.values()], ended: false };
}

const asList = (value: unknown): string[] =>
  typeof value === 'string' && value.length ? value.split(',').filter(Boolean) : [];

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const keywords = first(req.query['keywords']).trim();
  if (!keywords) {
    res.status(400).json({ status: 'error', message: 'keywords is required' } satisfies SearchResponse);
    return;
  }

  const windowKey = first(req.query['window']) as TimeWindow;
  const seconds = TIME_WINDOWS[windowKey] ?? TIME_WINDOWS['1h'];
  const deadline = Date.now() + DEADLINE_MS;
  const stats: FetchStats = { requests: 0, full: 0, truncated: 0 };
  const seen = new Set<string>();
  const all: Job[] = [];

  try {
    // Three pages is 30 postings within the look-back window — past that the
    // deadline is a bigger risk than the missed tail.
    for (let page = 0; page < 3; page++) {
      if (Date.now() > deadline) break;

      const url = buildUrl({
        keywords,
        location: first(req.query['location']).trim(),
        seconds,
        start: page * PAGE_SIZE,
        remote: asList(first(req.query['remote'])),
        experience: asList(first(req.query['experience'])),
      });

      const { jobs, ended } = await fetchPageWithRetry(url, stats, deadline);
      if (ended || jobs.length === 0) break;

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
      if (Date.now() + 600 < deadline) await sleep(600);
    }

    res.status(200).json({ status: 'ok', jobs: all, stats } satisfies SearchResponse);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      res.status(200).json({
        status: 'rate-limited',
        retryAfterMs: err.retryAfterMs,
        message: 'LinkedIn refused the request (429/999).',
      } satisfies SearchResponse);
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(200).json({ status: 'error', message } satisfies SearchResponse);
  }
}
