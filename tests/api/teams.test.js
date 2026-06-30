import { afterEach, describe, expect, it } from 'vitest';
import handler, { normalizeTeams } from '../../api/teams.js';

const originalEnv = { ...process.env };

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('teams api utils', () => {
  it('normalizes team names on save and load', () => {
    expect(normalizeTeams([
      { id: 3, names: '류준,류수현' },
      { id: 4, names: '  이선수 ,  박종일  ' },
    ])).toEqual([
      { id: 3, names: '류준, 류수현' },
      { id: 4, names: '이선수, 박종일' },
    ]);
  });

  it('rejects admin verification when ADMIN_PIN is not configured', async () => {
    delete process.env.ADMIN_PIN;
    const res = createMockRes();

    await handler({
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'x-admin-pin': '1234' },
      body: { action: 'verify' },
    }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false });
  });

  it('rejects admin verification with the wrong PIN', async () => {
    process.env.ADMIN_PIN = '8633';
    const res = createMockRes();

    await handler({
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'x-admin-pin': '0000' },
      body: { action: 'verify' },
    }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it('accepts admin verification with the server PIN', async () => {
    process.env.ADMIN_PIN = '8633';
    const res = createMockRes();

    await handler({
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'x-admin-pin': '8633' },
      body: { action: 'verify' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
