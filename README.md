# Job Fetcher

A local Vite + Express app that watches LinkedIn for new job postings in a given
location and surfaces them as they appear — so you can apply within minutes of a
job going live. Built to be started once and left running all day.

It's the automated version of the URL trick: search LinkedIn Jobs, apply the
"Past 24 Hours" filter, then edit `f_TPR=r86400` to `r3600` in the address bar.
`f_TPR` is just "posted within N seconds", and this sets it for you on a loop.

## Run it

```bash
npm install
npm start          # builds the UI, then serves everything on :3400
```

Open <http://localhost:3400> and leave it running.

For frontend work with hot reload:

```bash
npm run dev        # Vite on :5173 (HMR) + API on :3400, /api proxied
```

Other scripts: `npm test` (rate-control logic), `npm run probe` (hit the scraper
directly), `npm run serve` (skip the rebuild).

## Polling rate

You asked for the fastest cadence that won't get you blocked. LinkedIn doesn't
publish a limit for this endpoint, so rather than hardcode a guess, the app
**finds** the limit the way TCP finds link capacity — AIMD:

| Signal | Response |
| --- | --- |
| Clean cycles | interval **−15s** every 2 cycles (probe faster) |
| `429` / `999` | interval **×2**, request budget halved, pause for `Retry-After` |
| Near-total truncation | interval **×1.3** |

It starts at 150s and walks down toward a 45s floor, so with a 1-hour window a
new posting surfaces within about a minute of going live. Speeding up is cheap
and reversible; getting blocked is not — hence small additive gains and
aggressive multiplicative retreats.

Three things keep it sustainable:

- **A global token bucket** (12 req/min default) caps burst independently of
  cadence. Adding watches stretches cycles rather than multiplying load.
- **±15% jitter** on every interval. A poller firing on an exact period is a
  clean machine signature.
- **Learned cadence persists** to `data/db.json`, so restarting doesn't
  re-probe from scratch.

The sidebar's **Polling** panel shows the current cadence, budget, next check,
and total requests. Observed converging live: `150s → 135s → 120s`, ~2.6 req/min
across two watches.

Tune via env vars if you want a different risk posture:

```bash
MIN_INTERVAL_SEC=90 npm start     # more conservative floor
REQUESTS_PER_MIN=6  npm start     # tighter burst ceiling
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `API_PORT` | `3400` | API + production UI port |
| `MIN_INTERVAL_SEC` | `45` | Fastest cadence it will probe down to |
| `START_INTERVAL_SEC` | `150` | Where it begins |
| `MAX_INTERVAL_SEC` | `1800` | Slowest cadence after repeated blocks |
| `REQUESTS_PER_MIN` | `12` | Hard outbound ceiling |
| `NOTIFY` | `os` | `os` / `browser` / `both` / `none` |
| `DEBUG_LINKEDIN` | unset | Log every request + response size |

**Don't set `MIN_INTERVAL_SEC` below ~30.** Past that you're adding real ban
risk for seconds of latency: with a 1-hour window, the difference between a 45s
and a 15s cadence is 30 seconds of notice against a posting that will be open
for hours.

## Notifications

Alerts are fired by the **server** as Windows toasts, so they arrive whether or
not a browser is open — the app is meant to sit in the background all day, and
browser notifications die with the tab.

A single posting shows title / company / location and opens the listing when
clicked. More than two at once are collapsed into one summary toast so a batch
doesn't bury you.

```bash
node scripts/test-notify.js     # confirm toasts actually render on this machine
```

If nothing appears, check **Settings → System → Notifications** and make sure
Focus Assist / Do Not Disturb is off — a suppressed toast fails silently.

| `NOTIFY` | Behaviour |
| --- | --- |
| `os` *(default)* | Windows toasts from the server |
| `browser` | Web notifications, tab must be open |
| `both` | Both (you will get two alerts per job) |
| `none` | Silent; the UI still updates |

The UI itself updates over **Server-Sent Events** — the server pushes the moment
a watch yields something, so there's no client-side polling delay on top of the
fetch cadence.

## How it works

- **Watches** — a saved search: keywords, location, look-back window, optional
  workplace filter (on-site / remote / hybrid).
- **Dedupe** — jobs are keyed by LinkedIn's posting id, so a job is reported
  once no matter how many polls see it.

Data lives in `data/db.json`; postings older than 14 days are pruned on write.

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

```bash
node scripts/geo-check.js       # re-run the coverage comparison yourself
```

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

## Things worth knowing

**The endpoint is genuinely flaky, and it isn't your fault.** Roughly half to
two-thirds of *identical* requests come back truncated (~3 KB, one card) instead
of a full page of ten. Measured over six identical back-to-back requests:
`[10, 1, 1, 1, 10, 1]`. It happens on the very first request of a cold session,
so it is **not** a throttling signal — which is why the governor deliberately
doesn't treat it as one. A thin page is retried up to 3× and results unioned;
repeated polling closes the rest of the gap.

This is why a new watch keeps finding "new" jobs for its first few cycles — it's
backfilling, not duplicating.

**No auth, so no full-detail fields.** Descriptions, applicant counts, and most
salary data need a logged-in session. You get title, company, location, posting
age, sometimes salary, and the link.

**Terms of service.** Automated access is against LinkedIn's ToS regardless of
rate. For one person polling their own searches this is low-risk, but it's a
knowing choice — don't deploy it as a shared or public service.

## Layout

```
src/
  linkedin.js   fetch + parse the guest endpoint (retry/union)
  governor.js   AIMD rate control + token bucket
  poller.js     self-rescheduling loop, emits 'jobs' / 'cycle'
  notify.js     OS toasts
  store.js      JSON persistence, dedupe, read state
  server.js     REST API, SSE stream, serves dist/
web/            Vite frontend (vanilla ES modules, no framework)
scripts/        probe.js, geo-check.js, test-notify.js, test-governor.js
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | poller state, governor snapshot, unread count |
| `GET` `POST` | `/api/watches` | list / create |
| `PATCH` `DELETE` | `/api/watches/:id` | pause, edit, remove |
| `GET` | `/api/jobs` | `?watchId=` `?unread=true` `?limit=` |
| `POST` | `/api/jobs/read` | `{ids:[...]}`, or `{}` for all |
| `POST` | `/api/refresh` | poll all watches now |
| `GET` | `/api/stream` | SSE: `jobs` and `cycle` events |
