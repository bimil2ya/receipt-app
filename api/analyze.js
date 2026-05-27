export const config = { runtime: 'edge' };

export default async function handler(req) {
  const resHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: resHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: resHeaders });

  try {
    const body = await req.json();
    const rawKey = body.apiKey || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    const apiKey = rawKey ? rawKey.replace(/[\s\u200B-\u200D\uFEFF]/g, '') : null;
    
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'API 키 형식 오류',
        detail: 'API 키가 비어있거나 잘못되었습니다. 다시 입력해 주세요.'
      }), { status: 401, headers: resHeaders });
    }

    const { isTest, base64, mediaType } = body;

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
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-3-sonnet-20240229'
    ];
    
    let modelsToTry = candidates.filter(c => availableIds.includes(c));
    if (modelsToTry.length === 0) modelsToTry = availableIds.length > 0 ? [availableIds[0]] : candidates;

    const prompt = `<system_instructions>
너는 20년 경력의 대한민국 영수증 데이터 추출 전문가야. 이미지에서 상호명(storeName), 날짜(date), 금액(totalAmount), 용도(suggestedCategory), 사업자번호(bizNum), 승인번호(approvalNum), 카드번호(cardNumber)를 정밀하게 추출해야 해.

[사업자등록번호 추출 지침 - CRITICAL]
1. **10자리 고정 규칙**: 대한민국 사업자번호는 '무조건 10자리'입니다. 만약 8~9자리(예: 123-45-678)로 인식되었다면, 하이픈 근처나 앞뒤에 숫자로 오인될 수 있는 문자(I, l, O, |, . 등)가 있는지 반드시 확인하여 10자리를 완성하십시오.
2. **키워드 근처 탐색**: '사업자', '등록번호', 'Saupja', 'No.' 키워드 바로 옆이나 아래에 있는 숫자 뭉치를 우선적으로 추출하십시오.
3. **시각적 유사성 보정**: 상호명 추출 시 시각적으로 유사한 글자(예: '천'↔'참', '우'↔'무')가 있다면 문맥보다 이미지에 적힌 획을 더 우선시하여 정밀하게 읽으십시오. 
4. **OCR 노이즈 제거**: 숫자 사이의 공백, 점(.), 슬래시(/)는 모두 제거하고 순수 숫자 10자리만 'bizNum'으로 반환하십시오.

[일반 추출 규칙]
1. **객관성 유지**: 이미지에 적힌 텍스트를 그대로 읽어. **절대로 상호명을 네 맘대로 추측하거나 보정하지 마.** (보정은 나중에 외부 API가 할 거야). 이미지에서 가장 상호명으로 보이는 텍스트를 있는 그대로 추출해.
2. **용도 분류**: [숙박비, 식비, 기타, 유류비] 중 하나.
3. **JSON 형식 엄수**.
</system_instructions>
<output_format>
{
  "isReceipt": true,
  "receipts": [
    {
      "date": "YYYY-MM-DD",
      "storeName": "정확한 상호명",
      "totalAmount": 0,
      "suggestedCategory": "식비",
      "bizNum": "000-00-00000",
      "approvalNum": "00000000",
      "cardNumber": "0000-0000-****-0000"
    }
  ]
}
</output_format>
분석 후 JSON 결과값만 출력해.`;

    let finalData = null;
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
          if (match) { finalData = JSON.parse(match[0]); break; }
        }
        lastErr = { message: data.error?.message, type: data.error?.type, model: modelId };
        if (response.status === 404 || response.status === 403) continue;
        break;
      } catch (e) { lastErr = { message: e.message, model: modelId }; continue; }
    }

    if (finalData) return new Response(JSON.stringify({ success: true, ...finalData }), { status: 200, headers: { ...resHeaders, 'Content-Type': 'application/json' } });

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
