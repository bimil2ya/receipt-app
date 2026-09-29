import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const selected = vi.hoisted(() => ({ tab: 'overview' }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal(),
  useState: initial => [initial === 'overview' ? selected.tab : initial, () => {}],
}));
import DashboardShell from './DashboardShell.jsx';
import { HBars, StackBars } from './charts.jsx';

function data(overrides = {}) {
  const byCategory = { 식비: 100, 미정: 25, 교통비: 200, 환급: -10 };
  return {
    role: 'owner', analysisStatus: 'not_implemented', flags: [], coDining: [],
    totals: { spent: 315, core: 315, fuelMed: 0, receiptCount: 4, prevMonthSpent: null }, byCategory,
    teams: [{ names: '홍길동, 성춘향', spent: 315, core: 315, receiptCount: 4, byCategory, review: { ok: 0, req: 0, none: 4 }, reports: [] }],
    ledger: [{ team: '홍길동, 성춘향', date: '2026-09-01', category: '교통비', amount: 200, store: '터미널' }],
    trend: [{ month: '2026-09', byCategory }], ...overrides,
  };
}
const render = body => renderToStaticMarkup(<DashboardShell data={body} month="2026-09" months={['2026-09']} />);
beforeEach(() => { selected.tab = 'overview'; });

describe('dashboard truthful analysis status', () => {
  it('shows analysis unavailable in KPI and team matrix instead of zero findings', () => {
    const html = render(data());
    expect(html.match(/분석 미실행/g)).toHaveLength(2);
    expect(html).not.toContain('이상 지출 탭 참고');
  });
  it('does not claim no anomalies or no dining matches while analysis is unimplemented', () => {
    selected.tab = 'anomaly';
    const html = render(data());
    expect(html).toContain('이상 지출 분석이 아직 실행되지 않았습니다.');
    expect(html).toContain('함께 식사한 조 분석이 아직 실행되지 않았습니다.');
    expect(html).not.toContain('지금 표시할 이상 지출이 없습니다.');
    expect(html).not.toContain('해당 없음.');
    expect(html).not.toContain('0건');
  });
  it('treats missing analysis arrays as unavailable and preserves completed empty analysis', () => {
    selected.tab = 'anomaly';
    expect(render(data({ flags: undefined }))).toContain('분석 미실행');
    const html = render(data({ analysisStatus: 'complete' }));
    expect(html).toContain('지금 표시할 이상 지출이 없습니다.');
    expect(html).toContain('해당 없음.');
  });
  it.each([undefined, 'pending', 'failed', 'unexpected'])('does not assume analysis succeeded with status %s', analysisStatus => {
    selected.tab = 'anomaly';
    const html = render(data({ analysisStatus }));
    expect(html).toContain('분석 미실행');
    expect(html).not.toContain('해당 없음.');
  });
});

describe('submission and review uncertainty remain visible', () => {
  const uncertain = () => {
    const body = data({ unmatchedLedgerCount: 4, unmatchedReviewCount: 2 });
    body.teams[0] = {
      ...body.teams[0], aggregateReflected: true, submissionStatus: 'unverified', submitted: false,
      review: { ok: 0, req: 0, none: 0, unknown: 4 },
    };
    return body;
  };

  it.each(['overview', 'team'])('shows aggregate reflection and unknown review count in %s', tab => {
    selected.tab = tab;
    const html = render(uncertain());
    expect(html).toContain('집계 반영 · 최종 완료 확인 불가');
    expect(html).toContain('대조 불가');
    expect(html).toMatch(/0\s*\/\s*0\s*\/\s*0\s*\/\s*4/);
    expect(html).not.toContain('최종 제출 완료');
  });

  it('shows unmatched current and retained historical review records', () => {
    const html = render(uncertain());
    expect(html).toContain('현재 내역 대조 불가 4건');
    expect(html).toContain('현재 내역에 연결되지 않은 검토기록 2건');
  });

  it('includes unknown counts in staff summary without claiming they are unreviewed', () => {
    const body = uncertain();
    body.role = 'staff';
    const html = render(body);
    expect(html).toContain('요청 0 · 미검토 0 · 대조 불가 4');
  });

  it('does not allow an unverified status to appear complete despite a conflicting boolean', () => {
    const body = uncertain();
    body.teams[0].submitted = true;
    expect(render(body)).not.toContain('최종 제출 완료');
  });
});

describe('all ledger categories remain visible', () => {
  it.each(['overview', 'team', 'anomaly'])('shows custom and undetermined categories in %s', tab => {
    selected.tab = tab;
    const html = render(data());
    expect(html).toContain('교통비');
    if (tab !== 'anomaly') {
      expect(html).toContain('미정');
      expect(html).toContain('-10');
    }
    expect(html).not.toContain('width:-');
  });
  it('includes custom categories in trend net totals, legend and negative adjustments', () => {
    const html = renderToStaticMarkup(<StackBars trend={data().trend} />);
    expect(html).toContain('315');
    expect(html).toContain('교통비');
    expect(html).toContain('미정');
    expect(html).toContain('환급 -10원');
    expect(html).not.toContain('height:-');
  });
  it('renders refund values within nonnegative bar widths', () => {
    const html = renderToStaticMarkup(<HBars rows={[{ label: '환급', value: -200 }]} />);
    expect(html).toContain('width:100%');
    expect(html).toContain('-200');
  });
  it('handles custom categories matching object property names', () => {
    const byCategory = JSON.parse('{"__proto__":100,"constructor":200}');
    const html = render(data({ byCategory }));
    expect(html).toContain('__proto__');
    expect(html).toContain('constructor');
    expect(html).not.toContain('[object Object]');
  });
});
