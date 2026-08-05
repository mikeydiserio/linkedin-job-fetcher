import { exec } from 'node:child_process';
import notifier from 'node-notifier';

/**
 * OS-level toasts, so alerts arrive whether or not the app is open in a
 * browser. Browser notifications only fire while a tab is alive — no good for
 * something meant to run in the background all day.
 *
 * NOTIFY=os (default) | browser | both | none
 */
const MODE = (process.env.NOTIFY || 'os').toLowerCase();

export const notifyMode = ['os', 'browser', 'both', 'none'].includes(MODE) ? MODE : 'os';
const osEnabled = notifyMode === 'os' || notifyMode === 'both';

/** Open a URL in the default browser, per platform. */
function openUrl(url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error('[notify] could not open browser:', err.message);
  });
}

/**
 * Fire a toast for newly-found postings.
 *
 * One toast per job gets unusable fast when a batch lands, so anything past a
 * couple is summarised into a single notification instead.
 */
export function notifyNewJobs(jobs, { uiUrl } = {}) {
  if (!osEnabled || !jobs.length) return;

  try {
    if (jobs.length <= 2) {
      for (const job of jobs) {
        notifier.notify(
          {
            title: job.title,
            message: [job.company, job.location].filter(Boolean).join(' — ') || 'New posting',
            wait: true,
            timeout: 20,
            sound: true,
          },
          (err, response) => {
            // SnoreToast reports a click as "activate"; ignore timeouts.
            if (!err && typeof response === 'string' && response.includes('activate')) {
              openUrl(job.url);
            }
          },
        );
      }
      return;
    }

    notifier.notify(
      {
        title: `${jobs.length} new job postings`,
        message: jobs
          .slice(0, 3)
          .map((j) => `• ${j.title}`)
          .join('\n'),
        wait: true,
        timeout: 20,
        sound: true,
      },
      (err, response) => {
        if (!err && typeof response === 'string' && response.includes('activate') && uiUrl) {
          openUrl(uiUrl);
        }
      },
    );
  } catch (err) {
    // A failed toast must never take the poller down with it.
    console.error('[notify] failed:', err.message);
  }
}
