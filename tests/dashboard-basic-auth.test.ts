// The password is the only thing between a public URL and the export, the
// catalogue, and a scan trigger. A hole here is silent: the dashboard still
// looks right to the person who set it up.

import { describe, it, expect, vi } from 'vitest';
import {
  createDashboardAuth,
  passwordFromHeader,
  isLoopback,
  MissingPasswordError
} from '../src/server/dashboard-basic-auth.js';

function fakeReq(headers: Record<string, string> = {}) {
  return { get: (name: string) => headers[name.toLowerCase()] };
}

function fakeRes() {
  const res: Record<string, unknown> = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>
  };
  res.set = (k: string, v: string) => {
    (res.headers as Record<string, string>)[k] = v;
    return res;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.type = () => res;
  res.send = (b: string) => {
    res.body = b;
    return res;
  };
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (mw: any, headers: Record<string, string> = {}) => {
  const res = fakeRes();
  const next = vi.fn();
  mw(fakeReq(headers), res, next);
  return { res, next };
};

const basic = (user: string, pass: string) =>
  'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

describe('passwordFromHeader', () => {
  it('reads the password out of a Basic header', () => {
    expect(passwordFromHeader(basic('anyone', 'hunter2'))).toBe('hunter2');
  });

  it('keeps a password containing a colon intact', () => {
    // Split on the FIRST colon only. Splitting on every colon would quietly
    // truncate the password and reject a correct one.
    expect(passwordFromHeader(basic('u', 'a:b:c'))).toBe('a:b:c');
  });

  it('accepts an empty username, since none is checked', () => {
    expect(passwordFromHeader(basic('', 'p'))).toBe('p');
  });

  it('rejects anything that is not Basic', () => {
    expect(passwordFromHeader(undefined)).toBeNull();
    expect(passwordFromHeader('Bearer abc')).toBeNull();
    expect(passwordFromHeader('Basic')).toBeNull();
    expect(passwordFromHeader('Basic ' + Buffer.from('nocolon').toString('base64'))).toBeNull();
  });
});

describe('isLoopback', () => {
  it('knows the addresses that mean this machine', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
  });

  it('treats everything else as reachable by other people', () => {
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(isLoopback('192.168.1.10')).toBe(false);
  });
});

describe('createDashboardAuth', () => {
  it('refuses to start on a public host with no password', () => {
    // A warning would be printed into a log nobody reads. Refusing to boot is
    // the only version of this that cannot be missed.
    expect(() => createDashboardAuth({ password: undefined, host: '0.0.0.0' })).toThrow(
      MissingPasswordError
    );
  });

  it('asks for nothing on loopback', () => {
    // The reader already owns the machine; a login there is friction with no gain.
    const mw = createDashboardAuth({ password: undefined, host: '127.0.0.1' });
    const { next, res } = run(mw);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  describe('with a password set', () => {
    const mw = createDashboardAuth({ password: 'let-me-in', host: '0.0.0.0' });

    it('lets the right password through, whatever the username', () => {
      expect(run(mw, { authorization: basic('bạn-tôi', 'let-me-in') }).next).toHaveBeenCalled();
      expect(run(mw, { authorization: basic('', 'let-me-in') }).next).toHaveBeenCalled();
    });

    it('challenges a request with no credentials', () => {
      const { res, next } = run(mw);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      // Without this header the browser never shows a prompt.
      expect((res.headers as Record<string, string>)['WWW-Authenticate']).toContain('Basic');
    });

    it('rejects a wrong password', () => {
      const { res, next } = run(mw, { authorization: basic('u', 'wrong') });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('rejects a password that is merely a prefix of the right one', () => {
      // Guards the length-mismatch branch of the constant-time compare.
      const { next } = run(mw, { authorization: basic('u', 'let-me') });
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses to accept a password sent over plain HTTP', () => {
      // Basic auth over cleartext hands the password to anyone on the path.
      const { res, next } = run(mw, {
        authorization: basic('u', 'let-me-in'),
        'x-forwarded-proto': 'http'
      });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
    });

    it('accepts HTTPS, including a proxy chain that lists it first', () => {
      expect(
        run(mw, { authorization: basic('u', 'let-me-in'), 'x-forwarded-proto': 'https' }).next
      ).toHaveBeenCalled();
      expect(
        run(mw, { authorization: basic('u', 'let-me-in'), 'x-forwarded-proto': 'https, http' }).next
      ).toHaveBeenCalled();
    });

    it('allows a direct request that names no protocol', () => {
      // No header at all means nothing proxied it -- a local run, not a
      // downgrade. Refusing here would break `npm run dev` with a password set.
      expect(run(mw, { authorization: basic('u', 'let-me-in') }).next).toHaveBeenCalled();
    });
  });
});
