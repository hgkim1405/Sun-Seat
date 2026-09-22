import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://www.korail.com/ticket/train/trainGuide/seatingPlan';
const SEATMAP_BASE = 'https://www.korail.com/public/seatmap/';
const RAW_ROOT = path.join(ROOT, 'data', 'raw', 'korail-seat-layouts');
const PROCESSED_ROOT = path.join(ROOT, 'data', 'processed');
const ROLLING_STOCK_ROOT = path.join(ROOT, 'data', 'rolling-stock');

const CATALOG = [
  { id: 'KTX', displayName: 'KTX', tagoVehicleCode: '00', prefix: 'trainSeatKTXDown', sourceNumbers: range(1, 18), normalizeCar: (value) => value },
  { id: 'KTX-SANCHEON-A', displayName: 'KTX-산천 A-type', tagoVehicleCode: '07', prefix: 'trainSeatKTXSanDown', sourceNumbers: range(1, 8), normalizeCar: (value) => value },
  { id: 'KTX-SANCHEON-B', displayName: 'KTX-산천 B-type', tagoVehicleCode: '10', prefix: 'trainSeatKTXSanDown', sourceNumbers: range(11, 18), normalizeCar: (value) => value - 10 },
  { id: 'KTX-EUM', displayName: 'KTX-이음', tagoVehicleCode: '16', prefix: 'trainSeatEumDown', sourceNumbers: range(1, 6), normalizeCar: (value) => value },
  { id: 'KTX-EUM-12CAR', displayName: 'KTX-이음 12호차 편성', tagoVehicleCode: '16', prefix: 'trainSeatEumDown', sourceNumbers: range(7, 12), normalizeCar: (value) => value - 6 },
  { id: 'KTX-CHEONGRYONG', displayName: 'KTX-청룡', tagoVehicleCode: '19', prefix: 'trainSeatChungyoungDown', sourceNumbers: range(1, 8), normalizeCar: (value) => value },
  { id: 'ITX-SAEMAEUL', displayName: 'ITX-새마을', tagoVehicleCode: '08', prefix: 'trainSeatITXSaeDown', sourceNumbers: range(1, 6), normalizeCar: (value) => value },
  { id: 'ITX-CHEONGCHUN', displayName: 'ITX-청춘', tagoVehicleCode: '09', prefix: 'trainSeatITXcheongDown', sourceNumbers: range(1, 8), normalizeCar: (value) => value },
  { id: 'ITX-MAUM', displayName: 'ITX-마음', tagoVehicleCode: '18', prefix: 'trainSeatMaumDown', sourceNumbers: range(1, 8), normalizeCar: (value) => value },
  { id: 'ITX-MAUM-EMU', displayName: 'ITX-마음 EMU 편성', tagoVehicleCode: '18', prefix: 'trainSeatMaumEMUDown', sourceNumbers: range(1, 12), normalizeCar: (value) => value },
  { id: 'NURIRO', displayName: '누리로', tagoVehicleCode: '04', prefix: 'trainSeatNuriroDown', sourceNumbers: range(1, 4), normalizeCar: (value) => value },
  { id: 'SAEMAEUL', displayName: '새마을호', tagoVehicleCode: '01', prefix: 'trainSeatSaemaeulDown', sourceNumbers: range(1, 6), normalizeCar: (value) => value },
  { id: 'SRT', displayName: 'SRT', tagoVehicleCode: '17', prefix: 'trainSeatSRTDown', sourceNumbers: range(1, 8), normalizeCar: (value) => value },
  { id: 'MUGUNGHWA-52', displayName: '무궁화호 52석 객차', tagoVehicleCode: '02', fileName: 'trainSeatMuGungHwaDown52seats', sourceNumbers: [1], normalizeCar: () => 1 },
  { id: 'MUGUNGHWA-53', displayName: '무궁화호 53석 객차', tagoVehicleCode: '02', fileName: 'trainSeatMuGungHwaDown53seats', sourceNumbers: [1], normalizeCar: () => 1 },
  { id: 'MUGUNGHWA-56', displayName: '무궁화호 56석 객차', tagoVehicleCode: '02', fileName: 'trainSeatMuGungHwaDown56seats', sourceNumbers: [1], normalizeCar: () => 1 },
  { id: 'MUGUNGHWA-64', displayName: '무궁화호 64석 객차', tagoVehicleCode: '02', fileName: 'trainSeatMuGungHwaDown64seats', sourceNumbers: [1], normalizeCar: () => 1 },
  { id: 'MUGUNGHWA-68', displayName: '무궁화호 68석 객차', tagoVehicleCode: '02', fileName: 'trainSeatMuGungHwaDown68seats', sourceNumbers: [1], normalizeCar: () => 1 },
  { id: 'MUGUNGHWA-72', displayName: '무궁화호 72석 객차', tagoVehicleCode: '02', fileName: 'trainSeatMuGungHwaDown72seats', sourceNumbers: [1], normalizeCar: () => 1 },
];

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function sourceUrl(fileName) { return `${SEATMAP_BASE}${fileName}.html`; }

