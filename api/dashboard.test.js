import { describe, it, expect, beforeEach, vi } from 'vitest';

import handler from './dashboard.js';
import { signToken } from './_dashboardToken.js';
import { setTestRedis, memoryRedis, KvUnavailableError } from './_kv.js';

const throwingRedis = () => {
  const boom = async () => {
    throw new Error('kv down');
  };
  return { incr: boom, expire: boom, del: boom, get: boom, set: boom };
};
import { sendRecoveryEmail } from './_dashboardMail.js';

vi.mock('./_dashboardMail.js', () => ({
  sendRecoveryEmail: vi.fn(async () => ({ sent: true })),
}));

const OWNER_PW = 'owner-secret-123456';
const STAFF_PW = 'staff-secret-654321';

function makeReq({ method = 'GET', action, body = {}, headers = {}, query = {} } = {}) {
  return {
    method,
    query: { ...(action ? { action } : {}), ...query },
    body,
    headers: { origin: 'http://localhost:5173', ...headers },
    socket: { remoteAddress: '10.0.0.1' },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(payload) {
      this.ended = true;
      if (payload !== undefined) this.body = payload;
      return this;
    },
  };
  return res;
}

async function call(reqOpts) {
  const req = makeReq(reqOpts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  setTestRedis(memoryRedis());
  vi.clearAllMocks();
  process.env.DASHBOARD_PW_OWNER = OWNER_PW;
  process.env.DASHBOARD_PW_STAFF = STAFF_PW;
  process.env.DASHBOARD_TOKEN_SECRET = 'test-signing-secret';
  process.env.RECOVERY_EMAIL = 'bimil2ya@naver.com';
  delete process.env.VERCEL_ENV;
});

