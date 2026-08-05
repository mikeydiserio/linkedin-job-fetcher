/**
 * Fires a sample toast so you can confirm OS notifications work on this
 * machine (Windows Focus Assist / notification settings can silently eat them).
 *
 *   node scripts/test-notify.js
 */
import { notifyNewJobs, notifyMode } from '../src/notify.js';

console.log(`NOTIFY mode: ${notifyMode}`);
if (notifyMode === 'browser' || notifyMode === 'none') {
  console.log('OS toasts are disabled in this mode. Run with NOTIFY=os to test.');
  process.exitCode = 0;
} else {
  console.log('Firing a test toast — check the bottom-right of your screen…');
  notifyNewJobs([
    {
      id: 'test',
      title: 'Senior Frontend Engineer',
      company: 'Test Co',
      location: 'Cremorne, Victoria, Australia',
      url: 'https://www.linkedin.com/jobs/',
    },
  ]);
  // node-notifier's callback needs the process alive to deliver a click.
  setTimeout(() => console.log('Done.'), 6000);
}
