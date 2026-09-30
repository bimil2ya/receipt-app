import { test, expect } from '@playwright/test';

const payload = {
  contractVersion: '1.0', month: '2026-09', role: 'staff', generatedAt: '2026-09-30T00:00:00Z',
  totals: { spent: 73000, core: 73000, fuelMed: 0, receiptCount: 1, prevMonthSpent: null },
  byCategory: { 식비: 43000, 교통비: 30000 },
  teams: [{ names: '홍길동, 성춘향', spent: 73000, core: 73000, receiptCount: 1, aggregateReflected: true, submissionStatus: 'unverified', submitted: false, byCategory: { 식비: 43000, 교통비: 30000 }, review: { ok: 0, req: 0, none: 2, unknown: 1 }, reports: [{ label: '정산서', date: '2026-09-30', available: true, ref: 'r~s' }] }],
  ledger: [{ team: '홍길동, 성춘향', date: '2026-09-01', category: '식비', amount: 43000, store: '테스트식당', reviewStatus: '대조 불가' }], trend: [{ month: '2026-09', total: 73000, byCategory: { 식비: 43000, 교통비: 30000 } }], unmatchedLedgerCount: 1, unmatchedReviewCount: 0,
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
    if (month === '2026-08') await augustPending;
    await route.fulfill({ json: monthPayload(month, month === '2026-08' ? '8월 전환 식당' : '9월 기존 식당') });
  });
  await page.goto('/#/dashboard');
  await page.getByPlaceholder('비밀번호').fill('fixture');
  await page.getByRole('button', { name: '들어가기' }).click();
  await page.getByRole('button', { name: '조별 상세' }).click();
  await expect(page.getByText('9월 기존 식당')).toBeVisible();

  await page.locator('header select').selectOption('2026-08');
  await expect(page.getByText('불러오는 중…')).toBeVisible();
  await expect(page.getByText('9월 기존 식당')).toHaveCount(0);

  releaseAugust();
  await page.getByRole('button', { name: '조별 상세' }).click();
  await expect(page.getByText('8월 전환 식당')).toBeVisible();
  await expect(page.getByText('9월 기존 식당')).toHaveCount(0);
});
