// -----------------------------------------------------------------------------
// The mower model: what the cloud says about one mower, decoded once.
//
// Two payload dialects share the same `{ cfg, dat }` envelope:
//   - protocol 0, the wire mowers (Landroid S/M/L...): addressed by serial
//     number, schedule in `cfg.sc.m`/`cfg.sc.d`, zones in `cfg.mzv` + `dat.lz`;
//   - protocol 1, Vision and RTK mowers: addressed by `uuid`, schedule in
//     `cfg.sc.enabled`/`cfg.sc.slots`, zone in `dat.cut.z`.
// The REST product item carries the last payload (`last_status.payload`), the
// MQTT topic `command_out` pushes the new ones.
// -----------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { cloudOf } from './clouds.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * One product item of GET /product-items → the mower identity.
 * @param {object} item
 * @param {Map<number, object>} [products] the model catalog, by product id
 */
export function parseMower(item, products = new Map()) {
  const payload = isObject(item?.last_status?.payload) ? item.last_status.payload : {};
  const dat = isObject(payload.dat) ? payload.dat : {};
  const product = products.get(item.product_id);
  const serial = String(item.serial_number ?? '');
  return {
    serial,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : serial,
    uuid: item.uuid ?? dat.uuid ?? null,
    protocol: Number(item.protocol) === 1 ? 1 : 0,
    online: item.online !== false,
    endpoint: typeof item.mqtt_endpoint === 'string' ? item.mqtt_endpoint : null,
    userId: item.user_id ?? null,
    topics: {
      in: item.mqtt_topics?.command_in ?? null,
      out: item.mqtt_topics?.command_out ?? null,
    },
    model: product
      ? [product.default_name, product.meters, product.code && `(${product.code})`]
          .filter(Boolean)
          .join(' ')
      : null,
    firmware: item.firmware_version ?? dat.fw ?? null,
    apiCapabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
    payload: { cfg: isObject(payload.cfg) ? payload.cfg : {}, dat },
  };
}

/**
 * Merges a payload pushed over MQTT into the last known one: a message may
 * carry only `cfg` or only `dat`.
 */
export function mergePayload(previous, incoming) {
  return {
    cfg: isObject(incoming?.cfg) ? incoming.cfg : (previous?.cfg ?? {}),
    dat: isObject(incoming?.dat) ? incoming.dat : (previous?.dat ?? {}),
  };
}

/** The identifiers an MQTT message names its mower by. */
export function identifiersOf(message) {
  return [message?.cfg?.sn, message?.dat?.uuid, message?.dat?.mac]
    .filter((id) => id !== undefined && id !== null)
    .map(String);
}

/**
 * The decoded state of a mower, every field null when the payload lacks it.
 * @param {{ cfg: object, dat: object }} payload
 * @param {{ protocol: number, apiCapabilities?: string[] }} mower
 * @param {{ brand: string }} options
 */
export function decodeStatus(payload, mower, { brand }) {
  const cfg = payload?.cfg ?? {};
  const dat = payload?.dat ?? {};
  const bt = isObject(dat.bt) ? dat.bt : {};
  const st = isObject(dat.st) ? dat.st : {};
  const rain = isObject(dat.rain) ? dat.rain : null;
  const sc = isObject(cfg.sc) ? cfg.sc : null;

  let rainRemaining = null;
  if (rain && num(rain.cnt) !== null) {
    const raw = Math.max(0, num(rain.cnt));
    rainRemaining = cloudOf(brand).rainCounterSeconds ? Math.ceil(raw / 60) : raw;
  }

  const oneTime =
    Boolean(sc && ('ots' in sc || 'once' in sc)) ||
    Boolean(isObject(dat.sc) && ('ots' in dat.sc || 'once' in dat.sc)) ||
    (mower.apiCapabilities ?? []).includes('border_cut');

  return {
    statusCode: num(dat.ls),
    errorCode: num(dat.le),
    battery: num(bt.p),
    charging: num(bt.c) === null ? null : num(bt.c) === 1,
    batteryTemperature: num(bt.t),
    rssi: num(dat.rsi),
    locked: num(dat.lk) === null ? null : num(dat.lk) === 1,
    rainDetected: rain && num(rain.s) !== null ? num(rain.s) === 1 : null,
    rainRemaining,
    rainDelay: num(cfg.rd),
    zone: zoneOf(cfg, dat, mower.protocol),
    // Whether the mower reports zones at all (Vision: only while it cuts one).
    hasZone: mower.protocol === 1 ? isObject(dat.cut) : num(dat.lz) !== null,
    scheduleEnabled: scheduleEnabledOf(sc, mower.protocol),
    bladeMinutes: num(st.b),
    workMinutes: num(st.wt),
    gps: gpsOf(dat),
    canEdgeCut: oneTime,
    canMowOnce: oneTime,
  };
}

