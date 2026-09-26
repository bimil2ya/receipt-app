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

async function getStoredReceipts(page) {
  return page.evaluate(async () => {
    const { openReceiptDb } = await import('/src/utils/receiptDb.js');
    const db = await openReceiptDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('receipts', 'readonly').objectStore('receipts').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

// ---------- 테스트 1: 기본 로딩 ----------
test('앱이 정상적으로 로드된다', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.getByRole('button', { name: '업로드' })).toBeVisible();
  await expect(page.getByRole('button', { name: '촬영' })).toBeVisible();
});

test('등록 사용자 이름은 작업조 명단에 있을 때만 작업조를 바꿀 수 있다', async ({ page }) => {
  await page.route('**/api/teams', route => route.fulfill({ json: { success: true, teams: [{ id: 1, names: '홍길동, 성춘향' }, { id: 2, names: '강감찬, 이몽룡' }] } }));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /홍길동/ }).click();
  await page.getByRole('button', { name: '홍길동', exact: true }).click();
  await page.getByRole('button', { name: '설정' }).click();
  await page.getByRole('button', { name: /변경/ }).click();
  await page.getByRole('button', { name: /강감찬/ }).click();
  await expect(page.getByRole('alert')).toContainText('명단에 없습니다');
});

test('마감 화면은 선택한 팀의 담당자 검토기록만 표시한다', async ({ page }) => {
  await page.route('**/api/review**', route => route.fulfill({ json: { success: true, reviews: [{ '영수증 식별값': 'review-1', '팀': '류준, 류수현', '날짜': '2026-09-10', '사용처': '검토식당', '검토 상태': '추가 자료 요청', '담당자 메모': '원본 사진을 확인해 주세요.', '추가 자료 요청': '영수증 원본 사진' }] } }));
  await page.addInitScript(() => localStorage.setItem('receipt_names', '류준, 류수현'));
  await page.goto('/');
  await waitForAppReady(page);
  await page.getByRole('button', { name: '마감' }).click();
  await expect(page.getByLabel('담당자 검토기록')).toContainText('추가 자료 요청');
  await expect(page.getByLabel('담당자 검토기록')).toContainText('원본 사진을 확인해 주세요.');
  await page.evaluate(async () => {
    const { openReceiptDb } = await import('/src/utils/receiptDb.js');
    const db = await openReceiptDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put({ id: 'review-1', date: '2026-09-10', storeName: '검토식당', category: '식비', totalAmount: 7000 });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.reload();
  await waitForAppReady(page);
  await expect(page.locator('#receipt-row-review-1')).toContainText('담당자 검토');
  await expect(page.locator('#receipt-row-review-1')).toContainText('원본 사진을 확인해 주세요.');
  await page.locator('#receipt-row-review-1').getByRole('button', { name: '요청 자료 직접입력' }).click();
  await expect(page.getByRole('dialog', { name: '➕ 직접 입력' })).toBeVisible();
});

test('검토기록 새로고침 버튼과 앱 복귀 시 자동 새로고침으로 사무실 코멘트를 다시 가져온다', async ({ page }) => {
  let reviews = [];
  let calls = 0;
  await page.route('**/api/review**', route => { calls += 1; return route.fulfill({ json: { success: true, reviews } }); });
  await page.addInitScript(() => localStorage.setItem('receipt_names', '류준, 류수현'));
  await page.goto('/');
  await waitForAppReady(page);
  await page.getByRole('button', { name: '마감' }).click();
  const notice = page.getByLabel('담당자 검토기록');
  await expect(notice).toContainText('담당자 검토기록이 없습니다');

  // 사무실이 시트에 코멘트를 적은 상황 → 버튼으로 즉시 반영
  reviews = [{ '영수증 식별값': 'r-1', '팀': '류준, 류수현', '날짜': '2026-09-24', '사용처': '동은청과(주)', '검토 상태': '검토중', '담당자 메모': '금액확인', '추가 자료 요청': '영수증추가' }];
  await notice.getByRole('button', { name: '검토기록 새로고침' }).click();
  await expect(notice).toContainText('담당자 검토기록 1건');
  await expect(notice).toContainText('금액확인');

  // 새로고침 실패 시 이미 보이던 코멘트는 남는다
  await page.unroute('**/api/review**');
  await page.route('**/api/review**', route => { calls += 1; return route.fulfill({ status: 500, json: { success: false } }); });
  await notice.getByRole('button', { name: '검토기록 새로고침' }).click();
  await expect(notice).toContainText('검토기록을 불러오지 못했습니다.');
  await expect(notice).toContainText('금액확인');

  // 다른 앱에서 돌아오면(30초 이상 지난 뒤) 자동으로 다시 읽는다
  await page.unroute('**/api/review**');
  reviews = [{ ...reviews[0], '검토 상태': '승인', '담당자 메모': '확인 완료' }];
  await page.route('**/api/review**', route => { calls += 1; return route.fulfill({ json: { success: true, reviews } }); });
  // 방금 읽은 직후(예: 사진 촬영 후 복귀)에는 다시 부르지 않는다
  const beforeQuickReturn = calls;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  expect(calls).toBe(beforeQuickReturn);

  const before = calls;
  await page.evaluate(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice).toContainText('확인 완료');
  expect(calls).toBeGreaterThan(before);
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

test('수기 금액 오류는 저장하지 않고 쉼표 금액은 한 번만 저장한다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('receipt_names', '류준, 류수현'));
  await page.goto('/');
  await waitForAppReady(page);
  await page.getByRole('button', { name: '직접입력' }).click();
  await page.getByPlaceholder('🏢 사용처').fill('수기 검증');
  const amount = page.getByPlaceholder('💰 금액');

  for (const invalidValue of ['', '   ', '0', '-100', '12원', '1.5', '9,007,199,254,740,992']) {
    await amount.fill(invalidValue);
    await page.getByRole('button', { name: '추가' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(amount).toBeFocused();
    expect(await getStoredReceipts(page)).toHaveLength(0);
  }

  await amount.fill('12,345');
  await page.getByRole('button', { name: '추가' }).dblclick();
  await expect(page.getByText('수기 검증', { exact: true })).toBeVisible();
  await expect(page.getByText('12,345', { exact: true })).toBeVisible();
  await expect.poll(() => getStoredReceipts(page)).toHaveLength(1);
  expect((await getStoredReceipts(page))[0].totalAmount).toBe(12345);

  await page.getByRole('button', { name: '수정' }).click();
  const editAmount = page.locator('#edit-receipt-amount');
  await editAmount.fill('-5');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(editAmount).toBeFocused();
  expect((await getStoredReceipts(page))[0].totalAmount).toBe(12345);
  await editAmount.fill('20,000');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await getStoredReceipts(page))[0].totalAmount).toBe(20000);
  expect((await getStoredReceipts(page))[0].revision).toBe(2);
  await expect(page.getByText('20,000', { exact: true })).toBeVisible();
});

test('사진 OCR의 0원 결과는 저장하지 않고 금액 확인 안내를 표시한다', async ({ page }) => {
  await mockAnalyze(page, [{ date: '2026-07-02', storeName: '금액없는사진', totalAmount: 0, suggestedCategory: '식비' }]);
  await page.addInitScript(() => localStorage.setItem('receipt_names', '류준, 류수현'));
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('#file-i').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: FAKE_IMAGE });
  await expect(page.getByText('금액 확인 필요', { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('금액없는사진', { exact: true })).toHaveCount(0);
  expect(await getStoredReceipts(page)).toHaveLength(0);
});

test('빠른 사진 선택은 같은 OCR 결과를 한 번만 저장한다', async ({ page }) => {
  await mockAnalyze(page, [{ date: '2026-07-02', storeName: '빠른사진', totalAmount: 4000, suggestedCategory: '식비' }]);
  await page.addInitScript(() => localStorage.setItem('receipt_names', '류준, 류수현'));
  await page.goto('/');
  await waitForAppReady(page);
  const file = { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: FAKE_IMAGE };
  await Promise.all([
    page.locator('#file-i').setInputFiles(file),
    page.locator('#file-i').setInputFiles(file),
  ]);
  await expect.poll(() => getStoredReceipts(page)).toHaveLength(1);
  expect((await getStoredReceipts(page))[0]).toMatchObject({ storeName: '빠른사진', totalAmount: 4000 });
});

test('합산이 안전한 정수 범위를 넘으면 목록과 예산에 반올림 금액을 표시하지 않는다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('receipt_names', '류준, 류수현'));
  await page.goto('/');
  await waitForAppReady(page);
  await page.evaluate(async () => {
    const { openReceiptDb } = await import('/src/utils/receiptDb.js');
    const db = await openReceiptDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put({ id: 'safe-limit', date: '2026-09-09', storeName: '한도 금액', category: '식비', totalAmount: Number.MAX_SAFE_INTEGER });
      tx.objectStore('receipts').put({ id: 'overflow', date: '2026-09-09', storeName: '초과 금액', category: '숙박비', totalAmount: 1 });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.reload();
  await waitForAppReady(page);

  await expect(page.getByText('집계 금액이 안전한 정수 범위를 넘었습니다. 정확한 금액을 표시하지 않았습니다.')).toHaveCount(2);
  await expect(page.getByText('9,007,199,254,740,992원', { exact: true })).toHaveCount(0);
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
