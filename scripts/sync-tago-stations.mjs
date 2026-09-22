import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAGO_BASE = 'https://apis.data.go.kr/1613000/TrainInfo';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATION_MASTER_PATH = path.join(ROOT, 'data', 'metadata', 'stations.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'metadata', 'tago-stations.json');
const RAW_DIR = path.join(ROOT, 'data', 'raw', 'tago');
const apiKey = (process.env.TAGO_API_KEY || process.env.TAGO_SERVICE_KEY || '').trim();

if (!apiKey) throw new Error('TAGO_API_KEY or TAGO_SERVICE_KEY is required');

function decodeKey(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function redactUrl(value) {
  const url = new URL(value);
  if (url.searchParams.has('serviceKey')) url.searchParams.set('serviceKey', '***REDACTED***');
  return url.toString();
}

function items(body) {
  const value = body?.response?.body?.items?.item;
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  return String(value ?? '').trim();
}

function stationName(value) {
  return text(value).replace(/역$/, '');
}

function getField(value, names) {
  const object = value && typeof value === 'object' ? value : {};
  for (const name of names) {
    const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key && object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return null;
}

async function request(endpoint, params) {
  const url = new URL(`${TAGO_BASE}/${endpoint}`);
  url.searchParams.set('serviceKey', decodeKey(apiKey));
  for (const [key, value] of Object.entries({ pageNo: 1, numOfRows: 1000, _type: 'json', ...params })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { raw }; }
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`);
  const resultCode = text(body?.response?.header?.resultCode);
  if (resultCode && resultCode !== '00' && resultCode !== '0') {
    throw new Error(`${endpoint} ${resultCode}: ${text(body?.response?.header?.resultMsg)}`);
  }
  return { endpoint, params, requestUrl: redactUrl(url), status: response.status, body };
}

function normalizeStation(item, city) {
  const id = text(getField(item, ['nodeid', 'nodeId', 'trainSttnId', 'trainsttnid', 'stationId', 'stationid']));
  const name = text(getField(item, ['nodename', 'nodeName', 'trainSttnNm', 'trainsttnnm', 'stationName', 'stationname']));
  if (!id || !name) return null;
  return { id, name, cityCode: city.code, cityName: city.name, aliases: [stationName(name)] };
}

function matchesMasterStation(masterStation, tagoStation) {
  const aliases = [masterStation.name, ...(masterStation.aliases || []), masterStation.osmName]
    .filter(Boolean).map(stationName).map((value) => value.toLocaleLowerCase('ko-KR'));
  return aliases.includes(stationName(tagoStation.name).toLocaleLowerCase('ko-KR'));
}

const master = JSON.parse(await fs.readFile(STATION_MASTER_PATH, 'utf8'));
const cityResponse = await request('GetCtyCodeList', {});
const cities = items(cityResponse.body).map((item) => ({
  code: text(getField(item, ['citycode', 'cityCode', 'city_code'])),
  name: text(getField(item, ['cityname', 'cityName', 'city_name'])),
})).filter((city) => city.code && city.name);

const stationResponses = [];
const stations = [];
for (const city of cities) {
  const response = await request('GetCtyAcctoTrainSttnList', { cityCode: city.code });
  const normalized = items(response.body).map((item) => normalizeStation(item, city)).filter(Boolean);
  stationResponses.push({ ...response, itemCount: normalized.length });
  stations.push(...normalized);
}

const uniqueStations = [...new Map(stations.map((station) => [station.id, station])).values()]
  .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR') || left.id.localeCompare(right.id));
const matches = [];
const updatedMaster = {
  ...master,
  stations: master.stations.map((station) => {
    const match = uniqueStations.find((candidate) => matchesMasterStation(station, candidate));
    if (!match) {
      matches.push({ station: station.name, status: 'NOT_FOUND', tagoCode: null });
      return station;
    }
    matches.push({ station: station.name, status: 'MATCHED', tagoCode: match.id, tagoName: match.name, cityCode: match.cityCode });
    return { ...station, tagoCode: match.id, source: 'TAGO GetCtyAcctoTrainSttnList + OSM route mapping' };
  }),
};

await fs.mkdir(RAW_DIR, { recursive: true });
const generatedAt = new Date().toISOString();
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({ provider: 'TAGO', endpoint: '/GetCtyAcctoTrainSttnList', generatedAt, stationCount: uniqueStations.length, stations: uniqueStations }, null, 2)}\n`, 'utf8');
await fs.writeFile(STATION_MASTER_PATH, `${JSON.stringify(updatedMaster, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(RAW_DIR, `station-sync-${generatedAt.slice(0, 10)}.json`), `${JSON.stringify({
  provider: 'TAGO', generatedAt, cityRequest: { endpoint: cityResponse.endpoint, params: cityResponse.params, requestUrl: cityResponse.requestUrl, status: cityResponse.status },
  cityCount: cities.length, stationCount: uniqueStations.length, matches, requests: stationResponses.map(({ endpoint, params, requestUrl, status, itemCount }) => ({ endpoint, params, requestUrl, status, itemCount })),
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ generatedAt, cityCount: cities.length, stationCount: uniqueStations.length, matches }, null, 2));
