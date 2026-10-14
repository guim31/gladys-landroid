// -----------------------------------------------------------------------------
// The MQTT link: the custom authorizer username, the backoff, the refusals.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsername, createMqttLink } from '../src/worx/mqtt.js';
import { LIMITS } from '../src/worx/limits.js';
import { createFakeBroker } from './helpers/fakeCloud.js';
import { createWorld, settle } from './helpers/world.js';

test('the username carries the token for the AWS IoT custom authorizer', () => {
  // base64url parts: `-` and `_` are turned back to base64 (`+` and `/`), then quoted.
  const username = buildUsername('aaa-b_c.dd_e-f.sig-n_x');
  assert.equal(
    username,
    "gladys?jwt=aaa%2Bb/c.dd/e%2Bf&x-amz-customauthorizer-name=''&x-amz-customauthorizer-signature=sig%2Bn/x",
  );
});

function link(broker, overrides = {}) {
  const states = [];
  const messages = [];
  let tokens = 0;
  const l = createMqttLink({
    connect: broker.connect,
    getToken: async () => `h.p.s${(tokens += 1)}`,
    target: () => ({
      endpoint: 'iot.example.com',
      clientId: 'WX/USER/1/gladys/x',
      topics: ['a/commandOut'],
    }),
    onMessage: (topic, message) => messages.push({ topic, message }),
    onState: (connected, reason) => states.push({ connected, reason }),
    ...overrides,
  });
  return { l, states, messages, tokens: () => tokens };
}

test('the reconnection waits one minute, then longer, up to 30 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const broker = createFakeBroker({ accept: false });
  const { l, states } = link(broker);
  l.start();
  await settle();
  assert.equal(broker.connections.length, 1);
  assert.equal(states.at(-1).connected, false);
  const delays = [];
  let elapsed = 0;
  for (let i = 0; i < 8; i += 1) {
    const before = broker.connections.length;
    let waited = 0;
    while (broker.connections.length === before && waited < LIMITS.MQTT_RETRY_MAX_MS) {
      t.mock.timers.tick(1000);
      waited += 1000;
      await settle(1);
    }
    elapsed += waited;
    delays.push(waited / 1000);
    await settle();
  }
  assert.deepEqual(delays, [60, 120, 240, 480, 960, 1800, 1800, 1800]);
  assert.ok(elapsed > 0);
  l.stop();
});

test('every attempt takes a fresh token', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const broker = createFakeBroker({ accept: false });
  let refused = 0;
  const { l, tokens } = link(broker, { onAuthRefused: () => (refused += 1) });
  l.start();
  await settle();
  t.mock.timers.tick(LIMITS.MQTT_RETRY_MIN_MS);
  await settle();
  assert.equal(broker.connections.length, 2);
  assert.equal(tokens(), 2);
  assert.notEqual(broker.connections[0].options.username, broker.connections[1].options.username);
  assert.equal(refused, 2, 'a "not authorized" refusal expires the token');
  l.stop();
});

test('messages are parsed, garbage is ignored', async () => {
  const broker = createFakeBroker();
  const { l, messages, states } = link(broker);
  l.start();
  await settle();
  assert.deepEqual(states, [{ connected: true, reason: undefined }]);
  broker.push('a/commandOut', { dat: { ls: 1 } });
  broker.live[0].emit('message', 'a/commandOut', Buffer.from('not json'));
  assert.deepEqual(messages, [{ topic: 'a/commandOut', message: { dat: { ls: 1 } } }]);
  l.stop();
  assert.equal(broker.live.length, 0);
  await assert.rejects(l.publish('a/commandIn', {}), /link down/);
});

test('a dropped link is retried, and the cloud read every 30 minutes meanwhile', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const world = await createWorld({ timers: true });
  try {
    assert.equal(world.hub.realtime, true);
    world.broker.drop();
    await settle();
    assert.equal(world.hub.realtime, false);
    t.mock.timers.tick(LIMITS.MQTT_RETRY_MIN_MS);
    await settle(10);
    assert.equal(world.broker.connections.length, 2);
    assert.equal(world.hub.realtime, true);
  } finally {
    world.app.stop();
  }
});
