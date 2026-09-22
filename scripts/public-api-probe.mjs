import fs from 'node:fs/promises';
import path from 'node:path';

const TAGO_BASE = 'https://apis.data.go.kr/1613000/TrainInfo';
const KORAIL_BASE = 'https://apis.data.go.kr/B551457/run/v2';
const OUTPUT_DIR = path.resolve(process.env.PROBE_OUTPUT_DIR || 'probe-output');
const TAGO_API_KEY = (process.env.TAGO_API_KEY || '').trim();
const KORAIL_API_KEY = (process.env.KORAIL_API_KEY || '').trim();

if (!TAGO_API_KEY || !KORAIL_API_KEY) {
  throw new Error('TAGO_API_KEY and KORAIL_API_KEY are required');
}

function koreaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const value = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offsetDays));
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`;
}

const PROBE_DATE = process.env.PROBE_DATE || koreaDate();
const PROBE_ACTUAL_DATE = process.env.PROBE_ACTUAL_DATE || koreaDate(-1);

await fs.mkdir(OUTPUT_DIR, { recursive: true });

function decodeKey(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function redactUrl(value) {
  const url = new URL(value);
  if (url.searchParams.has('serviceKey')) url.searchParams.set('serviceKey', '***REDACTED***');
  return url.toString();
}

function paramsWithoutKey(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

async function saveJson(filename, value) {
  await fs.writeFile(path.join(OUTPUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function errorJson(error) {
  return {
    name: error?.name || null,
    message: error?.message || String(error),
    cause: error?.cause ? { name: error.cause.name || null, message: error.cause.message || String(error.cause), code: error.cause.code || null } : null,
    stack: error?.stack || null,
  };
}

async function requestOnce({ service, base, endpoint, params, apiKey, keyMode }) {
  const publicParams = paramsWithoutKey(params);
  const url = new URL(base + endpoint);
  url.searchParams.set('serviceKey', keyMode === 'decoded' ? decodeKey(apiKey) : apiKey);
  for (const [key, value] of Object.entries(publicParams)) url.searchParams.set(key, String(value));
  const request = { service, method: 'GET', endpoint, params: publicParams };
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json, application/xml;q=0.8, text/plain;q=0.5', 'user-agent': 'SunSeat-API-Probe/3.0' },
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); } catch { body = { _nonJson: true, raw }; }
    return {
      request,
      response: {
        networkOk: true, httpOk: response.ok, status: response.status, statusText: response.statusText,
        contentType: response.headers.get('content-type'), elapsedMs: Date.now() - startedAt, keyMode,
        requestUrl: redactUrl(url), body,
      },
    };
  } catch (error) {
    return { request, response: { networkOk: false, httpOk: false, status: null, elapsedMs: Date.now() - startedAt, keyMode, requestUrl: redactUrl(url), error: errorJson(error) } };
  }
}

function authError(body) {
  const text = JSON.stringify(body || {}).toUpperCase();
  return ['SERVICE_KEY', 'SERVICE KEY', 'SERVICEKEY', 'PERMISSION_DENIED', 'ACCESS DENIED', 'UNREGISTERED', 'AUTHENTICATION', 'AUTHORIZATION', '서비스키', '인증', '권한'].some((value) => text.includes(value));
}

async function apiGet({ service, base, endpoint, params, apiKey }) {
  const decoded = await requestOnce({ service, base, endpoint, params, apiKey, keyMode: 'decoded' });
  if (decoded.response.networkOk && decoded.response.httpOk && !authError(decoded.response.body)) return { selected: decoded, attempts: [decoded] };
  const raw = await requestOnce({ service, base, endpoint, params, apiKey, keyMode: 'raw' });
  if (raw.response.networkOk && raw.response.httpOk && !authError(raw.response.body)) return { selected: raw, attempts: [decoded, raw] };
  return { selected: decoded, attempts: [decoded, raw] };
}

async function runApi({ filename, title, service, base, endpoint, params, apiKey }) {
  const result = await apiGet({ service, base, endpoint, params, apiKey });
  await saveJson(filename, result);
  const response = result.selected.response;
  console.log(`${response.httpOk ? '✓' : '!'} [${service}] ${title} HTTP ${response.status ?? '-'} keyMode=${response.keyMode} ${response.elapsedMs}ms`);
  return result;
}

function getBody(record) { return record?.selected?.response?.body; }

function collectObjects(value, output = []) {
  if (Array.isArray(value)) { value.forEach((item) => collectObjects(item, output)); return output; }
  if (value && typeof value === 'object') { output.push(value); Object.values(value).forEach((item) => collectObjects(item, output)); }
  return output;
}

function objectsContaining(value, needle) {
  const normalized = String(needle).replace(/\s+/g, '');
  return collectObjects(value).filter((object) => Object.values(object).some((item) => typeof item === 'string' && item.replace(/\s+/g, '').includes(normalized)));
}

function getField(object, candidates) {
  if (!object || typeof object !== 'object') return undefined;
  for (const candidate of candidates) {
    const key = Object.keys(object).find((actual) => actual.toLowerCase() === candidate.toLowerCase());
    if (key) return object[key];
  }
  return undefined;
}

function findArrays(value, currentPath = '$', output = []) {
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) output.push({ path: currentPath, length: value.length, keys: Object.keys(value[0]), sample: value[0] });
    value.forEach((child, index) => findArrays(child, `${currentPath}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => findArrays(child, `${currentPath}.${key}`, output));
  }
  return output;
}

