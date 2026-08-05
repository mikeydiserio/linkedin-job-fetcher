import type { SearchResponse, Watch } from '@lib/types';

/**
 * Ask the serverless proxy for a watch's current results.
 *
 * The proxy exists because LinkedIn sends no CORS headers — the browser cannot
 * call the guest endpoint directly. Errors come back as a discriminated union
 * rather than a throw, so the caller has to handle rate limiting explicitly.
 */
export async function searchJobs(watch: Watch, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({
    keywords: watch.keywords,
    window: watch.window,
  });
  if (watch.location) params.set('location', watch.location);
  if (watch.remote.length) params.set('remote', watch.remote.join(','));
  if (watch.experience.length) params.set('experience', watch.experience.join(','));

  try {
    const res = await fetch(`/api/jobs?${params}`, { signal });
    if (!res.ok) {
      return { status: 'error', message: `Proxy responded ${res.status}` };
    }
    return (await res.json()) as SearchResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'error', message: 'Request cancelled' };
    }
    return { status: 'error', message: err instanceof Error ? err.message : 'Network error' };
  }
}
