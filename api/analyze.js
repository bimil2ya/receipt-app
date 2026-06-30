export const config = { runtime: 'edge' };

// 모듈 메모리 기반 분당 호출 제한 — Edge 런타임은 워커 인스턴스마다 메모리가 분리되므로
// 인스턴스 단위로만 적용됨(완전한 글로벌 제한은 외부 store 필요). 대량 자동화 호출의 단일
// 인스턴스 폭주만 누그러뜨리는 1차 방어선으로 동작.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 30;
const rateBuckets = new Map(); // key: origin → { count, resetAt }

function rateLimitCheck(key) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= RATE_MAX_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

function normalizeApprovalNum(value) {
  return String(value ?? '')
    .replace(/[Oo]/g, '0')
    .replace(/[Iil|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[^0-9]/g, '');
}

function hasMissingApprovalNum(receipts) {
  return Array.isArray(receipts) && receipts.some(receipt => !normalizeApprovalNum(receipt?.approvalNum));
}

function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function buildTripDateContext({ reportDate, tripStartDate, tripEndDate }) {
  const report = normalizeIsoDate(reportDate);
  const start = normalizeIsoDate(tripStartDate) || report;
  const end = normalizeIsoDate(tripEndDate) || start;
  if (!start && !end && !report) return '';

  const tripYear = (start || end || report || '').slice(0, 4);

  return `
[출장 기간 날짜 기준 - CRITICAL]
이번 영수증은 출장 중 사용한 것이다.
- 출장 시작일: ${start || '미지정'}
- 출장 종료일: ${end || start || '미지정'}
- 출장 연도: ${tripYear}년

규칙 (반드시 따를 것):
1. 읽은 날짜의 연도가 ${tripYear}년이 아니면 즉시 ${tripYear}년으로 교체하라. 예: 2024-06-15 → 2026-06-15.
2. 영수증 날짜는 출장 기간 ±7일 안에 있어야 정상이다. 이 범위를 벗어나더라도 연도만 틀린 경우라면 연도를 ${tripYear}년으로 교체한 뒤 반환하라.
3. 월/일이 명확하면 연도를 ${tripYear}년으로 강제 적용하라. 연도가 불분명할 때도 마찬가지다.
`;
}

// AI 응답 날짜를 서버에서 2차 검증 — 연도가 출장 연도와 다르면 교정
function repairReceiptDates(receipts, { tripStartDate, tripEndDate, reportDate }) {
  const start = normalizeIsoDate(tripStartDate) || normalizeIsoDate(reportDate);
  const end = normalizeIsoDate(tripEndDate) || start;
  if (!start) return receipts;

  const tripYear = start.slice(0, 4);
  const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // ±7일

  const startTs = Date.parse(start) - WINDOW_MS;
  const endTs = Date.parse(end) + WINDOW_MS;

  return receipts.map(r => {
    const raw = String(r.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return r;

    const ts = Date.parse(raw);
    if (ts >= startTs && ts <= endTs) return r; // 범위 안 — 그대로

    // 범위 밖: 연도만 tripYear로 교체해서 재시도
    const corrected = tripYear + raw.slice(4);
    const correctedTs = Date.parse(corrected);
    if (correctedTs >= startTs && correctedTs <= endTs) {
      return { ...r, date: corrected };
    }

    // 교정 후에도 범위 밖이지만 연도가 틀린 경우라면 연도만 교체
    if (raw.slice(0, 4) !== tripYear) {
      return { ...r, date: corrected };
    }

    return r;
  });
}

export default async function handler(req) {
  // 출처 화이트리스트 — upload/aggregate/lookup-biz와 동일 패턴
  const ALLOWED_ORIGINS = [
    'https://receipt-app-rho.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const resHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: resHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: resHeaders });

  // 프로덕션에서 허용되지 않은 출처는 403
  if (process.env.VERCEL_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
    const referer = req.headers.get('referer') || '';
    const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o + '/') || referer === o);
    if (!refererOk) {
      return new Response(JSON.stringify({ success: false, error: '허용되지 않은 출처', detail: `origin: ${origin || '(없음)'}` }), { status: 403, headers: { ...resHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // 분당 호출 제한 (출처 단위)
  const rateKey = origin || 'unknown';
  const rate = rateLimitCheck(rateKey);
  if (!rate.ok) {
    return new Response(JSON.stringify({
      success: false,
      error: '호출 빈도 제한',
      detail: `분당 ${RATE_MAX_PER_WINDOW}회 초과. ${rate.retryAfterSec}초 후 재시도.`,
    }), { status: 429, headers: { ...resHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rate.retryAfterSec) } });
  }

  try {
    const body = await req.json();
    // 분석용 Anthropic 키는 서버 환경변수에서만 읽는다.
    // 사용자가 브라우저에서 키를 입력하거나 저장하지 않도록 고정한다.
    const rawKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const apiKey = rawKey ? rawKey.replace(/[\s\u200B-\u200D\uFEFF]/g, '') : null;
    
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'OCR 설정 없음',
        detail: '서버의 Anthropic API 키가 설정되지 않았습니다. 관리자에게 문의하세요.'
      }), { status: 401, headers: resHeaders });
    }

    const { isTest, base64, mediaType, reportDate, tripStartDate, tripEndDate } = body;
    const tripDateContext = buildTripDateContext({ reportDate, tripStartDate, tripEndDate });

    const fetchWithTimeout = (url, options, timeout = 10000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
    };

    // --- 1. 실시간 가용 모델 목록 조회 ---
    const modelsRes = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    }, 10000);
    
    const mData = await modelsRes.json();
    if (!modelsRes.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: '연결 실패',
        detail: mData.error?.message || 'API 키 권한을 확인해 주세요.'
      }), { status: modelsRes.status, headers: resHeaders });
    }

    const availableIds = (mData.data || []).map(m => m.id);

    // 연결 테스트인 경우 리스트 반환 후 종료
    if (isTest) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: `✅ 연결 성공! (${availableIds.length}개의 모델 가용)`,
        detail: `사용 가능 모델: ${availableIds.join(', ')}`
      }), { status: 200, headers: resHeaders });
    }

    // --- 2. 분석 로직 ---
    if (!base64) return new Response(JSON.stringify({ success: false, error: '데이터 없음' }), { status: 400, headers: resHeaders });

    // 우선순위가 높은 모델부터 계정 가용 여부 확인
    const candidates = [
      'claude-sonnet-4-6',
      'claude-opus-4-7',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-3-sonnet-20240229'
    ];

    const modelsToTry = candidates.filter(c => availableIds.includes(c));
    if (modelsToTry.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: '지원 모델 없음',
        detail: `이 계정에서 사용 가능한 영수증 인식 모델이 없습니다. 가용 모델: ${availableIds.join(', ') || '없음'}`,
        suggestion: 'Anthropic 콘솔에서 Claude Sonnet 또는 Opus 모델 접근 권한을 확인해 주세요.'
      }), { status: 400, headers: resHeaders });
    }

    const prompt = `<system_instructions>
너는 20년 경력의 대한민국 영수증 데이터 추출 전문가야. 이미지 안에 있는 **모든 영수증**에서 상호명(storeName), 날짜(date), 금액(totalAmount), 용도(suggestedCategory), 사업자번호(bizNum), 승인번호(approvalNum), 카드번호(cardNumber)를 정밀하게 추출해야 해.

[다중 영수증 처리 - CRITICAL]
1. **모든 영수증 추출**: 이미지에 영수증이 2장 이상 있을 수 있다(나란히, 위아래, 겹친 상태 포함). 각 영수증을 별도의 receipts 배열 항목으로 모두 추출하라. **하나만 골라 반환하지 마라.**
2. **경계 식별**: 서로 다른 상호명/사업자번호/날짜/승인번호 중 어느 하나라도 다르면 별개 영수증으로 간주한다.
3. **부분적으로 잘린 영수증**: 일부만 보여도 읽을 수 있는 정보가 있으면 별도 항목으로 추출하라. 불가능하면 그 항목만 제외한다.
4. **순서**: 위에서 아래, 왼쪽에서 오른쪽 순서로 receipts 배열에 담아라.

${tripDateContext}
[사업자등록번호 추출 지침 - CRITICAL]
1. **10자리 고정 규칙**: 대한민국 사업자번호는 '무조건 10자리'입니다. 만약 8~9자리(예: 123-45-678)로 인식되었다면, 하이픈 근처나 앞뒤에 숫자로 오인될 수 있는 문자(I, l, O, |, . 등)가 있는지 반드시 확인하여 10자리를 완성하십시오.
2. **키워드 근처 탐색**: '사업자', '등록번호', 'Saupja', 'No.' 키워드 바로 옆이나 아래에 있는 숫자 뭉치를 우선적으로 추출하십시오.
3. **시각적 유사성 보정**: 상호명 추출 시 시각적으로 유사한 글자(예: '천'↔'참', '우'↔'무')가 있다면 문맥보다 이미지에 적힌 획을 더 우선시하여 정밀하게 읽으십시오.
4. **OCR 노이즈 제거**: 숫자 사이의 공백, 점(.), 슬래시(/)는 모두 제거하고 순수 숫자 10자리만 'bizNum'으로 반환하십시오.

[일반 추출 규칙]
1. **객관성 유지**: 이미지에 적힌 텍스트를 그대로 읽어. **절대로 상호명을 네 맘대로 추측하거나 보정하지 마.** (보정은 나중에 외부 API가 할 거야). 이미지에서 가장 상호명으로 보이는 텍스트를 있는 그대로 추출해.
2. **용도 분류**: [숙박비, 식비, 기타, 유류비, 의료비등] 중 하나. 약국/병원/의원 등 의료 관련은 '의료비등'으로 분류.
3. **사용시간(useTime)**: 영수증에 결제/거래 시각이 있으면 24시간제 'HH:MM' 형식으로 추출. 초까지 있으면 'HH:MM:SS'. 인식 불가하면 빈 문자열 "". 중복 판단 키로 사용되므로 신중히.
4. **날짜 형식 — CRITICAL**: 한국 영수증의 날짜는 반드시 **YY-MM-DD 또는 YYYY-MM-DD** 순서다. 절대로 DD-MM-YY나 MM-DD-YY로 해석하지 마라.
   - '26-06-18' → 연도 26 → **2026-06-18** ✓ (DD로 해석해 2018-06-26으로 만들면 틀림)
   - '25-12-31' → 연도 25 → **2025-12-31** ✓
   - 앞 두 자리가 00~99면 2000+YY로 변환해 YYYY-MM-DD로 반환.
   - '거래일시', '승인일시', '일자' 옆 숫자가 대상이다.
   - 대한민국 영수증 기준으로 읽어라. 미국식 MM/DD/YYYY, 유럽식 DD/MM/YYYY로 재해석하지 마라.
   - 월/일만 보이는 경우에도 미국식/유럽식 순서 추정을 하지 말고, 한국 영수증 문맥의 연-월-일 또는 월-일 표기만 사용하라.
5. **승인번호(approvalNum) — CRITICAL**:
   - 라벨이 '승인번호'로 붙어 있지 않아도 된다. '승 인 번 호', '승인 번호', '승인번 호', '승 인번 호', '승 인번호', '승 인 번 호', '승 인 번호', ' 승 인 번 호 ', ' 승인 번호 ', 'A P P R O V A L'처럼 글자가 한 글자씩 떨어져 있거나 줄바꿈·슬래시·하이픈이 섞여 있어도 같은 항목으로 본다.
   - 승인번호는 카드번호와 혼동하지 말고, **승인/승인일시/APPROVAL/승 인 번 호 옆의 숫자열만** 추출한다.
   - 숫자 사이 공백, 하이픈, 점, 슬래시는 제거하고 숫자만 approvalNum으로 반환한다.
   - 영수증에 승인번호가 분명히 보이면 빈 문자열로 두지 마라.
6. **JSON 형식 엄수**.
</system_instructions>
<output_format>
이미지에 영수증이 1장이면 receipts 배열에 1개, N장이면 N개를 담아라.
{
  "isReceipt": true,
  "receipts": [
    {
      "date": "YYYY-MM-DD",
      "useTime": "HH:MM",
      "storeName": "첫 번째 영수증 상호명",
      "totalAmount": 0,
      "suggestedCategory": "식비",
      "bizNum": "000-00-00000",
      "approvalNum": "00000000",
      "cardNumber": "0000-0000-****-0000"
    },
    {
      "date": "YYYY-MM-DD",
      "useTime": "HH:MM",
      "storeName": "두 번째 영수증 상호명",
      "totalAmount": 0,
      "suggestedCategory": "숙박비",
      "bizNum": "000-00-00000",
      "approvalNum": "00000000",
      "cardNumber": "0000-0000-****-0000"
    }
  ]
}
</output_format>
분석 후 JSON 결과값만 출력해.`;

    let finalData = null;
    let finalModelId = null;
    let lastErr = null;

    for (const modelId of modelsToTry) {
      try {
        const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 2048,
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } }, { type: 'text', text: prompt }] }]
          })
        }, 40000);

        const data = await response.json();
        if (response.ok) {
          const match = (data.content?.[0]?.text || '').match(/\{[\s\S]*\}/);
          if (match) {
            try {
              finalData = JSON.parse(match[0]);
              finalModelId = modelId;
              break;
            } catch (parseErr) {
              // 모델이 부분 JSON이나 잘못된 형식을 반환한 경우 — 다음 후보 모델로 넘어감
              lastErr = { message: `JSON 파싱 실패: ${parseErr.message}`, type: 'parse_error', model: modelId };
              continue;
            }
          }
        }
        lastErr = { message: data.error?.message, type: data.error?.type, model: modelId };
        if (response.status === 404 || response.status === 403) continue;
        break;
      } catch (e) { lastErr = { message: e.message, model: modelId }; continue; }
    }

    if (finalData) {
      let receipts = Array.isArray(finalData.receipts)
        ? finalData.receipts.map(receipt => ({
            ...receipt,
            approvalNum: normalizeApprovalNum(receipt.approvalNum),
          }))
        : finalData.receipts;

      // 서버 2차 날짜 교정 — AI가 연도를 잘못 돌려줘도 출장 연도로 강제 보정
      if (Array.isArray(receipts)) {
        receipts = repairReceiptDates(receipts, { tripStartDate, tripEndDate, reportDate });
      }

      if (Array.isArray(receipts) && receipts.length > 0 && hasMissingApprovalNum(receipts)) {
        try {
          const approvalRepairPrompt = `
너는 영수증에서 승인번호만 다시 읽는 보조 추출기다.
아래 이미지의 영수증 개수는 ${receipts.length}장이다.
각 영수증의 순서는 위에서 아래, 왼쪽에서 오른쪽이다.

중요:
1. 승인번호 라벨은 "승 인 번 호", "승인 번호", "승인번 호", "승 인번 호", "승 인번호", "승 인 번 호", " 승 인 번 호 ", " 승인 번호 ", "승 인 / 번 호", "승 인-번 호", "APPROVAL"처럼 띄어쓰기나 줄바꿈·슬래시·하이픈이 섞여 보여도 모두 같은 항목으로 본다.
2. 카드번호와 혼동하지 말고, 승인/승인번호/승인일시/APPROVAL/승 인 번 호 근처의 숫자열만 찾는다.
3. 숫자만 반환하고 하이픈/공백은 제거한다.
4. 정말 보이지 않는 경우에만 빈 문자열을 넣는다.

출력 형식은 JSON 하나만:
{"approvalNums":["첫번째","두번째","세번째"]}
`;
          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: finalModelId || modelsToTry[0],
              max_tokens: 1024,
              messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } }, { type: 'text', text: approvalRepairPrompt }] }]
            })
          }, 30000);
          const data = await response.json();
          if (response.ok) {
            const match = (data.content?.[0]?.text || '').match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              const approvalNums = Array.isArray(parsed.approvalNums) ? parsed.approvalNums : [];
              receipts = receipts.map((receipt, index) => ({
                ...receipt,
                approvalNum: normalizeApprovalNum(receipt.approvalNum || approvalNums[index] || ''),
              }));
            }
          }
        } catch (repairErr) {
          console.warn('approval repair failed:', repairErr);
        }
      }

      return new Response(JSON.stringify({ success: true, ...finalData, receipts }), { status: 200, headers: { ...resHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: false,
      error: lastErr?.type === 'insufficient_quota' ? 'API 잔액 부족' : '인식 실패',
      detail: `${lastErr?.message || '인식 오류'} (마지막 시도: ${lastErr?.model})`,
      suggestion: 'Anthropic 설정 또는 잔액을 확인해 주세요.'
    }), { status: 500, headers: resHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '서버 오류', detail: e.message }), { status: 500, headers: resHeaders });
  }
}
