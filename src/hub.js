// -----------------------------------------------------------------------------
// The hub: the account's mowers, kept up to date and published to Gladys.
//
// Two sources feed it:
//   - MQTT (src/worx/mqtt.js), real time: the mowers push every change;
//   - REST, on the container's own timer (Gladys#3198: the core's poll cannot
//     be trusted): every hour while MQTT works, every 30 minutes when it does
//     not. Also the source of the account's mower list and of `online`.
// The core's onPoll stays as a fallback that reads the cloud only when the
// timer has stalled.
//
// Every state goes through publishChangedStates (only the changes, plus a
// 6-hour heartbeat so a stable value never looks stale in Gladys).
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import {
  buildDevice,
  computeStates,
  featureKeys,
  mowerIds,
  statusKey,
  F,
  RAIN_DELAY_MAX,
  RAIN_DELAY_STEP,
} from './devices.js';
import { createDailyTracker } from './daily.js';
import { COMMAND_ERRORS, MESSAGES, TRANSPORT_TEXT, checkReport } from './i18n.js';
import { createIssueLog } from './issues.js';
import { createTriggerTracker } from './triggers.js';
import { ERROR_KINDS, WorxError, createApi } from './worx/api.js';
import { LIMITS, createLimiter } from './worx/limits.js';
import { createMqttLink } from './worx/mqtt.js';
import {
  ORDERS,
  decodeStatus,
  envelope,
  identifiersOf,
  mergePayload,
  parseMower,
} from './worx/mower.js';
import { createSession } from './worx/session.js';

const logger = createLogger({ name: 'hub' });

export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 15_000;
export const WIDGET_KEY = 'mower';

/** An error whose message Gladys shows as is: the user's language. */
export class UserError extends Error {
  constructor(texts, language) {
    super(texts[language] ?? texts.en);
    this.name = 'UserError';
    this.texts = texts;
  }
}

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {object} options.store /data store
 * @param {typeof fetch} [options.fetch]
 * @param {Function} [options.mqttConnect] mqtt.connect
 * @param {boolean} [options.timers] run the timers (tests drive them by hand)
 * @param {() => number} [options.now]
 */
