/**
 * Claude Vision OCR 테스트
 * Day 22-23 검증
 */

import { describe, expect, it } from "vitest";
import {
  extractAmountFallback,
  validateAmount,
  validateStoreName
} from "./vision.js";

/**
 * Test 1: Fallback 정규식 테스트
 */
describe("extractAmountFallback", () => {
  it("한국식 합계 패턴", () => {
    const testCases = [
      { text: "합계: 12,345원", expected: 12345 },
      { text: "합계:50000", expected: 50000 },
      { text: "합계 123456", expected: 123456 },
      { text: "합 계 : 1,000", expected: 1000 },
    ];

    for (const tc of testCases) {
      const result = extractAmountFallback(tc.text);
      console.log(`  입력: "${tc.text}" → 추출: ${result}`);
      expect(result).toBe(tc.expected);
    }
  });

  it("총액 패턴", () => {
    const testCases = [
      { text: "총액: 45,670원", expected: 45670 },
      { text: "총액 ₩ 30000", expected: 30000 },
    ];

    for (const tc of testCases) {
      const result = extractAmountFallback(tc.text);
      expect(result).toBe(tc.expected);
    }
  });

  it("결제 금액 패턴", () => {
    const testCases = [
      { text: "결제: 15,000원", expected: 15000 },
      { text: "결제금액 25000", expected: 25000 },
    ];

    for (const tc of testCases) {
      const result = extractAmountFallback(tc.text);
      expect(result).toBe(tc.expected);
    }
  });

  it("TOTAL 패턴", () => {
    const testCases = [
      { text: "TOTAL: $25.99", expected: 25 },
      { text: "TOTAL 100", expected: 100 },
    ];

    for (const tc of testCases) {
      const result = extractAmountFallback(tc.text);
      expect(result).toBe(tc.expected);
    }
  });

  it("쉼표 포함 금액", () => {
    const testCases = [
      { text: "1,234,567원", expected: 1234567 },
      { text: "₩ 99,999", expected: 99999 },
    ];

    for (const tc of testCases) {
      const result = extractAmountFallback(tc.text);
      expect(result).toBe(tc.expected);
    }
  });

  it("invalid text 반환 null", () => {
    const testCases = [
      "이것은 영수증이 아닙니다",
      "가격 정보 없음",
      "빈 문자열",
      null,
      undefined,
    ];

    for (const text of testCases) {
      const result = extractAmountFallback(text);
      console.log(`  입력: "${text}" → null: ${result === null}`);
      expect(result).toBeNull();
    }
  });
});

/**
 * Test 2: 금액 검증
 */
describe("validateAmount", () => {
  it("유효한 금액 승인", () => {
    const validAmounts = [100, 1000, 5000, 50000, 1000000, 9999999];

    for (const amount of validAmounts) {
      const result = validateAmount(amount);
      console.log(`  금액: ${amount} → 유효: ${result}`);
      expect(result).toBe(true);
    }
  });

  it("범위 이외 금액 거부", () => {
    const invalidAmounts = [
      { amount: 0, reason: "0원" },
      { amount: 50, reason: "100원 미만" },
      { amount: -5000, reason: "음수" },
      { amount: 10000001, reason: "1000만원 초과" },
      { amount: 100000000, reason: "100만원 초과" },
    ];

    for (const tc of invalidAmounts) {
      const result = validateAmount(tc.amount);
      console.log(`  금액: ${tc.amount} (${tc.reason}) → 유효: ${result}`);
      expect(result).toBe(false);
    }
  });

  it("잘못된 타입 거부", () => {
    const invalidTypes = [
      "12345",
      { amount: 5000 },
      [5000],
      null,
      undefined,
    ];

    for (const type of invalidTypes) {
      const result = validateAmount(type);
      console.log(`  타입: ${typeof type} → 유효: ${result}`);
      expect(result).toBe(false);
    }
  });
});

/**
 * Test 3: 상호명 검증
 */
