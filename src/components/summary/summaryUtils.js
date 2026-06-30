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

export const safeDateLabel = (value) => String(value || '').slice(2).replace(/-/g, '.');

export const getReceiptGrandTotal = (receipts) =>
  toReceiptList(receipts).reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0);

export const buildCategorySummary = (receipts) => {
  const list = toReceiptList(receipts);
  const sections = [...CATEGORY_ORDER, ...NON_BUDGET_CATEGORIES]
    .map((category) => {
      const items = list
        .filter((receipt) => receipt.category === category)
        .sort(sortByDateAndTimeDesc);

      return {
        key: category,
        category,
        total: items.reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0),
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  return {
    sections,
    subtotal: list
      .filter((receipt) => CATEGORY_ORDER.includes(receipt.category))
      .reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0),
  };
};

export const buildDateSummary = (receipts) => {
  const list = toReceiptList(receipts);
  const dates = [...new Set(list.map((receipt) => receipt.date).filter(Boolean))].sort((a, b) => (b || '').localeCompare(a || ''));

  return dates.map((date) => {
    const items = list
      .filter((receipt) => receipt.date === date)
      .sort(sortByTimeDesc);

    return {
      key: date,
      date,
      displayDate: safeDateLabel(date),
      total: items.reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0),
      items,
    };
  });
};

export const summaryCategories = CATEGORY_ORDER;
export const summaryNonBudgetCategories = NON_BUDGET_CATEGORIES;
