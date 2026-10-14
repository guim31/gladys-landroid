// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake cloud, a fake broker,
// a store in memory, and the integration wired on top (src/app.js).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { EMAIL, PASSWORD, createFakeBroker, createFakeCloud } from './fakeCloud.js';

// The integration logs its lifecycle; keep the test output readable.
// LOG_LEVEL=debug npm test shows everything.
process.env.LOG_LEVEL ??= 'silent';

/** Lets the pending immediates and promises run (MQTT connect, subscribe...). */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export const baseConfig = { email: EMAIL, password: PASSWORD, language: 'en' };

/**
 * @param {object} [options]
 * @param {object} [options.config] raw config (merged on baseConfig)
 * @param {object[]} [options.items] product items served by the cloud
 * @param {object} [options.cloud] an existing fake cloud
 * @param {object} [options.store] an existing store (a "restart")
 * @param {object[]} [options.devices] devices already created in Gladys
 * @param {boolean} [options.accept] the broker accepts the connection
 * @param {boolean} [options.timers]
 */
export async function createWorld({
  config = {},
  items,
  cloud = createFakeCloud(items ? { items } : {}),
  store = new MemoryStore(),
  devices = [],
  accept = true,
  timers = false,
  connect = true,
} = {}) {
  const broker = createFakeBroker({ accept });
  const gladys = createFakeGladys({ config: { ...baseConfig, ...config }, devices });
  const app = registerHandlers(gladys, {
    store,
    fetch: cloud.fetch,
    mqttConnect: broker.connect,
    timers,
  });
  if (connect) {
    await gladys.connect();
    await settle();
  }
  return { gladys, cloud, broker, store, app, hub: app.hub };
}

/** The external id of a mower device. */
export const deviceIdOf = (gladys, serial) => gladys.externalIds('mower', serial).device;

/** The external id of a mower feature. */
export const featureIdOf = (gladys, serial, key) =>
  gladys.externalIds('mower', serial).feature(key);

/** Create every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
  await settle();
}
