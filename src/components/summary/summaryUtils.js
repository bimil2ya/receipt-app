import { sumReceiptAmounts } from '../../utils/receiptAmount';

const CATEGORY_ORDER = ['숙박비', '식비', '기타'];
const NON_BUDGET_CATEGORIES = ['유류비', '의료비등'];

const toReceiptList = (receipts) => Array.isArray(receipts) ? receipts.filter(Boolean) : [];

const sortByDateAndTimeDesc = (a, b) => {
  const byDate = (b.date || '').localeCompare(a.date || '');
  if (byDate !== 0) return byDate;
  return (b.useTime || '').localeCompare(a.useTime || '');
};

const sortByTimeDesc = (a, b) => (b.useTime || '').localeCompare(a.useTime || '');

export const safeCategory = (value) => String(value || '기타');

export const safeDateLabel = (value) => value ? String(value).slice(2).replace(/-/g, '.') : '날짜 없음';

export const getReceiptGrandTotal = (receipts) => sumReceiptAmounts(toReceiptList(receipts));

export const buildCategorySummary = (receipts) => {
  const list = toReceiptList(receipts);
  const knownCategories = [...CATEGORY_ORDER, ...NON_BUDGET_CATEGORIES];
  const extraCategories = [...new Set(list.map(receipt => safeCategory(receipt.category)))]
    .filter(category => !knownCategories.includes(category));
  const sections = [...knownCategories, ...extraCategories]
    .map((category) => {
      const items = list
        .filter((receipt) => safeCategory(receipt.category) === category)
        .sort(sortByDateAndTimeDesc);

      return {
        key: category,
        category,
        total: sumReceiptAmounts(items),
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  return {
    sections,
    subtotal: sumReceiptAmounts(list.filter((receipt) => CATEGORY_ORDER.includes(safeCategory(receipt.category)))),
  };
};

export const buildDateSummary = (receipts) => {
  const list = toReceiptList(receipts);
  const dates = [...new Set(list.map((receipt) => receipt.date || ''))].sort((a, b) => (b || '').localeCompare(a || ''));

  return dates.map((date) => {
    const items = list
      .filter((receipt) => (receipt.date || '') === date)
      .sort(sortByTimeDesc);

    return {
      key: date,
      date,
      displayDate: safeDateLabel(date),
      total: sumReceiptAmounts(items),
      items,
    };
  });
};

export const summaryCategories = CATEGORY_ORDER;
export const summaryNonBudgetCategories = NON_BUDGET_CATEGORIES;
