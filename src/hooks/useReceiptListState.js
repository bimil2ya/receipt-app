import { useMemo, useState } from 'react';
import { decodeHtmlEntities } from '../utils/formatter';
import { buildApprovalReportFromReceipts, normalizeApprovalNum } from '../utils/approvalReport';

const SPECIAL_FILTERS = ['all', 'missingApproval', 'duplicateApproval', 'reviewApproval'];

export default function useReceiptListState({ receipts, categories }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [pinnedNewIds, setPinnedNewIds] = useState([]);

  const localApprovalReport = useMemo(() => buildApprovalReportFromReceipts(receipts), [receipts]);
  const duplicateApprovalIds = useMemo(() => new Set(
    (localApprovalReport.confirmedGroups || []).flatMap(group => group.receiptIds || [])
  ), [localApprovalReport]);
  const reviewApprovalIds = useMemo(() => new Set(
    (localApprovalReport.reviewGroups || []).flatMap(group => group.receiptIds || [])
  ), [localApprovalReport]);

  const receiptFilterOptions = useMemo(() => {
    const missingCount = localApprovalReport.missingApprovalCount || 0;
    const duplicateCount = duplicateApprovalIds.size;
    const reviewCount = reviewApprovalIds.size;
    const withCount = (label, count) => count > 0 ? `${label} ${count}` : label;
    return [
      ['all', '전체'],
      ['missingApproval', withCount('승인번호 없음', missingCount)],
      ['duplicateApproval', withCount('중복 후보', duplicateCount)],
      ['reviewApproval', withCount('확인 필요', reviewCount)],
      ...categories.map(category => [category, category]),
    ];
  }, [categories, localApprovalReport, duplicateApprovalIds, reviewApprovalIds]);

  const sortedReceipts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = (receipts || []).filter(receipt => {
      if (categoryFilter === 'missingApproval' && normalizeApprovalNum(receipt.approvalNum)) return false;
      if (categoryFilter === 'duplicateApproval' && !duplicateApprovalIds.has(receipt.id)) return false;
      if (categoryFilter === 'reviewApproval' && !reviewApprovalIds.has(receipt.id)) return false;
      if (!SPECIAL_FILTERS.includes(categoryFilter) && receipt.category !== categoryFilter) return false;
      if (!query) return true;
      const inStore = decodeHtmlEntities(receipt.storeName || '').toLowerCase().includes(query);
      const inNote = decodeHtmlEntities(receipt.note || '').toLowerCase().includes(query);
      const inApproval = String(receipt.approvalNum || '').toLowerCase().includes(query);
      const inBiz = String(receipt.bizNum || '').toLowerCase().includes(query);
      const inCard = String(receipt.cardNumber || '').toLowerCase().includes(query);
      const inTime = String(receipt.useTime || '').toLowerCase().includes(query);
      return inStore || inNote || inApproval || inBiz || inCard || inTime;
    });
    const base = [...filtered].sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      let result = typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv), 'ko')
        : av > bv ? 1 : av < bv ? -1 : 0;
      if (sortDir === 'desc') result = -result;
      return result || (b.createdAt - a.createdAt);
    });
    if (pinnedNewIds.length === 0) return base;
    const pinnedSet = new Set(pinnedNewIds);
    const pinned = pinnedNewIds
      .slice()
      .reverse()
      .map(id => base.find(receipt => receipt.id === id))
      .filter(Boolean);
    const rest = base.filter(receipt => !pinnedSet.has(receipt.id));
    return [...pinned, ...rest];
  }, [receipts, sortField, sortDir, pinnedNewIds, searchQuery, categoryFilter, duplicateApprovalIds, reviewApprovalIds]);

  return {
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    sortField,
    setSortField,
    sortDir,
    setSortDir,
    pinnedNewIds,
    setPinnedNewIds,
    localApprovalReport,
    receiptFilterOptions,
    sortedReceipts,
  };
}
