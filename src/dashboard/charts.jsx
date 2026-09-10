// 대시보드 차트 — 인라인 SVG/CSS, 라이브러리 없음. 착수 키트 §시안.
import { won, CATEGORY_COLORS } from './format';

// 가로 막대 — { label, value, color? }[]
export function HBars({ rows, valueFmt = won }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={r.label} className="grid grid-cols-[6rem_1fr] items-center gap-2 text-sm">
            <span className="truncate text-right font-medium text-slate-500">{r.label}</span>
            <div className="relative h-6 overflow-hidden rounded bg-slate-100">
              <div
                className="absolute inset-y-0 left-0 rounded-r"
                style={{ width: `${pct}%`, background: r.color || '#2a78d6', minWidth: 2 }}
              />
              <span
                className={`absolute top-1/2 -translate-y-1/2 font-mono text-xs font-semibold ${
                  pct < 45 ? 'left-[calc(100%+6px)] text-slate-700' : 'right-2 text-white'
                }`}
                style={pct < 45 ? { left: `calc(${pct}% + 6px)` } : undefined}
              >
                {valueFmt(r.value)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 월별 용도 스택 — trend[]: { month, byCategory }
export function StackBars({ trend }) {
  const cats = ['숙박비', '식비', '기타', '유류비', '의료비등'];
  const totals = trend.map((t) => cats.reduce((a, c) => a + (t.byCategory?.[c] || 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div>
      <div className="flex items-end gap-4" style={{ height: 160 }}>
        {trend.map((t, i) => (
          <div key={t.month} className="relative mx-auto flex w-14 flex-col-reverse gap-0.5">
            <span className="absolute -bottom-6 left-0 right-0 text-center text-xs font-semibold text-slate-500">
              {Number(t.month.split('-')[1])}월
            </span>
            <span className="absolute left-0 right-0 text-center font-mono text-[10px] text-slate-500"
              style={{ bottom: (totals[i] / max) * 150 + 6 }}>
              {won(totals[i])}
            </span>
            {cats.map((c) => {
              const h = ((t.byCategory?.[c] || 0) / max) * 150;
              return h > 0 ? (
                <div key={c} style={{ height: h, background: CATEGORY_COLORS[c] }} className="w-full rounded-sm" />
              ) : null;
            })}
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {cats.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[c] }} />
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// 용도별 금액 점 플롯 — points: number[], 라벨은 category
export function DotStrip({ label, values, color = '#2a78d6' }) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return (
    <div className="grid grid-cols-[4rem_1fr] items-center gap-2 text-xs">
      <span className="text-right font-medium text-slate-500">{label}</span>
      <div className="relative h-5 rounded bg-slate-100">
        {values.map((v, i) => {
          const outlier = v > median * 3;
          return (
            <span
              key={i}
              title={`${won(v)}원`}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{
                left: `${(v / max) * 100}%`,
                width: outlier ? 11 : 8,
                height: outlier ? 11 : 8,
                background: color,
                boxShadow: outlier ? '0 0 0 3px rgba(232,123,52,0.25)' : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
