# Worx Landroid for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and drives **Worx Landroid** robot mowers, and the mowers of the sister
brands of the same Positec cloud, **Kress** and **LandXcape**, with the account
of the vendor app.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the protocol as the community documents it, with
> invented fixtures, not against a real mower or account. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-landroid/issues).

**Not affiliated with Worx, Kress, LandXcape or Positec.** Worx and Landroid
are trademarks of their owners.

## Features

- **One device per mower**: status (mowing, returning to base, charging, at the
  base, error, rain…), current error as text, battery, charging, battery
  temperature, rain sensor, remaining rain delay, current zone, mowing time
  today, total blade and mowing times, Wi-Fi signal, and the GPS position for
  the models that report one (off by default).
- **Commands**: start, pause, return to base, edge cut (models that have it),
  anti-theft lock, schedule on/off, rain delay (0 to 12 h in 30-minute steps).
  Start, pause and return are push buttons, never switches a voice assistant
  could flip. No firmware update, no reset: left to the vendor app.
- **Real time**: the mowers push their state over MQTT (AWS IoT, secure
  WebSocket); a REST read every hour (every 30 minutes while MQTT is down)
  keeps everything right.
- **Dashboard widget** "Robot mower": state, battery, mowing time today, and
  the Start, Pause, Base (and Edge cut) buttons.
- **Scene triggers**: _Mower error_ (filter by kind: trapped, lifted, outside
  the boundary, blade, battery, base, cover, other) and _Mowing finished_ (back
  at the base, with the length of the session).
- **Scene action**: _Mow once_, a one-time session outside the schedule, with
  or without the edge first.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A mower added in the Worx Landroid, Kress or LandXcape app, and the e-mail
  and password of that account.
- Internet access: the mowers have no local API.

## Installation

In Gladys: **Integrations → Install from GitHub**, with
`https://github.com/guim31/gladys-landroid`. Then, in the **Configuration**
tab, choose the brand, enter the e-mail and password, save, and add the
mowers from the **Discovery** tab.

The user documentation is in [English](docs/en.md), [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md).

## Limits and cloud quotas

Worx bans accounts that are too talkative, for up to 24 hours. The vendor
publishes no number, so the integration keeps to the conservative budgets of
the community clients, counted over a rolling 24 hours and stored in `/data`:

| What                    | Budget                                                   |
| ----------------------- | -------------------------------------------------------- |
| MQTT commands           | 50 per mower per day, one every 1.1 s                    |
| REST requests           | 96 per day (one read per hour, 30 min without MQTT)      |
| Password logins         | 5 per day; the tokens are reused across restarts         |
| MQTT (re)connections    | after 1 min, then 2, 4… up to 30 min between attempts    |
| HTTP 429 from the cloud | everything pauses: Retry-After, or 1 h doubled each time |

A refused password is not retried until the configuration changes. Schedules,
zones and cutting height are read-only. "Mowing time today" starts at 0 the
first day.

## Development

```bash
npm install
npm test                    # node --test, against the SDK's fake Gladys
npm run lint
npm run format:check
node scripts/probe.mjs      # read-only check of the real cloud (see below)
```

`scripts/probe.mjs` logs in, lists the mowers and listens to MQTT for a
minute, without sending any command and without printing any identifier:

```bash
node scripts/probe.mjs                                   # fake account: clean refusal expected
WORX_EMAIL=… WORX_PASSWORD=… WORX_BRAND=worx node scripts/probe.mjs
```

The code: `src/worx/` speaks the cloud (REST client, session and tokens,
budgets, MQTT link, payload decoding), `src/hub.js` keeps the mowers and
publishes them, `src/devices.js` maps them to Gladys features, `src/app.js`
wires the SDK handlers. See [CLAUDE.md](CLAUDE.md) for the project rules.

## Credits

The protocol was learned from the work of the community, read to understand
it, never copied:

- [MTrab/pyworxcloud](https://github.com/MTrab/pyworxcloud) and
  [MTrab/landroid_cloud](https://github.com/MTrab/landroid_cloud) (GPL-3.0),
  the Home Assistant integration and its library: endpoints, MQTT topics,
  payloads, command formats.
- [iobroker-community-adapters/ioBroker.worx](https://github.com/iobroker-community-adapters/ioBroker.worx)
  (MIT) by TA2k and contributors: status and error codes, the rate limits that
  keep an account out of a ban.

Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js).

## License

[Apache-2.0](LICENSE)
