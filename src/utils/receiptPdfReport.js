import { decodeHtmlEntities, formatDateKorean } from './formatter';
import { summaryCategories, summaryNonBudgetCategories } from '../components/summary/summaryUtils';

const CATEGORY_ORDER = [...summaryCategories, ...summaryNonBudgetCategories];
const IMAGES_PER_PAGE = 2;   // 세로로 긴 영수증 2장을 나란히 — PDF가 담당자가 보는 유일한 문서라 크게
const PAGE_WIDTH_PX = 794;   // A4 @ 96dpi
const PAGE_HEIGHT_PX = 1123;
const CAPTURE_SCALE = 2;     // 유일 사본이므로 해상도 확보
const JPEG_QUALITY = 0.8;    // 글자 인식 확보

/**
 * HTML 문자열에 삽입되는 값을 이스케이프한다. & 치환을 반드시 먼저 해야
 * 뒤이은 <,>,",' 치환으로 생긴 엔티티를 다시 이스케이프하지 않는다.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Uint8Array를 지정 크기(바이트)의 슬라이스 배열로 나눈다.
 * 각 슬라이스는 이후 독립적으로 base64 인코딩되어야 하며(경계가 3바이트 배수가 아니어도 무방),
 * 서버는 슬라이스별로 독립 디코딩해 순서대로 이어붙이면 원본과 바이트 단위로 동일하다.
 */
export function sliceIntoChunks(bytes, size) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return chunks;
}

/**
 * 전체 영수증(receipts)을 용도별로 묶어 건수/금액을 집계한다.
 * 사진이 없는 항목도 표지 집계표에는 반영되어야 하므로 receipts 전체를 기준으로 계산한다.
 */
export function buildCategoryTotals(receipts) {
  const totals = new Map();
  let grandTotal = 0;

  for (const receipt of receipts || []) {
    const category = receipt.category || '기타';
    const amount = receipt.totalAmount || 0;
    if (!totals.has(category)) totals.set(category, { count: 0, amount: 0 });
    const entry = totals.get(category);
    entry.count += 1;
    entry.amount += amount;
    grandTotal += amount;
  }

  const known = CATEGORY_ORDER.filter((c) => totals.has(c));
  const rest = [...totals.keys()].filter((c) => !CATEGORY_ORDER.includes(c));
  const orderedCategories = [...known, ...rest];
  const totalCount = orderedCategories.reduce((sum, c) => sum + totals.get(c).count, 0);

  return { totals, orderedCategories, grandTotal, totalCount };
}

/**
 * 업로드용 이미지 목록(imageId당 1장, 관련 영수증 항목 포함)을 용도별로 묶는다.
 * 한 장의 사진에 여러 항목이 찍혀 있으면 첫 항목의 용도를 대표 용도로 사용한다.
 */
export function groupImagesByCategory(images) {
  const byCategory = new Map();
  for (const image of images || []) {
    const category = image.receipts?.[0]?.category || '기타';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(image);
  }
  return byCategory;
}

/**
 * 사진 한 장 아래 붙는 캡션 텍스트. 한 사진에 항목이 여러 개면 개수와 합계로 요약한다.
 * 이 함수가 반환하는 문자열은 이미 이스케이프가 끝난 최종 HTML 조각이므로,
 * 호출하는 쪽(buildCategoryPageHtml)에서 다시 escapeHtml을 호출하면 안 된다(이중 이스케이프 방지).
 */
