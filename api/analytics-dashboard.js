/**
 * 데이터 분석 대시보드
 * Day 38-40 구현
 *
 * 기능:
 * - 월별 소비 통계
 * - 상점별 분석
 * - 카테고리별 집계
 * - 시계열 분석
 */

/**
 * 분석 대시보드 클래스
 */
export class AnalyticsDashboard {
  constructor(receipts = []) {
    this.receipts = receipts;
    this.stats = {};
  }

  /**
   * 전체 통계 계산
   */
  calculateStats() {
    console.log(`📊 분석 시작: ${this.receipts.length}개 영수증`);

    const stats = {
      totalReceipts: this.receipts.length,
      totalAmount: 0,
      averageAmount: 0,
      minAmount: Infinity,
      maxAmount: 0,
      byMonth: {},
      byStore: {},
      byCategory: {},
      trends: {},
    };

    // 1차 통계: 기본값
    for (const receipt of this.receipts) {
      stats.totalAmount += receipt.amount || 0;
      stats.minAmount = Math.min(stats.minAmount, receipt.amount || 0);
      stats.maxAmount = Math.max(stats.maxAmount, receipt.amount || 0);
    }

    stats.averageAmount = stats.totalReceipts > 0
      ? Math.round(stats.totalAmount / stats.totalReceipts)
      : 0;

    // 2차 통계: 월별 분석
    for (const receipt of this.receipts) {
      const month = receipt.date ? receipt.date.substring(0, 7) : "unknown";
      if (!stats.byMonth[month]) {
        stats.byMonth[month] = { count: 0, total: 0 };
      }
      stats.byMonth[month].count++;
      stats.byMonth[month].total += receipt.amount || 0;
    }

    // 3차 통계: 상점별 분석
    for (const receipt of this.receipts) {
      const store = receipt.store || "미분류";
      if (!stats.byStore[store]) {
        stats.byStore[store] = { count: 0, total: 0 };
      }
      stats.byStore[store].count++;
      stats.byStore[store].total += receipt.amount || 0;
    }

    // 4차 통계: 카테고리별 분석
    for (const receipt of this.receipts) {
      const category = receipt.category || "기타";
      if (!stats.byCategory[category]) {
        stats.byCategory[category] = { count: 0, total: 0 };
      }
      stats.byCategory[category].count++;
      stats.byCategory[category].total += receipt.amount || 0;
    }

    this.stats = stats;
    console.log(`✅ 분석 완료`);

    return stats;
  }

  /**
   * 요약 데이터
   */
  getSummary() {
    return {
      totalReceipts: this.stats.totalReceipts,
      totalAmount: `₩${this.stats.totalAmount?.toLocaleString() || 0}`,
      averageAmount: `₩${this.stats.averageAmount?.toLocaleString() || 0}`,
      minAmount: `₩${this.stats.minAmount?.toLocaleString() || 0}`,
      maxAmount: `₩${this.stats.maxAmount?.toLocaleString() || 0}`,
    };
  }

  /**
   * 월별 통계
   */
  getMonthlyStats() {
    const months = Object.keys(this.stats.byMonth || {}).sort();
    return months.map(month => ({
      month,
      count: this.stats.byMonth[month].count,
      total: this.stats.byMonth[month].total,
      average: Math.round(this.stats.byMonth[month].total / this.stats.byMonth[month].count),
    }));
  }

