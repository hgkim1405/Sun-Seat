import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRequestHandler } from '../src/app/createApp.mjs';
import { PocRepository } from '../src/repositories/pocRepository.mjs';
import { ScheduleRepository } from '../src/repositories/scheduleRepository.mjs';

async function withServer(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunseat-api-'));
  const resultsDir = path.join(root, 'results');
  const routeDir = path.join(root, 'route');
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.mkdir(routeDir, { recursive: true });
  await fs.writeFile(path.join(resultsDir, 'summary.json'), JSON.stringify({ pocStatus: 'PASS' }));
  await fs.writeFile(path.join(resultsDir, 'timeline-1m.json'), JSON.stringify([{ rawSide: 'RIGHT' }]));
  await fs.writeFile(path.join(resultsDir, 'timeline.json'), JSON.stringify([{ rawSide: 'RIGHT' }]));
  await fs.writeFile(path.join(resultsDir, 'timeline-5m.json'), JSON.stringify([{ rawSide: 'RIGHT' }]));
  await fs.writeFile(path.join(routeDir, 'route.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  const requestHandler = createRequestHandler({
    repository: new PocRepository({ resultsDir, routeDir }),
    scheduleCache: new ScheduleRepository({ directory: path.join(root, 'schedules') }),
  });
  const server = http.createServer(requestHandler);
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('health and summary endpoints', async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    const summary = await fetch(`${base}/api/poc/summary`);
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).pocStatus, 'PASS');
  });
});

test('timeline resolutions and route endpoint', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/poc/timeline?resolution=5m`)).status, 200);
    assert.equal((await fetch(`${base}/api/poc/timeline?resolution=bad`)).status, 400);
    assert.equal((await fetch(`${base}/api/poc/route`)).status, 200);
  });
});

test('unknown endpoint returns 404', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});

test('mvp metadata and structural seat contracts do not fabricate live availability', async () => {
  await withServer(async (base) => {
    const stations = await fetch(`${base}/api/stations?q=부산`);
    assert.equal(stations.status, 200);
    assert.equal((await stations.json()).stations[0].name, '부산');
    const seats = await fetch(`${base}/api/train-types/KTX/seats`);
    assert.equal(seats.status, 200);
    const seatPayload = await seats.json();
    assert.equal(seatPayload.available, true);
    assert.equal(seatPayload.availability, 'STRUCTURAL_ONLY');
    assert.equal(seatPayload.layout.cars.length, 18);
    const mugunghwa = await fetch(`${base}/api/train-types/02/seats`);
    assert.equal(mugunghwa.status, 200);
    const mugunghwaPayload = await mugunghwa.json();
    assert.equal(mugunghwaPayload.available, true);
    assert.equal(mugunghwaPayload.variantLayouts.length, 6);
    assert.equal(mugunghwaPayload.layout.id, 'MUGUNGHWA-52');
    const trainTypes = await fetch(`${base}/api/train-types`);
    assert.equal(trainTypes.status, 200);
    assert.equal((await trainTypes.json()).trainTypes.find((item) => item.id === '00').name, 'KTX');
    const trains = await fetch(`${base}/api/trains?origin=서울&destination=부산&date=2026-09-22`);
    assert.equal(trains.status, 503);
  });
});