function zoneOf(cfg, dat, protocol) {
  if (protocol === 1) {
    const z = num(dat.cut?.z);
    return z !== null && z > 0 ? z : null;
  }
  const index = num(dat.lz);
  if (index === null) {
    return null;
  }
  // `mzv` lists, over 10 slots, which zone (0-3) each start lands in; a mower
  // without zones has none, or only zeros: it mows zone 1.
  const slots = Array.isArray(cfg.mzv) ? cfg.mzv : [];
  const zone = num(slots[index]);
  return zone === null ? 1 : zone + 1;
}

function scheduleEnabledOf(sc, protocol) {
  if (!sc) {
    return null;
  }
  if (protocol === 1) {
    return num(sc.enabled) === null ? null : num(sc.enabled) === 1 && !num(sc.paused);
  }
  // m: 0 off, 1 on, 2 "party mode" (schedule suspended).
  return num(sc.m) === null ? null : num(sc.m) === 1;
}

function gpsOf(dat) {
  const coo = dat.modules?.['4G']?.gps?.coo;
  const pos = Array.isArray(coo) ? coo : dat.rtk?.pos;
  if (!Array.isArray(pos) || pos.length < 2) {
    return null;
  }
  const [lat, lon] = pos.map(num);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) {
    return null;
  }
  return { lat, lon };
}

// --- Commands ----------------------------------------------------------------

/** Command codes of the `cmd` field. */
export const CMD = { REFRESH: 0, START: 1, PAUSE: 2, HOME: 3, LOCK: 5, UNLOCK: 6, EDGE_CUT_V: 101 };

const pad = (n) => String(n).padStart(2, '0');

/**
 * Wraps an order in the envelope the mower expects. Protocol 0 dates it in
 * local time (the container runs in the Gladys time zone): the mower sets its
 * clock from it.
 * @param {{ protocol: number, serial: string, uuid: string | null }} mower
 * @param {object} order e.g. `{ cmd: 1 }` or `{ rd: 60 }`
 * @param {Date} [date]
 */
export function envelope(mower, order, date = new Date()) {
  const id = randomInt(1024, 65536);
  if (mower.protocol === 1) {
    return { id, uuid: mower.uuid, tm: date.toISOString().replace(/\.\d{3}Z$/, 'Z'), ...order };
  }
  return {
    id,
    sn: mower.serial,
    tm: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    dt: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    ...order,
  };
}

/** The order of each user action, per protocol. */
export const ORDERS = {
  start: () => ({ cmd: CMD.START }),
  pause: () => ({ cmd: CMD.PAUSE }),
  home: () => ({ cmd: CMD.HOME }),
  lock: (_mower, locked) => ({ cmd: locked ? CMD.LOCK : CMD.UNLOCK }),
  edgeCut: (mower) =>
    mower.protocol === 1 ? { cmd: CMD.EDGE_CUT_V } : { sc: { ots: { bc: 1, wtm: 0 } } },
  // Vision firmwares only take the rain delay inside `cfg`.
  rainDelay: (mower, minutes) =>
    mower.protocol === 1 ? { cfg: { rd: minutes } } : { rd: minutes },
  schedule: (mower, enabled) =>
    mower.protocol === 1
      ? { sc: { enabled: enabled ? 1 : 0 } }
      : { sc: enabled ? { m: 1, distm: 0 } : { m: 0 } },
  mowOnce: (mower, { minutes, edge }) =>
    mower.protocol === 1
      ? { cmd: 10, sc: { once: { cfg: { cut: { b: edge ? 1 : 0, z: [] } }, time: minutes } } }
      : { sc: { ots: { bc: edge ? 1 : 0, wtm: minutes } } },
};