describe('dashboard router', () => {
  it('rejects an unknown action with 400', async () => {
    const res = await call({ method: 'POST', action: 'nope' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing action with 400', async () => {
    const res = await call({ method: 'GET' });
    expect(res.statusCode).toBe(400);
  });

  it('enforces the method per action (405)', async () => {
    expect((await call({ method: 'GET', action: 'auth' })).statusCode).toBe(405);
    expect((await call({ method: 'POST', action: 'data' })).statusCode).toBe(405);
  });

  it('short-circuits OPTIONS via CORS', async () => {
    const res = await call({ method: 'OPTIONS', action: 'auth' });
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
  });
});

describe('action=auth', () => {
  it('returns a token for the owner password', async () => {
    const res = await call({ method: 'POST', action: 'auth', body: { password: OWNER_PW } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('returns a token for the staff password', async () => {
    const res = await call({ method: 'POST', action: 'auth', body: { password: STAFF_PW } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await call({ method: 'POST', action: 'auth', body: { password: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });

  it('locks out after 5 failures from the same ip (KV survives across calls)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await call({ method: 'POST', action: 'auth', body: { password: 'wrong' } });
      expect(r.statusCode).toBe(401);
    }
    const sixth = await call({ method: 'POST', action: 'auth', body: { password: 'wrong' } });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.body.retryAfter).toBeGreaterThan(0);

    // 잠긴 뒤에는 올바른 비밀번호도 429 (윈도 만료 전).
    const correct = await call({ method: 'POST', action: 'auth', body: { password: OWNER_PW } });
    expect(correct.statusCode).toBe(429);
  });

  it('fails closed (503) when KV is unavailable', async () => {
    setTestRedis(throwingRedis());
    const res = await call({ method: 'POST', action: 'auth', body: { password: OWNER_PW } });
    expect(res.statusCode).toBe(503);
  });

  it('fails closed (503) on a deployment with no KV credentials (getRedis sync throw)', async () => {
    setTestRedis(null); // real getRedis() path
    process.env.VERCEL_ENV = 'production';
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const res = await call({ method: 'POST', action: 'auth', body: { password: OWNER_PW } });
    expect(res.statusCode).toBe(503);
  });

  it('still succeeds if only rlReset (post-success unlock) fails', async () => {
    let incrs = 0;
    setTestRedis({
      incr: async () => {
        incrs += 1;
        return 1;
      },
      expire: async () => 1,
      get: async () => null,
      set: async () => 'OK',
      del: async () => {
        throw new Error('unlock failed');
      },
    });
    const res = await call({ method: 'POST', action: 'auth', body: { password: OWNER_PW } });
    expect(res.statusCode).toBe(200);
    expect(incrs).toBeGreaterThan(0);
  });

  it('buckets lockout by x-real-ip, not by a spoofable x-forwarded-for', async () => {
    const asIp = (ip, xff) => ({
      method: 'POST',
      action: 'auth',
      body: { password: 'wrong' },
      headers: { 'x-real-ip': ip, ...(xff ? { 'x-forwarded-for': xff } : {}) },
    });
    for (let i = 0; i < 5; i += 1) {
      await call(asIp('1.1.1.1'));
    }
    // 같은 x-real-ip — x-forwarded-for를 바꿔도 잠금 유지
    expect((await call(asIp('1.1.1.1', '9.9.9.9'))).statusCode).toBe(429);
    // 다른 x-real-ip — 별개 버킷
    expect((await call(asIp('2.2.2.2'))).statusCode).toBe(401);
  });
});

describe('action=forgot', () => {
  it('always answers the same and only sends once per hour', async () => {
    const first = await call({ method: 'POST', action: 'forgot', body: { role: 'owner' } });
    const second = await call({ method: 'POST', action: 'forgot', body: { role: 'owner' } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(sendRecoveryEmail).toHaveBeenCalledTimes(1);
  });

  it('sends to the fixed RECOVERY_EMAIL regardless of request body', async () => {
    await call({
      method: 'POST',
      action: 'forgot',
      body: { role: 'staff', email: 'attacker@evil.test' },
    });
    expect(sendRecoveryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'bimil2ya@naver.com', role: 'staff' }),
    );
  });

  it('still returns the same 200 when KV is down (no info leak, no mail)', async () => {
    setTestRedis(throwingRedis());
    const res = await call({ method: 'POST', action: 'forgot', body: { role: 'owner' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: '메일을 보냈습니다' });
    expect(sendRecoveryEmail).not.toHaveBeenCalled();
  });
});

describe('action=data — token', () => {
  it('rejects a forged token with 401', async () => {
    const res = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: 'Bearer not.a.real.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    const token = signToken({ role: 'owner' }, { ttlSec: -10 });
    const res = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects any token when the signing secret is missing', async () => {
    const token = signToken({ role: 'owner' }, { ttlSec: 3600 });
    delete process.env.DASHBOARD_TOKEN_SECRET;
    const res = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('action=data — role-scoped payload (contract)', () => {
  async function fetchPayload(role) {
    const token = signToken({ role }, { ttlSec: 3600 });
    const res = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: `Bearer ${token}` },
      query: { month: '2026-09' },
    });
    expect(res.statusCode).toBe(200);
    return res;
  }

  it('gives the owner flags and coDining', async () => {
    const { body } = await fetchPayload('owner');
    expect('flags' in body).toBe(true);
    expect('coDining' in body).toBe(true);
    expect(body.role).toBe('owner');
  });

  it('omits flags and coDining keys entirely for staff', async () => {
    const { body } = await fetchPayload('staff');
    expect('flags' in body).toBe(false);
    expect('coDining' in body).toBe(false);
    expect(body.role).toBe('staff');
  });

  it('downgrades an unrecognized role to staff', async () => {
    const token = signToken({ role: 'manager' }, { ttlSec: 3600 });
    const res = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('staff');
    expect('flags' in res.body).toBe(false);
  });

  it('keeps totals internally consistent', async () => {
    const { body } = await fetchPayload('owner');
    const ledgerSum = body.ledger.reduce((a, r) => a + r.amount, 0);
    const catSum = Object.values(body.byCategory).reduce((a, b) => a + b, 0);
    expect(ledgerSum).toBe(body.totals.spent);
    expect(catSum).toBe(body.totals.spent);
    expect(body.totals.core + body.totals.fuelMed).toBe(body.totals.spent);
  });

  it('never lets a team review count exceed its receipt count', async () => {
    const { body } = await fetchPayload('staff');
    for (const t of body.teams) {
      expect(t.review.ok + t.review.req + t.review.none).toBeLessThanOrEqual(t.receiptCount);
    }
  });

  it('sets a private no-store cache header', async () => {
    const token = signToken({ role: 'staff' }, { ttlSec: 3600 });
    const res = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('includes signed report refs on every team (both roles)', async () => {
    for (const role of ['owner', 'staff']) {
      const { body } = await fetchPayload(role);
      for (const t of body.teams) {
        expect(Array.isArray(t.reports)).toBe(true);
        for (const r of t.reports) {
          if (r.available) expect(typeof r.ref).toBe('string');
        }
      }
    }
  });
});

describe('action=report', () => {
  async function anyRef() {
    const token = signToken({ role: 'staff' }, { ttlSec: 3600 });
    const data = await call({
      method: 'GET',
      action: 'data',
      headers: { authorization: `Bearer ${token}` },
      query: { month: '2026-09' },
    });
    return data.body.teams[0].reports.find((r) => r.available).ref;
  }

  it('401 without a valid token', async () => {
    const ref = await anyRef();
    const res = await call({ method: 'GET', action: 'report', query: { ref } });
    expect(res.statusCode).toBe(401);
  });

  it('400 for a tampered / unsigned ref', async () => {
    const token = signToken({ role: 'staff' }, { ttlSec: 3600 });
    const res = await call({
      method: 'GET',
      action: 'report',
      headers: { authorization: `Bearer ${token}` },
      query: { ref: 'arbitrary-drive-file-id~deadbeef' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('streams a PDF for a valid signed ref (staff and owner both allowed)', async () => {
    const ref = await anyRef();
    for (const role of ['staff', 'owner']) {
      const token = signToken({ role }, { ttlSec: 3600 });
      const res = await call({
        method: 'GET',
        action: 'report',
        headers: { authorization: `Bearer ${token}` },
        query: { ref },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/pdf');
      expect(res.headers['Cache-Control']).toBe('private, no-store');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });
});

// KvUnavailableError는 공개 계약이므로 import가 유지되는지 가벼운 확인.
describe('_kv contract', () => {
  it('exposes a typed unavailable error', () => {
    expect(new KvUnavailableError('x').code).toBe('KV_UNAVAILABLE');
  });
});
