// -----------------------------------------------------------------------------
// Wires the Gladys client to the hub: every handler, registered before
// connect(). Kept apart from index.js so the tests run the real wiring
// against the SDK's fake Gladys, a fake cloud and a fake MQTT broker.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { MESSAGES } from './i18n.js';
import { WIDGET_KEY, createHub } from './hub.js';
import { buildMowerWidget } from './widgets.js';

export const ACTIONS = { CHECK: 'check_connection' };
export const SCENE_ACTIONS = { MOW_ONCE: 'mow_once' };
export const WIDGETS = { MOWER: WIDGET_KEY };

/** The one-time session the `mow_once` action accepts, in minutes. */
export const MOW_ONCE_MIN = 10;
export const MOW_ONCE_MAX = 480;

/**
 * @param {object} gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {object} deps
 * @param {object} deps.store /data store
 * @param {typeof fetch} [deps.fetch]
 * @param {Function} [deps.mqttConnect] mqtt.connect
 * @param {boolean} [deps.timers]
 * @param {() => number} [deps.now]
 */
export function registerHandlers(gladys, { store, fetch, mqttConnect, timers = true, now }) {
  const hub = createHub({ gladys, store, fetch, mqttConnect, timers, now });
  let configJson = null;
  let started = false;

  async function applyConfig(raw) {
    const config = normalizeConfig(raw);
    configJson = JSON.stringify(config);
    started = true;
    await hub.start(config);
  }

  gladys.onScanRequest(() => hub.scan());
  gladys.onSetValue((device, feature, value) => hub.setValue(device, feature, value));
  gladys.onPoll((device) => hub.pollFromCore(device));
  gladys.onDeviceCreated((device) => hub.deviceCreated(device));
  gladys.onDeviceUpdated((device) => hub.deviceCreated(device));

  gladys.onAction(ACTIONS.CHECK, async () => {
    logger.info('Action: check the connection');
    return hub.check();
  });

  gladys.onSceneAction(SCENE_ACTIONS.MOW_ONCE, async (fields) => {
    const minutes = Math.round(Number(fields.duration ?? 60));
    if (!Number.isFinite(minutes) || minutes < MOW_ONCE_MIN || minutes > MOW_ONCE_MAX) {
      throw new Error(`duration must be ${MOW_ONCE_MIN} to ${MOW_ONCE_MAX} minutes`);
    }
    await hub.mowOnce(fields.device, { minutes, edge: fields.edge === true });
    return undefined;
  });

  gladys.onWidgetGet(WIDGETS.MOWER, async ({ settings, language }) =>
    buildMowerWidget({ gladys, hub, settings, language }),
  );

  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration saved: reconnecting to the cloud');
    await applyConfig(raw);
  });

  gladys.on('connected', async () => {
    try {
      const raw = await gladys.getConfig();
      if (started && JSON.stringify(normalizeConfig(raw)) === configJson) {
        // A reconnection to Gladys, same account: no new cloud session.
        await hub.republish();
        return;
      }
      await applyConfig(raw);
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
    }
  });

  return {
    hub,
    stop() {
      hub.stop();
    },
  };
}
