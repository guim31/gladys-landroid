// -----------------------------------------------------------------------------
// The cloud session: tokens reused across restarts, refreshed rather than
// re-logged, and every guard that keeps the account out of a ban.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, parseRetryAfter } from '../src/worx/api.js';
import { createLimiter, LIMITS } from '../src/worx/limits.js';
import { accountKey, createSession } from '../src/worx/session.js';
import { MemoryStore } from '../src/store.js';
import { EMAIL, PASSWORD, createFakeCloud } from './helpers/fakeCloud.js';
import { createWorld } from './helpers/world.js';

function setup({ store = new MemoryStore(), cloud = createFakeCloud(), config = {}, now } = {}) {
  const clock = now ?? (() => Date.now());
  const full = { brand: 'worx', email: EMAIL, password: PASSWORD, ...config };
  const api = createApi({ brand: full.brand, fetch: cloud.fetch });
  const limiter = createLimiter({ store, now: clock });
  const session = createSession({ api, config: full, store, limiter, now: clock });
  return { session, api, cloud, store };
}

test('the login uses the password grant of the vendor app', async () => {
  const { session, cloud } = setup();
  const token = await session.accessToken();
  assert.match(token, /^eyJ/);
  const [login] = cloud.requests;
  assert.equal(login.host, 'id.worx.com');
  assert.deepEqual(login.body, {
    client_id: '150da4d2-bb44-433b-9429-3773adc70a2a',
    scope: '*',
    grant_type: 'password',
    username: EMAIL,
    password: PASSWORD,
  });
});

test('the tokens survive a restart, and the e-mail is not stored in clear', async () => {
  const store = new MemoryStore();
  const cloud = createFakeCloud();
  await setup({ store, cloud }).session.accessToken();
  const saved = JSON.stringify(store.read('session.json'));
  assert.ok(!saved.includes(EMAIL));
  assert.ok(!saved.includes(PASSWORD));
  assert.equal(store.read('session.json').account, accountKey('worx', EMAIL));

  // A new container on the same /data: no new login.
  await setup({ store, cloud }).session.accessToken();
  assert.equal(cloud.logins(), 1);

  // Another account: its own login.
  await setup({ store, cloud, config: { email: 'other@example.com' } })
    .session.accessToken()
    .catch(() => {});
  assert.equal(cloud.logins(), 2);
});

test('an expired token is refreshed, not re-logged', async () => {
  let clock = 1_000_000;
  const { session, cloud } = setup({ now: () => clock });
  await session.accessToken();
  clock += 3600 * 1000;
  await session.accessToken();
  assert.equal(cloud.logins(), 1);
  const refresh = cloud.requests.at(-1);
  assert.equal(refresh.body.grant_type, 'refresh_token');
  assert.equal(refresh.body.password, undefined);
});

test('a token refused by the API is refreshed and the call retried once', async () => {
  const { session, api, cloud } = setup();
  await session.accessToken();
  cloud.validTokens.clear();
  const items = await session.request((token) => api.productItems(token));
  assert.equal(items.length, 3);
  assert.equal(cloud.logins(), 1);
});

test('a refused password stops the logins until the configuration changes', async () => {
  const store = new MemoryStore();
  const cloud = createFakeCloud();
  const { session } = setup({ store, cloud, config: { password: 'wrong' } });
  await assert.rejects(session.accessToken(), { kind: 'credentials' });
  await assert.rejects(session.accessToken(), { kind: 'credentials' });
  await assert.rejects(session.accessToken(), { kind: 'credentials' });
  assert.equal(cloud.logins(), 1);
});

test('the integration shows a refused password and does not retry it', async () => {
  const world = await createWorld({ config: { password: 'wrong' } });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.en, /refused the e-mail or password/);
    await world.hub.refreshNow();
    await world.hub.refreshNow();
    assert.equal(world.cloud.logins(), 1);
    assert.equal(world.broker.connections.length, 0);
  } finally {
    world.app.stop();
  }
});

test('the password logins are capped per day', async () => {
  const store = new MemoryStore();
  const cloud = createFakeCloud();
  let clock = 1_000_000;
  for (let i = 0; i < LIMITS.LOGINS_PER_DAY + 2; i += 1) {
    // A fresh store copy without tokens, same limits: every start must log in.
    store.write('session.json', {});
    const { session } = setup({ store, cloud, now: () => clock });
    await session.accessToken().catch(() => {});
    clock += 60_000;
  }
  assert.equal(cloud.logins(), LIMITS.LOGINS_PER_DAY);
});

test('a 429 pauses every request, longer at each new one', async () => {
  let clock = 1_000_000;
  const store = new MemoryStore();
  const cloud = createFakeCloud();
  const { session, api } = setup({ store, cloud, now: () => clock });
  await session.accessToken();
  cloud.failures['/api/v2/product-items'] = [{ status: 429 }];
  await assert.rejects(
    session.request((t) => api.productItems(t)),
    { kind: 'rate_limit' },
  );
  const count = cloud.requests.length;
  await assert.rejects(
    session.request((t) => api.productItems(t)),
    { kind: 'rate_limit' },
  );
  assert.equal(cloud.requests.length, count, 'nothing sent while paused');
  assert.equal(session.blockedUntil, clock + LIMITS.BAN_BACKOFF_MS);

  // The pause survives a restart.
  const again = setup({ store, cloud, now: () => clock }).session;
  assert.equal(again.blockedUntil, clock + LIMITS.BAN_BACKOFF_MS);

  // After the pause: a new 429 doubles it.
  clock += LIMITS.BAN_BACKOFF_MS + 1;
  cloud.failures['/api/v2/product-items'] = [{ status: 429 }];
  await assert.rejects(session.request((t) => api.productItems(t)));
  assert.equal(session.blockedUntil, clock + 2 * LIMITS.BAN_BACKOFF_MS);
});

test('a Retry-After header sets the pause', async () => {
  let clock = 1_000_000;
  const { session, api, cloud } = setup({ now: () => clock });
  await session.accessToken();
  cloud.failures['/api/v2/product-items'] = [{ status: 429, headers: { 'retry-after': '120' } }];
  await assert.rejects(session.request((t) => api.productItems(t)));
  assert.equal(session.blockedUntil, clock + 120_000);
  assert.equal(
    parseRetryAfter('Wed, 14 Oct 2026 10:00:00 GMT', Date.parse('2026-10-14T09:59:00Z')),
    60_000,
  );
  assert.equal(parseRetryAfter(undefined), undefined);
});

test('the daily request budget is enforced', async () => {
  let clock = 1_000_000;
  const { session, api, cloud } = setup({ now: () => clock });
  for (let i = 0; i < LIMITS.REST_REQUESTS_PER_DAY + 5; i += 1) {
    await session.request((t) => api.productItems(t)).catch(() => {});
    clock += 1000;
  }
  assert.ok(cloud.requests.length <= LIMITS.REST_REQUESTS_PER_DAY);
  await assert.rejects(
    session.request((t) => api.productItems(t)),
    /daily request budget/,
  );
  // A day later, the budget is back.
  clock += 24 * 60 * 60 * 1000;
  await session.request((t) => api.productItems(t));
});

test('a cloud that cannot be reached is a network error, without secret', async () => {
  const cloud = createFakeCloud();
  cloud.down = true;
  const { session } = setup({ cloud });
  await assert.rejects(session.accessToken(), (err) => {
    assert.equal(err.kind, 'network');
    assert.ok(!err.message.includes(PASSWORD));
    assert.ok(!err.message.includes(EMAIL));
    return true;
  });
});
