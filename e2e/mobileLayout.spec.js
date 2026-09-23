import { test, expect } from '@playwright/test';

const SIZES = [320, 375, 390, 768, 1280];

async function assertNoHorizontalOverflow(page) {
  const result = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.right <= 0 || element.closest('[aria-hidden="true"], .sr-only')) return false;
        if (element instanceof SVGElement || ['INPUT', 'SCRIPT', 'STYLE'].includes(element.tagName)) return false;
        return rect.right > viewport + 1 || rect.left < -1 || (viewport <= 768 && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1);
      })
      .map(element => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 80) }));
    return { documentWidth: document.documentElement.scrollWidth, viewport, offenders };
  });
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewport);
  expect(result.offenders).toEqual([]);
}

test('320px부터 태블릿까지 긴 데이터가 주요 화면을 가로로 밀지 않는다', async ({ page }, testInfo) => {
  await page.route('**/api/**', route => route.fulfill({ json: { success: false } }));
  await page.addInitScript(() => {
    const names = '매우 긴 출장 담당자 이름, 두 번째 담당자 이름';
    localStorage.setItem('receipt_names', names);
    localStorage.setItem('receipt_teams_cache', JSON.stringify([{ id: 1, names }]));
  });

  for (const width of SIZES) {
    await page.setViewportSize({ width, height: 667 });
    await page.goto('/');
    await expect(page.getByText('로드 중...')).toBeHidden({ timeout: 15000 });
    await page.evaluate(async () => {
      const { openReceiptDb } = await import('/src/utils/receiptDb.js');
      const db = await openReceiptDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('receipts', 'readwrite');
        tx.objectStore('receipts').put({
          id: 'mobile-long-row', date: '2026-09-08',
          storeName: '아주 긴 사용처 이름이 작은 화면에서 줄바꿈되어도 금액과 겹치지 않아야 합니다',
          category: '매우 긴 분류명도 안전하게 표시되어야 하는 검증 항목',
          totalAmount: 999999999999999,
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    });
    await page.reload();
    await expect(page.getByText('로드 중...')).toBeHidden({ timeout: 15000 });
    await assertNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: /저장 상태:/ })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('저장 상태:');

    if (width === 1280) {
      const desktopGrid = await page.locator('[id="receipt-row-mobile-long-row"] > div').evaluate(grid => ({
        categoryColumn: getComputedStyle(grid.children[2]).gridColumnStart,
        actionColumn: getComputedStyle(grid.children[3]).gridColumnStart,
      }));
      expect(desktopGrid).toEqual({ categoryColumn: 'auto', actionColumn: '2' });
    }

    await page.getByRole('button', { name: '직접입력' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    const dialog = await page.getByRole('dialog').boundingBox();
    expect(dialog.width).toBeLessThanOrEqual(width - 16);
    const smallTargets = await page.getByRole('dialog').locator('button, input').evaluateAll(elements => elements.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && (rect.width < 44 || rect.height < 44);
    }).map(el => el.outerHTML));
    expect(smallTargets).toEqual([]);
    await page.getByLabel('사용처', { exact: true }).fill(`모바일 입력 ${width}`);
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('저장 상태:');
    await expect(page.getByLabel('금액', { exact: true })).toBeFocused();
    await page.getByRole('alert').evaluate(el => { el.textContent = '금액을 확인해 주세요. 긴 오류 설명이 입력을 가리거나 화면 밖으로 잘리지 않아야 합니다. '.repeat(3); });
    await assertNoHorizontalOverflow(page);
    await page.setViewportSize({ width, height: 350 });
    await page.getByLabel('금액', { exact: true }).fill('12,345');
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await page.setViewportSize({ width, height: 667 });
    await page.locator('[id^="receipt-row-"]').filter({ hasText: `모바일 입력 ${width}` }).getByRole('button', { name: '수정', exact: true }).click();
    await page.getByLabel('금액', { exact: true }).fill('20,000');
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '저장', exact: true }).click();

    await page.getByRole('button', { name: '집계' }).click();
    await expect(page.getByRole('button', { name: '용도별' })).toBeVisible();
    await expect(page.getByRole('button', { name: '용도별' })).toHaveAttribute('aria-pressed', 'true');
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '일자별', exact: true }).click();
    await expect(page.getByRole('button', { name: '일자별', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('button[aria-expanded]').first().click();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`summary-${width}.png`), fullPage: true });

    await page.getByRole('button', { name: '목록' }).click();
    await page.getByRole('button', { name: '마감' }).click();
    await expect(page.getByRole('button', { name: '담당자에게 보내기' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '1 예산', exact: true }).click();
    await assertNoHorizontalOverflow(page);
    await page.setViewportSize({ width, height: 350 });
    const budgetDialog = page.getByRole('dialog');
    await expect(budgetDialog).toBeVisible();
    expect(await budgetDialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.getByRole('button', { name: '🔄 새로 시작 (영수증 모두 삭제)' }).click();
    await expect(page.getByRole('dialog', { name: '새 출장 시작' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '새 출장 시작' })).toBeHidden();
    await expect(budgetDialog).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await budgetDialog.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    await page.setViewportSize({ width, height: 667 });
    await page.getByRole('button', { name: '닫기' }).click();
  }
});
