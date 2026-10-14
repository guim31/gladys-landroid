// -----------------------------------------------------------------------------
// Entry point of the Worx Landroid integration for Gladys Assistant.
//
// SDK wiring only: the handlers live in src/app.js, the work in src/hub.js.
// The supervisor provides GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR (read by the SDK), and TZ, the Gladys time zone.
// -----------------------------------------------------------------------------

import mqtt from 'mqtt';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';
import { Store } from './src/store.js';

const gladys = new GladysIntegration();

const app = registerHandlers(gladys, {
  store: new Store('/data'),
  fetch: globalThis.fetch,
  mqttConnect: (url, options) => mqtt.connect(url, options),
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: shutting down`);
  app.stop();
});

logger.info('Starting the Worx Landroid integration');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed: ${err.message}`);
  process.exit(1);
});
