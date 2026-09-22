import assert from 'node:assert/strict';
import test from 'node:test';

import { ScheduleService } from '../src/services/scheduleService.mjs';

test('normalizes the confirmed TAGO timetable response', async () => {
  let requestedUrl;
  const metadata = {
    async findStation(value) {
      return value === '서울'
        ? { id: 'seoul', name: '서울', tagoCode: 'NAT010000' }
        : { id: 'busan', name: '부산', tagoCode: 'NAT014445' };
    },
    async loadTrainTypes() { return [{ id: '07', name: 'KTX-산천(A-type)' }]; },
  };
  const cache = {
    async get() { return null; },
    async put(_origin, _destination, _date, payload) { return payload; },
  };
  const service = new ScheduleService({
    metadata,
    cache,
    env: {
      TAGO_SCHEDULE_URL: 'https://example.test/GetStrtpntAlocFndTrainInfo',
      TAGO_SERVICE_KEY: encodeURIComponent('test-key/+'),
    },
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            response: {
              header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
              body: {
                items: {
                  item: [{
                    trainno: '00001',
                    traingradename: 'KTX-산천(A-type)',
                    depplandtime: '20260922051300',
                    arrplandtime: '20260922075000',
                  }],
                },
              },
            },
          };
        },
      };
    },
  });

  const result = await service.search({ origin: '서울', destination: '부산', date: '2026-09-22', includeDeparted: true });

  assert.equal(requestedUrl.searchParams.get('serviceKey'), 'test-key/+');
  assert.equal(requestedUrl.searchParams.get('depPlaceId'), 'NAT010000');
  assert.equal(requestedUrl.searchParams.get('arrPlaceId'), 'NAT014445');
  assert.equal(requestedUrl.searchParams.get('depPlandTime'), '20260922');
  assert.equal(result.source, 'TAGO');
  assert.equal(result.trains.length, 1);
  assert.equal(result.trains[0].trainType, 'KTX-SANCHEON');
  assert.equal(result.trains[0].departure, '2026-09-22T05:13:00+09:00');
  assert.equal(result.trains[0].arrival, '2026-09-22T07:50:00+09:00');
});

test('filters by time and grade without another upstream request', async () => {
  let fetchCount = 0;
  const metadata = {
    async findStation(value) {
      return value === '서울'
        ? { id: 'seoul', name: '서울', tagoCode: 'NAT010000' }
        : { id: 'busan', name: '부산', tagoCode: 'NAT014445' };
    },
    async loadTrainTypes() { return [{ id: '00', name: 'KTX' }, { id: '08', name: 'ITX-새마을' }]; },
  };
  const cache = {
    async get() { return null; },
    async put(_origin, _destination, _date, payload) { return payload; },
  };
  const service = new ScheduleService({
    metadata,
    cache,
    env: { TAGO_SCHEDULE_URL: 'https://example.test/timetable', TAGO_SERVICE_KEY: 'test-key' },
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return { response: { header: { resultCode: '00' }, body: { items: { item: [
            { trainno: '00010', traingradename: 'KTX', depplandtime: '20260922134200', arrplandtime: '20260922160000' },
            { trainno: '01010', traingradename: 'ITX-새마을', depplandtime: '20260922141200', arrplandtime: '20260922170000' },
            { trainno: '00012', traingradename: 'KTX', depplandtime: '20260922151800', arrplandtime: '20260922180000' },
          ] } } } };
        },
      };
    },
  });

  const result = await service.search({
    origin: '서울', destination: '부산', date: '2026-09-22',
    departureTimeFrom: '14:00', departureTimeTo: '15:00', trainGradeCodes: ['00'], includeDeparted: true,
  });

  assert.equal(fetchCount, 1);
  assert.equal(result.searchState.type, 'NO_TRAINS_IN_TIME_RANGE');
  assert.equal(result.trains.length, 0);
  assert.equal(result.nearbyTrains.previous.trainNumber, '00010');
  assert.equal(result.nearbyTrains.next.trainNumber, '00012');
  assert.deepEqual(result.availableTrainTypes, [{ id: '00', name: 'KTX', count: 2 }, { id: '08', name: 'ITX-새마을', count: 1 }]);
});
