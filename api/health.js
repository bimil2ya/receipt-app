export const config = { runtime: 'edge' };

import { getCorsHeaders, handleCorsPreFlight } from './_cors.js';

export default async function handler(req) {
  const corsPreFlight = handleCorsPreFlight(req);
  if (corsPreFlight) return corsPreFlight;

  const resHeaders = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };

  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: resHeaders });

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const hasApiKey = !!(apiKey && apiKey.startsWith('sk-ant-'));

    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || 'unknown',
      hasApiKey,
      message: hasApiKey ? '✅ 배포 정상' : '⚠️ API 키 설정 필요'
    }), { status: 200, headers: resHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500, headers: resHeaders });
  }
}