  /**
   * 상점별 순위 (Top 10)
   */
  getTopStores(limit = 10) {
    const stores = Object.entries(this.stats.byStore || {})
      .map(([name, data]) => ({
        name,
        count: data.count,
        total: data.total,
        average: Math.round(data.total / data.count),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    return stores;
  }

  /**
   * 카테고리별 분포
   */
  getCategoryDistribution() {
    const categories = Object.entries(this.stats.byCategory || {})
      .map(([name, data]) => ({
        name,
        count: data.count,
        total: data.total,
        percentage: this.stats.totalAmount > 0
          ? ((data.total / this.stats.totalAmount) * 100).toFixed(1)
          : "0",
      }))
      .sort((a, b) => b.total - a.total);

    return categories;
  }

  /**
   * 시계열 분석
   */
  getTimeSeries() {
    const months = Object.keys(this.stats.byMonth || {}).sort();

    return {
      months,
      amounts: months.map(m => this.stats.byMonth[m].total),
      counts: months.map(m => this.stats.byMonth[m].count),
    };
  }

  /**
   * 인사이트 생성
   */
  generateInsights() {
    const insights = [];

    // Insight 1: 최고 소비 월
    const monthlyStats = this.getMonthlyStats();
    if (monthlyStats.length > 0) {
      const topMonth = monthlyStats.reduce((a, b) => a.total > b.total ? a : b);
      insights.push({
        type: "high_spending",
        message: `${topMonth.month}에 가장 많이 사용했습니다 (₩${topMonth.total.toLocaleString()})`,
      });
    }

    // Insight 2: 가장 많이 가는 상점
    const topStores = this.getTopStores(1);
    if (topStores.length > 0) {
      const topStore = topStores[0];
      insights.push({
        type: "favorite_store",
        message: `${topStore.name}을 가장 자주 방문합니다 (${topStore.count}회)`,
      });
    }

    // Insight 3: 평균 소비액
    if (this.stats.averageAmount > 0) {
      insights.push({
        type: "average_spending",
        message: `평균 영수증: ₩${this.stats.averageAmount.toLocaleString()}`,
      });
    }

    // Insight 4: 총 소비액
    if (this.stats.totalAmount > 0) {
      const monthCount = Object.keys(this.stats.byMonth).length;
      const monthlyAverage = monthCount > 0
        ? Math.round(this.stats.totalAmount / monthCount)
        : 0;

      insights.push({
        type: "monthly_average",
        message: `월 평균 소비: ₩${monthlyAverage.toLocaleString()}`,
      });
    }

    return insights;
  }
}

/**
 * 글로벌 분석 대시보드 인스턴스
 */
export const analyticsDashboard = new AnalyticsDashboard();

/**
 * 대시보드 업데이트
 * @param {Array} receipts - 영수증 배열
 */
export function updateAnalytics(receipts) {
  analyticsDashboard.receipts = receipts;
  analyticsDashboard.calculateStats();
  console.log("✅ 분석 업데이트 완료");
}

/**
 * 차트 데이터 생성 (D3/Chart.js 호환)
 */
export function getChartData() {
  const monthlyStats = analyticsDashboard.getMonthlyStats();
  const topStores = analyticsDashboard.getTopStores();
  const categories = analyticsDashboard.getCategoryDistribution();

  return {
    // 월별 소비 추이 (라인/바 차트)
    monthlyChart: {
      labels: monthlyStats.map(m => m.month),
      datasets: [{
        label: "월별 소비액",
        data: monthlyStats.map(m => m.total),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
      }],
    },

    // 상점별 분포 (가로 바 차트)
    storesChart: {
      labels: topStores.map(s => s.name),
      datasets: [{
        label: "상점별 소비액",
        data: topStores.map(s => s.total),
        backgroundColor: [
          "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
          "#ec4899", "#06b6d4", "#14b8a6", "#f97316", "#a855f7",
        ],
      }],
    },

    // 카테고리별 분포 (원형 차트)
    categoriesChart: {
      labels: categories.map(c => c.name),
      datasets: [{
        label: "카테고리별 비율",
        data: categories.map(c => parseFloat(c.percentage)),
        backgroundColor: [
          "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
          "#ec4899", "#06b6d4", "#14b8a6", "#f97316", "#a855f7",
        ],
      }],
    },
  };
}

/**
 * CSV 내보내기
 */
export function exportAsCSV() {
  const receipts = analyticsDashboard.receipts;

  let csv = "날짜,상점,금액,카테고리\n";
  for (const receipt of receipts) {
    csv += `${receipt.date || ""},${receipt.store || ""},${receipt.amount || ""},${receipt.category || ""}\n`;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `receipts-${new Date().toISOString().split("T")[0]}.csv`;
  link.click();

  console.log("✅ CSV 내보내기 완료");
}

/**
 * JSON 내보내기
 */
export function exportAsJSON() {
  const data = {
    summary: analyticsDashboard.getSummary(),
    monthly: analyticsDashboard.getMonthlyStats(),
    stores: analyticsDashboard.getTopStores(),
    categories: analyticsDashboard.getCategoryDistribution(),
    insights: analyticsDashboard.generateInsights(),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `analytics-${new Date().toISOString().split("T")[0]}.json`;
  link.click();

  console.log("✅ JSON 내보내기 완료");
}
