// -----------------------------------------------------------------------------
// The real-time link: MQTT over secure WebSocket to the vendor's AWS IoT
// broker (`mqtt_endpoint` of the product items, e.g. iot.eu-west-1.worxlandroid.com).
//
// AWS IoT authenticates the connection with a "custom authorizer": the OAuth
// access token travels in the MQTT username, split at its dots (header and
// payload as `jwt`, the signature apart), base64url turned back to base64.
// The mower publishes its state on `mqtt_topics.command_out` and listens to
// `mqtt_topics.command_in`.
//
// Reconnection is ours (mqtt.js `reconnectPeriod: 0`): every attempt builds a
// new client with a fresh token, and the delay grows from one minute to 30
// minutes — connecting in a loop is what gets an account banned.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { LIMITS } from './limits.js';

const logger = createLogger({ name: 'mqtt' });

/** A connection shorter than this does not reset the backoff. */
const STABLE_AFTER_MS = 5 * 60 * 1000;
const AUTHORIZER_NAME = "''";

/** Python's `urllib.parse.quote`: like encodeURIComponent, but keeps `/`. */
const quote = (value) => encodeURIComponent(value).replace(/%2F/gi, '/');

/**
 * The MQTT username carrying the token for the AWS IoT custom authorizer.
 * @param {string} accessToken a JWT
 */
export function buildUsername(accessToken) {
  const [header = '', payload = '', signature = ''] = accessToken
    .replace(/_/g, '/')
    .replace(/-/g, '+')
    .split('.');
  return (
    `gladys?jwt=${quote(header)}.${quote(payload)}` +
    `&x-amz-customauthorizer-name=${AUTHORIZER_NAME}` +
    `&x-amz-customauthorizer-signature=${quote(signature)}`
  );
}

/** The reason of an MQTT failure, safe to log (no username, no token). */
function describe(err) {
  if (!err) return 'connection closed';
  const code = err.code !== undefined ? ` (${err.code})` : '';
  return `${String(err.message ?? err).slice(0, 120)}${code}`;
}

const isAuthRefusal = (err) =>
  err?.code === 4 ||
  err?.code === 5 ||
  /not authori[sz]ed|bad user ?name/i.test(err?.message ?? '');

/**
 * @param {object} options
 * @param {(url: string, options: object) => import('mqtt').MqttClient} options.connect mqtt.connect
 * @param {() => Promise<string>} options.getToken a valid access token
 * @param {() => void} [options.onAuthRefused] the broker refused the token
 * @param {() => { endpoint: string, clientId: string, topics: string[] } | null} options.target
 * @param {(topic: string, message: object) => void} options.onMessage
 * @param {(connected: boolean, reason?: string) => void} options.onState
 * @param {boolean} [options.timers] schedule the reconnections (tests drive them by hand)
 * @param {() => number} [options.now]
 */
export function createMqttLink({
  connect,
  getToken,
  onAuthRefused = () => {},
  target,
  onMessage,
  onState,
  timers = true,
  now = () => Date.now(),
}) {
  let client = null;
  let connected = false;
  let connectedAt = 0;
  let retryDelay = LIMITS.MQTT_RETRY_MIN_MS;
  let retryTimer = null;
  let stopped = true;
  let subscribed = new Set();
  let lastError = null;

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (stopped || !timers) {
      return;
    }
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, LIMITS.MQTT_RETRY_MAX_MS);
    logger.debug(`next MQTT attempt in ${Math.round(delay / 1000)} s`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attempt().catch(() => {});
    }, delay);
    retryTimer.unref?.();
  }

  function drop(reason) {
    const current = client;
    client = null;
    subscribed = new Set();
    if (current) {
      current.removeAllListeners();
      current.on('error', () => {});
      current.end(true);
    }
    if (connected) {
      connected = false;
      // A long connection that drops (token expiry, network) retries soon.
      if (now() - connectedAt >= STABLE_AFTER_MS) {
        retryDelay = LIMITS.MQTT_RETRY_MIN_MS;
      }
      // A stop is wanted, not a loss: nothing to report.
      if (!stopped) onState(false, reason);
    }
  }

  async function subscribe(topics) {
    const fresh = topics.filter((topic) => topic && !subscribed.has(topic));
    if (!client || !connected || fresh.length === 0) {
      return;
    }
    fresh.forEach((topic) => subscribed.add(topic));
    await new Promise((resolve) => {
      client.subscribe(fresh, { qos: 1 }, (err) => {
        if (err) {
          fresh.forEach((topic) => subscribed.delete(topic));
          logger.debug(`subscription refused: ${describe(err)}`);
        }
        resolve();
      });
    });
  }

  async function attempt() {
    if (stopped || client) {
      return;
    }
    const where = target();
    if (!where?.endpoint) {
      return;
    }
    let token;
    try {
      token = await getToken();
    } catch (err) {
      lastError = err.message;
      onState(false, `no token (${err.message})`);
      scheduleRetry();
      return;
    }
    if (stopped || client) {
      return;
    }
    logger.debug(`connecting to ${where.endpoint}`);
    const current = connect(`wss://${where.endpoint}/mqtt`, {
      clientId: where.clientId,
      username: buildUsername(token),
      clean: false,
      keepalive: 30,
      protocolVersion: 4,
      reconnectPeriod: 0,
      connectTimeout: 30_000,
    });
    client = current;
    current.on('connect', () => {
      if (client !== current) return;
      connected = true;
      connectedAt = now();
      lastError = null;
      onState(true);
      subscribe(target()?.topics ?? []).catch(() => {});
    });
    current.on('message', (topic, buffer) => {
      if (client !== current) return;
      let message;
      try {
        message = JSON.parse(buffer.toString('utf8'));
      } catch {
        logger.debug(`unreadable message on ${topic}`);
        return;
      }
      onMessage(topic, message);
    });
    current.on('error', (err) => {
      if (client !== current) return;
      lastError = describe(err);
      if (isAuthRefusal(err)) {
        onAuthRefused();
      }
    });
    current.on('close', () => {
      if (client !== current) return;
      const reason = lastError ?? 'connection closed';
      const wasConnected = connected;
      drop(reason);
      if (!wasConnected) {
        // A failed attempt: reported too, the caller logs it once.
        onState(false, reason);
      }
      scheduleRetry();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      retryDelay = LIMITS.MQTT_RETRY_MIN_MS;
      attempt().catch(() => {});
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      retryTimer = null;
      drop('stopped');
    },
    /** New mowers: subscribe to their topics on the live connection. */
    refreshTopics() {
      return subscribe(target()?.topics ?? []);
    },
    /** Retry now (tests, or a configuration that just changed). */
    retryNow() {
      clearTimeout(retryTimer);
      retryTimer = null;
      return attempt();
    },
    /**
     * Publishes one order (QoS 1); rejects when the link is down.
     * @param {string} topic
     * @param {object} message
     */
    publish(topic, message) {
      if (!client || !connected) {
        return Promise.reject(new Error('real-time link down'));
      }
      return new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(message), { qos: 1 }, (err) =>
          err ? reject(new Error(describe(err))) : resolve(),
        );
      });
    },
    get connected() {
      return connected;
    },
    get lastError() {
      return lastError;
    },
  };
}
