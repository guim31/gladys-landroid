// -----------------------------------------------------------------------------
// One Gladys device per mower: its features, and the states they take.
//
// External ids are forever: the device is keyed on the mower serial number
// (`gladys.externalIds('mower', serial)`), each feature on a fixed English
// key below. A feature only exists when the mower reports the matching value
// (rain sensor, zones, lock...), so a model never shows an empty row.
//
// Couples are taken from the Gladys feature table, with three choices:
//   - start, pause, return to base are `button/push`: a press, never a switch
//     a voice assistant could flip ("turn on the mower" must not start blades);
//   - the schedule is a writable `input/binary`, for the same reason;
//   - status and error are `text/text`, never empty ("No error").
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { ACTIVITY, ERROR_KEYS, RAIN_ERROR, STATUS_KEYS, activityOf } from './worx/codes.js';
import { ERROR_TEXT, NAMES, STATUS_TEXT, pick } from './i18n.js';

export const DEVICE_TYPE = 'mower';

/** Feature keys: part of the external ids, never rename one. */
export const F = {
  STATUS: 'status',
  ERROR: 'error',
  MOWING: 'mowing',
  BATTERY: 'battery',
  CHARGING: 'charging',
  BATTERY_TEMPERATURE: 'battery_temperature',
  RAIN: 'rain',
  RAIN_DELAY_REMAINING: 'rain_delay_remaining',
  RAIN_DELAY: 'rain_delay',
  ZONE: 'zone',
  MOWING_TODAY: 'mowing_today',
  BLADE_TIME: 'blade_time',
  MOWING_TIME: 'mowing_time',
  WIFI: 'wifi',
  GPS: 'gps',
  START: 'start',
  PAUSE: 'pause',
  HOME: 'home',
  EDGE_CUT: 'edge_cut',
  LOCK: 'lock',
  SCHEDULE: 'schedule',
};

/** The rain delay the mower accepts, in minutes (the app's range, in 30-minute steps). */
export const RAIN_DELAY_MAX = 720;
export const RAIN_DELAY_STEP = 30;

const sensor = (category, type, extra = {}) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});
const text = () => sensor(C.TEXT, T.TEXT.TEXT, { min: 0, max: 0, keep_history: false });
const push = () => ({
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  read_only: false,
  has_feedback: false,
  keep_history: false,
  min: 0,
  max: 1,
});

/**
 * The feature catalog: `when` tells whether this mower has the feature.
 * @type {{ key: string, when?: (s: object, m: object, c: object) => boolean, spec: object }[]}
 */
