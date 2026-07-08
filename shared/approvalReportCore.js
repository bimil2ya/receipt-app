// 승인번호 정규화 및 중복 그룹핑 — 순수 함수 (Node.js/브라우저 공통)
// 프론트 래퍼: src/utils/approvalReport.js
// 서버 래퍼:   api/approvalReport.js

export function normalizeApprovalNum(value) {
  return String(value ?? '').trim()
    .replace(/[Oo]/g, '0')
    .replace(/[Iil|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[^0-9]/g, '');
}

/**
 * 승인번호 기준 중복 그룹 탐지.
 *
 * @param {Array} items - 검사할 항목 배열
 * @param {{ getApprovalNum, getAmount, getDate }} accessors - 필드 접근자
 * @param {number} sampleLimit - 그룹당 items 최대 개수
 * @returns {{
 *   missingApprovalCount: number,
 *   confirmedGroups: Array<{ approvalKey, date, amount, count, items }>,
 *   reviewGroups:   Array<{ approvalKey, count, reason, items }>,
 * }}
 * 각 래퍼가 items[] 를 도메인 필드로 변환해 반환한다.
 */
export function findDuplicateApprovalGroups(items, { getApprovalNum, getAmount, getDate }, sampleLimit = 5) {
  const approvalGroups = new Map();
  let missingApprovalCount = 0;

  for (const item of items || []) {
    const key = normalizeApprovalNum(getApprovalNum(item));
    if (!key) { missingApprovalCount += 1; continue; }
    if (!approvalGroups.has(key)) approvalGroups.set(key, []);
    approvalGroups.get(key).push(item);
  }

  const confirmedGroups = [];
  const reviewGroups = [];

  for (const [approvalKey, groupItems] of approvalGroups.entries()) {
    if (groupItems.length < 2) continue;

    const exactGroups = new Map();
    for (const item of groupItems) {
      const exactKey = `${getDate(item)}|${getAmount(item)}`;
      if (!exactGroups.has(exactKey)) exactGroups.set(exactKey, []);
      exactGroups.get(exactKey).push(item);
    }

    let hasConfirmed = false;
    for (const exactItems of exactGroups.values()) {
      if (exactItems.length < 2) continue;
      hasConfirmed = true;
      confirmedGroups.push({
        approvalKey,
        date: getDate(exactItems[0]),
        amount: getAmount(exactItems[0]),
        count: exactItems.length,
        items: exactItems.slice(0, sampleLimit),
      });
    }

    if (!hasConfirmed) {
      reviewGroups.push({
        approvalKey,
        count: groupItems.length,
        reason: 'same_approval_different_date_or_amount',
        items: groupItems.slice(0, sampleLimit),
      });
    }
  }

  return { missingApprovalCount, confirmedGroups, reviewGroups };
}