function findScalars(value, currentPath = '$', output = [], depth = 0) {
  if (depth > 8) return output;
  if (Array.isArray(value)) { value.slice(0, 3).forEach((child, index) => findScalars(child, `${currentPath}[${index}]`, output, depth + 1)); return output; }
  if (value && typeof value === 'object') { Object.entries(value).forEach(([key, child]) => findScalars(child, `${currentPath}.${key}`, output, depth + 1)); return output; }
  output.push({ path: currentPath, value });
  return output;
}

function errorSignals(body) { return findScalars(body).filter((item) => /(resultcode|resultmsg|resultmessage|error|err|message|msg)/i.test(item.path)).slice(0, 50); }
function pagination(body) { return findScalars(body).filter((item) => /(totalcount|total_count|pageno|page_no|numofrows|num_of_rows)/i.test(item.path)); }

function endpointParams(extra) { return { pageNo: 1, numOfRows: 200, _type: 'json', ...extra }; }

console.log(`SunSeat Public API Probe v3: plan=${PROBE_DATE}, actual=${PROBE_ACTUAL_DATE}`);

const tagoCity = await runApi({ filename: '01-tago-city-codes.json', title: 'TAGO 도시코드', service: 'TAGO', base: TAGO_BASE, endpoint: '/GetCtyCodeList', params: { _type: 'json' }, apiKey: TAGO_API_KEY });
const tagoVehicles = await runApi({ filename: '02-tago-vehicle-kinds.json', title: 'TAGO 차량종류', service: 'TAGO', base: TAGO_BASE, endpoint: '/GetVhcleKndList', params: { _type: 'json' }, apiKey: TAGO_API_KEY });

const seoulCityObject = objectsContaining(getBody(tagoCity), '서울')[0];
const busanCityObject = objectsContaining(getBody(tagoCity), '부산')[0];
const seoulCityCode = getField(seoulCityObject, ['citycode', 'cityCode', 'city_code']);
const busanCityCode = getField(busanCityObject, ['citycode', 'cityCode', 'city_code']);

let tagoSeoulStations = null;
let tagoBusanStations = null;
if (seoulCityCode) tagoSeoulStations = await runApi({ filename: '03-tago-seoul-stations.json', title: 'TAGO 서울 역목록', service: 'TAGO', base: TAGO_BASE, endpoint: '/GetCtyAcctoTrainSttnList', params: endpointParams({ cityCode: seoulCityCode }), apiKey: TAGO_API_KEY });
if (busanCityCode) tagoBusanStations = await runApi({ filename: '04-tago-busan-stations.json', title: 'TAGO 부산 역목록', service: 'TAGO', base: TAGO_BASE, endpoint: '/GetCtyAcctoTrainSttnList', params: endpointParams({ cityCode: busanCityCode }), apiKey: TAGO_API_KEY });

