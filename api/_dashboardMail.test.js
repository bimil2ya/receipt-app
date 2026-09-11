import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({
  default: { createTransport: (...args) => createTransport(...args) },
}));

const ENV_KEYS = [
  'DASHBOARD_SMTP_HOST',
  'DASHBOARD_SMTP_PORT',
  'DASHBOARD_SMTP_USER',
  'DASHBOARD_SMTP_PASS',
  'DASHBOARD_SMTP_FROM',
];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
  sendMail.mockReset();
  createTransport.mockClear();
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
});

describe('sendRecoveryEmail', () => {
  it('SMTP env가 없으면 전송을 생략하고 no_sender를 반환한다', async () => {
    const { sendRecoveryEmail } = await import('./_dashboardMail.js');
    const res = await sendRecoveryEmail({
      to: 'owner@example.com',
      role: 'owner',
      password: 'secret',
      ip: '1.2.3.4',
      at: '2026-09-11T00:00:00Z',
    });
    expect(res).toEqual({ sent: false, reason: 'no_sender' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('수신 주소(RECOVERY_EMAIL)가 없으면 SMTP가 설정돼도 전송을 생략한다', async () => {
    process.env.DASHBOARD_SMTP_HOST = 'smtp.example.com';
    process.env.DASHBOARD_SMTP_USER = 'bot@example.com';
    process.env.DASHBOARD_SMTP_PASS = 'app-password';
    const { sendRecoveryEmail } = await import('./_dashboardMail.js');
    const res = await sendRecoveryEmail({
      to: '',
      role: 'staff',
      password: 'secret',
      ip: '1.2.3.4',
      at: '2026-09-11T00:00:00Z',
    });
    expect(res).toEqual({ sent: false, reason: 'no_sender' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('SMTP env가 갖춰지면 실제로 발송하고 sent:true를 반환한다', async () => {
    process.env.DASHBOARD_SMTP_HOST = 'smtp.example.com';
    process.env.DASHBOARD_SMTP_PORT = '465';
    process.env.DASHBOARD_SMTP_USER = 'bot@example.com';
    process.env.DASHBOARD_SMTP_PASS = 'app-password';
    process.env.DASHBOARD_SMTP_FROM = '출장비 대시보드 <bot@example.com>';
    sendMail.mockResolvedValueOnce({ messageId: 'abc' });

    const { sendRecoveryEmail } = await import('./_dashboardMail.js');
    const res = await sendRecoveryEmail({
      to: 'owner@example.com',
      role: 'owner',
      password: 'super-secret-passphrase',
      ip: '1.2.3.4',
      at: '2026-09-11T00:00:00Z',
    });

    expect(res).toEqual({ sent: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 465, secure: true }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '출장비 대시보드 <bot@example.com>',
        to: 'owner@example.com',
        subject: expect.stringContaining('owner'),
        text: expect.stringContaining('super-secret-passphrase'),
      }),
    );
  });

  it('465가 아닌 포트는 secure:false(STARTTLS)로 연결한다', async () => {
    process.env.DASHBOARD_SMTP_HOST = 'smtp2.example.com';
    process.env.DASHBOARD_SMTP_USER = 'bot2@example.com';
    process.env.DASHBOARD_SMTP_PASS = 'app-password';
    sendMail.mockResolvedValueOnce({});

    const { sendRecoveryEmail } = await import('./_dashboardMail.js');
    await sendRecoveryEmail({
      to: 'staff@example.com',
      role: 'staff',
      password: 'x',
      ip: '1.2.3.4',
      at: '2026-09-11T00:00:00Z',
    });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });

  it('전송 실패는 삼키고 send_failed를 반환한다(호출부가 응답에 노출하지 않음)', async () => {
    process.env.DASHBOARD_SMTP_HOST = 'smtp3.example.com';
    process.env.DASHBOARD_SMTP_USER = 'bot3@example.com';
    process.env.DASHBOARD_SMTP_PASS = 'app-password';
    sendMail.mockRejectedValueOnce(new Error('535 auth failed'));

    const { sendRecoveryEmail } = await import('./_dashboardMail.js');
    const res = await sendRecoveryEmail({
      to: 'owner@example.com',
      role: 'owner',
      password: 'x',
      ip: '1.2.3.4',
      at: '2026-09-11T00:00:00Z',
    });

    expect(res).toEqual({ sent: false, reason: 'send_failed' });
  });
});
