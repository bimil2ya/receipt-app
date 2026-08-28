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
