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

