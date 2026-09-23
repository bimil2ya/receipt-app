import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./_supabase.js', () => {
  const mockSupabase = {
    from: vi.fn(() => ({
      insert: vi.fn(function() {
        return {
          select: vi.fn(function() {
            return {
              single: vi.fn(),
            };
          }),
        };
      }),
    })),
  };
  return { supabaseAdmin: mockSupabase };
});

vi.mock('./_cors.js', () => ({
  ALLOWED_ORIGINS: ['http://localhost:3000', 'https://example.com'],
}));

vi.mock('./_corsNode.js', () => ({
  applyCorsHeaders: vi.fn(),
  checkOriginAllowed: vi.fn((origin) => origin === 'http://localhost:3000' || origin === 'https://example.com'),
}));

vi.mock('./_errorHandler.js', () => ({
  jsonError: (error) => error,
  Errors: {
    METHOD_NOT_ALLOWED: { code: 'METHOD_NOT_ALLOWED', statusCode: 405 },
    ORIGIN_NOT_ALLOWED: { code: 'ORIGIN_NOT_ALLOWED', statusCode: 403 },
  },
}));

import handler from './auto-save.js';
import { supabaseAdmin } from './_supabase.js';

const mockSupabase = vi.mocked(supabaseAdmin);

describe('POST /api/auto-save', () => {
  let mockRes;
  let insertSpy;
  let selectSpy;
  let singleSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRes = {
      status: vi.fn(function(code) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function(data) {
        this.jsonData = data;
        return this;
      }),
      end: vi.fn(),
    };

    // Setup Supabase mock chain
    singleSpy = vi.fn();
    selectSpy = vi.fn(() => ({
      single: singleSpy,
    }));
    insertSpy = vi.fn(() => ({
      select: selectSpy,
    }));

    mockSupabase.from.mockReturnValue({
      insert: insertSpy,
    });
  });

  it('storeName 필수 - 없으면 400 에러', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        totalAmount: 10000,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: '사용처(storeName)는 필수입니다',
      })
    );
  });

  it('storeName 빈 문자열이면 400 에러', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '   ',
        totalAmount: 10000,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INVALID_REQUEST',
      })
    );
  });

  it('totalAmount 필수 - 없으면 400 에러', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '카페',
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: '금액(totalAmount)은 필수입니다',
      })
    );
  });

  it('totalAmount 음수면 400 에러', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '카페',
        totalAmount: -5000,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INVALID_REQUEST',
        message: '금액은 0 이상의 숫자여야 합니다',
      })
    );
  });

  it('필수 필드만으로 저장 성공', async () => {
    singleSpy.mockResolvedValue({
      data: {
        id: 'receipt-123',
        createdAt: '2026-09-23T12:00:00Z',
      },
      error: null,
    });

    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '카페',
        totalAmount: 5000,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      status: 'draft',
      receiptId: 'receipt-123',
      savedAt: '2026-09-23T12:00:00Z',
    });
    expect(insertSpy).toHaveBeenCalled();
  });

  it('선택 필드 포함하여 저장', async () => {
    singleSpy.mockResolvedValue({
      data: {
        id: 'receipt-456',
        createdAt: '2026-09-23T12:30:00Z',
      },
      error: null,
    });

    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '식당',
        totalAmount: 25000,
        date: '2026-09-23',
        category: '식사',
        useTime: '12:30',
        approvalNum: '12345',
        bizNum: '123-45-67890',
        cardNumber: '1234-****-****-5678',
        note: '회의 점심',
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        receiptId: 'receipt-456',
      })
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          storeName: '식당',
          totalAmount: 25000,
          date: '2026-09-23',
          category: '식사',
          useTime: '12:30',
          note: '회의 점심',
        }),
      ])
    );
  });

  it('0원 영수증도 저장', async () => {
    singleSpy.mockResolvedValue({
      data: {
        id: 'receipt-zero',
        createdAt: '2026-09-23T13:00:00Z',
      },
      error: null,
    });

    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '무료 이벤트',
        totalAmount: 0,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
      })
    );
  });

  it('요청 본문이 없으면 400 에러', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: null,
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('Supabase 저장 실패 시 500 에러', async () => {
    singleSpy.mockResolvedValue({
      data: null,
      error: { message: 'Database error' },
    });

    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: {
        storeName: '카페',
        totalAmount: 5000,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        code: 'SAVE_FAILED',
      })
    );
  });

  it('OPTIONS 요청 처리', async () => {
    const mockReq = {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000' },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.end).toHaveBeenCalled();
  });

  it('GET 요청은 405 에러', async () => {
    const mockReq = {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(405);
  });

  it('CORS 체크 - 허용되지 않은 origin은 403 에러', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'https://evil.com' },
      body: {
        storeName: '카페',
        totalAmount: 5000,
      },
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
  });
});
