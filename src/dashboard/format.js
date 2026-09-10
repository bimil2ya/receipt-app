export const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-');
  return y && m ? `${y}년 ${Number(m)}월` : ym;
}

export function recentMonths(count = 6) {
  const now = new Date();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // 1일로 고정한 Date로 계산 — 3월 31일에서 setMonth(1)이 3월로 되말리는 버그 회피.
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export const SEVERITY = {
  critical: { label: '긴급', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  serious: { label: '중요', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  warning: { label: '주의', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  info: { label: '참고', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const CATEGORY_COLORS = {
  숙박비: '#2a78d6',
  식비: '#eb6834',
  기타: '#1baf7a',
  유류비: '#eda100',
  의료비등: '#e87ba4',
};
