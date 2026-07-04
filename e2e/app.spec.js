import { test, expect } from '@playwright/test';

// 최소 1×1 JPEG — 실제 파일 업로드 input을 트리거하기 위한 더미 이미지
const FAKE_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// localStorage에 출장 날짜를 미리 심어두기 (페이지 스크립트 실행 전)
async function setTripDates(page, start, end) {
  await page.addInitScript(([s, e]) => {
    localStorage.setItem('trip_start_date', s);
    localStorage.setItem('trip_end_date', e);
  }, [start, end]);
}

// /api/analyze 응답을 고정 데이터로 대체
async function mockAnalyze(page, receipts) {
  await page.route('**/api/analyze', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, receipts }),
    })
  );
}

// IndexedDB 초기화 완료 + LaunchSplash 소멸(180ms) 대기
async function waitForAppReady(page) {
  await expect(page.getByText('로드 중...')).toBeHidden({ timeout: 15000 });
  await page.waitForTimeout(300);
}

// ---------- 테스트 1: 기본 로딩 ----------
test('앱이 정상적으로 로드된다', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.getByText('업로드')).toBeVisible();
  await expect(page.getByText('촬영')).toBeVisible();
});

// ---------- 테스트 2: 업로드 → 목록 추가 ----------
test('영수증 업로드 후 목록에 추가된다', async ({ page }) => {
  await setTripDates(page, '2026-07-01', '2026-07-05');
  await mockAnalyze(page, [{
    date: '2026-07-02',
    storeName: '테스트마트',
    totalAmount: 15000,
    suggestedCategory: '식비',
    useTime: '12:30',
    bizNum: '',
    approvalNum: '',
    cardNumber: '',
  }]);

  await page.goto('/');
  await waitForAppReady(page);

  await page.locator('#file-i').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: FAKE_IMAGE,
  });

  await expect(page.getByText('테스트마트')).toBeVisible({ timeout: 15000 });
});

// ---------- 테스트 3: 날짜 불일치 경고 토스트 ----------
test('출장 기간 밖 날짜의 영수증 업로드 시 경고 토스트가 표시된다', async ({ page }) => {
  await setTripDates(page, '2026-07-01', '2026-07-03');
  await mockAnalyze(page, [{
    date: '2026-06-15',   // 출장 기간(7/1~7/3) 밖
    storeName: '외부업체',
    totalAmount: 8000,
    suggestedCategory: '식비',
    useTime: '14:00',
    bizNum: '',
    approvalNum: '',
    cardNumber: '',
  }]);

  await page.goto('/');
  await waitForAppReady(page);

  await page.locator('#file-i').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: FAKE_IMAGE,
  });

  // 5초간 표시되는 amber 경고 토스트 확인
  await expect(
    page.getByText('날짜가 출장기간과 맞지 않습니다', { exact: false })
  ).toBeVisible({ timeout: 15000 });
});
