import { test, expect } from '@playwright/test';

const localMonth = (offset = 0) => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const CURRENT_MONTH = localMonth();
const PREVIOUS_MONTH = localMonth(-1);

const payload = {
  contractVersion: '1.0', month: CURRENT_MONTH, role: 'staff', generatedAt: `${CURRENT_MONTH}-01T00:00:00Z`,
  totals: { spent: 73000, core: 73000, fuelMed: 0, receiptCount: 1, prevMonthSpent: null },
  byCategory: { 식비: 43000, 교통비: 30000 },
  teams: [{ names: '홍길동, 성춘향', spent: 73000, core: 73000, receiptCount: 1, aggregateReflected: true, submissionStatus: 'unverified', submitted: false, byCategory: { 식비: 43000, 교통비: 30000 }, review: { ok: 0, req: 0, none: 2, unknown: 1 }, reports: [{ label: '정산서', date: '2026-09-30', available: true, ref: 'r~s' }] }],
  ledger: [{ team: '홍길동, 성춘향', date: `${CURRENT_MONTH}-01`, category: '식비', amount: 43000, store: '테스트식당', reviewStatus: '대조 불가' }], trend: [{ month: CURRENT_MONTH, total: 73000, byCategory: { 식비: 43000, 교통비: 30000 } }], unmatchedLedgerCount: 1, unmatchedReviewCount: 0,
};

function monthPayload(month, store) {
  return {
    contractVersion: '1.0', month, role: 'staff', generatedAt: `${month}-01T00:00:00Z`,
    totals: { spent: 1000, core: 1000, fuelMed: 0, receiptCount: 1, prevMonthSpent: null },
    byCategory: { 식비: 1000 },
    teams: [{ names: '전환 확인 조', spent: 1000, core: 1000, receiptCount: 1, aggregateReflected: true, submissionStatus: 'unverified', submitted: false, byCategory: { 식비: 1000 }, review: { ok: 0, req: 0, none: 1, unknown: 0 }, reports: [] }],
    ledger: [{ team: '전환 확인 조', date: `${month}-01`, category: '식비', amount: 1000, store, reviewStatus: null }],
    trend: [{ month, total: 1000, byCategory: { 식비: 1000 } }], unmatchedLedgerCount: 0, unmatchedReviewCount: 0,
  };
}

test('사무실 대시보드는 팀 원장과 PDF 오류를 정직하게 표시한다', async ({ page }) => {
  await page.route('**/api/dashboard?action=auth', r => r.fulfill({ json: { token: 'test-token' } }));
  await page.route('**/api/dashboard?action=data**', r => r.fulfill({ json: payload }));
  await page.route('**/api/dashboard?action=report**', r => r.fulfill({ status: 413, json: { success: false } }));
  await page.goto('/#/dashboard');
  await page.getByPlaceholder('비밀번호').fill('fixture');
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.getByText('집계 반영 · 최종 완료 확인 불가')).toBeVisible();
  await page.getByRole('button', { name: '조별 상세' }).click();
  await expect(page.getByText('테스트식당')).toBeVisible();
  await page.getByRole('button', { name: '화면으로 보기' }).click();
  await expect(page.getByText('화면 미리보기 한도를 넘었습니다')).toBeVisible();
});

test('월 전환 중에는 이전 월 원장을 새 월로 표시하지 않는다', async ({ page }) => {
  let releaseAugust;
  const augustPending = new Promise(resolve => { releaseAugust = resolve; });
  await page.route('**/api/dashboard?action=auth', route => route.fulfill({ json: { token: 'test-token' } }));
  await page.route('**/api/dashboard?action=data**', async route => {
    const month = new URL(route.request().url()).searchParams.get('month');
    if (month === PREVIOUS_MONTH) await augustPending;
    await route.fulfill({ json: monthPayload(month, month === PREVIOUS_MONTH ? '이전 달 전환 식당' : '현재 달 기존 식당') });
  });
  await page.goto('/#/dashboard');
  await page.getByPlaceholder('비밀번호').fill('fixture');
  await page.getByRole('button', { name: '들어가기' }).click();
  await page.getByRole('button', { name: '조별 상세' }).click();
  await expect(page.getByText('현재 달 기존 식당')).toBeVisible();

  await page.locator('header select').selectOption(PREVIOUS_MONTH);
  await expect(page.getByText('불러오는 중…')).toBeVisible();
  await expect(page.getByText('현재 달 기존 식당')).toHaveCount(0);

  releaseAugust();
  await page.getByRole('button', { name: '조별 상세' }).click();
  await expect(page.getByText('이전 달 전환 식당')).toBeVisible();
  await expect(page.getByText('현재 달 기존 식당')).toHaveCount(0);
});

test('공식 월 집계가 없을 때 자료 없음으로 구분해 표시한다', async ({ page }) => {
  await page.route('**/api/dashboard?action=auth', route => route.fulfill({ json: { token: 'test-token' } }));
  await page.route('**/api/dashboard?action=data**', route => route.fulfill({ status: 404, json: { success: false, code: 'DASHBOARD_SOURCE_MISSING' } }));
  await page.goto('/#/dashboard');
  await page.getByPlaceholder('비밀번호').fill('fixture');
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.getByText('선택한 월의 공식 집계 또는 임시 진행 자료가 아직 없습니다.')).toBeVisible();
});

test('최종 제출 전 자동 공유 자료는 빨간 임시 집계로만 표시한다', async ({ page }) => {
  const provisional = {
    ...payload,
    provisional: {
      active: true, aggregateReceiptCount: 1, provisionalReceiptCount: 2,
      exactOfficialMatchCount: 1, changedOfficialCount: 0, ambiguousProgressCount: 0, unidentifiedProgressCount: 0,
      deletionReconciliationUnavailable: true,
      lastSharedAt: '2026-09-10T01:02:03.000Z',
    },
    teams: [{ ...payload.teams[0], officialReceiptCount: 1, provisionalReceiptCount: 2 }],
  };
  await page.route('**/api/dashboard?action=auth', route => route.fulfill({ json: { token: 'test-token' } }));
  await page.route('**/api/dashboard?action=data**', route => route.fulfill({ json: provisional }));
  await page.goto('/#/dashboard');
  await page.getByPlaceholder('비밀번호').fill('fixture');
  await page.getByRole('button', { name: '들어가기' }).click();
  await expect(page.getByText('임시 집계 — 최종 제출 전 자료 포함')).toBeVisible();
  await expect(page.getByText('사진·PDF·검토가 확인되지 않았으며, 공식 월 집계와 같은 영수증은 제외됩니다.')).toBeVisible();
  await expect(page.getByText('집계 반영(최종 완료 확인 불가) + 임시 2건')).toBeVisible();
});
