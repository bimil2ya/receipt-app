// Node.js 런타임 API용 CORS 헬퍼 (Express/Vercel 스타일)
import { ALLOWED_ORIGINS } from './_cors.js';

export function applyCorsHeaders(req, res, options = {}) {
  const {
    methods = 'POST, GET, OPTIONS',
    extraHeaders = '',
  } = options;

  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  
  const headers = extraHeaders ? `Content-Type, Authorization, ${extraHeaders}` : 'Content-Type, Authorization';
  res.setHeader('Access-Control-Allow-Headers', headers);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // OPTIONS 처리됨
  }
  
  return false;
}

export function checkOriginAllowed(req, res) {
  const origin = req.headers.origin || '';
  
  if (process.env.VERCEL_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
    const referer = req.headers.referer || '';
    const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o + '/') || referer === o);
    if (!refererOk) {
      res.status(403).json({
        success: false,
        error: '허용되지 않은 출처',
        detail: `origin: ${origin || '(없음)'}`,
      });
      return false;
    }
  }
  
  return true;
}
