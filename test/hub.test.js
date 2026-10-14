// -----------------------------------------------------------------------------
// The integration end to end: the fake Gladys of the SDK, a fake cloud, a
// fake broker. Discovery, live states, commands, triggers, budgets.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from './helpers/fakeCloud.js';
import { createAll, createWorld, deviceIdOf, featureIdOf, settle } from './helpers/world.js';
import { LIMITS } from '../src/worx/limits.js';

const WIRE = '20230000000000000001';
const VISION = '20240000000000000002';
const OLD = '20180000000000000003';
const WIRE_OUT = 'DB510/F0FE6B000001/commandOut';
const WIRE_IN = 'DB510/F0FE6B000001/commandIn';
const VISION_IN = 'RVM100/6f1b2c3d-0000-4000-8000-00000000a1b2/commandIn';
const VISION_OUT = 'RVM100/6f1b2c3d-0000-4000-8000-00000000a1b2/commandOut';

const wirePayload = () => structuredClone(FIXTURES.items()[0].last_status.payload);
const visionPayload = () => structuredClone(FIXTURES.items()[1].last_status.payload);

function deviceOf(world, serial) {
  return world.gladys.fake.discoveredDevices.find(
    (d) => d.external_id === deviceIdOf(world.gladys, serial),
  );
}

function featureOf(world, serial, key) {
  return { external_id: featureIdOf(world.gladys, serial, key) };
}

test('the mowers of the account are discovered, with their states', async () => {
  const world = await createWorld();
  try {
    const { fake } = world.gladys;
    assert.deepEqual(fake.connectionStatus, { connected: true });
    assert.equal(fake.discoveredDevices.length, 3);
    const wire = deviceOf(world, WIRE);
    assert.equal(wire.name, 'Pelouse avant');
    assert.deepEqual(wire.params, [
      { name: 'SERIAL_NUMBER', value: WIRE },
      { name: 'MODEL', value: 'Landroid M 500 (WR141E)' },
    ]);
    // A mower without a name in the app is named by its serial number.
    assert.equal(deviceOf(world, OLD).name, OLD);

    const last = (serial, key) => fake.lastState(featureIdOf(world.gladys, serial, key));
    assert.equal(last(WIRE, 'status'), 'Charging');
    assert.equal(last(WIRE, 'error'), 'No error');
    assert.equal(last(WIRE, 'battery'), 87);
    assert.equal(last(WIRE, 'charging'), 1);
    assert.equal(last(WIRE, 'zone'), 2, 'lz 3 → mzv[3] = 1 → zone 2');
    assert.equal(last(WIRE, 'rain_delay'), 60);
    assert.equal(last(WIRE, 'blade_time'), 853, '51234 min → 853 h');
    assert.equal(last(WIRE, 'mowing_time'), 1005);
    assert.equal(last(WIRE, 'wifi'), 76, '-62 dBm');
    assert.equal(last(WIRE, 'schedule'), 1);
    assert.equal(last(VISION, 'status'), 'Mowing');
    assert.equal(last(VISION, 'mowing'), 1);
    assert.equal(last(VISION, 'zone'), 1);
    assert.equal(last(OLD, 'status'), 'Offline');
    assert.equal(last(OLD, 'mowing'), 0);

    // One MQTT connection, subscribed to the three mowers.
    assert.equal(world.broker.connections.length, 1);
    const [{ url, options }] = world.broker.connections;
    assert.equal(url, 'wss://iot.eu-west-1.worxlandroid.com/mqtt');
    assert.match(options.clientId, /^WX\/USER\/100001\/gladys\/[0-9a-f-]{36}$/);
    assert.match(
      options.username,
      /^gladys\?jwt=.+&x-amz-customauthorizer-name=''&x-amz-customauthorizer-signature=.+$/,
    );
    assert.equal(options.reconnectPeriod, 0);
    assert.equal(world.broker.live[0].subscriptions.size, 3);

    // The offline mower is unreachable; the others are on the cloud.
    const transport = (serial) =>
      fake.transports
        .filter((t) => t.device_external_id === deviceIdOf(world.gladys, serial))
        .at(-1);
    assert.equal(transport(OLD).transport, 'unreachable');
    assert.equal(transport(WIRE).transport, 'cloud');
    assert.equal(transport(WIRE).degraded, undefined);
  } finally {
    world.app.stop();
  }
});

