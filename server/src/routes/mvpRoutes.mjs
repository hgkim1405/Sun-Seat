import { exposureBatchSchema, exposureRequestSchema, stationSearchSchema, trainSearchSchema } from '../../../shared/schemas/mvp.mjs';
import { methodNotAllowed, sendJson } from '../lib/http.mjs';

export function createMvpRouter(controller) {
  return async function route(request, response, url) {
    if (url.pathname === '/api/stations') {
      if (request.method !== 'GET') return methodNotAllowed(response);
      const query = stationSearchSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!query.success) return sendJson(response, 400, { error: 'INVALID_QUERY', detail: query.error.issues });
      await controller.stations(response, query.data.q);
      return true;
    }
    if (url.pathname === '/api/trains') {
      if (request.method !== 'GET') return methodNotAllowed(response);
      const query = trainSearchSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!query.success) return sendJson(response, 400, { error: 'INVALID_QUERY', detail: query.error.issues });
      await controller.trains(response, query.data);
      return true;
    }
    if (url.pathname === '/api/exposure') {
      if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
      await controller.exposureRequest(request, response, exposureRequestSchema);
      return true;
    }
    if (url.pathname === '/api/exposure/batch') {
      if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
      await controller.exposureBatch(request, response, exposureBatchSchema);
      return true;
    }
    if (url.pathname === '/api/train-types') {
      if (request.method !== 'GET') return methodNotAllowed(response);
      await controller.trainTypes(response);
      return true;
    }
    const seatMatch = url.pathname.match(/^\/api\/train-types\/([^/]+)\/seats$/);
    if (seatMatch) {
      if (request.method !== 'GET') return methodNotAllowed(response);
      await controller.seats(response, decodeURIComponent(seatMatch[1]));
      return true;
    }
    const routeMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/display$/);
    if (routeMatch) {
      if (request.method !== 'GET') return methodNotAllowed(response);
      await controller.routeDisplay(response, decodeURIComponent(routeMatch[1]));
      return true;
    }
    if (url.pathname === '/api/sources') {
      if (request.method !== 'GET') return methodNotAllowed(response);
      await controller.sources(response);
      return true;
    }
    return false;
  };
}
