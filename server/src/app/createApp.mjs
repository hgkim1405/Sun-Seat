import { PocController } from '../controllers/pocController.mjs';
import { PocRepository } from '../repositories/pocRepository.mjs';
import { createPocRouter } from '../routes/pocRoutes.mjs';
import { PocService } from '../services/pocService.mjs';
import { MetadataRepository } from '../repositories/metadataRepository.mjs';
import { ScheduleRepository } from '../repositories/scheduleRepository.mjs';
import { ExposureRepository } from '../repositories/exposureRepository.mjs';
import { RouteRepository } from '../repositories/routeRepository.mjs';
import { SeatLayoutRepository } from '../repositories/seatLayoutRepository.mjs';
import { ScheduleService } from '../services/scheduleService.mjs';
import { ExposureService } from '../services/exposureService.mjs';
import { MvpController } from '../controllers/mvpController.mjs';
import { createMvpRouter } from '../routes/mvpRoutes.mjs';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function createRequestHandler({ repository = new PocRepository(), scheduleCache = new ScheduleRepository() } = {}) {
  const service = new PocService(repository);
  const controller = new PocController(service);
  const pocRouter = createPocRouter(controller);
  const metadata = new MetadataRepository();
  const schedule = new ScheduleService({ metadata, cache: scheduleCache });
  const exposure = new ExposureService({ metadata, cache: new ExposureRepository() });
  const mvpController = new MvpController({
    metadata,
    schedule,
    exposure,
    route: new RouteRepository(),
    seatLayouts: new SeatLayoutRepository(),
    sourceLoader: () => metadata.loadSources(),
  });
  const mvpRouter = createMvpRouter(mvpController);
  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'sunseat-api',
        calculationService: process.env.SUNSEAT_CALC_URL ?? 'http://127.0.0.1:8100',
        scheduleConfigured: Boolean(process.env.TAGO_SCHEDULE_URL && (process.env.TAGO_SERVICE_KEY ?? process.env.TAGO_API_KEY)),
      });
      return;
    }
    if (await mvpRouter(request, response, url)) return;
    if (await pocRouter(request, response, url)) {
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  };
}