test('the states follow the MQTT messages, only what changed is sent', async () => {
  const world = await createWorld();
  try {
    const { fake } = world.gladys;
    const before = fake.states.length;
    const payload = wirePayload();
    payload.dat.ls = 7;
    payload.dat.bt.p = 80;
    payload.dat.bt.c = 0;
    world.broker.push(WIRE_OUT, payload);
    await settle();

    const sent = fake.states
      .slice(before)
      .map((s) => s.device_feature_external_id.split(':').pop());
    assert.deepEqual(sent.sort(), ['battery', 'charging', 'mowing', 'status']);
    assert.equal(fake.lastState(featureIdOf(world.gladys, WIRE, 'status')), 'Mowing');
    assert.equal(fake.lastState(featureIdOf(world.gladys, WIRE, 'battery')), 80);

    // The same message again: nothing new.
    const after = fake.states.length;
    world.broker.push(WIRE_OUT, payload);
    await settle();
    assert.equal(fake.states.length, after);
  } finally {
    world.app.stop();
  }
});

test('a message may carry only dat: the configuration part is kept', async () => {
  const world = await createWorld();
  try {
    const { dat } = wirePayload();
    dat.rain = { s: 1, cnt: 90 };
    dat.le = 5;
    world.broker.push(WIRE_OUT, { dat });
    await settle();
    const last = (key) => world.gladys.fake.lastState(featureIdOf(world.gladys, WIRE, key));
    assert.equal(last('rain'), 1);
    assert.equal(last('rain_delay_remaining'), 90);
    assert.equal(last('rain_delay'), 60, 'cfg.rd kept from the previous payload');
    assert.equal(last('status'), 'Waiting after rain');
    assert.equal(last('error'), 'Raining');
  } finally {
    world.app.stop();
  }
});

test('the scene triggers fire on transitions only', async () => {
  const world = await createWorld();
  try {
    const { fake } = world.gladys;
    assert.deepEqual(fake.sceneEvents, [], 'nothing for the first state seen');

    // Leaves the base, mows for 42 minutes, gets trapped, then comes home.
    const payload = wirePayload();
    payload.dat.ls = 7;
    world.broker.push(WIRE_OUT, payload);
    await settle();
    payload.dat.le = 1;
    payload.dat.st.wt += 20;
    world.broker.push(WIRE_OUT, payload);
    await settle();
    world.broker.push(WIRE_OUT, payload); // the same error again: no new event
    await settle();
    payload.dat.le = 0;
    payload.dat.ls = 30;
    payload.dat.st.wt += 22;
    world.broker.push(WIRE_OUT, payload);
    await settle();
    payload.dat.ls = 1;
    payload.dat.bt.p = 21;
    world.broker.push(WIRE_OUT, payload);
    await settle();

    assert.deepEqual(fake.sceneEvents, [
      {
        key: 'mower_error',
        data: {
          device: deviceIdOf(world.gladys, WIRE),
          device_name: 'Pelouse avant',
          kind: 'trapped',
          code: 1,
          error: 'Trapped',
        },
      },
      {
        key: 'mowing_finished',
        data: {
          device: deviceIdOf(world.gladys, WIRE),
          device_name: 'Pelouse avant',
          duration_minutes: 42,
          battery: 21,
          rain: false,
        },
      },
    ]);

    // Rain is not a fault.
    payload.dat.le = 5;
    world.broker.push(WIRE_OUT, payload);
    await settle();
    assert.equal(fake.sceneEvents.length, 2);
  } finally {
    world.app.stop();
  }
});

