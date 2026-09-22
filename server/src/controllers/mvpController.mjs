import { readJsonBody, sendJson } from '../lib/http.mjs';

function errorStatus(error) {
  if (['STATION_NOT_FOUND', 'SCHEDULE_DATA_INVALID', 'CALCULATION_UPSTREAM_ERROR'].includes(error?.code)) return error.code === 'CALCULATION_UPSTREAM_ERROR' ? 502 : 422;
  if (['SCHEDULE_NOT_CONFIGURED', 'STATION_CODE_NOT_CONFIGURED', 'ROUTE_NOT_FOUND', 'DATA_NOT_READY'].includes(error?.code)) return 503;
  if (error?.code === 'SCHEDULE_UPSTREAM_ERROR') return 502;
  if (error?.code === 'PAYLOAD_TOO_LARGE') return 413;
  if (error?.code === 'INVALID_JSON') return 400;
  return 500;
}

function reportError(response, error) {
  const status = errorStatus(error);
  if (status >= 500 && error?.code !== 'SCHEDULE_NOT_CONFIGURED') console.error(error);
  sendJson(response, status, { error: error.code ?? 'Internal server error', detail: error.message });
}

export class MvpController {
  constructor({ metadata, schedule, exposure, route, seatLayouts, sourceLoader, env = process.env }) {
    this.metadata = metadata;
    this.schedule = schedule;
    this.exposure = exposure;
    this.route = route;
    this.seatLayouts = seatLayouts;
    this.sourceLoader = sourceLoader;
    this.env = env;
  }

  async stations(response, query) {
    try { sendJson(response, 200, { stations: await this.metadata.findStations(query) }); } catch (error) { reportError(response, error); }
  }

  async trains(response, query) {
    try { sendJson(response, 200, await this.schedule.search(query)); } catch (error) { reportError(response, error); }
  }

  async exposureRequest(request, response, schema) {
    try {
      const body = schema.parse(await readJsonBody(request));
      sendJson(response, 200, await this.exposure.calculate(body));
    } catch (error) {
      if (error?.name === 'ZodError') return sendJson(response, 400, { error: 'INVALID_REQUEST', detail: error.issues });
      reportError(response, error);
    }
  }

  async exposureBatch(request, response, schema) {
    try {
      const body = schema.parse(await readJsonBody(request));
      sendJson(response, 200, await this.exposure.batch(body.requests));
    } catch (error) {
      if (error?.name === 'ZodError') return sendJson(response, 400, { error: 'INVALID_REQUEST', detail: error.issues });
      reportError(response, error);
    }
  }

  async trainTypes(response) {
    try {
      const [trainTypes, rollingStockData] = await Promise.all([this.metadata.loadTrainTypes(), this.metadata.loadRollingStocks()]);
      const rollingStocks = rollingStockData.rollingStocks ?? [];
      sendJson(response, 200, {
        trainTypes: trainTypes.map((trainType) => {
          const rollingStock = rollingStocks.find((item) => item.id === trainType.id);
          return {
            ...trainType,
            seatMapAvailable: Boolean(rollingStock?.seatMapAvailable),
            seatLayoutId: rollingStock?.layoutId ?? null,
            seatLayoutVariants: rollingStock?.layoutVariants ?? [],
            rollingStockSource: rollingStock?.sourceUrl ?? null,
          };
        }),
      });
    } catch (error) { reportError(response, error); }
  }

  async seats(response, type) {
    try {
      const [trainTypes, rollingStockData] = await Promise.all([this.metadata.loadTrainTypes(), this.metadata.loadRollingStocks()]);
      const rollingStocks = rollingStockData.rollingStocks ?? [];
      const trainType = trainTypes.find((item) => item.id === type || item.name === type);
      const rollingStock = rollingStocks.find((item) => item.id === trainType?.id || item.id === type);
      const layoutIds = [...new Set([rollingStock?.layoutId, ...(rollingStock?.layoutVariants ?? [])].filter(Boolean))];
      const layouts = (await Promise.all(layoutIds.map((layoutId) => this.seatLayouts.get(layoutId)))).filter(Boolean);
      if (!layouts.length) {
        sendJson(response, 200, {
          type,
          available: false,
          layout: null,
          layoutVariants: layoutIds,
          reason: 'NO_VERIFIED_OFFICIAL_SEAT_LAYOUT',
        });
        return;
      }
      const layout = layouts.find((item) => item.id === rollingStock?.layoutId) ?? layouts[0];
      sendJson(response, 200, {
        type,
        available: true,
        layout,
        layoutVariants: layouts.map((item) => item.id),
        variantLayouts: layouts,
        availability: 'STRUCTURAL_ONLY',
        note: layouts.length > 1
          ? '실시간 잔여좌석은 제공하지 않으며 공식 좌석배치 변형을 함께 제공합니다. 실제 편성 변형은 예약 시스템에서 확인해야 합니다.'
          : '실시간 잔여좌석은 제공하지 않으며 공식 좌석배치 구조만 제공합니다.',
      });
    } catch (error) { reportError(response, error); }
  }

  async routeDisplay(response, routeId) {
    try { sendJson(response, 200, await this.route.getDisplay(routeId)); } catch (error) { reportError(response, error); }
  }

  async sources(response) {
    try {
      const value = await this.sourceLoader();
      sendJson(response, 200, {
        ...value,
        scheduleSource: {
          ...value.scheduleSource,
          configured: Boolean(this.env.TAGO_SCHEDULE_URL && (this.env.TAGO_SERVICE_KEY ?? this.env.TAGO_API_KEY)),
        },
      });
    } catch (error) { reportError(response, error); }
  }
}
