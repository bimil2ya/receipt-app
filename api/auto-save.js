import { ALLOWED_ORIGINS } from './_cors.js';
import { applyCorsHeaders, checkOriginAllowed } from './_corsNode.js';
import { jsonError, Errors } from './_errorHandler.js';
import { supabaseAdmin } from './_supabase.js';

export const config = { maxDuration: 10 };

/**
 * POST /api/auto-save
 * 자동 저장 엔드포인트 - 초안 데이터를 서버에 저장
 *
 * Request:
 *   {
 *     storeName: string (필수)
 *     totalAmount: number (필수)
 *     date?: string
 *     category?: string
 *     useTime?: string
 *     approvalNum?: string
 *     bizNum?: string
 *     cardNumber?: string
 *     note?: string
 *   }
 *
 * Response (success):
 *   {
 *     status: 'draft',
 *     receiptId: string,
 *     savedAt: ISO timestamp
 *   }
 *
 * Response (error):
 *   { status: 'error', code: 'INVALID_REQUEST', message: '...' }
 */

function validateAutoSaveRequest(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '요청 본문이 필요합니다' };
  }

  const { storeName, totalAmount } = data;

  // 필수 필드: storeName
  if (!storeName || typeof storeName !== 'string' || storeName.trim() === '') {
    return { ok: false, error: '사용처(storeName)는 필수입니다' };
  }

  // 필수 필드: totalAmount
  if (totalAmount === null || totalAmount === undefined || totalAmount === '') {
    return { ok: false, error: '금액(totalAmount)은 필수입니다' };
  }

  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: '금액은 0 이상의 숫자여야 합니다' };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  applyCorsHeaders(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json(jsonError(Errors.METHOD_NOT_ALLOWED));
    return;
  }

  // CORS 검증
  if (!checkOriginAllowed(req.headers.origin, ALLOWED_ORIGINS)) {
    res.status(403).json(jsonError(Errors.ORIGIN_NOT_ALLOWED));
    return;
  }

  try {
    const validation = validateAutoSaveRequest(req.body);
    if (!validation.ok) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: validation.error,
      });
      return;
    }

    const {
      storeName,
      totalAmount,
      date = null,
      category = null,
      useTime = null,
      approvalNum = null,
      bizNum = null,
      cardNumber = null,
      note = null,
    } = req.body;

    // Supabase에 draft 상태로 저장
    const receiptData = {
      storeName: String(storeName).trim(),
      totalAmount: Number(totalAmount),
      date: date || null,
      category: category || null,
      useTime: useTime || null,
      approvalNum: approvalNum || null,
      bizNum: bizNum || null,
      cardNumber: cardNumber || null,
      note: note || null,
      status: 'draft',
      isDraft: true,
      createdAt: new Date().toISOString(),
    };

    // Supabase에 저장 (receipts 테이블 또는 draft_receipts 테이블)
    const { data: savedReceipt, error } = await supabaseAdmin
      .from('receipts')
      .insert([receiptData])
      .select('id, createdAt')
      .single();

    if (error) {
      console.error('[auto-save] Supabase insert error:', error);
      res.status(500).json({
        status: 'error',
        code: 'SAVE_FAILED',
        message: '초안 저장에 실패했습니다',
      });
      return;
    }

    res.status(200).json({
      status: 'draft',
      receiptId: savedReceipt.id,
      savedAt: savedReceipt.createdAt,
    });
  } catch (err) {
    console.error('[auto-save] Unexpected error:', err);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다',
    });
  }
}