test('the commands reach the mower in its protocol', async () => {
  const world = await createWorld();
  try {
    const { fake } = world.gladys;
    const wire = deviceOf(world, WIRE);
    const vision = deviceOf(world, VISION);

    assert.equal((await fake.setValue(wire, featureOf(world, WIRE, 'start'), 1)).success, true);
    assert.equal(
      (await fake.setValue(wire, featureOf(world, WIRE, 'rain_delay'), 100)).success,
      true,
    );
    assert.equal((await fake.setValue(wire, featureOf(world, WIRE, 'schedule'), 0)).success, true);
    assert.equal((await fake.setValue(wire, featureOf(world, WIRE, 'edge_cut'), 1)).success, true);
    assert.equal((await fake.setValue(vision, featureOf(world, VISION, 'home'), 1)).success, true);
    assert.equal(
      (await fake.setValue(vision, featureOf(world, VISION, 'rain_delay'), 30)).success,
      true,
    );
    assert.equal((await fake.setValue(vision, featureOf(world, VISION, 'lock'), 1)).success, true);
    assert.equal(
      (await fake.setValue(vision, featureOf(world, VISION, 'edge_cut'), 1)).success,
      true,
    );

    const sent = world.broker.published;
    assert.deepEqual(
      sent.map(({ topic, message }) => {
        const { id, tm, dt, sn, uuid, ...order } = message;
        assert.ok(id >= 1024 && id <= 65535);
        assert.ok(tm);
        if (topic === WIRE_IN) {
          assert.equal(sn, WIRE);
          assert.match(dt, /^\d{2}\/\d{2}\/\d{4}$/);
          assert.match(tm, /^\d{2}:\d{2}:\d{2}$/);
        } else {
          assert.equal(uuid, '6f1b2c3d-0000-4000-8000-00000000a1b2');
          assert.match(tm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        }
        return [topic, order];
      }),
      [
        [WIRE_IN, { cmd: 1 }],
        [WIRE_IN, { rd: 90 }], // rounded to the 30-minute step
        [WIRE_IN, { sc: { m: 0 } }],
        [WIRE_IN, { sc: { ots: { bc: 1, wtm: 0 } } }],
        [VISION_IN, { cmd: 3 }],
        [VISION_IN, { cfg: { rd: 30 } }],
        [VISION_IN, { cmd: 5 }],
        [VISION_IN, { cmd: 101 }],
      ],
    );
  } finally {
    world.app.stop();
  }
});

test('commands are refused, in the configured language, when they cannot be sent', async () => {
  const world = await createWorld({ config: { language: 'fr' } });
  try {
    const { fake } = world.gladys;
    // The old mower is offline.
    const old = deviceOf(world, OLD);
    const ack = await fake.setValue(old, featureOf(world, OLD, 'start'), 1);
    assert.deepEqual(ack, { success: false, error: 'La tondeuse est hors ligne.' });

    // The real-time link is down.
    world.broker.accept = false;
    world.broker.drop();
    await settle();
    const wire = deviceOf(world, WIRE);
    const down = await fake.setValue(wire, featureOf(world, WIRE, 'pause'), 1);
    assert.deepEqual(down, {
      success: false,
      error: 'Liaison temps réel coupée, réessayez plus tard.',
    });
    assert.equal(world.broker.published.length, 0);
    // The badge says the mower is now read every 30 minutes.
    const badge = fake.transports.filter((t) => t.device_external_id === wire.external_id).at(-1);
    assert.equal(badge.transport, 'cloud');
    assert.equal(badge.degraded, true);
  } finally {
    world.app.stop();
  }
});

test('the daily command budget of a mower is enforced, and survives a restart', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: false });
  const wire = deviceOf(world, WIRE);
  try {
    const sends = [];
    for (let i = 0; i < LIMITS.COMMANDS_PER_DAY; i += 1) {
      sends.push(world.gladys.fake.setValue(wire, featureOf(world, WIRE, 'pause'), 1));
      await settle(2);
      t.mock.timers.tick(LIMITS.COMMAND_SPACING_MS);
    }
    for (const ack of await Promise.all(sends)) assert.equal(ack.success, true);
    const refused = await world.gladys.fake.setValue(wire, featureOf(world, WIRE, 'pause'), 1);
    assert.deepEqual(refused, {
      success: false,
      error: 'Daily command limit reached for this mower.',
    });
    assert.equal(world.broker.published.length, LIMITS.COMMANDS_PER_DAY);
  } finally {
    world.app.stop();
  }
  // Same /data, new container: still refused.
  const again = await createWorld({ store: world.store, cloud: world.cloud });
  try {
    const refused = await again.gladys.fake.setValue(wire, featureOf(again, WIRE, 'start'), 1);
    assert.equal(refused.success, false);
  } finally {
    again.app.stop();
  }
});

