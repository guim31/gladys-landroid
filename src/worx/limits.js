// -----------------------------------------------------------------------------
// The guards that keep the account out of the cloud's temporary bans.
//
// Worx blocks accounts that are too talkative, for up to 24 hours (the app
// stops working too). The vendor publishes no number: these budgets are the
// conservative ones of the community clients (ioBroker.worx defaults: 50
// commands per mower and per day, about 70 REST requests per day, 1.1 s
// between two commands), and are counted over a rolling 24 hours, stored in
// /data so a restart does not reset them.
// -----------------------------------------------------------------------------

export const LIMITS = {
  /** Password logins per rolling 24 h (a token refresh is not a login). */
  LOGINS_PER_DAY: 5,
  /** REST requests (token refreshes included) per rolling 24 h. */
  REST_REQUESTS_PER_DAY: 96,
  /** MQTT commands per mower and per rolling 24 h. */
  COMMANDS_PER_DAY: 50,
  /** Minimum gap between two MQTT commands. */
  COMMAND_SPACING_MS: 1100,
  /** REST read of the mowers while the real-time link (MQTT) works. */
  REST_PERIOD_MS: 60 * 60 * 1000,
  /** REST read of the mowers while MQTT is down: the fallback. */
  REST_FALLBACK_PERIOD_MS: 30 * 60 * 1000,
  /** MQTT reconnection backoff, first and last delay. */
  MQTT_RETRY_MIN_MS: 60 * 1000,
  MQTT_RETRY_MAX_MS: 30 * 60 * 1000,
  /** A 429 without Retry-After: wait this long, doubled at each new 429. */
  BAN_BACKOFF_MS: 60 * 60 * 1000,
  BAN_BACKOFF_MAX_MS: 24 * 60 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE = 'limits.json';

/**
 * Rolling 24-hour counters, one per bucket ('login', 'rest', 'cmd:<serial>').
 * @param {{ store: { read: Function, write: Function }, now?: () => number }} options
 */
export function createLimiter({ store, now = () => Date.now() }) {
  const buckets = store.read(FILE, {});

  function recent(bucket) {
    const since = now() - DAY_MS;
    const kept = (Array.isArray(buckets[bucket]) ? buckets[bucket] : []).filter((t) => t > since);
    buckets[bucket] = kept;
    return kept;
  }

  return {
    /** Records one use and returns true, or returns false when the budget is spent. */
    take(bucket, max) {
      const used = recent(bucket);
      if (used.length >= max) {
        return false;
      }
      used.push(now());
      store.write(FILE, buckets);
      return true;
    },
    /** Uses left in the bucket over the rolling 24 h. */
    remaining(bucket, max) {
      return Math.max(0, max - recent(bucket).length);
    },
    /** When the oldest use leaves the window (the budget grows again then). */
    nextSlotAt(bucket) {
      const used = recent(bucket);
      return used.length > 0 ? used[0] + DAY_MS : now();
    },
  };
}
