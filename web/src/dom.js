/**
 * Everything rendered here originates from LinkedIn, so nodes are built
 * explicitly and text is assigned via textContent. No innerHTML anywhere.
 */
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function inFuture(iso) {
  if (!iso) return '';
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  if (secs <= 0) return 'now';
  if (secs < 60) return `${Math.ceil(secs)}s`;
  return `${Math.round(secs / 60)}m`;
}

export const duration = (ms) =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`;
