import { resolveRollingStock } from './rollingStockResolver.mjs';

const SCHEDULE_SCHEMA_VERSION = 3;

function pick(value, names) {
  for (const name of names) {
    if (value?.[name] !== undefined && value[name] !== null && value[name] !== '') return value[name];
  }
  return null;
}

function officialTime(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? '').trim();
  if (/^\d{12,14}$/.test(text)) {
    const digits = text.padEnd(14, '0');
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+09:00`;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function decodeServiceKey(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function canonicalTrainType(value) {
  const name = String(value ?? '').trim().toUpperCase();
  if (name === 'KTX') return 'KTX';
  if (name.includes('KTX') && name.includes('산천')) return 'KTX-SANCHEON';
  if (name.includes('KTX') && name.includes('청룡')) return 'KTX-CHEONGRYONG';
  if (name.includes('KTX') && name.includes('이음')) return 'KTX-EUM';
  return 'UNKNOWN';
}

function itemList(body) {
  const candidates = [
    body?.response?.body?.items?.item,
    body?.body?.items?.item,
    body?.items?.item,
    body?.items,
  ];
  const value = candidates.find((candidate) => candidate !== undefined);
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(item, originStation, destinationStation, date, trainTypes, rollingStocks) {
  const departure = officialTime(pick(item, ['depplandtime', 'depPlanTime', 'departureTime', 'depTime']));
  const arrival = officialTime(pick(item, ['arrplandtime', 'arrPlanTime', 'arrivalTime', 'arrTime']));
  const trainNumber = pick(item, ['trainno', 'trainNo', 'trainNumber', 'trnNo']);
  if (!departure || !arrival || !trainNumber) return null;
  const trainGradeName = String(pick(item, ['traingradename', 'trainGradeName', 'trainName']) ?? '열차');
  const grade = trainTypes.find((type) => type.name === trainGradeName);
  const durationMinutes = Math.round((Date.parse(arrival) - Date.parse(departure)) / 60_000);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) return null;
  const normalized = {
    id: `${date}-${trainNumber}-${departure}-${originStation.id}`,
    trainNumber: String(trainNumber),
    trainGradeCode: grade?.id ?? null,
    trainGradeName,
    trainName: trainGradeName,
    trainType: canonicalTrainType(trainGradeName),
    originStationId: originStation.id,
    destinationStationId: destinationStation.id,
    origin: originStation.name,
    destination: destinationStation.name,
    departureAt: departure,
    arrivalAt: arrival,
    departure,
    arrival,
    durationMinutes,
    adultFare: toNumber(pick(item, ['adultcharge', 'adultCharge', 'fare'])),
    stationTimeline: [
      { station: originStation.name, time: departure, event: 'departure' },
      { station: destinationStation.name, time: arrival, event: 'arrival' },
    ],
    intermediateTimesAvailable: false,
    routeId: originStation.routeId && originStation.routeId === destinationStation.routeId ? originStation.routeId : null,
  };
  return { ...normalized, rollingStock: resolveRollingStock(normalized, rollingStocks) };
}

function enrichCachedSchedule(schedule, originStation, destinationStation, rollingStocks) {
  return {
    ...schedule,
    trains: (schedule.trains ?? []).map((train) => ({
      ...train,
      routeId: train.routeId ?? (originStation.routeId && originStation.routeId === destinationStation.routeId ? originStation.routeId : null),
      rollingStock: train.rollingStock ?? resolveRollingStock(train, rollingStocks),
    })),
  };
}

function clockMinutes(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function trainDepartureMinutes(train) {
  return clockMinutes(String(train.departureAt ?? train.departure).slice(11, 16));
}

function seoulDateTime() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]));
}

function seoulDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function trainTypesSummary(trains) {
  const counts = new Map();
  for (const train of trains) {
    const code = train.trainGradeCode ?? `name:${train.trainGradeName}`;
    const current = counts.get(code) ?? { id: train.trainGradeCode, name: train.trainGradeName, count: 0 };
    current.count += 1;
    counts.set(code, current);
  }
  return [...counts.values()];
}

function nearestTrains(trains, from, to) {
  const fromMinutes = clockMinutes(from) ?? 0;
  const toMinutes = clockMinutes(to) ?? 23 * 60 + 59;
  return {
    previous: trains.filter((train) => trainDepartureMinutes(train) < fromMinutes).at(-1) ?? null,
    next: trains.find((train) => trainDepartureMinutes(train) > toMinutes) ?? null,
  };
}

function filterSchedule(schedule, conditions) {
  const allTrains = [...(schedule.trains ?? [])].sort((left, right) => Date.parse(left.departureAt ?? left.departure) - Date.parse(right.departureAt ?? right.departure));
  const today = conditions.date === seoulDate();
  const now = seoulDateTime();
  const nowMinutes = now.hour * 60 + now.minute;
  const visibleTrains = conditions.includeDeparted || !today
    ? allTrains
    : allTrains.filter((train) => (trainDepartureMinutes(train) ?? 0) >= nowMinutes);
  const requestedGrades = conditions.trainGradeCodes ?? [];
  const gradeTrains = requestedGrades.length
    ? visibleTrains.filter((train) => train.trainGradeCode && requestedGrades.includes(train.trainGradeCode))
    : visibleTrains;
  const hasTimeRange = Boolean(conditions.departureTimeFrom || conditions.departureTimeTo);
  const fromMinutes = clockMinutes(conditions.departureTimeFrom) ?? 0;
  const toMinutes = clockMinutes(conditions.departureTimeTo) ?? 23 * 60 + 59;
  const trains = hasTimeRange
    ? gradeTrains.filter((train) => {
      const departure = trainDepartureMinutes(train);
      return departure !== null && departure >= fromMinutes && departure <= toMinutes;
    })
    : gradeTrains;
  let type = 'SUCCESS';
  let reason = null;
  if (allTrains.length === 0) {
    type = 'NO_TRAINS';
    reason = 'NO_SERVICE';
  } else if (visibleTrains.length === 0) {
    type = 'NO_TRAINS';
    reason = 'ALL_DEPARTED';
  } else if (gradeTrains.length === 0) {
    type = 'NO_TRAINS_FOR_GRADE';
    reason = 'GRADE_FILTER';
  } else if (hasTimeRange && trains.length === 0) {
    type = 'NO_TRAINS_IN_TIME_RANGE';
    reason = 'TIME_RANGE_FILTER';
  }
  const nearbyTrains = type === 'NO_TRAINS_IN_TIME_RANGE'
    ? nearestTrains(gradeTrains, conditions.departureTimeFrom, conditions.departureTimeTo)
    : { previous: null, next: null };
  const availableTrainTypes = trainTypesSummary(visibleTrains);
  return {
    ...schedule,
    trains,
    searchState: { type, reason },
    nearbyTrains,
    availableTrainTypes,
    summary: {
      totalAvailable: visibleTrains.length,
      totalMatches: trains.length,
      departedHidden: allTrains.length - visibleTrains.length,
      firstDeparture: visibleTrains[0]?.departureAt ?? null,
      lastDeparture: visibleTrains.at(-1)?.departureAt ?? null,
      availableTrainTypes,
      conditions: {
        origin: conditions.origin,
        destination: conditions.destination,
        date: conditions.date,
        departureTimeFrom: conditions.departureTimeFrom ?? null,
        departureTimeTo: conditions.departureTimeTo ?? null,
        trainGradeCodes: requestedGrades,
        includeDeparted: Boolean(conditions.includeDeparted),
      },
    },
  };
}

export class ScheduleService {
  constructor({ metadata, cache, fetchImpl = fetch, env = process.env } = {}) {
    this.metadata = metadata;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.env = env;
  }

  async loadTrainTypes() {
    return this.metadata?.loadTrainTypes ? this.metadata.loadTrainTypes() : [];
  }

  async loadRollingStocks() {
    const data = this.metadata?.loadRollingStocks ? await this.metadata.loadRollingStocks() : { rollingStocks: [] };
    return data.rollingStocks ?? [];
  }

  async search(conditions) {
    const originStation = await this.metadata.findStation(conditions.origin);
    const destinationStation = await this.metadata.findStation(conditions.destination);
    if (!originStation || !destinationStation) {
      const error = new Error('Origin or destination station is not in the station master');
      error.code = 'STATION_NOT_FOUND';
      throw error;
    }
    if (!originStation.tagoCode || !destinationStation.tagoCode) {
      const error = new Error('Official TAGO station codes are not configured for this route');
      error.code = 'STATION_CODE_NOT_CONFIGURED';
      throw error;
    }
    const trainTypes = await this.loadTrainTypes();
    const rollingStocks = await this.loadRollingStocks();
    const cached = await this.cache.get(originStation.id, destinationStation.id, conditions.date);
    if (cached?.schemaVersion === SCHEDULE_SCHEMA_VERSION) return filterSchedule(enrichCachedSchedule(cached, originStation, destinationStation, rollingStocks), conditions);

    const url = this.env.TAGO_SCHEDULE_URL;
    const serviceKey = this.env.TAGO_SERVICE_KEY ?? this.env.TAGO_API_KEY;
    if (!url || !serviceKey) {
      const error = new Error('TAGO_SCHEDULE_URL and TAGO_SERVICE_KEY are required when no schedule cache exists');
      error.code = 'SCHEDULE_NOT_CONFIGURED';
      throw error;
    }
    const endpoint = new URL(url);
    endpoint.searchParams.set('serviceKey', decodeServiceKey(serviceKey));
    endpoint.searchParams.set('_type', 'json');
    endpoint.searchParams.set('numOfRows', '1000');
    endpoint.searchParams.set('pageNo', '1');
    endpoint.searchParams.set('depPlandTime', conditions.date.replaceAll('-', ''));
    endpoint.searchParams.set('depPlaceId', originStation.tagoCode);
    endpoint.searchParams.set('arrPlaceId', destinationStation.tagoCode);
    const response = await this.fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      const error = new Error(`TAGO schedule request failed with HTTP ${response.status}`);
      error.code = 'SCHEDULE_UPSTREAM_ERROR';
      throw error;
    }
    const body = await response.json();
    const resultCode = body?.response?.header?.resultCode;
    if (resultCode && resultCode !== '00') {
      const error = new Error(body?.response?.header?.resultMsg || `TAGO returned result code ${resultCode}`);
      error.code = 'SCHEDULE_UPSTREAM_ERROR';
      throw error;
    }
    const trains = itemList(body).map((item) => normalize(item, originStation, destinationStation, conditions.date, trainTypes, rollingStocks)).filter(Boolean);
    const payload = {
      schemaVersion: SCHEDULE_SCHEMA_VERSION,
      origin: originStation.name,
      destination: destinationStation.name,
      originStationId: originStation.id,
      destinationStationId: destinationStation.id,
      date: conditions.date,
      trains,
      source: 'TAGO',
      stale: false,
      fetchedAt: new Date().toISOString(),
      intermediateTimesAvailable: false,
    };
    await this.cache.put(originStation.id, destinationStation.id, conditions.date, payload);
    return filterSchedule(payload, conditions);
  }
}
