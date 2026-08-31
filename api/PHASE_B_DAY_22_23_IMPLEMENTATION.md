# Phase B Day 22-23: Claude Vision OCR 구현 가이드

**자동 영수증 인식 - 금액 추출**

---

## 📌 목표

Claude Vision API를 사용하여 영수증 이미지에서 **금액(amount)을 자동 추출**

```
정확도 목표: > 85%
응답 시간: < 5초/이미지
비용 효율: Vision API 호출 최소화
```

---

## 🔍 구현 방향

### 아키텍처
```
User Upload Image
  ↓
api/upload.js (handlePdfOrImage)
  ↓
api/vision.js (NEW)
  ├── extractAmount() ← Claude Vision API
  ├── extractAmountFallback() ← Regex 백업
  └── validateAmount()
  ↓
Result: { amount: 5000, confidence: 0.92 }
```

### 사용할 API
```javascript
// Anthropic SDK (이미 설치됨)
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const response = await client.messages.create({
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
            media_type: "image/jpeg",
            data: base64ImageData
          }
        },
        {
          type: "text",
          text: "Extract the receipt total amount in KRW from this image..."
        }
      ]
    }
  ]
});
```

---

## 📝 구현 단계

### Step 1: api/vision.js 생성

```javascript
/**
 * Claude Vision을 사용한 영수증 분석
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

/**
 * 이미지에서 금액 추출
 * @param {Buffer} imageBuffer - 이미지 바이너리
 * @param {string} mimeType - image/jpeg, image/png 등
 * @returns {Promise<Object>} { amount: 5000, confidence: 0.92, raw: "..." }
 */
export async function extractAmount(imageBuffer, mimeType = "image/jpeg") {
  const base64Image = imageBuffer.toString("base64");

  try {
    const response = await client.messages.create({
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
 * @returns {Object} { amount: number, confidence: number, raw: string }
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
  // 한국 영수증에서 흔한 패턴
  const patterns = [
    /합계\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /총액\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /금액\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /결제\s*:?\s*[₩$]?\s*([0-9,]+)/i,
    /TOTAL\s*:?\s*[₩$]?\s*([0-9,]+)/i,
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
```

### Step 2: 테스트 작성 (api/vision.test.js)

```javascript
import { describe, expect, it } from "vitest";
import { extractAmount, extractAmountFallback, validateAmount } from "./vision.js";
import fs from "fs";
import path from "path";

describe("Claude Vision OCR", () => {
  // 실제 이미지 테스트 (선택사항)
  describe.skip("Real Receipt Images", () => {
    it("should extract amount from cafe receipt", async () => {
      // test-receipts/cafe.jpg 필요
      const imagePath = path.join(__dirname, "../test-receipts/cafe.jpg");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await extractAmount(imageBuffer);

      expect(result.amount).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0.8); // > 80%
      expect(validateAmount(result.amount)).toBe(true);
    });

    it("should extract amount from convenience store receipt", async () => {
      // test-receipts/convenient-store.jpg 필요
      const imagePath = path.join(__dirname, "../test-receipts/convenient-store.jpg");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await extractAmount(imageBuffer);

      expect(result.amount).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  // Fallback 정규식 테스트
  describe("Fallback Regex Extraction", () => {
    it("should extract amount from Korean pattern", () => {
      const texts = [
        "합계: 12,345원",
        "총액: 50000",
        "결제금액: ₩ 25,000",
        "TOTAL: $15.50",
      ];

      for (const text of texts) {
        const amount = extractAmountFallback(text);
        expect(amount).toBeDefined();
        expect(amount).toBeGreaterThan(0);
      }
    });

    it("should return null for invalid text", () => {
      const result = extractAmountFallback("This is not a receipt");
      expect(result).toBeNull();
    });
  });

  // 검증 테스트
  describe("Amount Validation", () => {
    it("should accept valid amounts", () => {
      const validAmounts = [100, 5000, 50000, 1000000];
      for (const amount of validAmounts) {
        expect(validateAmount(amount)).toBe(true);
      }
    });

    it("should reject invalid amounts", () => {
      const invalidAmounts = [0, -5000, 100000000, "12345"];
      for (const amount of invalidAmounts) {
        expect(validateAmount(amount)).toBe(false);
      }
    });
  });
});
```

### Step 3: 통합 (api/upload.js)

```javascript
// api/upload.js에 추가

import { extractAmount, extractAmountFallback, validateAmount } from "./vision.js";

export async function analyzeReceipt(imageBuffer, mimeType) {
  try {
    // 1차 시도: Claude Vision
    const visionResult = await extractAmount(imageBuffer, mimeType);

    if (visionResult.amount && validateAmount(visionResult.amount)) {
      return {
        amount: visionResult.amount,
        method: "vision",
        confidence: visionResult.confidence
      };
    }

    // 2차 시도: Fallback 정규식
    console.log("Vision 실패, Fallback 사용");
    const fallbackAmount = extractAmountFallback(visionResult.raw);

    if (fallbackAmount && validateAmount(fallbackAmount)) {
      return {
        amount: fallbackAmount,
        method: "fallback",
        confidence: 0.5
      };
    }

    throw new Error("금액을 추출할 수 없습니다");

  } catch (error) {
    console.error("영수증 분석 실패:", error.message);
    throw error;
  }
}
```

---

## 📊 검증 기준

### 정확도 테스트
```
목표: > 85% 정확도

테스트 세트:
  1. 카페 영수증 (3-5장)
  2. 편의점 영수증 (3-5장)
  3. 식당 영수증 (3-5장)
  4. 온라인 영수증 (2-3장)
  5. 이미지 품질 낮음 (2-3장)

성공 기준: 15장 중 13장 이상 정확 (86.7%)
```

### 성능 테스트
```
목표: < 5초/이미지

측정:
  - Vision API 응답 시간
  - 파싱 시간
  - 전체 응답 시간
```

### 비용 효율
```
Claude Vision 비용: $0.003/이미지 (제한)
월 1000장 기준: $3 (무시할 수 있는 수준)

최적화:
  - 이미지 압축
  - 캐싱 (메타데이터와 연동)
  - Fallback으로 Vision 호출 감소
```

---

## 🚀 배포 계획

### Day 22-23 완성 기준
- [ ] `api/vision.js` 구현 완료
- [ ] `api/vision.test.js` 모든 테스트 통과
- [ ] Fallback 정규식으로 85% 이상 정확도 달성
- [ ] Vision API 실제 테스트 (5-10장)
- [ ] `api/upload.js` 통합

### Day 24-25 다음 단계
- `recognizeStore()`: 상호명 추출
- 상점 정보 데이터베이스 연동

### 에러 처리
```javascript
// Vision API 실패 시나리오
1. 네트워크 오류 → Retry 3회 + 지수 백오프
2. API 오류 → Fallback 정규식 사용
3. 파싱 오류 → 사용자 수동 입력 유도
```

---

## 💡 주의사항

1. **비용 관리**: Vision API는 사용당 요금 청구 (모니터링 필수)
2. **개인정보**: 영수증 이미지에 민감 정보 포함 가능 (즉시 삭제)
3. **캐싱**: 동일 이미지 재분석 금지 (메타데이터 활용)
4. **성능**: 병렬 처리 최대 5개 이미지 (API 한도)

---

**상태**: ✅ 준비 완료  
**일정**: Day 22-23 (2-3일)  
**다음**: Day 24-25 (상호명 추출)