test('two commands are spaced by 1.1 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const world = await createWorld();
  try {
    const wire = deviceOf(world, WIRE);
    const first = world.gladys.fake.setValue(wire, featureOf(world, WIRE, 'start'), 1);
    const second = world.gladys.fake.setValue(wire, featureOf(world, WIRE, 'pause'), 1);
    await settle();
    assert.equal(world.broker.published.length, 1);
    t.mock.timers.tick(LIMITS.COMMAND_SPACING_MS);
    await settle();
    assert.equal(world.broker.published.length, 2);
    assert.equal((await first).success, true);
    assert.equal((await second).success, true);
  } finally {
    world.app.stop();
  }
});

test('the mow_once scene action starts a one-time session', async () => {
  const world = await createWorld();
  try {
    const { fake } = world.gladys;
    const ok = await fake.sceneAction('mow_once', {
      device: deviceIdOf(world.gladys, VISION),
      duration: 45,
      edge: true,
    });
    assert.equal(ok.success, true);
    const ok2 = await fake.sceneAction('mow_once', {
      device: deviceIdOf(world.gladys, WIRE),
      duration: 90,
    });
    assert.equal(ok2.success, true);
    const orders = world.broker.published.map(({ message }) => {
      const { id: _i, tm: _t, dt: _d, sn: _s, uuid: _u, ...order } = message;
      return order;
    });
    assert.deepEqual(orders, [
      { cmd: 10, sc: { once: { cfg: { cut: { b: 1, z: [] } }, time: 45 } } },
      { sc: { ots: { bc: 0, wtm: 90 } } },
    ]);
    // The old mower has no one-time schedule.
    const refused = await fake.sceneAction('mow_once', {
      device: deviceIdOf(world.gladys, OLD),
      duration: 30,
    });
    assert.equal(refused.success, false);
    const tooLong = await fake.sceneAction('mow_once', {
      device: deviceIdOf(world.gladys, WIRE),
      duration: 900,
    });
    assert.equal(tooLong.success, false);
  } finally {
    world.app.stop();
  }
});

test('a mower added to Gladys gets all its states again', async () => {
  const world = await createWorld();
  try {
    const { fake } = world.gladys;
    const before = fake.states.length;
    await fake.deviceCreated(deviceOf(world, WIRE));
    await settle();
    const resent = fake.states.slice(before);
    assert.ok(resent.length >= 15, `only ${resent.length} states re-sent`);
    assert.ok(
      resent.every((s) => s.device_feature_external_id.startsWith(deviceIdOf(world.gladys, WIRE))),
    );
    assert.ok(fake.widgetRefreshes.includes('mower'));
  } finally {
    world.app.stop();
  }
});

test('the states refresh on the container timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const world = await createWorld({ timers: true });
  try {
    await createAll(world);
    const { fake } = world.gladys;
    const polls = fake.wsMessages.length;
    // The cloud changes, nothing pushed over MQTT (the link stays quiet).
    world.cloud.items[0].last_status.payload.dat.bt.p = 55;
    world.cloud.items[0].last_status.payload.dat.ls = 7;
    const reads = world.cloud.count('/api/v2/product-items');
    t.mock.timers.tick(LIMITS.REST_PERIOD_MS);
    await settle(10);
    assert.equal(world.cloud.count('/api/v2/product-items'), reads + 1);
    assert.equal(fake.lastState(featureIdOf(world.gladys, WIRE, 'battery')), 55);
    assert.equal(fake.lastState(featureIdOf(world.gladys, WIRE, 'status')), 'Mowing');
    assert.ok(!fake.requests.some((r) => r.path === '/poll'), 'no core poll involved');
    assert.equal(fake.wsMessages.length >= polls, true);
  } finally {
    world.app.stop();
  }
});