const seoulCandidates = objectsContaining(getBody(tagoSeoulStations), '서울');
const busanCandidates = objectsContaining(getBody(tagoBusanStations), '부산');
const seoulStationObject = seoulCandidates.find((object) => Object.values(object).some((value) => value === '서울' || value === '서울역')) || seoulCandidates[0];
const busanStationObject = busanCandidates.find((object) => Object.values(object).some((value) => value === '부산' || value === '부산역')) || busanCandidates[0];
const seoulStationId = getField(seoulStationObject, ['nodeid', 'nodeId', 'trainSttnId', 'trainsttnid', 'stationId', 'stationid']);
const busanStationId = getField(busanStationObject, ['nodeid', 'nodeId', 'trainSttnId', 'trainsttnid', 'stationId', 'stationid']);

let tagoTrains = null;
if (seoulStationId && busanStationId) tagoTrains = await runApi({ filename: '05-tago-seoul-busan-trains.json', title: 'TAGO 서울→부산 열차', service: 'TAGO', base: TAGO_BASE, endpoint: '/GetStrtpntAlocFndTrainInfo', params: endpointParams({ depPlaceId: seoulStationId, arrPlaceId: busanStationId, depPlandTime: PROBE_DATE }), apiKey: TAGO_API_KEY });
else await saveJson('05-tago-seoul-busan-trains.json', { skipped: true, reason: 'TAGO cityCode or station IDs were not discovered', discovered: { seoulCityCode: seoulCityCode ?? null, busanCityCode: busanCityCode ?? null, seoulStationId: null, busanStationId: null } });

const korailCodeSeoul = await runApi({ filename: '06-korail-codes-seoul.json', title: 'KORAIL 서울 코드', service: 'KORAIL', base: KORAIL_BASE, endpoint: '/codes2', params: { pageNo: 1, numOfRows: 200, returnType: 'JSON', 'cond[value::LIKE]': '서울' }, apiKey: KORAIL_API_KEY });
const korailCodeBusan = await runApi({ filename: '07-korail-codes-busan.json', title: 'KORAIL 부산 코드', service: 'KORAIL', base: KORAIL_BASE, endpoint: '/codes2', params: { pageNo: 1, numOfRows: 200, returnType: 'JSON', 'cond[value::LIKE]': '부산' }, apiKey: KORAIL_API_KEY });
const korailPlanRoute = await runApi({ filename: '08-korail-plan-seoul-busan.json', title: 'KORAIL 서울→부산 운행계획', service: 'KORAIL', base: KORAIL_BASE, endpoint: '/travelerTrainRunPlan2', params: { pageNo: 1, numOfRows: 500, returnType: 'JSON', 'cond[run_ymd::GTE]': PROBE_DATE, 'cond[run_ymd::LTE]': PROBE_DATE, 'cond[dptre_stn_nm::EQ]': '서울', 'cond[arvl_stn_nm::EQ]': '부산' }, apiKey: KORAIL_API_KEY });
const korailPlanDate = await runApi({ filename: '09-korail-plan-date.json', title: 'KORAIL 날짜 전체 운행계획', service: 'KORAIL', base: KORAIL_BASE, endpoint: '/travelerTrainRunPlan2', params: { pageNo: 1, numOfRows: 500, returnType: 'JSON', 'cond[run_ymd::GTE]': PROBE_DATE, 'cond[run_ymd::LTE]': PROBE_DATE }, apiKey: KORAIL_API_KEY });
const korailActualSeoul = await runApi({ filename: '10-korail-actual-seoul.json', title: 'KORAIL 서울 실제운행', service: 'KORAIL', base: KORAIL_BASE, endpoint: '/travelerTrainRunInfo2', params: { pageNo: 1, numOfRows: 500, returnType: 'JSON', 'cond[run_ymd::GTE]': PROBE_ACTUAL_DATE, 'cond[run_ymd::LTE]': PROBE_ACTUAL_DATE, 'cond[stn_nm::EQ]': '서울' }, apiKey: KORAIL_API_KEY });
const korailActualDate = await runApi({ filename: '11-korail-actual-date.json', title: 'KORAIL 날짜 전체 실제운행', service: 'KORAIL', base: KORAIL_BASE, endpoint: '/travelerTrainRunInfo2', params: { pageNo: 1, numOfRows: 500, returnType: 'JSON', 'cond[run_ymd::GTE]': PROBE_ACTUAL_DATE, 'cond[run_ymd::LTE]': PROBE_ACTUAL_DATE }, apiKey: KORAIL_API_KEY });

