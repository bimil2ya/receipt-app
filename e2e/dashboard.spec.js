import { test, expect } from '@playwright/test';

const payload = {
  contractVersion: '1.0', month: '2026-09', role: 'staff', generatedAt: '2026-09-30T00:00:00Z',
  totals: { spent: 73000, core: 73000, fuelMed: 0, receiptCount: 3, prevMonthSpent: null },
  byCategory: { 식비: 43000, 교통비: 30000 },
  teams: [{ names: '홍길동, 성춘향', spent: 73000, core: 73000, receiptCount: 3, aggregateReflected: true, submissionStatus: 'unverified', submitted: false, byCategory: { 식비: 43000, 교통비: 30000 }, review: { ok: 0, req: 0, none: 2, unknown: 1 }, reports: [{ label: '정산서', date: '2026-09-30', available: true, ref: 'r~s' }] }],
  ledger: [{ team: '홍길동, 성춘향', date: '2026-09-01', category: '식비', amount: 43000, store: '테스트식당', reviewStatus: '대조 불가' }], trend: [{ month: '2026-09', total: 73000, byCategory: { 식비: 43000, 교통비: 30000 } }], unmatchedLedgerCount: 1, unmatchedReviewCount: 0,
};

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