const FEATURES = [
  { key: F.STATUS, spec: text() },
  { key: F.ERROR, spec: text() },
  { key: F.MOWING, spec: sensor(C.INPUT, T.INPUT.BINARY, { min: 0, max: 1 }) },
  {
    key: F.BATTERY,
    spec: sensor(C.BATTERY, T.BATTERY.INTEGER, { min: 0, max: 100, unit: U.PERCENT }),
  },
  {
    key: F.CHARGING,
    when: (s) => s.charging !== null,
    spec: sensor(C.BATTERY, T.BATTERY.CHARGING, { min: 0, max: 1 }),
  },
  {
    key: F.BATTERY_TEMPERATURE,
    when: (s) => s.batteryTemperature !== null,
    spec: sensor(C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
      min: -20,
      max: 80,
      unit: U.CELSIUS,
    }),
  },
  {
    key: F.RAIN,
    when: (s) => s.rainDetected !== null,
    spec: sensor(C.RAIN_SENSOR, T.SENSOR.BINARY, { min: 0, max: 1 }),
  },
  {
    key: F.RAIN_DELAY_REMAINING,
    when: (s) => s.rainRemaining !== null,
    spec: sensor(C.DURATION, T.DURATION.INTEGER, { min: 0, max: 1440, unit: U.MINUTES }),
  },
  {
    key: F.RAIN_DELAY,
    when: (s) => s.rainDelay !== null,
    spec: {
      category: C.DURATION,
      type: T.DURATION.DECIMAL,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      min: 0,
      max: RAIN_DELAY_MAX,
      step: RAIN_DELAY_STEP,
      unit: U.MINUTES,
    },
  },
  {
    key: F.ZONE,
    when: (s) => s.hasZone,
    spec: sensor(C.COUNTER_SENSOR, T.SENSOR.INTEGER, { min: 1, max: 10 }),
  },
  {
    key: F.MOWING_TODAY,
    when: (s) => s.workMinutes !== null,
    spec: sensor(C.DURATION, T.DURATION.INTEGER, { min: 0, max: 1440, unit: U.MINUTES }),
  },
  {
    key: F.BLADE_TIME,
    when: (s) => s.bladeMinutes !== null,
    spec: sensor(C.DURATION, T.DURATION.INTEGER, { min: 0, max: 100000, unit: U.HOURS }),
  },
  {
    key: F.MOWING_TIME,
    when: (s) => s.workMinutes !== null,
    spec: sensor(C.DURATION, T.DURATION.INTEGER, { min: 0, max: 100000, unit: U.HOURS }),
  },
  {
    key: F.WIFI,
    when: (s) => s.rssi !== null,
    spec: sensor(C.SIGNAL, T.SIGNAL.QUALITY, { min: 0, max: 100, unit: U.PERCENT }),
  },
  {
    key: F.GPS,
    when: (s, _m, c) => c.gps_enabled && s.gps !== null,
    spec: text(),
  },
  { key: F.START, spec: push() },
  { key: F.PAUSE, spec: push() },
  { key: F.HOME, spec: push() },
  { key: F.EDGE_CUT, when: (s) => s.canEdgeCut, spec: push() },
  {
    key: F.LOCK,
    when: (s) => s.locked !== null,
    spec: {
      category: C.LOCK,
      type: T.LOCK.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
  },
  {
    key: F.SCHEDULE,
    when: (s) => s.scheduleEnabled !== null,
    spec: {
      category: C.INPUT,
      type: T.INPUT.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
  },
];

/** The external ids of one mower. */
export const mowerIds = (gladys, mower) => gladys.externalIds(DEVICE_TYPE, mower.serial);

/** The feature keys this mower has, in display order. */
export function featureKeys(mower, status, config) {
  return FEATURES.filter((f) => !f.when || f.when(status, mower, config)).map((f) => f.key);
}

/**
 * The Gladys device of one mower.
 * @param {object} gladys
 * @param {object} mower from parseMower
 * @param {object} status from decodeStatus
 * @param {object} config normalized config
 */
export function buildDevice(gladys, mower, status, config) {
  const ids = mowerIds(gladys, mower);
  const names = NAMES[config.language] ?? NAMES.en;
  const keys = new Set(featureKeys(mower, status, config));
  const params = [{ name: 'SERIAL_NUMBER', value: mower.serial }];
  if (mower.model) params.push({ name: 'MODEL', value: mower.model });
  return {
    name: mower.name,
    external_id: ids.device,
    model: mower.model ?? undefined,
    // The container refreshes on its own timer (Gladys#3198): the core's
    // poll, once a minute, is only a fallback that reads no cloud.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params,
    features: FEATURES.filter((f) => keys.has(f.key)).map((f) => ({
      name: names[f.key],
      external_id: ids.feature(f.key),
      ...f.spec,
    })),
  };
}

/** The status shown to the user: a key of STATUS_TEXT. */
export function statusKey(mower, status) {
  if (!mower.online) return 'offline';
  const error = status.errorCode;
  if (error !== null && error !== 0 && error !== RAIN_ERROR) return 'error';
  const activity = activityOf(status.statusCode);
  if (error === RAIN_ERROR && (activity === ACTIVITY.HOME || activity === ACTIVITY.IDLE)) {
    return 'rain';
  }
  if (status.statusCode === 1 && status.charging) return 'charging';
  return STATUS_KEYS[status.statusCode] ?? 'unknown';
}

/** The error key of the error code (`none` for 0). */
export const errorKey = (code) => (code === null ? 'none' : (ERROR_KEYS[code] ?? 'unknown'));

/** Wi-Fi quality from the RSSI in dBm: -100 dBm or less → 0 %, -50 dBm or more → 100 %. */
export function wifiQuality(rssi) {
  if (rssi >= 0) return Math.min(100, Math.round(rssi));
  return Math.max(0, Math.min(100, Math.round(2 * (rssi + 100))));
}

/**
 * The states of every feature this mower has, in `publishStates` format.
 * @param {object} gladys
 * @param {object} mower
 * @param {object} status
 * @param {object} config
 * @param {{ mowingToday: number | null }} extra values computed by the hub
 */
export function computeStates(gladys, mower, status, config, { mowingToday = null } = {}) {
  const ids = mowerIds(gladys, mower);
  const lang = config.language;
  const keys = new Set(featureKeys(mower, status, config));
  const states = [];
  const add = (key, value) => {
    if (!keys.has(key) || value === null || value === undefined) return;
    const id = ids.feature(key);
    if (typeof value === 'string') {
      states.push({ device_feature_external_id: id, text: value });
    } else {
      states.push({ device_feature_external_id: id, state: Number(value) });
    }
  };
  const bool = (value) => (value === null ? null : value ? 1 : 0);

  add(F.STATUS, pick(STATUS_TEXT, lang)[statusKey(mower, status)]);
  add(F.ERROR, pick(ERROR_TEXT, lang)[errorKey(status.errorCode)]);
  if (status.statusCode !== null) {
    add(F.MOWING, activityOf(status.statusCode) === ACTIVITY.WORKING && mower.online ? 1 : 0);
  }
  add(F.BATTERY, status.battery === null ? null : Math.round(status.battery));
  add(F.CHARGING, bool(status.charging));
  add(F.BATTERY_TEMPERATURE, status.batteryTemperature);
  add(F.RAIN, bool(status.rainDetected));
  add(F.RAIN_DELAY_REMAINING, status.rainRemaining);
  add(F.RAIN_DELAY, status.rainDelay);
  add(F.ZONE, status.zone);
  add(F.MOWING_TODAY, mowingToday);
  add(F.BLADE_TIME, status.bladeMinutes === null ? null : Math.floor(status.bladeMinutes / 60));
  add(F.MOWING_TIME, status.workMinutes === null ? null : Math.floor(status.workMinutes / 60));
  add(F.WIFI, status.rssi === null ? null : wifiQuality(status.rssi));
  if (status.gps) {
    add(F.GPS, `${status.gps.lat.toFixed(6)}, ${status.gps.lon.toFixed(6)}`);
  }
  add(F.LOCK, bool(status.locked));
  add(F.SCHEDULE, bool(status.scheduleEnabled));
  return states;
}