export function createHub({
  gladys,
  store,
  fetch,
  mqttConnect,
  timers = true,
  now = () => Date.now(),
}) {
  const issues = createIssueLog(logger);
  const limiter = createLimiter({ store, now });
  const daily = createDailyTracker({ store, now });
  const triggers = createTriggerTracker();
  const clientUuid = store.read('client.json', null)?.uuid ?? randomUUID();
  store.write('client.json', { uuid: clientUuid });

  let config = null;
  let api = null;
  let session = null;
  let account = null;
  let link = null;
  let products = null;
  /** serial → { mower, payload, status, mqttAt, lastStatusKey, lastTransport } */
  const mowers = new Map();
  let lastRestAt = 0;
  let restTimer = null;
  let generation = 0;
  let devicesSignature = null;
  let connectionKey = null;
  let lastConnection = [false, MESSAGES.notConfigured];
  let everConnectedCloud = false;
  let everConnectedMqtt = false;
  let lastCommandAt = 0;
  let commandChain = Promise.resolve();

  const language = () => config?.language ?? 'fr';
  const restPeriod = () =>
    link?.connected ? LIMITS.REST_PERIOD_MS : LIMITS.REST_FALLBACK_PERIOD_MS;

  async function setConnection(connected, message) {
    lastConnection = [connected, message];
    const key = connected ? 'ok' : JSON.stringify(message);
    if (key === connectionKey) return;
    connectionKey = key;
    await gladys.setConnectionStatus(connected, message).catch((err) => {
      logger.debug(`connection status not sent: ${err.message}`);
    });
  }

  // --- Publication ------------------------------------------------------------

  async function publishDevices({ force = false } = {}) {
    const devices = [...mowers.values()].map((entry) =>
      buildDevice(gladys, entry.mower, entry.status, config),
    );
    const signature = JSON.stringify(devices);
    if (!force && signature === devicesSignature) return;
    await gladys.publishDiscoveredDevices(devices);
    devicesSignature = signature;
  }

  async function publishTransport(entry) {
    const transport = !entry.mower.online ? 'unreachable' : 'cloud';
    const degraded = entry.mower.online && !link?.connected;
    const key = `${transport}:${degraded}`;
    if (key === entry.lastTransport) return;
    const item = { external_id: mowerIds(gladys, entry.mower).device, transport };
    if (degraded) {
      item.degraded = true;
      item.message = TRANSPORT_TEXT.degraded;
    }
    try {
      await gladys.publishTransports([item]);
      entry.lastTransport = key;
    } catch (err) {
      logger.debug(`transport badge not sent: ${err.message}`);
    }
  }

  /** Decodes, publishes the changed states, fires the triggers of one mower. */
  async function processMower(entry) {
    const { mower } = entry;
    entry.status = decodeStatus(entry.payload, mower, { brand: config.brand });
    const deviceId = mowerIds(gladys, mower).device;
    const mowingToday = daily.update(mower.serial, entry.status.workMinutes);
    const states = computeStates(gladys, mower, entry.status, config, { mowingToday });

    const keysChanged =
      JSON.stringify(featureKeys(mower, entry.status, config)) !== entry.featureKeys;
    entry.featureKeys = JSON.stringify(featureKeys(mower, entry.status, config));
    if (keysChanged && entry.published) {
      // A feature appeared (GPS turned on, rain sensor reported): Gladys
      // offers "Update" in Discovery.
      await publishDevices().catch((err) =>
        issues.fail('devices', `devices not published: ${err.message}`),
      );
    }
    entry.published = true;

    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      issues.ok('states', 'states accepted again by Gladys');
    } catch (err) {
      issues.fail('states', `states not published: ${err.message}`);
    }

    for (const event of triggers.observe(mower, entry.status, { deviceId, language: language() })) {
      logger.debug(`scene event ${event.key} for ${mower.name}`);
      await gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => logger.warn(`scene event ${event.key} refused: ${err.message}`));
    }

    const key = statusKey(mower, entry.status);
    if (entry.lastStatusKey !== undefined && key !== entry.lastStatusKey) {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    entry.lastStatusKey = key;
    await publishTransport(entry);
  }

  // --- REST -------------------------------------------------------------------

  function reportCloudError(err) {
    const kind = err instanceof WorxError ? err.kind : ERROR_KINDS.HTTP;
    const message =
      kind === ERROR_KINDS.CREDENTIALS
        ? MESSAGES.credentials
        : kind === ERROR_KINDS.RATE_LIMIT
          ? MESSAGES.rateLimited
          : MESSAGES.unreachable;
    issues.fail('cloud', `Worx cloud: ${err.message}`);
    return setConnection(false, message);
  }

  /**
   * Reads the account's mowers through REST, unless it was read less than
   * `minGap` periods ago.
   */
  async function refresh({ force = false, minGap = 0.5 } = {}) {
    if (!session) return false;
    if (!force && now() - lastRestAt < restPeriod() * minGap) {
      logger.debug('REST read skipped: read recently');
      return false;
    }
    const run = generation;
    lastRestAt = now();
    let items;
    try {
      items = await session.request((token) => api.productItems(token));
      if (products === null) {
        products = new Map();
        const catalog = await session
          .request((token) => api.products(token))
          .catch((err) => {
            logger.debug(`model catalog unavailable: ${err.message}`);
            return [];
          });
        for (const product of catalog) products.set(product.id, product);
      }
    } catch (err) {
      if (run === generation) await reportCloudError(err);
      return false;
    }
    if (run !== generation) return false;

    const seen = new Set();
    for (const item of items) {
      const mower = parseMower(item, products);
      if (!mower.serial) continue;
      seen.add(mower.serial);
      const entry = mowers.get(mower.serial) ?? { mower, payload: mower.payload, mqttAt: 0 };
      if (entry.mower.online !== mower.online && mowers.has(mower.serial)) {
        logger.info(`${mower.name}: ${mower.online ? 'back online' : 'offline'}`);
      }
      entry.mower = mower;
      // A payload pushed by MQTT since the previous read is newer than the
      // one the REST answer carries.
      if (!(link?.connected && entry.mqttAt > now() - restPeriod())) {
        entry.payload = mower.payload;
      }
      mowers.set(mower.serial, entry);
    }
    for (const serial of [...mowers.keys()]) {
      if (!seen.has(serial)) {
        mowers.delete(serial);
        triggers.forget(serial);
      }
    }

    if (issues.isFailing('cloud')) {
      issues.ok('cloud', `Worx cloud: reachable again, ${mowers.size} mower(s)`);
    } else if (!everConnectedCloud) {
      logger.info(`Worx cloud: connected, ${mowers.size} mower(s)`);
    }
    everConnectedCloud = true;
    for (const entry of mowers.values()) {
      entry.status = decodeStatus(entry.payload, entry.mower, { brand: config.brand });
    }
    try {
      await publishDevices();
    } catch (err) {
      issues.fail('devices', `devices not published: ${err.message}`);
    }
    for (const entry of mowers.values()) {
      await processMower(entry);
    }
    await setConnection(mowers.size > 0, mowers.size > 0 ? undefined : MESSAGES.noMower);
    link?.refreshTopics().catch(() => {});
    return true;
  }

  function schedule() {
    clearTimeout(restTimer);
    restTimer = null;
    if (!timers || !session) return;
    // Counted from the last read: re-arming (the link went up or down) never
    // postpones a read that is due.
    const delay = Math.max(1000, lastRestAt + restPeriod() - now());
    restTimer = setTimeout(async () => {
      restTimer = null;
      try {
        await refresh();
      } catch (err) {
        logger.error(`refresh failed: ${err.message}`);
      } finally {
        schedule();
      }
    }, delay);
    restTimer.unref?.();
  }

  // --- MQTT -------------------------------------------------------------------

  function mqttTarget() {
    const first = [...mowers.values()].find((e) => e.mower.endpoint && e.mower.userId !== null);
    if (!first) return null;
    const { mqttPrefix } = api.cloud;
    return {
      endpoint: first.mower.endpoint,
      clientId: `${mqttPrefix}/USER/${first.mower.userId}/gladys/${clientUuid}`,
      topics: [...mowers.values()].map((e) => e.mower.topics.out).filter(Boolean),
    };
  }

  function findByMessage(topic, message) {
    const ids = new Set(identifiersOf(message));
    for (const entry of mowers.values()) {
      const { mower } = entry;
      if (mower.topics.out === topic) return entry;
      if (ids.has(mower.serial) || (mower.uuid && ids.has(String(mower.uuid)))) return entry;
    }
    return null;
  }

  function onMqttMessage(topic, message) {
    const entry = findByMessage(topic, message);
    if (!entry) {
      logger.debug(`message for an unknown mower on ${topic}`);
      return;
    }
    logger.debug(`message from ${entry.mower.name}`);
    entry.payload = mergePayload(entry.payload, message);
    entry.mqttAt = now();
    // A message means the mower is reachable, whatever REST said an hour ago.
    if (!entry.mower.online) {
      logger.info(`${entry.mower.name}: back online`);
      entry.mower = { ...entry.mower, online: true };
    }
    processMower(entry).catch((err) => logger.error(`processing failed: ${err.message}`));
  }

  function onMqttState(connected, reason) {
    if (connected) {
      if (!everConnectedMqtt) {
        logger.info('Real-time link (MQTT) connected');
        everConnectedMqtt = true;
      }
      issues.ok('mqtt', 'Real-time link (MQTT) back');
    } else {
      issues.fail('mqtt', `Real-time link (MQTT) down: ${reason}; reading every 30 minutes`);
    }
    for (const entry of mowers.values()) {
      publishTransport(entry).catch(() => {});
    }
    // The REST pace follows the link: re-arm the timer at the new period.
    schedule();
  }

  // --- Commands -----------------------------------------------------------------

  function entryByDeviceId(deviceExternalId) {
    for (const entry of mowers.values()) {
      if (mowerIds(gladys, entry.mower).device === deviceExternalId) return entry;
    }
    return null;
  }

  /** Sends one order to a mower, within the budgets; resolves once the broker took it. */
  function send(entry, order, label) {
    const lang = language();
    if (!entry.mower.online) throw new UserError(COMMAND_ERRORS.offline, lang);
    if (!link?.connected || !entry.mower.topics.in) {
      throw new UserError(COMMAND_ERRORS.linkDown, lang);
    }
    if (!limiter.take(`cmd:${entry.mower.serial}`, LIMITS.COMMANDS_PER_DAY)) {
      throw new UserError(COMMAND_ERRORS.dailyLimit, lang);
    }
    logger.info(`${entry.mower.name}: ${label}`);
    const run = commandChain.then(async () => {
      const wait = lastCommandAt + LIMITS.COMMAND_SPACING_MS - now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastCommandAt = now();
      let timeout;
      await Promise.race([
        link.publish(entry.mower.topics.in, envelope(entry.mower, order)),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('no answer from the broker')),
            COMMAND_TIMEOUT_MS,
          );
          timeout.unref?.();
        }),
      ]).finally(() => clearTimeout(timeout));
    });
    commandChain = run.catch(() => {});
    return run.catch((err) => {
      logger.warn(`${entry.mower.name}: ${label} not sent (${err.message})`);
      throw new UserError(COMMAND_ERRORS.linkDown, lang);
    });
  }

  const unsupported = () => new UserError(COMMAND_ERRORS.unsupported, language());

  const hub = {
    /** (Re)starts with a configuration: a new account, or the same one. */
    async start(newConfig) {
      hub.stop();
      generation += 1;
      config = newConfig;
      devicesSignature = null;
      connectionKey = null;
      if (!isConfigured(config)) {
        logger.info('Not configured yet: waiting for the e-mail and password');
        mowers.clear();
        await setConnection(false, MESSAGES.notConfigured);
        return;
      }
      api = createApi({ brand: config.brand, fetch });
      session = createSession({ api, config, store, limiter, now });
      if (session.account !== account) {
        // Another account (or brand): its mowers and models start over.
        account = session.account;
        products = null;
        for (const serial of mowers.keys()) triggers.forget(serial);
        mowers.clear();
      }
      link = createMqttLink({
        connect: mqttConnect,
        getToken: () => session.accessToken(),
        onAuthRefused: () => session.expireAccessToken(),
        target: mqttTarget,
        onMessage: onMqttMessage,
        onState: onMqttState,
        timers,
        now,
      });
      await refresh({ force: true });
      if (mowers.size > 0 && mqttConnect) link.start();
      schedule();
    },

    stop() {
      clearTimeout(restTimer);
      restTimer = null;
      link?.stop();
      link = null;
    },

    /** Discovery: the mowers of the account, read again unless read minutes ago. */
    async scan() {
      if (!session) return;
      await refresh({ minGap: 0.1 });
      await publishDevices({ force: true });
    },

    /** Gladys came back (SDK reconnection): publish everything again, no cloud read. */
    async republish() {
      if (!session) {
        connectionKey = null;
        await setConnection(false, MESSAGES.notConfigured);
        return;
      }
      await publishDevices({ force: true });
      for (const entry of mowers.values()) {
        entry.lastTransport = undefined;
        await processMower(entry);
      }
      // The status shown before the reconnection, sent again.
      const [connected, message] = lastConnection;
      connectionKey = null;
      await setConnection(connected, message);
    },

    /** The timer's tick (tests call it in place of the timer). */
    tick: () => refresh(),

    /** Forces a REST read now. */
    refreshNow: () => refresh({ force: true }),

    /** The core's onPoll: reads the cloud only when the timer has stalled. */
    async pollFromCore(device) {
      const entry = entryByDeviceId(device.external_id);
      if (!entry) return;
      const read = await refresh({ minGap: 1.5 });
      if (!read && entry.status) {
        // Nothing new to read: re-send what changed (a value Gladys lost).
        await processMower(entry);
      }
    },

    /** The user added a mower to Gladys: send all its states now. */
    async deviceCreated(device) {
      const entry = entryByDeviceId(device.external_id);
      if (!entry?.status) return;
      gladys.forgetPublishedStates(device.external_id);
      entry.lastTransport = undefined;
      await processMower(entry);
      gladys.requestWidgetRefresh(WIDGET_KEY);
    },

    /**
     * A command from Gladys (dashboard, scene).
     * @param {{ external_id: string }} device
     * @param {{ external_id: string }} feature
     * @param {number | string} value
     */
    async setValue(device, feature, value) {
      const entry = entryByDeviceId(device.external_id);
      if (!entry) throw new UserError(COMMAND_ERRORS.unknownMower, language());
      const key = feature.external_id.slice(device.external_id.length + 1);
      const { mower, status } = entry;
      const on = Number(value) >= 1;
      switch (key) {
        case F.START:
          return send(entry, ORDERS.start(mower), 'start mowing');
        case F.PAUSE:
          return send(entry, ORDERS.pause(mower), 'pause');
        case F.HOME:
          return send(entry, ORDERS.home(mower), 'return to base');
        case F.EDGE_CUT:
          if (!status?.canEdgeCut) throw unsupported();
          return send(entry, ORDERS.edgeCut(mower), 'edge cut');
        case F.LOCK:
          return send(entry, ORDERS.lock(mower, on), on ? 'lock' : 'unlock');
        case F.SCHEDULE:
          return send(entry, ORDERS.schedule(mower, on), on ? 'schedule on' : 'schedule off');
        case F.RAIN_DELAY: {
          const minutes = Math.min(
            RAIN_DELAY_MAX,
            Math.max(0, Math.round(Number(value) / RAIN_DELAY_STEP) * RAIN_DELAY_STEP),
          );
          if (!Number.isFinite(minutes)) throw unsupported();
          return send(entry, ORDERS.rainDelay(mower, minutes), `rain delay ${minutes} min`);
        }
        default:
          throw unsupported();
      }
    },

    /** The `mow_once` scene action: a one-time session, with or without the edge. */
    async mowOnce(deviceExternalId, { minutes, edge }) {
      const entry = entryByDeviceId(deviceExternalId);
      if (!entry) throw new UserError(COMMAND_ERRORS.unknownMower, language());
      if (!entry.status?.canMowOnce) throw unsupported();
      await send(entry, ORDERS.mowOnce(entry.mower, { minutes, edge }), `mow once ${minutes} min`);
    },

    /** The "Check the connection" action. */
    async check() {
      if (!isConfigured(config ?? {})) return MESSAGES.notConfigured;
      if (now() - lastRestAt > 5 * 60 * 1000) {
        await refresh({ force: true });
      }
      if (session?.credentialsRefused) return MESSAGES.credentials;
      if (session?.blockedUntil) return MESSAGES.rateLimited;
      if (mowers.size === 0) {
        return issues.isFailing('cloud') ? MESSAGES.unreachable : MESSAGES.noMower;
      }
      const left = Math.min(
        ...[...mowers.values()].map((e) =>
          limiter.remaining(`cmd:${e.mower.serial}`, LIMITS.COMMANDS_PER_DAY),
        ),
      );
      return checkReport({
        mowers: [...mowers.values()].map((e) => e.mower),
        realtime: Boolean(link?.connected),
        commandsLeft: left,
      });
    },

    /** What the widget shows of one mower, or null. */
    snapshot(deviceExternalId) {
      const entry = entryByDeviceId(deviceExternalId);
      return entry?.status ? { mower: entry.mower, status: entry.status } : null;
    },

    get configured() {
      return Boolean(config && isConfigured(config));
    },
    get mowers() {
      return [...mowers.values()];
    },
    get realtime() {
      return Boolean(link?.connected);
    },
    get link() {
      return link;
    },
  };
  return hub;
}
