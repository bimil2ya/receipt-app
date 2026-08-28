// Vercel 파일 기반 라우팅에서 _ 접두사 파일은 API 라우트에서 제외됩니다.
// 모든 API 엔드포인트가 공통으로 사용하는 CORS 설정입니다.
// Edge 런타임도 import하므로 Node.js 전용 모듈 사용 금지.

export const ALLOWED_ORIGINS = [
  'https://receipt-app-rho.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

export function getCorsHeaders(req, options = {}) {
  const {
    allowMethods = 'POST, OPTIONS',
    allowHeaders = 'Content-Type',
  } = options;

  const origin = req.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Vary': 'Origin',
  };
}

export function handleCorsPreFlight(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: getCorsHeaders(req),
    });
  }
  return null;
}
