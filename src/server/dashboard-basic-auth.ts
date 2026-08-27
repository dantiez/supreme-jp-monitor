// A shared password in front of the dashboard, for the moment it stops being
// a thing on one person's laptop.
//
// WHY IT HAS TO EXIST BEFORE HOSTING: the dashboard reads the whole catalogue,
// hands out an export, and -- the part that is not merely a privacy question --
// exposes POST /api/scan. Anyone holding an unprotected URL could start a
// hundred-second scan, repeatedly, against both Supreme and the database. So
// this guards every route, not only the readable ones.
//
// WHY BASIC AUTH AND NOT ACCOUNTS: two people share one password. Sessions,
// a user table, and a login form would all be scaffolding around a fact that
// fits in an environment variable. The browser remembers the credentials, so
// the reader types them once. It is exactly as strong as the password and the
// transport, and no stronger -- which is why it refuses to run without TLS.

import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'crypto';

/** Compare without leaking the answer through how long it took. */
function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself be a tell.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Read `Authorization: Basic ...` into a password, or null if unusable. */
export function passwordFromHeader(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, encoded] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  // "user:password" -- the username is not checked. One shared secret, and
  // pretending otherwise would suggest per-person accounts that do not exist.
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;
  return decoded.slice(separator + 1);
}

export interface AuthConfig {
  /** The shared password. Undefined means none was configured. */
  password: string | undefined;
  /** Host the server is bound to, used to decide whether a password is required. */
  host: string;
}

/** Loopback means "this machine", where a password protects nobody. */
export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export class MissingPasswordError extends Error {}

/**
 * Build the middleware, or throw if the configuration cannot be honoured.
 *
 * Bound to a public interface with no password, this THROWS rather than warns.
 * The previous version printed a warning and served anyway -- and a warning in
 * a log nobody reads is indistinguishable from no protection at all. Refusing
 * to start is the only version of this that cannot be missed.
 */
export function createDashboardAuth(config: AuthConfig): RequestHandler {
  const { password, host } = config;

  if (!password) {
    if (!isLoopback(host)) {
      throw new MissingPasswordError(
        `Refusing to serve on ${host} without a password. Set DASHBOARD_PASSWORD ` +
          '-- the dashboard exposes the export and the scan trigger to anyone ' +
          'holding the URL.'
      );
    }
    // On loopback, no password and no prompt: the reader is already the owner
    // of the machine, and a login on your own laptop is friction with no gain.
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    // Behind Render's proxy the connection to us is plain HTTP; the header says
    // what the browser actually used. Basic auth over cleartext hands the
    // password to anyone on the path, so refuse rather than serve insecurely.
    const proto = req.get('x-forwarded-proto');
    if (proto && proto.split(',')[0]?.trim() === 'http') {
      res.status(400).type('text/plain').send('HTTPS required.');
      return;
    }

    const given = passwordFromHeader(req.get('authorization'));
    if (given !== null && matches(given, password)) {
      next();
      return;
    }

    // The realm string shows in the browser's prompt.
    res.set('WWW-Authenticate', 'Basic realm="Supreme JP monitor", charset="UTF-8"');
    res.status(401).type('text/plain').send('Cần mật khẩu.');
  };
}
