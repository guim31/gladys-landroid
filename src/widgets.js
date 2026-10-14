// -----------------------------------------------------------------------------
// The "mower" dashboard widget: state, battery and the three everyday
// buttons of one mower.
//
// The tiles and buttons are bound to the device features (live tiles, and
// the buttons go through onSetValue like the dashboard rows), so the widget
// needs no action handler of its own. The status rows are text the core
// caches: the hub nudges a refresh when the status changes.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { F, errorKey, mowerIds, statusKey } from './devices.js';
import { ERROR_TEXT, STATUS_TEXT, WIDGET_TEXT, pick } from './i18n.js';
import { RAIN_ERROR } from './worx/codes.js';

const COLOR_BY_STATUS = {
  offline: WIDGET_COLORS.NEUTRAL,
  error: WIDGET_COLORS.DANGER,
  rain: WIDGET_COLORS.INFO,
  charging: WIDGET_COLORS.PRIMARY,
  home: WIDGET_COLORS.PRIMARY,
  paused: WIDGET_COLORS.WARNING,
  idle: WIDGET_COLORS.NEUTRAL,
};

const message = (text) => ({ ttl_seconds: 300, components: [{ type: 'text', text }] });

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {object} options.hub
 * @param {object} options.settings widget settings ({ device })
 * @param {string} options.language the language of the viewing user
 */
export function buildMowerWidget({ gladys, hub, settings, language }) {
  const lang = WIDGET_TEXT[language] ? language : 'en';
  const t = WIDGET_TEXT[lang];
  if (!hub.configured) return message(t.notConfigured);
  if (!settings?.device) return message(t.pick);
  const snapshot = hub.snapshot(settings.device);
  if (!snapshot) return message(t.unknown);

  const { mower, status } = snapshot;
  const ids = mowerIds(gladys, mower);
  const key = statusKey(mower, status);
  const components = [];

  if (status.battery !== null) {
    components.push({
      type: 'value',
      label: t.battery,
      device_feature: ids.feature(F.BATTERY),
      icon: 'battery',
    });
  }
  if (status.workMinutes !== null) {
    components.push({
      type: 'value',
      label: t.today,
      device_feature: ids.feature(F.MOWING_TODAY),
      icon: 'clock',
    });
  }

  const items = [
    {
      label: t.status,
      value: pick(STATUS_TEXT, lang)[key],
      color: COLOR_BY_STATUS[key] ?? WIDGET_COLORS.SUCCESS,
    },
  ];
  if (key === 'error') {
    items.push({
      label: t.error,
      value: pick(ERROR_TEXT, lang)[errorKey(status.errorCode)],
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (status.rainRemaining > 0 || status.errorCode === RAIN_ERROR) {
    items.push({
      label: t.rain,
      value: `${status.rainRemaining ?? 0} ${t.minutes}`,
      color: WIDGET_COLORS.INFO,
    });
  }
  components.push({ type: 'status', items });

  const button = (feature, label, icon) => ({
    type: 'button',
    label,
    icon,
    style: 'secondary',
    device_feature: ids.feature(feature),
    value: 1,
  });
  components.push(button(F.START, t.start, 'play'));
  components.push(button(F.PAUSE, t.pause, 'pause'));
  components.push(button(F.HOME, t.home, 'home'));
  if (status.canEdgeCut) {
    components.push(button(F.EDGE_CUT, t.edge, 'scissors'));
  }
  return { ttl_seconds: 60, components };
}
