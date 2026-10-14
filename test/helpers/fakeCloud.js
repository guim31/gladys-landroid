// -----------------------------------------------------------------------------
// A fake Positec cloud (REST) and a fake AWS IoT broker (MQTT), in memory.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/worx/${name}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  items: () => fixture('product-items.json'),
  kress: () => fixture('product-items-kress.json'),
  products: () => fixture('products.json'),
};

export const EMAIL = 'gardener@example.com';
export const PASSWORD = 'very-secret-password';

/** A JWT-shaped token: three base64url parts. */
const jwt = (n) =>
  `eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMDAwMDEiLCJuIjo${n}fQ.c2lnbmF0dXJlLV8tcGFydA${n}`;

/**
 * @param {object} [options]
 * @param {object[]} [options.items] the product items served
 * @param {string} [options.email]
 * @param {string} [options.password]
 */
export function createFakeCloud({
  items = FIXTURES.items(),
  email = EMAIL,
  password = PASSWORD,
} = {}) {
  let issued = 0;
  const cloud = {
    items,
    products: FIXTURES.products(),
    requests: [],
    /** Next answers to force, by path: [{ status, headers }]. */
    failures: {},
    validTokens: new Set(),
    refreshTokens: new Set(),
    expiresIn: 3600,
    down: false,

    async fetch(url, init = {}) {
      const { pathname, hostname } = new URL(url);
      const body = init.body ? JSON.parse(init.body) : undefined;
      cloud.requests.push({ method: init.method ?? 'GET', host: hostname, path: pathname, body });
      if (cloud.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      const forced = cloud.failures[pathname]?.shift();
      if (forced) {
        return answer(forced.status, { error: 'forced' }, forced.headers);
      }
      if (pathname === '/oauth/token') {
        if (body.grant_type === 'password') {
          if (body.username !== email || body.password !== password) {
            return answer(401, { error: 'invalid_grant' });
          }
        } else if (!cloud.refreshTokens.has(body.refresh_token)) {
          return answer(400, { error: 'invalid_grant' });
        }
        issued += 1;
        const access = jwt(issued);
        const refresh = `refresh-${issued}`;
        cloud.validTokens.add(access);
        cloud.refreshTokens.add(refresh);
        return answer(200, {
          token_type: 'Bearer',
          expires_in: cloud.expiresIn,
          access_token: access,
          refresh_token: refresh,
        });
      }
      const token = init.headers?.Authorization?.replace(/^Bearer /, '');
      if (!cloud.validTokens.has(token)) {
        return answer(401, { message: 'Unauthenticated.' });
      }
      if (pathname === '/api/v2/product-items') {
        return answer(200, structuredClone(cloud.items));
      }
      if (pathname === '/api/v2/products') {
        return answer(200, cloud.products);
      }
      return answer(404, {});
    },

    count(path) {
      return cloud.requests.filter((r) => r.path === path).length;
    },
    logins() {
      return cloud.requests.filter(
        (r) => r.path === '/oauth/token' && r.body.grant_type === 'password',
      ).length;
    },
  };
  cloud.fetch = cloud.fetch.bind(cloud);
  return cloud;
}

function answer(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    json: async () => body,
  };
}

/**
 * A fake broker: `connect` stands for mqtt.connect.
 * @param {{ accept?: boolean }} [options]
 */
export function createFakeBroker({ accept = true } = {}) {
  const broker = {
    accept,
    connections: [],
    published: [],
    clients: [],

    connect(url, options) {
      const client = new EventEmitter();
      client.subscriptions = new Set();
      client.ended = false;
      client.subscribe = (topics, _opts, cb) => {
        topics.forEach((t) => client.subscriptions.add(t));
        cb?.(null);
      };
      client.publish = (topic, payload, _opts, cb) => {
        broker.published.push({ topic, message: JSON.parse(payload) });
        cb?.(null);
      };
      client.end = () => {
        client.ended = true;
      };
      broker.connections.push({ url, options });
      broker.clients.push(client);
      setImmediate(() => {
        if (broker.accept) {
          client.emit('connect');
        } else {
          client.emit(
            'error',
            Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }),
          );
          client.emit('close');
        }
      });
      return client;
    },

    /** The mower pushes a message on its command_out topic. */
    push(topic, message) {
      for (const client of broker.clients) {
        if (!client.ended && client.subscriptions.has(topic)) {
          client.emit('message', topic, Buffer.from(JSON.stringify(message)));
        }
      }
    },

    /** The broker drops the live connection. */
    drop() {
      for (const client of broker.clients) {
        if (!client.ended) client.emit('close');
      }
    },

    get live() {
      return broker.clients.filter((c) => !c.ended);
    },
  };
  broker.connect = broker.connect.bind(broker);
  return broker;
}
