// -----------------------------------------------------------------------------
// The decoding of the two payload dialects, and the protocol envelopes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from './helpers/fakeCloud.js';
import {
  ORDERS,
  decodeStatus,
  envelope,
  identifiersOf,
  mergePayload,
  parseMower,
} from '../src/worx/mower.js';
import { activityOf, faultKindOf, ACTIVITY } from '../src/worx/codes.js';
import { statusKey, wifiQuality } from '../src/devices.js';

const products = new Map(FIXTURES.products().map((p) => [p.id, p]));
const [wireItem, visionItem, oldItem] = FIXTURES.items();
const [kressItem] = FIXTURES.kress();

test('a wire mower (protocol 0)', () => {
  const mower = parseMower(wireItem, products);
  assert.equal(mower.protocol, 0);
  assert.equal(mower.model, 'Landroid M 500 (WR141E)');
  assert.equal(mower.topics.in, 'DB510/F0FE6B000001/commandIn');
  const s = decodeStatus(mower.payload, mower, { brand: 'worx' });
  assert.equal(s.statusCode, 1);
  assert.equal(s.charging, true);
  assert.equal(s.zone, 2);
  assert.equal(s.scheduleEnabled, true);
  assert.equal(s.canEdgeCut, true);
  assert.equal(s.locked, false);
  assert.equal(s.gps, null);
  assert.equal(statusKey(mower, s), 'charging');
});

test('a Vision mower (protocol 1)', () => {
  const mower = parseMower(visionItem, products);
  assert.equal(mower.protocol, 1);
  assert.equal(mower.uuid, '6f1b2c3d-0000-4000-8000-00000000a1b2');
  const s = decodeStatus(mower.payload, mower, { brand: 'worx' });
  assert.equal(s.zone, 1);
  assert.equal(s.hasZone, true);
  assert.equal(s.scheduleEnabled, true);
  assert.equal(statusKey(mower, s), 'mowing');
  // Paused schedule = not enabled.
  const paused = structuredClone(mower.payload);
  paused.cfg.sc.paused = 1;
  assert.equal(decodeStatus(paused, mower, { brand: 'worx' }).scheduleEnabled, false);
});

test('an old offline mower lacks most sensors', () => {
  const mower = parseMower(oldItem, products);
  assert.equal(mower.online, false);
  assert.equal(mower.model, null);
  const s = decodeStatus(mower.payload, mower, { brand: 'worx' });
  assert.equal(s.rainDetected, null);
  assert.equal(s.locked, null);
  assert.equal(s.hasZone, false);
  assert.equal(s.canEdgeCut, false);
  assert.equal(statusKey(mower, s), 'offline');
});

test('a Kress mower counts the rain delay in seconds and reports its RTK position', () => {
  const mower = parseMower(kressItem, products);
  const s = decodeStatus(mower.payload, mower, { brand: 'kress' });
  assert.equal(s.rainRemaining, 90);
  assert.deepEqual(s.gps, { lat: 45.000123, lon: 1.000456 });
  assert.equal(statusKey(mower, s), 'rain');
  assert.equal(decodeStatus(mower.payload, mower, { brand: 'worx' }).rainRemaining, 5400);
});

test('party mode (m = 2) means the schedule is off', () => {
  const mower = parseMower(wireItem, products);
  const p = structuredClone(mower.payload);
  p.cfg.sc.m = 2;
  assert.equal(decodeStatus(p, mower, { brand: 'worx' }).scheduleEnabled, false);
});

test('a 4G module position is read too, and (0, 0) means no fix', () => {
  const mower = parseMower(wireItem, products);
  const p = structuredClone(mower.payload);
  p.dat.modules = { '4G': { gps: { coo: [44.5, 2.25] } } };
  assert.deepEqual(decodeStatus(p, mower, { brand: 'worx' }).gps, { lat: 44.5, lon: 2.25 });
  p.dat.modules['4G'].gps.coo = [0, 0];
  assert.equal(decodeStatus(p, mower, { brand: 'worx' }).gps, null);
});

test('merging and identifying the MQTT messages', () => {
  const merged = mergePayload({ cfg: { rd: 30 }, dat: { ls: 1 } }, { dat: { ls: 7 } });
  assert.deepEqual(merged, { cfg: { rd: 30 }, dat: { ls: 7 } });
  assert.deepEqual(identifiersOf({ cfg: { sn: 'S' }, dat: { mac: 'M', uuid: 'U' } }), [
    'S',
    'U',
    'M',
  ]);
});

test('the envelopes of both protocols', () => {
  const date = new Date(2026, 9, 14, 9, 5, 7);
  const wire = envelope({ protocol: 0, serial: 'S1', uuid: null }, ORDERS.start(), date);
  assert.equal(wire.sn, 'S1');
  assert.equal(wire.tm, '09:05:07');
  assert.equal(wire.dt, '14/10/2026');
  assert.equal(wire.cmd, 1);
  const vision = envelope({ protocol: 1, serial: 'S2', uuid: 'U2' }, ORDERS.pause(), date);
  assert.equal(vision.uuid, 'U2');
  assert.equal(vision.sn, undefined);
  assert.match(vision.tm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(ORDERS.schedule({ protocol: 1 }, true), { sc: { enabled: 1 } });
  assert.deepEqual(ORDERS.schedule({ protocol: 0 }, true), { sc: { m: 1, distm: 0 } });
  assert.deepEqual(ORDERS.lock({ protocol: 0 }, false), { cmd: 6 });
});

test('codes: activities and fault kinds', () => {
  assert.equal(activityOf(7), ACTIVITY.WORKING);
  assert.equal(activityOf(32), ACTIVITY.WORKING);
  assert.equal(activityOf(30), ACTIVITY.RETURNING);
  assert.equal(activityOf(34), ACTIVITY.PAUSED);
  assert.equal(activityOf(102), ACTIVITY.OTHER);
  assert.equal(faultKindOf(2), 'lifted');
  assert.equal(faultKindOf(4), 'outside');
  assert.equal(faultKindOf(999), 'other');
});

test('Wi-Fi quality from the RSSI', () => {
  assert.equal(wifiQuality(-100), 0);
  assert.equal(wifiQuality(-75), 50);
  assert.equal(wifiQuality(-40), 100);
});
