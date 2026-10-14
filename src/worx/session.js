// -----------------------------------------------------------------------------
// The cloud session: tokens, their refresh, and the guards around the logins.
//
// The tokens are stored in /data/session.json (owner-only file), tied to the
// brand and the e-mail they were obtained for: a restart reuses them instead
// of logging in again, and another account never reuses them. A password
// login only happens when no token can be refreshed, at most
// LIMITS.LOGINS_PER_DAY times a day. A refused password stops every login
// until the configuration changes; a 429 stops every request until the
// cloud's Retry-After (or a doubling backoff) is over.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { ERROR_KINDS, WorxError } from './api.js';
import { LIMITS } from './limits.js';

const FILE = 'session.json';
/** A token this close to its expiry is refreshed before use. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** Identifies an account without storing its e-mail in clear. */
export function accountKey(brand, email) {
  return createHash('sha256')
    .update(`${brand}:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * @param {object} options
 * @param {ReturnType<import('./api.js').createApi>} options.api
 * @param {{ brand: string, email: string, password: string }} options.config
 * @param {object} options.store
 * @param {ReturnType<import('./limits.js').createLimiter>} options.limiter
 * @param {() => number} [options.now]
 */
export function createSession({ api, config, store, limiter, now = () => Date.now() }) {
  const account = accountKey(config.brand, config.email);
  const saved = store.read(FILE, {});
  let tokens = saved.account === account ? saved.tokens : null;
  let blockedUntil = saved.account === account ? (saved.blockedUntil ?? 0) : 0;
  let banBackoffMs = saved.account === account ? (saved.banBackoffMs ?? 0) : 0;
  let credentialsRefused = false;
  let pending = null;

  function persist() {
    store.write(FILE, { account, tokens, blockedUntil, banBackoffMs });
  }

  function assertAllowed() {
    if (credentialsRefused) {
      throw new WorxError(ERROR_KINDS.CREDENTIALS, 'the account refused the e-mail or password');
    }
    if (blockedUntil > now()) {
      throw new WorxError(
        ERROR_KINDS.RATE_LIMIT,
        `requests paused until ${new Date(blockedUntil).toISOString()} (the cloud asked to slow down)`,
        { retryAfterMs: blockedUntil - now() },
      );
    }
  }

  function takeRestBudget() {
    if (!limiter.take('rest', LIMITS.REST_REQUESTS_PER_DAY)) {
      throw new WorxError(
        ERROR_KINDS.RATE_LIMIT,
        `daily request budget spent (${LIMITS.REST_REQUESTS_PER_DAY} per 24 h)`,
        { retryAfterMs: limiter.nextSlotAt('rest') - now() },
      );
    }
  }

  /** Every cloud error goes through here: a 429 pauses everything. */
  function noteError(err) {
    if (err instanceof WorxError && err.kind === ERROR_KINDS.RATE_LIMIT && err.status === 429) {
      banBackoffMs = err.retryAfterMs
        ? err.retryAfterMs
        : Math.min(
            banBackoffMs ? banBackoffMs * 2 : LIMITS.BAN_BACKOFF_MS,
            LIMITS.BAN_BACKOFF_MAX_MS,
          );
      blockedUntil = now() + banBackoffMs;
      persist();
    }
    if (err instanceof WorxError && err.kind === ERROR_KINDS.CREDENTIALS) {
      tokens = null;
      persist();
    }
    return err;
  }

  /** An answer went through: the next 429 starts the backoff over. */
  function cleared() {
    if (banBackoffMs !== 0) {
      banBackoffMs = 0;
      persist();
    }
  }

  function remember(fresh) {
    tokens = {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken,
      expiresAt: now() + fresh.expiresInMs,
    };
    persist();
  }

  async function obtain() {
    if (tokens?.refreshToken) {
      takeRestBudget();
      try {
        remember(await api.refresh(tokens.refreshToken));
        return tokens.accessToken;
      } catch (err) {
        if (!(err instanceof WorxError) || err.kind !== ERROR_KINDS.CREDENTIALS) {
          throw noteError(err);
        }
        // The refresh token is dead: fall back to a password login.
        tokens = null;
        persist();
      }
    }
    if (!limiter.take('login', LIMITS.LOGINS_PER_DAY)) {
      throw new WorxError(
        ERROR_KINDS.RATE_LIMIT,
        `login budget spent (${LIMITS.LOGINS_PER_DAY} per 24 h)`,
        { retryAfterMs: limiter.nextSlotAt('login') - now() },
      );
    }
    takeRestBudget();
    try {
      remember(await api.login(config.email, config.password));
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof WorxError && err.kind === ERROR_KINDS.CREDENTIALS) {
        credentialsRefused = true;
      }
      throw noteError(err);
    }
  }

  const session = {
    account,

    /** A valid access token, refreshed or obtained when needed (one at a time). */
    async accessToken() {
      assertAllowed();
      if (tokens?.accessToken && tokens.expiresAt - EXPIRY_MARGIN_MS > now()) {
        return tokens.accessToken;
      }
      pending ??= obtain().finally(() => {
        pending = null;
      });
      return pending;
    },

    /**
     * Runs one REST call with a valid token; a refused token is refreshed and
     * the call retried once.
     * @template T
     * @param {(accessToken: string) => Promise<T>} call
     * @returns {Promise<T>}
     */
    async request(call) {
      const token = await session.accessToken();
      takeRestBudget();
      try {
        const answer = await call(token);
        cleared();
        return answer;
      } catch (err) {
        if (!(err instanceof WorxError) || err.kind !== ERROR_KINDS.TOKEN) {
          throw noteError(err);
        }
      }
      if (tokens) {
        tokens.expiresAt = 0;
      }
      const fresh = await session.accessToken();
      takeRestBudget();
      try {
        const answer = await call(fresh);
        cleared();
        return answer;
      } catch (err) {
        throw noteError(err);
      }
    },

    /** The tokens were refused by the MQTT broker: refresh before the next connection. */
    expireAccessToken() {
      if (tokens) {
        tokens.expiresAt = 0;
      }
    },

    get credentialsRefused() {
      return credentialsRefused;
    },
    get blockedUntil() {
      return blockedUntil > now() ? blockedUntil : 0;
    },
  };
  return session;
}