test('while MQTT is down, the cloud is read every 30 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const world = await createWorld({ timers: true, accept: false });
  try {
    const reads = world.cloud.count('/api/v2/product-items');
    t.mock.timers.tick(LIMITS.REST_FALLBACK_PERIOD_MS);
    await settle(10);
    assert.equal(world.cloud.count('/api/v2/product-items'), reads + 1);
  } finally {
    world.app.stop();
  }
});

test("the core's poll reads no cloud while the timer works", async () => {
  const world = await createWorld();
  try {
    const reads = world.cloud.count('/api/v2/product-items');
    const ack = await world.gladys.fake.poll(deviceOf(world, WIRE));
    assert.equal(ack.success, true);
    assert.equal(world.cloud.count('/api/v2/product-items'), reads);
  } finally {
    world.app.stop();
  }
});

test('the heartbeat re-sends an unchanged value after 6 hours', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const world = await createWorld({ timers: true });
  try {
    const id = featureIdOf(world.gladys, WIRE, 'battery');
    const count = () =>
      world.gladys.fake.states.filter((s) => s.device_feature_external_id === id).length;
    const first = count();
    for (let hour = 1; hour <= 6; hour += 1) {
      t.mock.timers.tick(LIMITS.REST_PERIOD_MS);
      await settle(10);
    }
    assert.equal(count(), first + 1, 'sent once again after 6 hours');
  } finally {
    world.app.stop();
  }
});

test('GPS is only published when the user turns it on', async () => {
  const off = await createWorld({ config: { brand: 'kress' }, items: FIXTURES.kress() });
  const on = await createWorld({
    config: { brand: 'kress', gps_enabled: true },
    items: FIXTURES.kress(),
  });
  try {
    const keys = (w) =>
      w.gladys.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
    assert.ok(!keys(off).includes('gps'));
    assert.ok(keys(on).includes('gps'));
    const serial = '20250000000000000004';
    assert.equal(
      on.gladys.fake.lastState(featureIdOf(on.gladys, serial, 'gps')),
      '45.000123, 1.000456',
    );
    // Kress counts the rain delay in seconds: 5400 s → 90 min.
    assert.equal(
      on.gladys.fake.lastState(featureIdOf(on.gladys, serial, 'rain_delay_remaining')),
      90,
    );
    assert.equal(
      on.gladys.fake.lastState(featureIdOf(on.gladys, serial, 'status')),
      'Waiting after rain',
    );
    assert.equal(on.gladys.fake.lastState(featureIdOf(on.gladys, serial, 'lock')), 1);
    assert.equal(on.broker.connections[0].url, 'wss://iot.eu-west-1.kress-robotik.com/mqtt');
    assert.match(on.broker.connections[0].options.clientId, /^KR\/USER\/100001\//);
  } finally {
    off.app.stop();
    on.app.stop();
  }
});

test('a mowing session is counted in the mowing time of the day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 14, 9, 0).getTime() });
  const world = await createWorld();
  try {
    const id = featureIdOf(world.gladys, VISION, 'mowing_today');
    assert.equal(world.gladys.fake.lastState(id), 0);
    const payload = visionPayload();
    payload.dat.st.wt += 75;
    world.broker.push(VISION_OUT, payload);
    await settle();
    assert.equal(world.gladys.fake.lastState(id), 75);
    // Next day: back to 0 until it mows again.
    t.mock.timers.setTime(new Date(2026, 9, 15, 9, 0).getTime());
    world.broker.push(VISION_OUT, payload);
    await settle();
    assert.equal(world.gladys.fake.lastState(id), 0);
  } finally {
    world.app.stop();
  }
});

