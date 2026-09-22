async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export function getSummary() {
  return getJson('/api/poc/summary');
}

export function getTimeline(resolution = '1m') {
  return getJson(`/api/poc/timeline?resolution=${encodeURIComponent(resolution)}`);
}

export function getRoute() {
  return getJson('/api/poc/route');
}

