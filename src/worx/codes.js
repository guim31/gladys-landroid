// -----------------------------------------------------------------------------
// The status (`dat.ls`) and error (`dat.le`) codes the mowers report.
//
// Protocol facts, collected from the community documentation (ioBroker.worx,
// MIT; the HACS landroid_cloud project) and written here as our own table:
// codes 0-34 are shared by the wire and Vision mowers, 100+ are the newer
// Vision and RTK (Kress Mission, Landroid Vision RTK) ones.
// -----------------------------------------------------------------------------

/** Status code → stable key (the key names the localized text, src/i18n.js). */
export const STATUS_KEYS = {
  0: 'idle',
  1: 'home',
  2: 'start_sequence',
  3: 'leaving_home',
  4: 'following_wire',
  5: 'searching_home',
  6: 'searching_wire',
  7: 'mowing',
  8: 'lifted',
  9: 'trapped',
  10: 'blade_blocked',
  11: 'debug',
  12: 'remote_control',
  13: 'fence_escape',
  30: 'going_home',
  31: 'zone_training',
  32: 'edge_cutting',
  33: 'searching_zone',
  34: 'paused',
  100: 'map_training',
  101: 'map_processing',
  102: 'firmware_upgrade',
  103: 'moving_to_zone',
  104: 'going_home',
  105: 'ready_for_training',
  106: 'map_download',
  107: 'map_upload',
  108: 'map_training_paused',
  109: 'map_training',
  110: 'border_crossing',
  111: 'exploring_lawn',
};

/** What the mower is doing, coarsely: drives the "mowing" feature and the triggers. */
export const ACTIVITY = {
  HOME: 'home',
  WORKING: 'working',
  RETURNING: 'returning',
  PAUSED: 'paused',
  IDLE: 'idle',
  OTHER: 'other',
};

const WORKING = new Set([2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 31, 32, 33, 103, 110, 111]);
const RETURNING = new Set([5, 30, 104]);

/** @param {number} code */
export function activityOf(code) {
  if (code === 1) return ACTIVITY.HOME;
  if (code === 0) return ACTIVITY.IDLE;
  if (code === 34) return ACTIVITY.PAUSED;
  if (WORKING.has(code)) return ACTIVITY.WORKING;
  if (RETURNING.has(code)) return ACTIVITY.RETURNING;
  return ACTIVITY.OTHER;
}

/** Error code 5 is not a fault: the rain sensor is wet, the mower waits. */
export const RAIN_ERROR = 5;

/** Error code → stable key. */
export const ERROR_KEYS = {
  0: 'none',
  1: 'trapped',
  2: 'lifted',
  3: 'wire_missing',
  4: 'outside_wire',
  5: 'raining',
  6: 'close_door_to_mow',
  7: 'close_door_to_go_home',
  8: 'blade_motor_blocked',
  9: 'wheel_motor_blocked',
  10: 'trapped_timeout',
  11: 'upside_down',
  12: 'battery_low',
  13: 'wire_reversed',
  14: 'charge_error',
  15: 'home_search_timeout',
  16: 'wifi_locked',
  17: 'battery_temperature',
  18: 'dummy_model',
  19: 'trunk_open_timeout',
  20: 'wire_sync',
  100: 'docking_error',
  101: 'hbi_error',
  102: 'ota_error',
  103: 'map_error',
  104: 'excessive_slope',
  105: 'unreachable_zone',
  106: 'unreachable_station',
  107: 'calibration_needed',
  108: 'insufficient_sensor_data',
  109: 'training_start_disallowed',
  110: 'camera_error',
  111: 'exploration_required',
  112: 'exploration_failed',
  113: 'rfid_error',
  114: 'headlight_error',
  115: 'missing_station',
  116: 'blade_height_blocked',
  117: 'unsupported_blade_height',
  118: 'firmware_upgrade_required',
  119: 'area_limit_exceeded',
  120: 'undocking_error',
};

/**
 * The families of faults a scene can filter on (the `kind` filter of the
 * `mower_error` trigger). Keys are published: never rename one.
 */
export const FAULT_KINDS = [
  'trapped',
  'lifted',
  'outside',
  'blade',
  'battery',
  'docking',
  'cover',
  'other',
];

const KIND_BY_CODE = {
  1: 'trapped',
  9: 'trapped',
  10: 'trapped',
  104: 'trapped',
  2: 'lifted',
  11: 'lifted',
  3: 'outside',
  4: 'outside',
  13: 'outside',
  20: 'outside',
  105: 'outside',
  111: 'outside',
  112: 'outside',
  119: 'outside',
  8: 'blade',
  116: 'blade',
  117: 'blade',
  12: 'battery',
  14: 'battery',
  17: 'battery',
  15: 'docking',
  100: 'docking',
  106: 'docking',
  115: 'docking',
  120: 'docking',
  6: 'cover',
  7: 'cover',
  19: 'cover',
};

/** @param {number} code a fault code (not 0, not 5) */
export function faultKindOf(code) {
  return KIND_BY_CODE[code] ?? 'other';
}
