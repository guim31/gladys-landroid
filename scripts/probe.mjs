#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of the real Positec cloud, for a machine that has network.
//
//   node scripts/probe.mjs                     a fake account: expects a clean refusal
//   WORX_EMAIL=… WORX_PASSWORD=… [WORX_BRAND=worx|kress|landxcape] node scripts/probe.mjs
//
// With a real account it logs in once, lists the mowers, listens to MQTT for
// up to 60 seconds, and prints what the integration would decode. It sends no
// command and writes nothing to disk. It never prints the e-mail, a token, a
// serial number, a MAC address or a position: only the shape of the answers.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { createApi } from '../src/worx/api.js';
import { createLimiter } from '../src/worx/limits.js';
import { createSession } from '../src/worx/session.js';
import { createMqttLink } from '../src/worx/mqtt.js';
import { decodeStatus, parseMower } from '../src/worx/mower.js';
import { MemoryStore } from '../src/store.js';

const brand = process.env.WORX_BRAND ?? 'worx';
const real = Boolean(process.env.WORX_EMAIL && process.env.WORX_PASSWORD);
const config = {
  brand,
  email: process.env.WORX_EMAIL ?? 'probe@example.invalid',
  password: process.env.WORX_PASSWORD ?? 'not-a-real-password',
};

const store = new MemoryStore();
const api = createApi({ brand });
const session = createSession({ api, config, store, limiter: createLimiter({ store }) });
const say = (...args) => console.log('[probe]', ...args);

say(`brand ${brand}, ${real ? 'real account' : 'fake account (a refusal is expected)'}`);
try {
  await session.accessToken();
  say('login: accepted');
} catch (err) {
  say(`login: refused — kind "${err.kind}", ${err.message}`);
  if (err.kind === 'network' || err.kind === 'server') {
    say('NOT TESTED: the cloud cannot be reached from this machine');
    process.exit(2);
  }
  if (real) {
    say('FAIL: check the account in the vendor app');
    process.exit(1);
  }
  say(err.kind === 'credentials' ? 'OK: the refusal is clean' : 'UNEXPECTED refusal');
  process.exit(err.kind === 'credentials' ? 0 : 1);
}
if (!real) {
  say('UNEXPECTED: a fake account was accepted');
  process.exit(1);
}

const items = await session.request((token) => api.productItems(token));
say(`product-items: ${items.length} mower(s)`);
const catalog = await session.request((token) => api.products(token)).catch(() => []);
const products = new Map(catalog.map((p) => [p.id, p]));
const mowers = items.map((item) => parseMower(item, products));
for (const [i, mower] of mowers.entries()) {
  const s = decodeStatus(mower.payload, mower, { brand });
  say(
    `mower #${i + 1}: model ${mower.model ?? '?'}, protocol ${mower.protocol}, online ${mower.online}`,
  );
  say(
    `  topics present: in ${Boolean(mower.topics.in)}, out ${Boolean(mower.topics.out)}, endpoint ${mower.endpoint}`,
  );
  say(`  cfg keys: ${Object.keys(mower.payload.cfg).sort().join(',')}`);
  say(`  dat keys: ${Object.keys(mower.payload.dat).sort().join(',')}`);
  say(
    `  decoded: status ${s.statusCode}, error ${s.errorCode}, battery ${s.battery}, charging ${s.charging},`,
  );
  say(
    `           rain ${s.rainDetected}/${s.rainRemaining} min, delay ${s.rainDelay}, zone ${s.zone},`,
  );
  say(
    `           schedule ${s.scheduleEnabled}, lock ${s.locked}, edge cut ${s.canEdgeCut}, gps ${s.gps ? 'yes' : 'no'}`,
  );
}

const first = mowers.find((m) => m.endpoint && m.userId !== null);
if (!first) {
  say('no MQTT endpoint in the answer: real-time link not tested');
  process.exit(0);
}
let received = 0;
const link = createMqttLink({
  connect: (url, options) => mqtt.connect(url, options),
  getToken: () => session.accessToken(),
  target: () => ({
    endpoint: first.endpoint,
    clientId: `${api.cloud.mqttPrefix}/USER/${first.userId}/gladys/${randomUUID()}`,
    topics: mowers.map((m) => m.topics.out).filter(Boolean),
  }),
  onMessage: (_topic, message) => {
    received += 1;
    say(`MQTT message: cfg ${Boolean(message.cfg)}, dat ${Boolean(message.dat)}`);
  },
  onState: (connected, reason) => say(`MQTT ${connected ? 'connected' : `down (${reason})`}`),
  timers: false,
});
link.start();
await new Promise((resolve) => setTimeout(resolve, 60_000));
link.stop();
say(`MQTT: ${received} message(s) in 60 s (a mower at rest may send none)`);
process.exit(0);
