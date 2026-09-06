// 표준화된 에러 응답 핸들러

export class ApiError extends Error {
  constructor(statusCode, error, message, detail = null) {
    super(message || error);
    this.statusCode = statusCode;
    this.error = error;
    this.message = message;
    this.detail = detail;
  }

  toJson() {
    const response = {
      success: false,
      error: this.error,
      message: this.message,
    };
    if (this.detail) {
      response.detail = this.detail;
    }
    return response;
  }
}

// 공통 에러 생성 함수
export function createError(statusCode, error, message, detail = null) {
  return new ApiError(statusCode, error, message, detail);
}

// Edge Runtime 응답 (Web API)
export function responseError(error, headers = {}) {
  const resHeaders = { 'Content-Type': 'application/json', ...headers };
  return new Response(JSON.stringify(error.toJson()), {
    status: error.statusCode,
    headers: resHeaders,
  });
}

// Node.js Runtime 응답 (Express)
export function jsonError(res, error) {
  return res.status(error.statusCode).json(error.toJson());
}

// 사전 정의된 에러들
export const Errors = {
  // 4xx
  badRequest: (detail) => createError(400, 'BAD_REQUEST', '잘못된 요청', detail),
  unauthorized: (detail) => createError(401, 'UNAUTHORIZED', '인증이 필요합니다', detail),
  forbidden: (detail) => createError(403, 'FORBIDDEN', '접근이 거부되었습니다', detail),
  notFound: (detail) => createError(404, 'NOT_FOUND', '요청한 리소스를 찾을 수 없습니다', detail),
  methodNotAllowed: () => createError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 HTTP 메서드입니다'),
  rateLimit: (retryAfter) => createError(429, 'RATE_LIMIT', '요청 빈도 제한', `${retryAfter}초 후 재시도하세요`),
  
  // 5xx
  internalError: (detail) => createError(500, 'INTERNAL_ERROR', '서버 오류가 발생했습니다', detail),

  // API 특화 에러
  notReceipt: () => createError(400, 'NOT_RECEIPT', '영수증 이미지가 아닙니다'),
  apiKeyMissing: () => createError(401, 'API_KEY_MISSING', 'OCR 설정이 없습니다', 'Anthropic API 키가 필요합니다'),
  unsupportedMediaType: (mediaType) => createError(400, 'UNSUPPORTED_MEDIA_TYPE', '지원하지 않는 이미지 형식입니다', `받은 형식: ${mediaType}`),
};

// ═════════════════════════════════════════════════════════════════════════════
// Google Drive API 에러 처리 (Phase 1-2 추가)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Google Drive API 에러 분석 및 재시도 전략 결정
 * @param {Error} error - API 에러
 * @returns {Object} { shouldRetry, message, delay }
 */
export function handleDriveError(error) {
  const status = error.status || error.code;

  switch (status) {
    case 403:
      // 권한 오류: 재시도 금지
      return {
        shouldRetry: false,
        message: '권한 거부 (403) - 토큰 만료 또는 권한 불충분',
        delay: 0
      };

    case 409:
      // 충돌 (파일/폴더 중복 생성): 재시도 권장
      return {
        shouldRetry: true,
        message: '리소스 충돌 (409) - 다른 프로세스가 생성함',
        delay: 1000
      };

    case 429:
      // Rate Limit 초과: 지수 백오프
      return {
        shouldRetry: true,
        message: 'API 한도 초과 (429) - 요청 속도 조절 필요',
        delay: 5000
      };

    case 500:
    case 503:
      // 서버 오류: 재시도 권장
      return {
        shouldRetry: true,
        message: `서버 오류 (${status}) - 일시적 오류`,
        delay: 2000
      };

    default:
      return {
        shouldRetry: false,
        message: `알 수 없는 오류 (${status}) - ${error.message}`,
        delay: 0
      };
  }
}

/**
 * 자동 재시도 로직 (고차 함수)
 * @param {Function} fn - 실행할 비동기 함수
 * @param {number} maxRetries - 최대 재시도 횟수 (기본값: 5)
 * @returns {Promise} fn의 반환값
 */
export async function withRetry(fn, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const { shouldRetry, message, delay } = handleDriveError(error);

      // 마지막 시도이거나 재시도 불가능한 에러면 throw
      if (!shouldRetry || attempt === maxRetries - 1) {
        console.error(`❌ ${message} (시도: ${attempt + 1}/${maxRetries})`);
        throw error;
      }

      // 재시도 대기
      console.warn(`⚠️ ${message} (시도: ${attempt + 1}/${maxRetries}, ${delay}ms 후 재시도...)`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
