/**
 * 선택 기능 테스트 (Day 38-40)
 * - 음성 알림
 * - 데이터 분석 대시보드
 * - 위젯
 */

import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  VOICE_CONFIG,
  voiceManager,
  getAvailableVoices,
} from "./voice-notification.js";
import {
  AnalyticsDashboard,
  analyticsDashboard,
  updateAnalytics,
  getChartData,
} from "./analytics-dashboard.js";

describe("Optional Features (Day 38-40)", () => {
  /**
   * Test 1: 음성 알림 타입
   */
  describe("Voice Notifications", () => {
    it("모든 음성 알림 타입 확인", () => {
      const types = Object.values(NOTIFICATION_TYPES);

      expect(types).toContain(NOTIFICATION_TYPES.SUCCESS);
      expect(types).toContain(NOTIFICATION_TYPES.WARNING);
      expect(types).toContain(NOTIFICATION_TYPES.ERROR);
      expect(types).toContain(NOTIFICATION_TYPES.INFO);
      expect(types).toContain(NOTIFICATION_TYPES.SYNC);

      console.log(`  ✅ 알림 타입: ${types.join(", ")}`);
    });

    it("음성 설정", () => {
      expect(VOICE_CONFIG.lang).toBe("ko-KR");
      expect(VOICE_CONFIG.rate).toBe(1.0);
      expect(VOICE_CONFIG.pitch).toBe(1.0);
      expect(VOICE_CONFIG.volume).toBe(0.8);

      console.log(`  🔊 설정: ${VOICE_CONFIG.lang}, 속도=${VOICE_CONFIG.rate}`);
    });

    it("음성 알림 활성화/비활성화", () => {
      voiceManager.setPreference(true);
      expect(voiceManager.enabled).toBe(true);

      voiceManager.setPreference(false);
      expect(voiceManager.enabled).toBe(false);

      console.log(`  ✅ 음성 제어: 활성화 ↔ 비활성화`);
    });
  });

  /**
   * Test 2: 데이터 분석 기본
   */
  describe("Analytics Dashboard - Basics", () => {
    it("대시보드 생성 및 초기화", () => {
      const dashboard = new AnalyticsDashboard([]);

      expect(dashboard.receipts.length).toBe(0);
      expect(dashboard.stats).toBeDefined();

      console.log(`  ✅ 대시보드 생성`);
    });

    it("영수증 데이터 로드", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페서울", amount: 5000, category: "cafe" },
        { date: "2026-08-31", store: "GS편의점", amount: 12000, category: "convenient" },
        { date: "2026-08-30", store: "카페서울", amount: 4500, category: "cafe" },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      expect(dashboard.stats.totalReceipts).toBe(3);
      expect(dashboard.stats.totalAmount).toBe(21500);

      console.log(`  📊 영수증: ${dashboard.stats.totalReceipts}개, 총액: ₩${dashboard.stats.totalAmount.toLocaleString()}`);
    });
  });

  /**
   * Test 3: 통계 계산
   */
  describe("Analytics Dashboard - Statistics", () => {
    it("요약 통계 생성", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페A", amount: 5000 },
        { date: "2026-08-30", store: "카페B", amount: 10000 },
        { date: "2026-08-29", store: "카페C", amount: 7500 },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const summary = dashboard.getSummary();

      expect(summary.totalReceipts).toBe(3);
      expect(summary.totalAmount).toMatch(/22.*500/); // 포맷팅된 숫자
      expect(summary.averageAmount).toMatch(/7.*500/);

      console.log(`  📊 요약: ${summary.totalReceipts}개, 총액: ${summary.totalAmount}`);
    });

    it("월별 통계", () => {
      const receipts = [
        { date: "2026-08-31", amount: 5000 },
        { date: "2026-08-30", amount: 3000 },
        { date: "2026-07-31", amount: 10000 },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const monthly = dashboard.getMonthlyStats();

      expect(monthly.length).toBe(2);
      expect(monthly[0].month).toBe("2026-07");
      expect(monthly[1].month).toBe("2026-08");

      console.log(`  📅 월별: ${monthly.length}개월`);
      for (const m of monthly) {
        console.log(`    ${m.month}: ${m.count}개, ₩${m.total.toLocaleString()}`);
      }
    });

    it("상점별 순위", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페A", amount: 5000 },
        { date: "2026-08-31", store: "카페A", amount: 3000 },
        { date: "2026-08-31", store: "카페B", amount: 10000 },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const topStores = dashboard.getTopStores();

      expect(topStores[0].name).toBe("카페B");
      expect(topStores[1].name).toBe("카페A");

      console.log(`  🏪 상점 순위:`);
      for (const store of topStores) {
        console.log(`    ${store.name}: ${store.count}회, ₩${store.total.toLocaleString()}`);
      }
    });

    it("카테고리별 분포", () => {
      const receipts = [
        { date: "2026-08-31", amount: 5000, category: "cafe" },
        { date: "2026-08-31", amount: 10000, category: "restaurant" },
        { date: "2026-08-31", amount: 5000, category: "cafe" },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const categories = dashboard.getCategoryDistribution();

      expect(categories.length).toBe(2);
      // 총액으로 정렬되므로 restaurant(10000) > cafe(10000)인 경우 순서 확인
      expect(categories.find(c => c.name === "cafe")).toBeDefined();
      expect(categories.find(c => c.name === "restaurant")).toBeDefined();

      console.log(`  📂 카테고리 분포:`);
      for (const cat of categories) {
        console.log(`    ${cat.name}: ${cat.percentage}%`);
      }
    });
  });

  /**
   * Test 4: 인사이트 생성
   */
  describe("Analytics Dashboard - Insights", () => {
    it("자동 인사이트 생성", () => {
      const receipts = [
        { date: "2026-08-31", store: "스타벅스", amount: 5000 },
        { date: "2026-08-30", store: "스타벅스", amount: 4500 },
        { date: "2026-08-29", store: "스타벅스", amount: 5000 },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const insights = dashboard.generateInsights();

      expect(insights.length).toBeGreaterThan(0);

      console.log(`  💡 인사이트 (${insights.length}개):`);
      for (const insight of insights) {
        console.log(`    [${insight.type}] ${insight.message}`);
      }
    });
  });

  /**
   * Test 5: 차트 데이터
   */
  describe("Analytics Dashboard - Charts", () => {
    it("차트 데이터 생성", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페A", amount: 5000, category: "cafe" },
        { date: "2026-08-30", store: "카페B", amount: 10000, category: "cafe" },
        { date: "2026-07-31", store: "식당", amount: 25000, category: "restaurant" },
      ];

      updateAnalytics(receipts);
      const charts = getChartData();

      expect(charts.monthlyChart).toBeDefined();
      expect(charts.storesChart).toBeDefined();
      expect(charts.categoriesChart).toBeDefined();

      console.log(`  📈 차트 3가지: 월별, 상점별, 카테고리별`);
    });

    it("월별 차트 데이터", () => {
      const receipts = [
        { date: "2026-08-31", amount: 5000 },
        { date: "2026-08-15", amount: 3000 },
        { date: "2026-07-31", amount: 10000 },
      ];

      updateAnalytics(receipts);
      const charts = getChartData();
      const monthly = charts.monthlyChart;

      expect(monthly.labels.length).toBe(2);
      expect(monthly.datasets[0].data.length).toBe(2);

      console.log(`  📊 월별 데이터: ${monthly.labels.join(", ")}`);
    });

    it("상점별 차트 데이터", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페A", amount: 15000 },
        { date: "2026-08-31", store: "카페B", amount: 8000 },
        { date: "2026-08-31", store: "식당", amount: 30000 },
      ];

      updateAnalytics(receipts);
      const charts = getChartData();
      const stores = charts.storesChart;

      expect(stores.labels.length).toBe(3);
      expect(stores.labels[0]).toBe("식당");

      console.log(`  🏪 상점 데이터: ${stores.labels.join(", ")}`);
    });

    it("카테고리별 차트 데이터", () => {
      const receipts = [
        { date: "2026-08-31", amount: 5000, category: "cafe" },
        { date: "2026-08-31", amount: 15000, category: "restaurant" },
        { date: "2026-08-31", amount: 5000, category: "cafe" },
      ];

      updateAnalytics(receipts);
      const charts = getChartData();
      const categories = charts.categoriesChart;

      expect(categories.labels.length).toBe(2);
      // 총액: cafe 10000, restaurant 15000, 총 25000
      // cafe: 40%, restaurant: 60%
      expect(categories.datasets[0].data).toContain(60); // restaurant
      expect(categories.datasets[0].data).toContain(40); // cafe

      console.log(`  📂 카테고리 데이터: ${categories.labels.join(", ")}`);
    });
  });

  /**
   * Test 6: 시계열 분석
   */
  describe("Analytics Dashboard - Time Series", () => {
    it("시계열 데이터 생성", () => {
      const receipts = [
        { date: "2026-06-30", amount: 10000 },
        { date: "2026-07-31", amount: 15000 },
        { date: "2026-08-31", amount: 20000 },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const timeSeries = dashboard.getTimeSeries();

      expect(timeSeries.months.length).toBe(3);
      expect(timeSeries.amounts).toEqual([10000, 15000, 20000]);

      console.log(`  📈 시계열: ${timeSeries.months.join(" → ")}`);
    });
  });

  /**
   * Test 7: 분석 대시보드 통합
   */
  describe("Analytics Dashboard - Integration", () => {
    it("전체 분석 파이프라인", () => {
      const receipts = [
        { date: "2026-08-31", store: "스타벅스", amount: 5000, category: "cafe" },
        { date: "2026-08-31", store: "맥도날드", amount: 12000, category: "restaurant" },
        { date: "2026-08-30", store: "스타벅스", amount: 4500, category: "cafe" },
        { date: "2026-07-31", store: "롯데월드", amount: 50000, category: "leisure" },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const summary = dashboard.getSummary();
      const monthly = dashboard.getMonthlyStats();
      const stores = dashboard.getTopStores();
      const categories = dashboard.getCategoryDistribution();
      const insights = dashboard.generateInsights();

      console.log(`  📊 최종 분석:`);
      console.log(`    총 영수증: ${summary.totalReceipts}개`);
      console.log(`    총액: ${summary.totalAmount}`);
      console.log(`    평균: ${summary.averageAmount}`);
      console.log(`    월수: ${monthly.length}`);
      console.log(`    상점: ${stores.length}개`);
      console.log(`    카테고리: ${categories.length}개`);
      console.log(`    인사이트: ${insights.length}개`);

      expect(summary.totalReceipts).toBe(4);
      expect(monthly.length).toBe(2);
      expect(stores.length).toBeGreaterThan(0);
      expect(categories.length).toBeGreaterThan(0);
    });
  });

  /**
   * Test 8: 위젯 개념 (데이터)
   */
  describe("Widget Concepts", () => {
    it("요약 위젯 데이터", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페", amount: 5000 },
        { date: "2026-08-30", store: "식당", amount: 15000 },
      ];

      const dashboard = new AnalyticsDashboard(receipts);
      dashboard.calculateStats();

      const widget = {
        type: "summary",
        title: "이달의 소비",
        data: dashboard.getSummary(),
        lastUpdated: new Date().toISOString(),
      };

      expect(widget.type).toBe("summary");
      expect(widget.data.totalReceipts).toBe(2);

      console.log(`  📱 위젯: ${widget.type}, 제목: ${widget.title}`);
    });

    it("차트 위젯 데이터", () => {
      const receipts = [
        { date: "2026-08-31", store: "카페A", amount: 5000 },
        { date: "2026-08-31", store: "카페B", amount: 10000 },
      ];

      updateAnalytics(receipts);
      const chartData = getChartData();

      const widget = {
        type: "chart",
        title: "월별 소비 추이",
        data: chartData.monthlyChart,
      };

      expect(widget.type).toBe("chart");

      console.log(`  📱 위젯: ${widget.type}, 차트 타입: ${widget.data.datasets[0].label}`);
    });
  });

  /**
   * Test 9: 선택 기능 E2E
   */
  describe("Optional Features E2E", () => {
    it("음성 알림 + 분석 통합", () => {
      // 1. 음성 알림 활성화
      voiceManager.setPreference(true);

      // 2. 영수증 데이터 로드
      const receipts = [
        { date: "2026-08-31", store: "카페", amount: 5000, category: "cafe" },
      ];

      // 3. 분석 업데이트
      updateAnalytics(receipts);

      // 4. 차트 데이터 생성
      const charts = getChartData();

      // 5. 인사이트 생성
      const insights = analyticsDashboard.generateInsights();

      console.log(`  📊 E2E 흐름: 음성→데이터→분석→차트→인사이트`);
      console.log(`    ✅ 음성 알림: ${voiceManager.enabled ? "활성화" : "비활성화"}`);
      console.log(`    ✅ 분석 완료: ${analyticsDashboard.stats.totalReceipts}개 영수증`);
      console.log(`    ✅ 차트 생성: 3가지`);
      console.log(`    ✅ 인사이트: ${insights.length}개`);

      expect(voiceManager.enabled).toBe(true);
      expect(analyticsDashboard.stats.totalReceipts).toBe(1);
      expect(charts).toBeDefined();
      expect(insights.length).toBeGreaterThan(0);
    });
  });
});
