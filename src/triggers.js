// -----------------------------------------------------------------------------
// Scene triggers: what HAPPENS to a mower, fired once per transition.
//
//   mower_error      the mower reports a new fault (trapped, lifted, outside
//                    the boundary...). Rain (error 5) is not a fault: the rain
//                    sensor feature tells it. Filterable by mower and by kind.
//   mowing_finished  the mower is back at its base after working: the end of
//                    a mowing session, by schedule, by rain or on request.
//
// The current state is a device feature (status, error); these events add
// what a state cannot: "it just happened", with its details (fault kind, how
// long the session lasted). Nothing fires for the first state seen after a
// start: an error already there when the container starts is not new.
// -----------------------------------------------------------------------------

import { ACTIVITY, RAIN_ERROR, activityOf, faultKindOf } from './worx/codes.js';
import { ERROR_TEXT, pick } from './i18n.js';
import { errorKey } from './devices.js';

export const TRIGGERS = {
  MOWER_ERROR: 'mower_error',
  MOWING_FINISHED: 'mowing_finished',
};

/** Every trigger key the code fires (tested against the manifest). */
export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

const isFault = (code) => code !== null && code !== 0 && code !== RAIN_ERROR;

export function createTriggerTracker() {
  /** serial → { status, sessionStart } */
  const seen = new Map();

  return {
    /**
     * Compares the new state of a mower with the previous one.
     * @param {{ serial: string, name: string }} mower
     * @param {object} status from decodeStatus
     * @param {{ deviceId: string, language: string }} context
     * @returns {{ key: string, data: object }[]} the events to fire
     */
    observe(mower, status, { deviceId, language }) {
      const before = seen.get(mower.serial);
      const activity = activityOf(status.statusCode);
      let sessionStart = before?.sessionStart ?? null;
      if (activity === ACTIVITY.WORKING && sessionStart === null) {
        sessionStart = status.workMinutes;
      }
      seen.set(mower.serial, { status, sessionStart });
      if (!before) {
        return [];
      }

      const events = [];
      const previous = before.status;
      if (isFault(status.errorCode) && status.errorCode !== previous.errorCode) {
        events.push({
          key: TRIGGERS.MOWER_ERROR,
          data: {
            device: deviceId,
            device_name: mower.name,
            kind: faultKindOf(status.errorCode),
            code: status.errorCode,
            error: pick(ERROR_TEXT, language)[errorKey(status.errorCode)],
          },
        });
      }

      const wasOut = [ACTIVITY.WORKING, ACTIVITY.RETURNING].includes(
        activityOf(previous.statusCode),
      );
      if (wasOut && activity === ACTIVITY.HOME) {
        const start = before.sessionStart;
        events.push({
          key: TRIGGERS.MOWING_FINISHED,
          data: {
            device: deviceId,
            device_name: mower.name,
            duration_minutes:
              start !== null && status.workMinutes !== null
                ? Math.max(0, status.workMinutes - start)
                : null,
            battery: status.battery,
            rain: status.errorCode === RAIN_ERROR,
          },
        });
        seen.set(mower.serial, { status, sessionStart: null });
      } else if (activity === ACTIVITY.HOME || activity === ACTIVITY.IDLE) {
        seen.set(mower.serial, { status, sessionStart: null });
      }
      return events;
    },

    forget(serial) {
      seen.delete(serial);
    },
  };
}
