// -----------------------------------------------------------------------------
// REST client of the Positec cloud (Worx, Kress, LandXcape).
//
//   POST https://<authHost>/oauth/token          OAuth2 password / refresh grant
//   GET  https://<apiHost>/api/v2/product-items  the mowers of the account, with
//                                                their last status and MQTT topics
//   GET  https://<apiHost>/api/v2/products       the model catalog (names)
//
// Stateless: the tokens live in src/worx/session.js. No token, password or
// e-mail ever reaches an error message: callers log those messages.
// -----------------------------------------------------------------------------

import { cloudOf } from './clouds.js';

const REQUEST_TIMEOUT_MS = 20_000;

/** What went wrong, so the caller can react (stop, back off, refresh). */
export const ERROR_KINDS = {
  CREDENTIALS: 'credentials', // the account refused the e-mail or password
  TOKEN: 'token', // the access token was refused: refresh it
  RATE_LIMIT: 'rate_limit', // 429: the cloud asks us to slow down
  NETWORK: 'network', // DNS, TLS, timeout...
  SERVER: 'server', // 5xx
  HTTP: 'http', // anything else
};

export class WorxError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message safe to log: never holds a secret
   * @param {{ status?: number, retryAfterMs?: number }} [details]
   */
  constructor(kind, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'WorxError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry-After header (seconds or HTTP date) in milliseconds, if any. */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * @param {object} options
 * @param {string} options.brand
 * @param {typeof fetch} [options.fetch]
 */
export function createApi({ brand, fetch: fetchImpl = globalThis.fetch }) {
  const cloud = cloudOf(brand);

  async function request(url, init, { auth = false } = {}) {
    // Only the path is ever logged: the host is known, the query is harmless.
    const where = new URL(url).pathname;
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.name);
      throw new WorxError(ERROR_KINDS.NETWORK, `${where}: cloud unreachable (${reason})`);
    }
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new WorxError(ERROR_KINDS.HTTP, `${where}: invalid JSON answer`, {
          status: response.status,
        });
      }
    }
    const status = response.status;
    if (status === 429) {
      throw new WorxError(ERROR_KINDS.RATE_LIMIT, `${where}: too many requests (HTTP 429)`, {
        status,
        retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after')),
      });
    }
    if (auth && (status === 400 || status === 401 || status === 403)) {
      throw new WorxError(ERROR_KINDS.CREDENTIALS, `${where}: refused (HTTP ${status})`, {
        status,
      });
    }
    if (status === 401 || status === 403) {
      throw new WorxError(ERROR_KINDS.TOKEN, `${where}: token refused (HTTP ${status})`, {
        status,
      });
    }
    if (status >= 500) {
      throw new WorxError(ERROR_KINDS.SERVER, `${where}: cloud error (HTTP ${status})`, {
        status,
      });
    }
    throw new WorxError(ERROR_KINDS.HTTP, `${where}: HTTP ${status}`, { status });
  }

  function tokenRequest(body) {
    return request(
      `https://${cloud.authHost}/oauth/token`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: cloud.clientId, scope: '*', ...body }),
      },
      { auth: true },
    ).then(toTokens);
  }

  function get(path, accessToken) {
    return request(`https://${cloud.apiHost}/api/v2/${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
  }

  return {
    cloud,
    /** Password grant: the e-mail and password of the vendor app account. */
    login: (email, password) => tokenRequest({ grant_type: 'password', username: email, password }),
    /** Refresh grant: no password involved. */
    refresh: (refreshToken) =>
      tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    /** The mowers of the account (status=1: with their last known status). */
    async productItems(accessToken) {
      const items = await get('product-items?status=1&gps_status=1', accessToken);
      if (!Array.isArray(items)) {
        throw new WorxError(ERROR_KINDS.HTTP, 'product-items: unexpected answer');
      }
      return items;
    },
    /** The model catalog, to name the mowers (read once per start). */
    async products(accessToken) {
      const items = await get('products', accessToken);
      return Array.isArray(items) ? items : [];
    },
  };
}

function toTokens(body) {
  if (!body || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new WorxError(ERROR_KINDS.HTTP, 'oauth/token: no token in the answer');
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    // One hour when the answer does not say.
    expiresInMs: (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}
