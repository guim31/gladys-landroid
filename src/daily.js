// -----------------------------------------------------------------------------
// "Mowing time today", derived from the mower's lifetime work counter
// (`dat.st.wt`, minutes): the counter minus its value at the start of the
// local day (the container runs in the Gladys time zone).
//
// The base is the last value seen before the day changed, stored in /data so
// a restart keeps it. A mower first seen in the middle of the day starts at 0:
// what it mowed earlier that day is unknown.
// -----------------------------------------------------------------------------

const FILE = 'daily.json';

/** The local calendar day, YYYY-MM-DD. */
export const localDay = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * @param {{ store: object, now?: () => number }} options
 */
export function createDailyTracker({ store, now = () => Date.now() }) {
  const days = store.read(FILE, {});

  return {
    /**
     * @param {string} serial
     * @param {number | null} workMinutes the lifetime counter
     * @returns {number | null} minutes worked today
     */
    update(serial, workMinutes) {
      if (workMinutes === null) {
        return null;
      }
      const today = localDay(now());
      const record = days[serial];
      let next;
      if (!record) {
        next = { day: today, base: workMinutes, last: workMinutes };
      } else if (record.day !== today) {
        next = { day: today, base: record.last, last: workMinutes };
      } else {
        next = { ...record, last: workMinutes };
      }
      if (workMinutes < next.base) {
        // The counter went back (reset, other mower behind the serial).
        next.base = workMinutes;
      }
      if (JSON.stringify(next) !== JSON.stringify(record)) {
        days[serial] = next;
        store.write(FILE, days);
      }
      return Math.min(1440, Math.max(0, workMinutes - next.base));
    },
  };
}
