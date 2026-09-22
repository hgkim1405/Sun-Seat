import { timelineQuerySchema } from '../../../shared/schemas/poc.mjs';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function createPocRouter(controller) {
  return async function route(request, response, url) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }
    if (url.pathname === '/api/poc/summary') {
      await controller.summary(response);
      return true;
    }
    if (url.pathname === '/api/poc/timeline') {
      const parsed = timelineQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) {
        sendJson(response, 400, { error: 'Invalid resolution', allowed: ['raw', '1m', '5m'] });
        return true;
      }
      await controller.timeline(response, parsed.data.resolution);
      return true;
    }
    if (url.pathname === '/api/poc/route') {
      await controller.route(response);
      return true;
    }
    return false;
  };
}

