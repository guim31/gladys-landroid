// -----------------------------------------------------------------------------
// Repeated failures, logged once.
//
// A cloud that stays down would write the same warning at every attempt. An
// issue log remembers, per key, that a problem is ongoing: the first failure
// is a warning, the next ones go to debug, the recovery is one info line.
// -----------------------------------------------------------------------------

/** @param {{ debug: Function, info: Function, warn: Function }} logger */
export function createIssueLog(logger) {
  const ongoing = new Set();
  return {
    /** A warning the first time, debug while it lasts. */
    fail(key, message) {
      if (ongoing.has(key)) {
        logger.debug(`${message} (still failing)`);
        return;
      }
      ongoing.add(key);
      logger.warn(message);
    },
    /** One info line when it ends an ongoing failure, nothing otherwise. */
    ok(key, message) {
      if (ongoing.delete(key)) {
        logger.info(message);
      }
    },
    isFailing(key) {
      return ongoing.has(key);
    },
  };
}
