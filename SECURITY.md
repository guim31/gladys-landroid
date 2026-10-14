# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration stores and sends:

- The **e-mail and password** of the vendor account live in the Gladys
  configuration of the integration (the password is a secret field). They are
  only sent to the vendor's login endpoint (`id.worx.com`, `id.kress.com` or
  `id.landxcape-services.com`), over HTTPS.
- The **access and refresh tokens** are stored in `/data/session.json`
  (readable by the container user only), next to a hash of the brand and
  e-mail — never the e-mail itself. `/data` also holds the rolling request
  counters (`limits.json`), the day's mowing baseline (`daily.json`) and a
  random MQTT client id (`client.json`).
- Network: HTTPS to the vendor REST API, and MQTT over secure WebSocket to the
  vendor's AWS IoT endpoint. Nothing else, nothing on the local network.
- The logs never contain the password, the e-mail or a token, at any level
  (a test checks it). The GPS position is only read when the user turns it on.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the vendor cloud and mowers the integration talks to.