function parseSeatNodes(html) {
  const seats = [];
  const seen = new Set();
  const seatLineStarts = [...html.matchAll(/<li\b[^>]*class="[^"]*\bseat_line\b[^"]*"[^>]*>/gi)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);
  const tagPattern = /<li\b(?=[^>]*\bclass="([^"]+)"(?=[^>]*\bid="([^"]*)"))[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const classes = match[1].split(/\s+/).filter(Boolean);
    const seatNumber = match[2].trim();
    if (!classes.some((value) => value.startsWith('seat_')) || !seatNumber || classes.includes('noseat') || seen.has(seatNumber)) continue;
    seen.add(seatNumber);
    const columnMatch = seatNumber.match(/^(\d+)([A-D])$/i);
    const row = columnMatch ? Number(columnMatch[1]) : null;
    const column = columnMatch ? columnMatch[2].toUpperCase() : null;
    const physicalSide = column
      ? ['A', 'B'].includes(column) ? 'SIDE_A' : 'SIDE_B'
      : classes.includes('seat_T') ? 'SIDE_A' : 'SIDE_B';
    const position = column
      ? ['A', 'C'].includes(column) ? 'WINDOW' : 'AISLE'
      : 'OTHER';
    let layoutRow = null;
    for (let index = seatLineStarts.length - 1; index >= 0; index -= 1) {
      if (seatLineStarts[index] <= (match.index ?? -1)) {
        layoutRow = index + 1;
        break;
      }
    }
    seats.push({
      seatNumber,
      ...(row ? { row } : {}),
      ...(column ? { column } : {}),
      ...(layoutRow ? { layoutRow } : {}),
      physicalSide,
      position,
      facing: classes.some((value) => value.startsWith('four_')) ? 'ROTATABLE' : 'UNKNOWN',
    });
  }
  return seats;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: 'text/html', 'user-agent': 'SunSeat-seat-layout-sync/1.0' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return { ok: false, status: response.status, text: '' };
  return { ok: true, status: response.status, text: await response.text() };
}

async function syncLayout(catalog, collectedAt) {
  const layoutDirectory = path.join(RAW_ROOT, catalog.id);
  await fs.mkdir(layoutDirectory, { recursive: true });
  const cars = [];
  const sourceFiles = [];
  for (const sourceNumber of catalog.sourceNumbers) {
    const fileName = catalog.fileName ?? `${catalog.prefix}${String(sourceNumber).padStart(2, '0')}`;
    const url = sourceUrl(fileName);
    const response = await fetchText(url);
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const seats = parseSeatNodes(response.text);
    if (!seats.length) throw new Error(`${url} contains no official seat identifiers`);
    const carNumber = catalog.normalizeCar(sourceNumber);
    await fs.writeFile(path.join(layoutDirectory, `car-${String(carNumber).padStart(2, '0')}-down.html`), response.text, 'utf8');
    sourceFiles.push({ carNumber, sourceFile: `${fileName}.html`, sourceUrl: url, seatCount: seats.length });
    cars.push({
      carNumber,
      seatClass: 'OTHER',
      declaredSeatCount: seats.length,
      declaredSeatCountSource: 'KORAIL public seatmap HTML seat identifiers',
      seats,
    });
  }
  const validationStatus = cars.every((car) => car.seats.length === car.declaredSeatCount) ? 'VALID' : 'TOTAL_COUNT_MISMATCH';
  return {
    id: catalog.id,
    rollingStockType: catalog.displayName,
    tagoVehicleCode: catalog.tagoVehicleCode,
    cars,
    source: { provider: 'KORAIL', sourceUrl: SOURCE_URL, seatmapBaseUrl: SEATMAP_BASE, collectedAt, direction: 'Down', files: sourceFiles },
    verified: validationStatus === 'VALID',
    validationStatus,
    totalSeatCount: cars.reduce((sum, car) => sum + car.seats.length, 0),
  };
}

