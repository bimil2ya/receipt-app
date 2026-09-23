import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

const rows = [
  { id: 'manual-1', userId: 'test-user', date: '', category: '교통비', storeName: '수기교통', totalAmount: 3000 },
  { id: 'photo-1', userId: 'test-user', date: '2026-09-01', category: '', storeName: '사진식당', totalAmount: 7000, imageId: 'img-1' },
];
async function seed(page, withImage = true) {
  // All service boundaries are mocked; no live Drive writes or notifications.
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, teams: [{ id: 1, names: '검증팀' }] } }));
  await page.route('https://**.supabase.co/**', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    localStorage.setItem('receipt_names', '검증팀');
    localStorage.setItem('trip_start_date', '2026-09-01');
    localStorage.setItem('trip_end_date', '2026-09-02');
  });
  await page.goto('/');
  await expect(page.getByText('로드 중...')).toBeHidden();
  await page.evaluate(async ({ rows, withImage }) => {
    const { openReceiptDb } = await import('/src/utils/receiptDb.js');
    const db = await openReceiptDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['receipts', 'receipt_images'], 'readwrite');
      rows.forEach(row => tx.objectStore('receipts').put(row));
      if (withImage) {
        const canvas = document.createElement('canvas');
        canvas.width = 250; canvas.height = 400;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, 250, 400);
        context.fillStyle = '#111'; context.font = '20px sans-serif';
        context.fillText('Receipt 7,000', 20, 60);
        const data = atob(canvas.toDataURL('image/png').split(',')[1]);
        tx.objectStore('receipt_images').put({ imageId: 'img-1', blob: new Blob([Uint8Array.from(data, c => c.charCodeAt(0))], { type: 'image/png' }) });
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }, { rows, withImage });
  await page.reload();
  await expect(page.getByText('수기교통', { exact: true })).toBeVisible();
}
async function submit(page) {
  await page.getByRole('button', { name: '3 마감' }).click();
  await page.getByRole('button', { name: /Drive 저장/ }).click();
  await page.getByRole('button', { name: '업로드', exact: true }).click();
}

test('legacy rows survive reload and appear in both summary modes and PDF totals', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: '집계', exact: true }).click();
  await expect(page.getByRole('button', { name: /교통비.*3,000/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /기타.*7,000/ })).toBeVisible();
  await page.getByRole('button', { name: '일자별', exact: true }).click();
  await expect(page.getByRole('button', { name: /날짜 없음.*3,000/ })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { openReceiptDb } = await import('/src/utils/receiptDb.js');
    const { buildCategoryTotals } = await import('/src/utils/receiptPdfReport.js');
    const db = await openReceiptDb();
    const stored = await new Promise(resolve => {
      db.transaction('receipts').objectStore('receipts').getAll().onsuccess = e => resolve(e.target.result);
    });
    return { stored, total: buildCategoryTotals(stored).grandTotal };
  });
  expect(result.stored).toEqual(rows);
  expect(result.total).toBe(10000);
  await page.screenshot({ path: 'test-results/summary-legacy.png', fullPage: true });
});

test('real XLSX and PDF generation, failed photo response and retry', async ({ page }) => {
  await seed(page);
  let failImage = true;
  const uploads = [];
  await page.route('**/api/upload', route => {
    const body = route.request().postDataJSON();
    uploads.push(body);
    if (body.isFinalizeOnly) return route.fulfill({ json: {
      success: true, type: 'completion', complete: true,
      submissionId: body.submissionId, revision: 5,
    } });
    if (body.xlsxBase64) return route.fulfill({ json: { success: true, submissionId: body.submissionId, revision: 1, fileId: 'test-xlsx', uploadStatus: 'uploaded', aggregate: { success: true, fileId: 'test-aggregate', count: 2 } } });
    if (body.isPdfChunk) return route.fulfill({ json: { success: true, assembled: true, fileId: 'test-pdf', submissionId: body.submissionId, reportId: body.reportId, revision: 4, received: body.chunkIndex, uploadStatus: 'uploaded' } });
    if (failImage) return route.fulfill({ status: 500, json: { success: false } });
    return route.fulfill({ json: {
      success: true,
      submissionId: body.submissionId,
      key: body.images[0].key,
      fileId: 'test-image',
      uploadStatus: 'uploaded',
      revision: 3,
      files: [body.images[0].filename],
      skipped: [],
    } });
  });
  await submit(page);
  await expect(page.getByRole('button', { name: /실패 1건 다시 보내기/ })).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole('button', { name: /Drive 저장/ })).toContainText('미전송');
  const xlsx = uploads.find(body => body.xlsxBase64);
  const workbook = XLSX.read(xlsx.xlsxBase64, { type: 'base64' });
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets['영수증내역']);
  expect(exported.map(row => row['금액'])).toEqual([3000, 7000]);
  expect(exported.map(row => row['용도'])).toEqual(['교통비', '']);
  expect(xlsx.receiptSummary).toMatchObject({ totalCount: 2, totalAmount: 10000, imageCount: 1 });
  const pdf = Buffer.concat(uploads.filter(body => body.isPdfChunk).map(body => Buffer.from(body.chunkBase64, 'base64')));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(uploads.find(body => body.isImageOnly).images[0].receipts[0].id).toBe('photo-1');
  failImage = false;
  await page.getByRole('button', { name: /실패 1건 다시 보내기/ }).click();
  await expect(page.getByRole('button', { name: /실패 1건 다시 보내기/ })).toBeHidden();
  await expect(page.getByRole('button', { name: /Drive 저장/ })).toContainText('1회 전송', { timeout: 25000 });
});

test('missing referenced original blocks all submission requests', async ({ page }) => {
  await seed(page, false);
  let requests = 0;
  await page.route('**/api/upload', route => { requests++; return route.fulfill({ json: { success: true } }); });
  await submit(page);
  await expect(page.getByText(/원본 사진을 찾을 수 없습니다/)).toBeVisible();
  expect(requests).toBe(0);
});

test('historical send counts do not claim office receipt or approval', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    localStorage.setItem('receipt-app:send-count:team-1:2026-09-01', JSON.stringify({ kakaoCount: 1, uploadCount: 1 }));
  });
  await page.reload();
  await page.getByRole('button', { name: '3 마감' }).click();
  await expect(page.getByText('전송 이력이 있습니다', { exact: true })).toBeVisible();
  await expect(page.getByText(/담당자의 수신·검수 완료 여부는 별도로 확인/)).toBeVisible();
  await expect(page.getByText('출장 마감 완료', { exact: false })).toBeHidden();
});
