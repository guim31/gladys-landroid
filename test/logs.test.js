// -----------------------------------------------------------------------------
// Quiet logs: nothing at info level for a normal cycle, a repeated failure
// said once, and never a secret — not even at debug level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, EMAIL, PASSWORD, createFakeCloud } from './helpers/fakeCloud.js';
import { createWorld, deviceIdOf, featureIdOf, settle } from './helpers/world.js';
import { LIMITS } from '../src/worx/limits.js';

const WIRE = '20230000000000000001';
const WIRE_OUT = 'DB510/F0FE6B000001/commandOut';

/** Captures every log line written while `level` is active. */
function capture(t, level) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return {
    lines,
    restore() {
      process.env.LOG_LEVEL = previous;
      t.mock.restoreAll();
    },
  };
}

test('a normal cycle writes nothing at info level', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const world = await createWorld({ timers: true });
  const log = capture(t, 'info');
  try {
    const payload = structuredClone(FIXTURES.items()[0].last_status.payload);
    for (const ls of [7, 7, 30, 1]) {
      payload.dat.ls = ls;
      payload.dat.bt.p -= 3;
      world.broker.push(WIRE_OUT, payload);
      await settle();
    }
    t.mock.timers.tick(LIMITS.REST_PERIOD_MS);
    await settle(10);
    const device = world.gladys.fake.discoveredDevices[0];
    await world.gladys.fake.poll(device);
    await world.gladys.fake.widgetGet('mower', { settings: { device: device.external_id } });
    assert.deepEqual(log.lines, [], 'no line at info level or above');
  } finally {
    log.restore();
    world.app.stop();
  }
});

test('a user action writes one info line', async (t) => {
  const world = await createWorld();
  const log = capture(t, 'info');
  try {
    const device = world.gladys.fake.discoveredDevices.find(
      (d) => d.external_id === deviceIdOf(world.gladys, WIRE),
    );
    await world.gladys.fake.setValue(
      device,
      { external_id: featureIdOf(world.gladys, WIRE, 'start') },
      1,
    );
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0], /\[INFO\] \[hub\] Pelouse avant: start mowing$/);
  } finally {
    log.restore();
    world.app.stop();
  }
});

test('a cloud that stays down is said once, and its return once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const world = await createWorld({ timers: true });
  const log = capture(t, 'info');
  try {
    world.cloud.down = true;
    world.broker.accept = false;
    world.broker.drop();
    await settle();
    for (let i = 0; i < 6; i += 1) {
      t.mock.timers.tick(LIMITS.REST_FALLBACK_PERIOD_MS);
      await settle(10);
    }
    world.cloud.down = false;
    t.mock.timers.tick(LIMITS.REST_FALLBACK_PERIOD_MS);
    await settle(10);
    const cloudLines = log.lines.filter((l) => l.includes('Worx cloud'));
    assert.equal(cloudLines.length, 2, cloudLines.join('\n'));
    assert.match(cloudLines[0], /\[WARN\].*cloud unreachable/);
    assert.match(cloudLines[1], /\[INFO\].*reachable again/);
    const mqttLines = log.lines.filter((l) => l.includes('Real-time link'));
    assert.equal(mqttLines.length, 1, mqttLines.join('\n'));
  } finally {
    log.restore();
    world.app.stop();
  }
});

test('no secret of the configuration ever reaches the logs, even at debug level', async (t) => {
  const log = capture(t, 'debug');
  const cloud = createFakeCloud();
  const worlds = [];
  try {
    const world = await createWorld({ cloud });
    worlds.push(world);
    const device = world.gladys.fake.discoveredDevices[0];
    await world.gladys.fake.setValue(device, { external_id: `${device.external_id}:start` }, 1);
    world.broker.push(WIRE_OUT, FIXTURES.items()[0].last_status.payload);
    await settle();
    world.broker.drop();
    await settle();
    // A refused password, a cloud down.
    worlds.push(await createWorld({ config: { password: 'wrong-password-123' } }));
    const down = createFakeCloud();
    down.down = true;
    worlds.push(await createWorld({ cloud: down }));
  } finally {
    worlds.forEach((w) => w.app.stop());
    log.restore();
  }
  const text = log.lines.join('\n');
  assert.ok(log.lines.length > 5, `only ${log.lines.length} debug lines captured`);
  const secrets = [
    PASSWORD,
    'wrong-password-123',
    EMAIL,
    ...cloud.validTokens,
    ...cloud.refreshTokens,
  ];
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `a secret leaked into the logs: ${secret.slice(0, 6)}…`);
  }
  // No token part either (the MQTT username is built from it).
  assert.ok(!/jwt=|eyJ/.test(text));
});

test('saving the configuration or stopping says nothing about a lost link', async (t) => {
  const world = await createWorld();
  const log = capture(t, 'info');
  try {
    await world.gladys.fake.configUpdated({ email: EMAIL, password: PASSWORD, language: 'de' });
    await settle();
    await world.gladys.fake.shutdown().catch(() => {});
    world.app.stop();
    assert.deepEqual(
      log.lines.filter((l) => /WARN|ERROR|Real-time link/.test(l)),
      [],
    );
  } finally {
    log.restore();
    world.app.stop();
  }
});