const responses = [
  ['TAGO 도시코드', tagoCity], ['TAGO 차량종류', tagoVehicles], ['TAGO 서울 역목록', tagoSeoulStations], ['TAGO 부산 역목록', tagoBusanStations], ['TAGO 서울→부산 열차', tagoTrains],
  ['KORAIL 서울 코드', korailCodeSeoul], ['KORAIL 부산 코드', korailCodeBusan], ['KORAIL 서울→부산 운행계획', korailPlanRoute], ['KORAIL 날짜 전체 운행계획', korailPlanDate], ['KORAIL 서울 실제운행', korailActualSeoul], ['KORAIL 날짜 전체 실제운행', korailActualDate],
];

const analysis = { generatedAt: new Date().toISOString(), dates: { plan: PROBE_DATE, actual: PROBE_ACTUAL_DATE }, discovered: { seoulCityCode: seoulCityCode ?? null, busanCityCode: busanCityCode ?? null, seoulStationId: seoulStationId ?? null, busanStationId: busanStationId ?? null }, services: {} };
for (const [title, record] of responses) {
  if (!record) { analysis.services[title] = { skipped: true }; continue; }
  const response = record.selected.response;
  analysis.services[title] = { request: record.selected.request, networkOk: response.networkOk, httpOk: response.httpOk, status: response.status, keyMode: response.keyMode, requestUrl: response.requestUrl, elapsedMs: response.elapsedMs, arrays: response.body ? findArrays(response.body) : [], pagination: response.body ? pagination(response.body) : [], errorSignals: response.body ? errorSignals(response.body) : [], error: response.error ?? null };
}
await saveJson('analysis.json', analysis);

const report = [`# SunSeat 실제 API Request / Response 분석`, '', `생성시각: ${analysis.generatedAt}`, `계획 조회일: ${PROBE_DATE}`, `실제운행 조회일: ${PROBE_ACTUAL_DATE}`, '', '## 발견된 식별자', '', '```json', JSON.stringify(analysis.discovered, null, 2), '```', ''];
for (const [title, record] of responses) {
  report.push(`## ${title}`, '');
  if (!record) { report.push('호출하지 않음: 선행 식별자를 찾지 못함.', ''); continue; }
  const selected = record.selected;
  report.push('### Request', '', '```json', JSON.stringify(selected.request, null, 2), '```', '');
  report.push('### Response', '', `- Network: \`${selected.response.networkOk}\``, `- HTTP: \`${selected.response.status ?? '-'}\``, `- Key mode: \`${selected.response.keyMode}\``, `- Elapsed: \`${selected.response.elapsedMs}ms\``, '', '```json', JSON.stringify(selected.response.body ?? selected.response.error, null, 2), '```', '');
  const arrays = selected.response.body ? findArrays(selected.response.body) : [];
  if (arrays.length) { report.push('### Array candidates', '', '```json', JSON.stringify(arrays.slice(0, 5), null, 2), '```', ''); }
}
report.push('## 적용 판단', '', '- API 키가 유효하고 response DTO가 확인된 경우에만 adapter 매핑을 추가한다.', '- TAGO는 도시코드 → 역목록 → 출발/도착 열차의 순서를 유지한다.', '- KORAIL 계획과 실제운행은 별도 adapter로 저장하고 planned/actual 검증에 사용한다.', '- API 키는 request JSON, response JSON, report에 저장하지 않는다.', '');
await fs.writeFile(path.join(OUTPUT_DIR, 'REPORT.md'), `${report.join('\n')}\n`, 'utf8');
console.log(`Probe complete. Output: ${OUTPUT_DIR}`);
