import { ALLOWED_ORIGINS } from './_cors.js';

// 비즈노 API가 (주), & 같은 한글/특수문자를 XML 인코딩해 반환하는 경우 디코딩
function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export default async function handler(req) {
  // 출처 화이트리스트 — 비즈노 API 무단 소모 방지 (upload/aggregate와 동일 패턴)
  const origin = req.headers.get?.('origin') || req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const resHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (process.env.VERCEL_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
    const referer = req.headers.get?.('referer') || req.headers.referer || '';
    const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o + '/') || referer === o);
    if (!refererOk) {
      return new Response(JSON.stringify({ success: false, error: '허용되지 않은 출처', detail: `origin: ${origin || '(없음)'}` }), { status: 403, headers: { ...resHeaders, 'Content-Type': 'application/json' } });
    }
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: resHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: resHeaders });

  try {
    const { bizNum, apiKey } = await req.json();
    if (!bizNum) return new Response(JSON.stringify({ success: false, error: '사업자번호 누락' }), { status: 400, headers: resHeaders });

    // [Legacy Cleanup]: 불완전한 정규식 제거 및 새로운 무결성 로직 적용
    // OCR 노이즈 정제: O -> 0, l/I -> 1 보정 후 숫자 이외의 문자 제거
    const cleanBizNum = bizNum
      .toString()
      .replace(/[Oo]/g, '0')
      .replace(/[lI]/g, '1')
      .replace(/[^0-9]/g, '');

    // 10자리 고정 규칙 검증
    if (cleanBizNum.length !== 10) {
      console.error(`[Bizno API Error] Invalid Business Number: ${cleanBizNum} (Length: ${cleanBizNum.length})`);
      return new Response(JSON.stringify({
        success: false,
        error: '유효하지 않은 사업자번호',
        detail: `사업자등록번호는 10자리여야 합니다. (인식된 번호: ${cleanBizNum})`
      }), { status: 400, headers: resHeaders });
    }

    // Bizno API 키 우선순위: 앱 설정 입력값 → 환경변수
    // (소스코드에 기본 키를 하드코딩하지 않음)
    const BIZNO_KEY = apiKey || process.env.BIZNO_API_KEY || '';
    if (!BIZNO_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'BIZNO API 키 미설정', detail: '앱 설정에서 비즈노 API 키를 입력하거나, Vercel 환경변수 BIZNO_API_KEY를 설정하세요.' }), { status: 401, headers: resHeaders });
    }

    // gb=1 (JSON 포맷), q=검색어. 
    // [중요] type 파라미터에 'json'을 넣으면 검색 유형 오류가 발생하므로 제거합니다.
    const url = `https://bizno.net/api/fapi?key=${BIZNO_KEY}&gb=1&q=${cleanBizNum}`;

    const response = await fetch(url);
    const text = await response.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[Bizno API Warning] Failed to parse JSON, attempting XML parse');
      // XML 파싱 (Edge Runtime에서는 DOMParser가 없으므로 정규식으로 추출)
      const extractXML = (tag) => {
        const match = text.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`, 's'));
        return match ? match[1].replace('<![CDATA[', '').replace(']]>', '').trim() : '';
      };

      const company = extractXML('company');
      const bno = extractXML('bno');
      const adr = extractXML('adr') || extractXML('address');
      const resultMsg = extractXML('resultMsg');

      if (company) {
        return new Response(JSON.stringify({
          success: true,
          company: decodeHtmlEntities(company),
          busiResNum: bno,
          address: decodeHtmlEntities(adr)
        }), { status: 200, headers: { ...resHeaders, 'Content-Type': 'application/json' } });
      }

      if (resultMsg && !resultMsg.startsWith('NORMAL SERVICE')) {
        return new Response(JSON.stringify({ success: false, error: 'API 오류', detail: resultMsg }), { status: 500, headers: resHeaders });
      }

      return new Response(JSON.stringify({ success: false, error: '정보를 찾을 수 없음', detail: 'XML 응답에서 데이터를 추출하지 못했습니다.' }), { status: 404, headers: resHeaders });
    }

    // 응답 데이터 구조 확인
    if (data && (parseInt(data.total) > 0) && data.items && data.items[0]) {
      return new Response(JSON.stringify({
        success: true,
        company: decodeHtmlEntities(data.items[0].company),
        busiResNum: data.items[0].bno || data.items[0].busiResNum,
        address: decodeHtmlEntities(data.items[0].adr || data.items[0].address)
      }), { status: 200, headers: { ...resHeaders, 'Content-Type': 'application/json' } });
    }

    // Bizno API 결과 분석 (result 또는 resultCode 필드 확인)
    const resValue = data && data.result ? data.result.toString() : (data && data.resultCode ? data.resultCode.toString() : '');
    const resultMsg = data && data.resultMsg ? data.resultMsg : '';

    // result가 '0'이거나 resultMsg가 'NORMAL SERVICE'로 시작하면 성공(조회 결과 없음)으로 간주
    const isSuccess = resValue === '0' || resultMsg.startsWith('NORMAL SERVICE');

    if (!isSuccess && resValue !== '') {
      return new Response(JSON.stringify({
        success: false,
        error: 'API 호출 실패',
        code: resValue,
        detail: resultMsg,
        suggestion: '비즈노 API 키가 만료되었거나 일일 한도를 초과했을 수 있습니다.'
      }), { status: 500, headers: resHeaders });
    }

    return new Response(JSON.stringify({
      success: false,
      error: '정보를 찾을 수 없음',
      detail: '비즈노 데이터베이스에 해당 번호가 없거나 검색 결과가 없습니다.',
      code: resValue,
      msg: resultMsg
    }), { status: 404, headers: resHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '서버 오류', detail: e.message }), { status: 500, headers: resHeaders });
  }
}
