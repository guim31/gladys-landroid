// -----------------------------------------------------------------------------
// The three brands of the Positec cloud. Same protocol, distinct hosts: an
// account created in the Worx app only exists on the Worx cloud.
//
// The client ids are the public ids of the vendors' mobile apps (OAuth2
// "password" grant), the same ones every community client uses.
// -----------------------------------------------------------------------------

export const BRANDS = {
  worx: {
    label: 'Worx Landroid',
    apiHost: 'api.worxlandroid.com',
    authHost: 'id.worx.com',
    clientId: '150da4d2-bb44-433b-9429-3773adc70a2a',
    mqttPrefix: 'WX',
    // Unit of the remaining rain delay (`dat.rain.cnt`).
    rainCounterSeconds: false,
  },
  kress: {
    label: 'Kress',
    apiHost: 'api.kress-robotik.com',
    authHost: 'id.kress.com',
    clientId: '931d4bc4-3192-405a-be78-98e43486dc59',
    mqttPrefix: 'KR',
    // Kress mowers count the remaining rain delay in seconds.
    rainCounterSeconds: true,
  },
  landxcape: {
    label: 'LandXcape',
    apiHost: 'api.landxcape-services.com',
    authHost: 'id.landxcape-services.com',
    clientId: 'dec998a9-066f-433b-987a-f5fc54d3af7c',
    mqttPrefix: 'LX',
    rainCounterSeconds: false,
  },
};

/** @param {string} brand */
export function cloudOf(brand) {
  return BRANDS[brand] ?? BRANDS.worx;
}