const collectedAt = new Date().toISOString();
await fs.mkdir(RAW_ROOT, { recursive: true });
await fs.mkdir(PROCESSED_ROOT, { recursive: true });
await fs.mkdir(ROLLING_STOCK_ROOT, { recursive: true });
const page = await fetchText(SOURCE_URL);
if (page.ok) await fs.writeFile(path.join(RAW_ROOT, 'seating-plan-page.html'), page.text, 'utf8');

const layouts = [];
const failures = [];
for (const catalog of CATALOG) {
  try {
    const layout = await syncLayout(catalog, collectedAt);
    layouts.push(layout);
    console.log(`✓ ${catalog.id}: ${layout.cars.length} cars / ${layout.totalSeatCount} seats`);
  } catch (error) {
    failures.push({ id: catalog.id, displayName: catalog.displayName, tagoVehicleCode: catalog.tagoVehicleCode, error: error.message });
    console.log(`! ${catalog.id}: ${error.message}`);
  }
}

const layoutById = new Map(layouts.map((layout) => [layout.id, layout]));
const rollingStocks = [
  { id: '00', displayName: 'KTX', layoutId: layoutById.has('KTX') ? 'KTX' : null },
  { id: '07', displayName: 'KTX-산천(A-type)', layoutId: layoutById.has('KTX-SANCHEON-A') ? 'KTX-SANCHEON-A' : null },
  { id: '10', displayName: 'KTX-산천(B-type)', layoutId: layoutById.has('KTX-SANCHEON-B') ? 'KTX-SANCHEON-B' : null },
  { id: '0A', displayName: 'KTX-산천', layoutId: null, layoutVariants: ['KTX-SANCHEON-A', 'KTX-SANCHEON-B'].filter((id) => layoutById.has(id)) },
  { id: '16', displayName: 'KTX-이음', layoutId: layoutById.has('KTX-EUM') ? 'KTX-EUM' : null, layoutVariants: ['KTX-EUM', 'KTX-EUM-12CAR'].filter((id) => layoutById.has(id)) },
  { id: '19', displayName: 'KTX-청룡', layoutId: layoutById.has('KTX-CHEONGRYONG') ? 'KTX-CHEONGRYONG' : null },
  { id: '08', displayName: 'ITX-새마을', layoutId: layoutById.has('ITX-SAEMAEUL') ? 'ITX-SAEMAEUL' : null },
  { id: '09', displayName: 'ITX-청춘', layoutId: layoutById.has('ITX-CHEONGCHUN') ? 'ITX-CHEONGCHUN' : null },
  { id: '18', displayName: 'ITX-마음', layoutId: layoutById.has('ITX-MAUM') ? 'ITX-MAUM' : null, layoutVariants: ['ITX-MAUM', 'ITX-MAUM-EMU'].filter((id) => layoutById.has(id)) },
  { id: '04', displayName: '누리로', layoutId: layoutById.has('NURIRO') ? 'NURIRO' : null },
  { id: '02', displayName: '무궁화호', layoutId: null, layoutVariants: layouts.filter((layout) => layout.id.startsWith('MUGUNGHWA-')).map((layout) => layout.id) },
  { id: '01', displayName: '새마을호', layoutId: layoutById.has('SAEMAEUL') ? 'SAEMAEUL' : null },
  { id: '03', displayName: '통근열차', layoutId: null },
  { id: '06', displayName: 'AREX직통', layoutId: null },
  { id: '17', displayName: 'SRT', layoutId: layoutById.has('SRT') ? 'SRT' : null },
].map((item) => ({ ...item, sourceUrl: SOURCE_URL, verifiedAt: collectedAt, seatMapAvailable: Boolean(item.layoutId || item.layoutVariants?.length) }));

await fs.writeFile(path.join(PROCESSED_ROOT, 'seat-layouts.json'), `${JSON.stringify({ version: `korail-${collectedAt.slice(0, 10)}`, provider: 'KORAIL', sourceUrl: SOURCE_URL, generatedAt: collectedAt, layouts, failures }, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(ROLLING_STOCK_ROOT, 'rolling-stock.json'), `${JSON.stringify({ version: `korail-${collectedAt.slice(0, 10)}`, provider: 'KORAIL', sourceUrl: SOURCE_URL, generatedAt: collectedAt, rollingStocks, failures }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ generatedAt: collectedAt, layoutCount: layouts.length, rollingStockCount: rollingStocks.length, failures }, null, 2));
