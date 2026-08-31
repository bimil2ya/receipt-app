/**
 * Claude Vision을 사용한 영수증 분석
 * Day 22-23 구현
 */

// Anthropic SDK는 런타임에 동적으로 로드됨
let client = null;

async function getClient() {
  if (!client) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic();
    } catch (error) {
      console.warn("Anthropic SDK not available, using fallback mode");
      return null;
    }
  }
  return client;
}

/**
 * 이미지에서 금액 추출
 * @param {Buffer} imageBuffer - 이미지 바이너리
 * @param {string} mimeType - image/jpeg, image/png 등
 * @returns {Promise<Object>} { amount: 5000, confidence: 0.92, raw: "..." }
 */
export async function extractAmount(imageBuffer, mimeType = "image/jpeg") {
  const base64Image = imageBuffer.toString("base64");
  const visionClient = await getClient();

  if (!visionClient) {
    console.warn("Vision API 사용 불가, Fallback 모드로 전환");
    return {
      amount: null,
      confidence: 0,
      raw: "Vision API not available"
    };
  }

  try {
    const response = await visionClient.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64Image
              }
            },
            {
              type: "text",
              text: `당신은 한국 영수증 분석 AI입니다. 이 이미지에서 다음을 추출해주세요:
1. 총 결제 금액 (합계, 총액, Total)
2. 통화는 한국원(KRW)이고, 숫자만 추출하세요.
3. 가장 마지막 금액이 총액이 아닌 경우 문맥을 고려하세요.
4. 찾을 수 없으면 "NOT_FOUND"라고 답하세요.
5. 확신도를 0.0~1.0 범위로 나타내세요.

다음 JSON 형식으로 답변하세요:
{
  "amount": 12345,
  "confidence": 0.95,
  "reasoning": "영수증 하단의 '합계: 12,345원' 구간에서 추출"
}`
            }
          ]
        }
      ]
    });

    // 응답 파싱
    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const result = parseVisionResponse(content);

    console.log(`✅ OCR 성공: ${result.amount}원 (신뢰도: ${result.confidence})`);
    return result;

  } catch (error) {
    console.error(`❌ Vision API 실패: ${error.message}`);
    throw error;
  }
}

/**
 * Vision API 응답 파싱
 * @param {string} content - API 응답 텍스트
 * @returns {Object} { amount: number|null, confidence: number, raw: string }
 */
function parseVisionResponse(content) {
  try {
    // JSON 추출
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("JSON not found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      amount: parsed.amount !== "NOT_FOUND" ? parsed.amount : null,
      confidence: parsed.confidence || 0,
      raw: content
    };

  } catch (error) {
    console.warn(`⚠️ JSON 파싱 실패: ${error.message}`);

    // Fallback: 정규식으로 추출
    const amountMatch = content.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
    return {
      amount: amountMatch ? parseInt(amountMatch[1].replace(/,/g, "")) : null,
      confidence: 0.5,
      raw: content
    };
  }
}

/**
 * Fallback: 정규식으로 금액 추출
 * @param {string} ocrText - OCR 텍스트
 * @returns {number|null} 추출된 금액
 */
export function extractAmountFallback(ocrText) {
  if (!ocrText || typeof ocrText !== "string") {
    return null;
  }

  // 한국 영수증에서 흔한 패턴 (공백 허용 버전)
  const patterns = [
    /합\s*계\s*:?\s*[₩$]?\s*([0-9,]+)/i,    // 공백 허용: 합 계
    /합계\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /총\s*액\s*:?\s*[₩$]?\s*([0-9,]+)/i,    // 공백 허용: 총 액
    /총액\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /금\s*액\s*:?\s*[₩$]?\s*([0-9,]+)/i,    // 공백 허용: 금 액
    /금액\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /결\s*제\s*:?\s*[₩$]?\s*([0-9,]+)/i,    // 공백 허용: 결 제
    /결제\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /TOTAL\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /[₩$]\s*([0-9,]+)/,                      // 통화 기호로 시작
    /(\d{1,3}(?:,\d{3})*)\s*원/,             // 1,234원 또는 1234원 형식
  ];

  for (const pattern of patterns) {
    const match = ocrText.match(pattern);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""));
    }
  }

  return null;
}

/**
 * 금액 검증
 * @param {number} amount - 검증할 금액
 * @returns {boolean} 유효하면 true
 */
export function validateAmount(amount) {
  // 한국 영수증 금액 범위: 100원 ~ 10,000,000원
  return typeof amount === "number" && amount >= 100 && amount <= 10000000;
}

/**
 * 이미지에서 상호명 추출 (Day 24-25)
 * @param {Buffer} imageBuffer - 이미지 바이너리
 * @param {string} mimeType - image/jpeg, image/png 등
 * @returns {Promise<Object>} { store: "카페서울", confidence: 0.95 }
 */
export async function extractStoreName(imageBuffer, mimeType = "image/jpeg") {
  const base64Image = imageBuffer.toString("base64");
  const visionClient = await getClient();

  if (!visionClient) {
    console.warn("Vision API 사용 불가, Fallback 모드로 전환");
    return {
      store: null,
      confidence: 0,
      raw: "Vision API not available"
    };
  }

  try {
    const response = await visionClient.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64Image
              }
            },
            {
              type: "text",
              text: `당신은 한국 영수증 분석 AI입니다. 이 이미지에서 다음을 추출해주세요:
1. 상점 이름 (식당명, 카페명, 편의점명 등)
2. 영수증의 맨 위에 있는 상점 이름을 찾으세요.
3. 찾을 수 없으면 "NOT_FOUND"라고 답하세요.
4. 확신도를 0.0~1.0 범위로 나타내세요.

다음 JSON 형식으로 답변하세요:
{
  "store": "카페서울",
  "confidence": 0.95,
  "reasoning": "영수증 상단에 '카페서울'이라고 명시"
}`
            }
          ]
        }
      ]
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const result = parseStoreResponse(content);

    console.log(`✅ 상호 추출 성공: ${result.store} (신뢰도: ${result.confidence})`);
    return result;

  } catch (error) {
    console.error(`❌ 상호 추출 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 상호명 추출 응답 파싱
 * @param {string} content - API 응답 텍스트
 * @returns {Object} { store: string|null, confidence: number, raw: string }
 */
function parseStoreResponse(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("JSON not found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      store: parsed.store !== "NOT_FOUND" ? parsed.store : null,
      confidence: parsed.confidence || 0,
      raw: content
    };

  } catch (error) {
    console.warn(`⚠️ 상호 파싱 실패: ${error.message}`);
    return {
      store: null,
      confidence: 0,
      raw: content
    };
  }
}

/**
 * 상호명 검증
 * @param {string} store - 검증할 상호명
 * @returns {boolean} 유효하면 true
 */
export function validateStoreName(store) {
  if (typeof store !== "string") {
    return false;
  }

  // 최소 2글자, 최대 100글자
  return store.length >= 2 && store.length <= 100;
}