describe("validateStoreName", () => {
  it("유효한 상호명 승인", () => {
    const validNames = [
      "카페서울",
      "GS편의점",
      "맥도날드 강남역점",
      "스타벅스",
      "CU",
      "올리브영",
    ];

    for (const name of validNames) {
      const result = validateStoreName(name);
      console.log(`  상호: "${name}" (${name.length}자) → 유효: ${result}`);
      expect(result).toBe(true);
    }
  });

  it("범위 이외 상호명 거부", () => {
    const invalidNames = [
      { name: "A", reason: "1자" },
      { name: "a".repeat(101), reason: "101자 (100자 초과)" },
    ];

    for (const tc of invalidNames) {
      const result = validateStoreName(tc.name);
      console.log(`  상호: "${tc.name.substring(0, 20)}..." (${tc.name.length}자) → 유효: ${result}`);
      expect(result).toBe(false);
    }
  });

  it("잘못된 타입 거부", () => {
    const invalidTypes = [
      123,
      null,
      undefined,
      { store: "카페서울" },
      ["카페"],
    ];

    for (const type of invalidTypes) {
      const result = validateStoreName(type);
      console.log(`  타입: ${typeof type} → 유효: ${result}`);
      expect(result).toBe(false);
    }
  });
});

/**
 * Test 4: Vision API 시뮬레이션 (Mock)
 */
describe("Vision API Response Parsing", () => {
  it("금액 추출 시뮬레이션", () => {
    // Vision API가 없을 때 fallback으로 테스트
    const simulatedResponses = [
      {
        text: "합계: 12,345원 확신도: 0.95",
        expectedAmount: 12345,
      },
      {
        text: "금액을 찾을 수 없습니다",
        expectedAmount: null,
      },
    ];

    for (const tc of simulatedResponses) {
      const amount = extractAmountFallback(tc.text);
      console.log(`  응답: "${tc.text.substring(0, 30)}" → 금액: ${amount}`);
      expect(amount).toBe(tc.expectedAmount);
    }
  });
});

/**
 * Test 5: Edge Cases
 */
describe("Edge Cases", () => {
  it("여러 금액이 있을 때 첫 번째 매칭 사용", () => {
    const text = "소계: 5000 세금: 500 합계: 5500";
    // Fallback은 첫 매칭을 반환
    const result = extractAmountFallback(text);
    console.log(`  여러 금액: "${text}" → ${result}`);
    expect([5000, 5500]).toContain(result);
  });

  it("쉼표 없는 큰 숫자", () => {
    const text = "합계: 1000000원";
    const result = extractAmountFallback(text);
    console.log(`  큰 숫자: "${text}" → ${result}`);
    expect(result).toBe(1000000);
  });

  it("공백이 많은 입력", () => {
    const text = "  합  계  :   1,234  원  ";
    const result = extractAmountFallback(text);
    console.log(`  공백 많음: "${text}" → ${result}`);
    expect(result).toBe(1234);
  });

  it("빈 문자열 처리", () => {
    const result = extractAmountFallback("");
    expect(result).toBeNull();
  });

  it("특수문자 포함", () => {
    const text = "합계: ₩12,345 (부가세 포함)";
    const result = extractAmountFallback(text);
    console.log(`  특수문자: "${text}" → ${result}`);
    expect(result).toBe(12345);
  });
});

/**
 * Test 6: 실제 영수증 텍스트 시뮬레이션
 */
describe("Real Receipt Simulation", () => {
  it("카페 영수증", () => {
    const receiptText = `
    ===============================
    카페서울 강남점
    ===============================
    아메리카노 x2      4,000
    크로아상          3,500
    ===============================
    합계: 7,500원
    카드결제
    2026.08.31 14:30
    ===============================
    감사합니다.
    `;

    const amount = extractAmountFallback(receiptText);
    console.log(`  카페 영수증 → 금액: ${amount}원`);
    expect(amount).toBe(7500);
  });

  it("편의점 영수증", () => {
    const receiptText = `
    GS25 강남역점
    ---------
    우유               2,500
    계란               3,500
    간식               1,000
    ---------
    총액: 7,000원
    ---------
    `;

    const amount = extractAmountFallback(receiptText);
    console.log(`  편의점 영수증 → 금액: ${amount}원`);
    expect(amount).toBe(7000);
  });

  it("식당 영수증", () => {
    const receiptText = `
    명동설렁탕
    ====================
    테이블: 5
    ====================
    설렁탕             12,000
    소주               3,500
    ====================
    금액: 15,500원
    ====================
    `;

    const amount = extractAmountFallback(receiptText);
    console.log(`  식당 영수증 → 금액: ${amount}원`);
    expect(amount).toBe(15500);
  });
});
