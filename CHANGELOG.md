# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- Worx Landroid robot mowers in Gladys, and the Kress and LandXcape mowers of
  the same cloud, with the e-mail and password of the vendor app.
- One device per mower: status, current error, battery, charging, battery
  temperature, rain sensor, remaining rain delay, current zone, mowing time
  today, total blade and mowing times, Wi-Fi signal, and the GPS position of
  the models that have one (off by default).
- Commands: start, pause, return to base, edge cut, lock, schedule on/off and
  rain delay.
- Real-time states over MQTT, with a REST read every hour (every 30 minutes
  while the real-time link is down).
- A "Robot mower" dashboard widget: state, battery, mowing time today, and the
  start, pause and base buttons.
- Scene triggers "Mower error" (filterable by kind of fault) and "Mowing
  finished", and the scene action "Mow once".
- A "Check the connection" button in the configuration.
- Budgets that keep the account out of the vendor's temporary bans: 50
  commands per mower per day, 96 cloud requests and 5 logins per day, a pause
  after a "too many requests" answer.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-landroid/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-landroid/releases/tag/v1.0.1
