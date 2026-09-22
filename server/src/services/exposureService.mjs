export class ExposureService {
  constructor({ metadata, cache, fetchImpl = fetch, env = process.env } = {}) {
    this.metadata = metadata;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.env = env;
  }

  async calculate(request) {
    const routeVersion = await this.metadata.routeVersion();
    const calculationVersion = this.env.SUNSEAT_CALCULATION_VERSION ?? '2026-09-22-noaa-v1';
    const cacheInput = { ...request, routeVersion, calculationVersion };
    const key = this.cache.key(cacheInput);
    const cached = await this.cache.get(key);
    if (cached) return { ...cached, cache: 'HIT' };
    const calcUrl = this.env.SUNSEAT_CALC_URL ?? 'http://127.0.0.1:8100';
    const response = await this.fetchImpl(`${calcUrl.replace(/\/$/, '')}/calculate/exposure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...request, calculationVersion }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Calculation service failed with HTTP ${response.status}: ${detail.slice(0, 400)}`);
      error.code = 'CALCULATION_UPSTREAM_ERROR';
      throw error;
    }
    const result = await response.json();
    const payload = {
      ...result,
      metadata: {
        scheduleSource: request.scheduleSource ?? 'REQUEST',
        railwaySource: 'OpenStreetMap Overpass',
        seatSource: 'KORAIL_OFFICIAL_STRUCTURAL_ONLY',
        routeVersion,
        calculationVersion,
      },
    };
    await this.cache.put(key, payload);
    return { ...payload, cache: 'MISS' };
  }

  async batch(requests) {
    const routeVersion = await this.metadata.routeVersion();
    const calculationVersion = this.env.SUNSEAT_CALCULATION_VERSION ?? '2026-09-22-noaa-v1';
    const results = new Array(requests.length);
    const misses = [];
    for (const [index, request] of requests.entries()) {
      const cacheInput = { ...request, routeVersion, calculationVersion };
      const key = this.cache.key(cacheInput);
      const cached = await this.cache.get(key);
      if (cached) results[index] = { ...cached, cache: 'HIT' };
      else misses.push({ index, request, key });
    }
    if (misses.length) {
      const calcUrl = this.env.SUNSEAT_CALC_URL ?? 'http://127.0.0.1:8100';
      const response = await this.fetchImpl(`${calcUrl.replace(/\/$/, '')}/calculate/exposure/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ requests: misses.map(({ request }) => ({ ...request, calculationVersion })) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`Calculation batch service failed with HTTP ${response.status}: ${detail.slice(0, 400)}`);
        error.code = 'CALCULATION_UPSTREAM_ERROR';
        throw error;
      }
      const body = await response.json();
      if (!Array.isArray(body.results) || body.results.length !== misses.length) {
        const error = new Error('Calculation batch service returned an invalid result count');
        error.code = 'CALCULATION_UPSTREAM_ERROR';
        throw error;
      }
      for (const [offset, result] of body.results.entries()) {
        const { index, request, key } = misses[offset];
        const payload = {
          ...result,
          metadata: {
            scheduleSource: request.scheduleSource ?? 'REQUEST',
            railwaySource: 'OpenStreetMap Overpass',
            seatSource: 'KORAIL_OFFICIAL_STRUCTURAL_ONLY',
            routeVersion,
            calculationVersion,
          },
        };
        await this.cache.put(key, payload);
        results[index] = { ...payload, cache: 'MISS' };
      }
    }
    return { results };
  }
}