test('the widget shows the state and the three buttons', async () => {
  const world = await createWorld();
  try {
    const { validateWidgetContent } = await import('@gladysassistant/integration-sdk');
    const ack = await world.gladys.fake.widgetGet('mower', {
      settings: { device: deviceIdOf(world.gladys, WIRE) },
      language: 'de',
    });
    assert.equal(ack.success, true);
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), []);
    const status = content.components.find((c) => c.type === 'status');
    assert.equal(status.items[0].value, 'Lädt');
    const buttons = content.components.filter((c) => c.type === 'button');
    assert.deepEqual(
      buttons.map((b) => b.device_feature.split(':').pop()),
      ['start', 'pause', 'home', 'edge_cut'],
    );
    // Every linked feature exists on the discovered device.
    const features = new Set(deviceOf(world, WIRE).features.map((f) => f.external_id));
    for (const c of content.components.filter((c) => c.device_feature)) {
      assert.ok(features.has(c.device_feature), c.device_feature);
    }

    // A tap on a button goes through onSetValue.
    const ack2 = await world.gladys.fake.setValue(
      deviceOf(world, WIRE),
      { external_id: buttons[0].device_feature },
      1,
    );
    assert.equal(ack2.success, true);

    const empty = await world.gladys.fake.widgetGet('mower', { settings: {}, language: 'es' });
    assert.deepEqual(validateWidgetContent(empty.data.content), []);
    assert.equal(
      empty.data.content.components[0].text,
      'Elija un robot en los ajustes del widget.',
    );

    // An error shows in red, with its text.
    const payload = wirePayload();
    payload.dat.ls = 0;
    payload.dat.le = 2;
    world.broker.push(WIRE_OUT, payload);
    await settle();
    const errored = await world.gladys.fake.widgetGet('mower', {
      settings: { device: deviceIdOf(world.gladys, WIRE) },
      language: 'fr',
    });
    const rows = errored.data.content.components.find((c) => c.type === 'status').items;
    assert.deepEqual(
      rows.map((r) => r.value),
      ['Erreur', 'Soulevée'],
    );
    assert.ok(world.gladys.fake.widgetRefreshes.includes('mower'));
  } finally {
    world.app.stop();
  }
});

test('the check action reports the mowers and the link', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.action('check_connection');
    assert.equal(ack.success, true);
    assert.match(
      ack.data.message.en,
      /^3 mower\(s\), 2 online: Pelouse avant, Jardin, 2018.*Real-time link: up\. Commands left today: 50\.$/,
    );
    assert.match(ack.data.message.de, /Echtzeitverbindung: aktiv/);
  } finally {
    world.app.stop();
  }
});

test('a mower removed from the account disappears from the discovery', async () => {
  const world = await createWorld();
  try {
    world.cloud.items.splice(2, 1);
    await world.hub.refreshNow();
    assert.equal(world.gladys.fake.discoveredDevices.length, 2);
  } finally {
    world.app.stop();
  }
});

test('an account without mower says so', async () => {
  const world = await createWorld({ items: [] });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.en, /No mower on this account/);
    assert.equal(world.broker.connections.length, 0, 'no MQTT without a mower');
  } finally {
    world.app.stop();
  }
});

test('without credentials, the integration waits for them', async () => {
  const world = await createWorld({ config: { email: '', password: '' } });
  try {
    assert.equal(world.cloud.requests.length, 0);
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.fr, /Saisissez/);
    // The user fills them in.
    await world.gladys.fake.configUpdated({
      email: 'gardener@example.com',
      password: 'very-secret-password',
    });
    await settle();
    assert.equal(world.gladys.fake.connectionStatus.connected, true);
    assert.equal(world.gladys.fake.discoveredDevices.length, 3);
  } finally {
    world.app.stop();
  }
});

test('a reconnection to Gladys opens no new cloud session', async () => {
  const world = await createWorld();
  try {
    const requests = world.cloud.requests.length;
    await world.gladys.disconnect();
    await world.gladys.connect();
    await settle();
    assert.equal(world.cloud.requests.length, requests);
    assert.equal(world.broker.connections.length, 1);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    world.app.stop();
  }
});
