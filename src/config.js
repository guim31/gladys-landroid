// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of the manifest. This module
// only provides the defaults (they MUST match the manifest `default` values)
// and normalizes the received object, so the rest of the code never deals
// with `undefined` or with a value typed as a string by a form.
// -----------------------------------------------------------------------------

import { BRANDS } from './worx/clouds.js';

/** The languages of the Gladys interface, the ones every text exists in. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  brand: 'worx', // 'worx' | 'kress' | 'landxcape': the cloud the account lives on
  email: '',
  password: '',
  // Language of the feature names and of the texts the container produces
  // (status, error): a device integration never receives the user's language.
  language: 'fr',
  // The position is personal data, and only a few models report it.
  gps_enabled: false,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const brand = String(raw.brand ?? DEFAULT_CONFIG.brand).toLowerCase();
  const language = String(raw.language ?? DEFAULT_CONFIG.language).toLowerCase();
  return {
    brand: Object.hasOwn(BRANDS, brand) ? brand : DEFAULT_CONFIG.brand,
    email: String(raw.email ?? DEFAULT_CONFIG.email).trim(),
    password: String(raw.password ?? DEFAULT_CONFIG.password),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
    gps_enabled: raw.gps_enabled === true || raw.gps_enabled === 'true',
  };
}

/** The account can only be reached once both credentials are set. */
export function isConfigured(config) {
  return Boolean(config.email && config.password);
}