export function buildImageCaption(image) {
  const items = image.receipts || [];
  if (items.length === 0) return '';
  const first = items[0];
  const store = escapeHtml(decodeHtmlEntities(first.storeName)) || '사용처 없음';
  const date = escapeHtml(first.date || '');
  let caption;
  if (items.length === 1) {
    caption = `${date} · ${store} · ${(first.totalAmount || 0).toLocaleString()}원`;
  } else {
    const sum = items.reduce((s, r) => s + (r.totalAmount || 0), 0);
    caption = `${date} · ${store} 외 ${items.length - 1}건 · 합계 ${sum.toLocaleString()}원`;
  }

  // 사진 한 장에 여러 용도가 섞인 경우 — 대표 용도가 아닌 페이지를 보는 담당자를 위한 단서.
  const representativeCategory = first.category || '기타';
  const otherCategories = [...new Set(
    items.map((r) => r.category || '기타').filter((c) => c !== representativeCategory),
  )];
  if (otherCategories.length > 0) {
    caption += ` (다른 용도 포함: ${otherCategories.map(escapeHtml).join(', ')})`;
  }

  return caption;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildCoverHtml({ teamNames, tripStartDate, tripEndDate, totals, orderedCategories, grandTotal, totalCount }) {
  const rows = orderedCategories.map((category) => {
    const entry = totals.get(category);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #d1d5db;">${escapeHtml(category)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #d1d5db;text-align:center;">${entry.count}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #d1d5db;text-align:right;">${entry.amount.toLocaleString()}원</td>
      </tr>`;
  }).join('');

  const periodLabel = tripStartDate === tripEndDate || !tripEndDate
    ? formatDateKorean(tripStartDate)
    : `${formatDateKorean(tripStartDate)} ~ ${formatDateKorean(tripEndDate)}`;

  return `
    <div style="width:${PAGE_WIDTH_PX}px;height:${PAGE_HEIGHT_PX}px;box-sizing:border-box;padding:80px 70px;background:#ffffff;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#111827;">
      <div style="text-align:center;margin-bottom:48px;">
        <div style="font-size:30px;font-weight:700;letter-spacing:2px;">출 장 비 정 산 서</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:36px;">
        <tr>
          <td style="width:110px;padding:8px 0;color:#6b7280;font-size:15px;">사용자팀</td>
          <td style="padding:8px 0;font-size:17px;font-weight:600;">${escapeHtml(decodeHtmlEntities(teamNames)) || '미설정'}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:15px;">출장기간</td>
          <td style="padding:8px 0;font-size:17px;font-weight:600;">${escapeHtml(periodLabel)}</td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <thead>
          <tr style="background:#111827;color:#ffffff;">
            <td style="padding:10px 12px;">용도</td>
            <td style="padding:10px 12px;text-align:center;">건수</td>
            <td style="padding:10px 12px;text-align:right;">금액</td>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td style="padding:12px;font-weight:700;border-top:2px solid #111827;">합계</td>
            <td style="padding:12px;font-weight:700;text-align:center;border-top:2px solid #111827;">${totalCount}</td>
            <td style="padding:12px;font-weight:700;text-align:right;border-top:2px solid #111827;">${grandTotal.toLocaleString()}원</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

export function buildCategoryPageHtml(category, pageImages, pageIndex, pageCount) {
  const tiles = pageImages.map((image) => `
    <div style="width:49%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:10px;">
      <img src="${image.dataUrl}" style="width:100%;height:915px;object-fit:contain;display:block;background:#f3f4f6;" />
      <div style="margin-top:8px;font-size:12px;line-height:1.4;color:#374151;text-align:center;word-break:break-all;">${buildImageCaption(image)}</div>
    </div>`).join('');

  return `
    <div style="width:${PAGE_WIDTH_PX}px;height:${PAGE_HEIGHT_PX}px;box-sizing:border-box;padding:50px 55px;background:#ffffff;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#111827;">
      <div style="font-size:20px;font-weight:700;margin-bottom:6px;">${escapeHtml(category)}</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px;">${pageIndex + 1} / ${pageCount} 페이지</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;">${tiles}</div>
    </div>`;
}

async function renderHtmlToCanvas(html2canvas, container, html) {
  container.innerHTML = html;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  return html2canvas(container.firstElementChild, { backgroundColor: '#ffffff', scale: CAPTURE_SCALE, useCORS: true });
}

/**
 * 팀별 출장비 정산서(PDF)를 생성해 원시 바이트(Uint8Array)로 반환한다.
 * 표지에 용도별 집계표를, 이후 페이지에 용도별로 묶은 영수증 사진을 담는다.
 * Korean 텍스트 렌더링은 html2canvas(브라우저 폰트)에 위임하고, jsPDF는 이미지를 페이지에 앉히는 용도로만 쓴다.
 * 반환한 바이트는 sliceIntoChunks로 쪼개 업로드하고 서버가 이어붙여 조립한다(§4.2).
 */
export async function buildReceiptPdfBytes({ receipts, images, teamNames, tripStartDate, tripEndDate }) {
  const { jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;

  const { totals, orderedCategories, grandTotal, totalCount } = buildCategoryTotals(receipts);
  const imagesByCategory = groupImagesByCategory(images);

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  document.body.appendChild(container);

  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidthMm = doc.internal.pageSize.getWidth();
    const pageHeightMm = doc.internal.pageSize.getHeight();

    const coverCanvas = await renderHtmlToCanvas(
      html2canvas,
      container,
      buildCoverHtml({ teamNames, tripStartDate, tripEndDate, totals, orderedCategories, grandTotal, totalCount }),
    );
    doc.addImage(coverCanvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, pageWidthMm, pageHeightMm);

    for (const category of orderedCategories) {
      const categoryImages = imagesByCategory.get(category) || [];
      if (categoryImages.length === 0) continue;
      const pages = chunk(categoryImages, IMAGES_PER_PAGE);
      for (let i = 0; i < pages.length; i += 1) {
        const canvas = await renderHtmlToCanvas(
          html2canvas,
          container,
          buildCategoryPageHtml(category, pages[i], i, pages.length),
        );
        doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
      }
    }

    return new Uint8Array(doc.output('arraybuffer'));
  } finally {
    document.body.removeChild(container);
  }
}
