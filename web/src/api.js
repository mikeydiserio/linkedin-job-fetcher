async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  status: () => request('/api/status'),
  watches: () => request('/api/watches'),
  jobs: () => request('/api/jobs'),

  addWatch: (body) => request('/api/watches', { method: 'POST', body: JSON.stringify(body) }),
  patchWatch: (id, body) =>
    request(`/api/watches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWatch: (id) => request(`/api/watches/${id}`, { method: 'DELETE' }),

  /** Pass null to mark everything read. */
  markRead: (ids) => request('/api/jobs/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  refresh: () => request('/api/refresh', { method: 'POST' }),
};
