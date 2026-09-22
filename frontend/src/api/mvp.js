async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
  return body;
}

export function getStations(query = '') {
  return getJson(`/api/stations?q=${encodeURIComponent(query)}`);
}

export function getTrains(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) query.set(key, value.join(','));
    } else query.set(key, String(value));
  }
  return getJson(`/api/trains?${query}`);
}

export function calculateExposureBatch(requests) {
  return getJson('/api/exposure/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
}

export function calculateExposure(request) {
  return getJson('/api/exposure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export function getTrainTypes() {
  return getJson('/api/train-types');
}

export function getSeats(type) {
  return getJson(`/api/train-types/${encodeURIComponent(type)}/seats`);
}

export function getSeatLayout(type) {
  return getSeats(type);
}
