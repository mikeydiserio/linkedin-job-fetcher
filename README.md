# Job Fetcher

Watch LinkedIn job postings for new listings in a given location and surface
them the moment they drop.

A React + TypeScript single-page app. Watches and seen postings live in
`localStorage` — there is no database and no account. The only server-side piece
is one stateless function that proxies LinkedIn, because LinkedIn sends no CORS
headers and the browser therefore cannot call it directly.

## Run it

```bash
npm install
npm run dev          # Vite on :5173
```

`npm run dev` serves the UI only. The `/api/jobs` proxy needs the Vercel runtime:

```bash
npx vercel dev       # UI + function together on :3000
```

Vite proxies `/api` to `:3000`, so both modes call the same same-origin paths.

## How it works

The browser is the poller. There is no cron, no queue, and no background worker:

1. A timer in `useJobFeed` wakes on an adaptive interval.
2. For each enabled watch it calls `/api/jobs`, which fetches and parses
   LinkedIn's guest endpoint server-side and returns structured postings.
3. Anything whose id isn't already in `localStorage` is new — it's prepended to
   the list and raises one browser notification per batch.

Polling only happens while a tab is open. Close the tab and nothing runs; that
is the trade for having no backend to pay for or maintain.

## Polling rate

There is no published rate limit for LinkedIn's guest endpoint, and any number
hardcoded here would be a guess. So `RateGovernor` finds one instead, using AIMD
— the same idea TCP uses to find link capacity it was never told:

| Signal | Response |
| --- | --- |
| Clean cycles | Shorten the interval by 15s (probe faster) |
| Truncation spike (>90%) | Lengthen by 1.3x |
| 429 / 999 | Double the interval and pause |

It starts at 150s and probes down toward a 45s floor, with ±15% jitter so the
cadence isn't a clean machine signature. The learned interval persists across
reloads, so a refresh doesn't restart the probe from scratch.

## Look-back windows

Set per watch, mapping straight onto `f_TPR`:

| Window | `f_TPR` |
| --- | --- |
| Past hour | `r3600` |
| Past 2 hours | `r7200` |
| Past 4 hours | `r14400` |
| Past 8 hours | `r28800` |
| Past 24 hours | `r86400` |

**Keep the window much wider than the cadence.** At a 45s cadence a 1-hour
window gives each posting ~80 chances to be seen, so no single failed fetch can
lose one. A window narrower than the cadence drops postings outright.

## Locations and suburbs

Searching `Melbourne, Victoria, Australia` **does** return suburb postings —
verified, not assumed. A 40-result sample came back tagged Camberwell, Richmond,
Clayton, Forest Hill, Dandenong (~30 km SE), Broadmeadows (~16 km N) and Melton
(~35 km W). The geo resolves to Greater Melbourne, not the CBD.

Searching `Cremorne, Victoria, Australia` directly returned 40 jobs of which
**32 were the same postings** as the Melbourne search, with the same suburb
spread — LinkedIn snaps suburb input up to the metro area. So there's no
accuracy gained by naming a suburb, and no coverage lost by not naming one.

**Don't filter results down to suburb names.** 31 of those 40 were tagged plain
`Melbourne, Victoria, Australia`, including roles at companies physically in
Cremorne (SEEK, REA, Carsales all list as "Melbourne"). Filtering on the
location string would hide exactly the jobs you want.

## Things worth knowing

**The endpoint is genuinely flaky, and it isn't your fault.** Roughly half of
requests return a truncated body (~3 KB, one card) instead of a full page,
regardless of headers or query encoding. It is not a rate limit — no 429, just a
short body. A thin result is therefore treated as suspect rather than
authoritative: retry once, and union everything seen.

**Datacenter IPs are the real risk.** The pacing above is tuned for a single
user on a residential connection. Serverless functions run from shared cloud
ranges that LinkedIn sees far more traffic from, so a `rate-limited` status in
the UI is the expected failure mode there, not a bug. The governor backs off and
retries rather than hammering.

**Notifications need a granted permission and an open tab.** The browser
Notification API replaced the desktop notifier the Node version used. Declining
the prompt degrades to silence, not an error.

**`window` must stay wider than the poll interval.** See above — this is the one
setting that can silently lose postings.

## Layout

```
api/jobs.ts            LinkedIn proxy — fetch, parse, page, return JSON
src/
  App.tsx              Shell and layout
  components/          One folder per component: .tsx + .module.css
  hooks/
    useJobFeed.ts      The polling loop, merge, and new-job detection
    useWatches.ts      Watch CRUD over localStorage
    useNotifications.ts
    useLocalStorage.ts
  lib/
    governor.ts        AIMD rate control
    api.ts             Typed client for /api/jobs
    types.ts           Shared with the function — the one cross-boundary import
```

## API

`GET /api/jobs`

| Param | Notes |
| --- | --- |
| `keywords` | Required |
| `location` | Free text; resolves to a metro area |
| `window` | One of `1h` `2h` `4h` `8h` `24h` (default `1h`) |
| `remote` | Comma list: `1` on-site, `2` remote, `3` hybrid |
| `experience` | Comma list: `1` internship … `6` executive |

Always responds `200` with a discriminated union, so the client has to handle
throttling explicitly rather than treating it as a generic failure:

```ts
| { status: 'ok'; jobs: Job[]; stats: FetchStats }
| { status: 'rate-limited'; retryAfterMs: number; message: string }
| { status: 'error'; message: string }
```

The function budgets 8s against Hobby's 10s ceiling and returns what it has when
that runs out — a killed function returns nothing, which is worse than two pages.
