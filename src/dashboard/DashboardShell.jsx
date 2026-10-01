import { useMemo, useState } from 'react';
import { won, monthLabel, SEVERITY, categoryNames, categoryColor } from './format';
import { HBars, StackBars, DotStrip } from './charts';
import ReportsPanel from './ReportsPanel';

function analysisAvailable(data) {
  return data.analysisStatus === 'complete' && Array.isArray(data.flags) && Array.isArray(data.coDining);
}

function submissionLabel(team) {
  if (team.provisionalReceiptCount > 0) {
    return team.officialReceiptCount > 0
      ? `집계 반영(최종 완료 확인 불가) + 임시 ${team.provisionalReceiptCount}건`
      : `임시 ${team.provisionalReceiptCount}건`;
  }
  if (team.submissionStatus !== 'unverified' && team.submitted === true) return '최종 제출 완료';
  return team.aggregateReflected === true ? '집계 반영 · 최종 완료 확인 불가' : '최종 완료 확인 불가';
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1.5 font-mono text-xl font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1 font-mono text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, note, children }) {
  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {note && <span className="text-xs text-slate-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function OverviewTab({ data, isOwner }) {
  const t = data.totals;
  const analyzed = analysisAvailable(data);
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="이번 달 총 지출" value={won(t.spent)} sub={`${data.teams.length}개 조 · ${t.receiptCount}건`} />
        <Kpi
          label="전월 대비"
          value={
            t.prevMonthSpent
              ? `${t.spent >= t.prevMonthSpent ? '+' : ''}${Math.round(
                  ((t.spent - t.prevMonthSpent) / t.prevMonthSpent) * 100,
                )}%`
              : '—'
          }
          sub={t.prevMonthSpent ? `전월 ${won(t.prevMonthSpent)}` : '전월 자료 없음'}
        />
        <Kpi label="유류·의료 외 지출" value={won(t.core)} sub={`유류·의료 ${won(t.fuelMed)} 별도`} />
        {isOwner ? (
          <Kpi label="이상 지출" value={analyzed ? String(data.flags.length) : '분석 미실행'} accent sub={analyzed ? '이상 지출 탭 참고' : '분석 결과를 확인할 수 없습니다'} />
        ) : (
          <Kpi
            label="검수 완료"
            value={`${data.teams.reduce((a, x) => a + x.review.ok, 0)} / ${t.receiptCount}`}
            sub={`요청 ${data.teams.reduce((a, x) => a + x.review.req, 0)} · 미검토 ${data.teams.reduce((a, x) => a + x.review.none, 0)} · 대조 불가 ${data.teams.reduce((a, x) => a + (x.review.unknown || 0), 0)}`}
          />
        )}
      </div>

      <Panel title="용도별 지출" note="전 조 합계">
        <HBars rows={categoryNames(data.byCategory).map((c) => ({ label: c, value: data.byCategory[c] || 0, color: categoryColor(c) }))} />
      </Panel>

      {(data.unmatchedLedgerCount > 0 || data.unmatchedReviewCount > 0) && (
        <Panel title="검토 대조 안내">
          <p className="text-sm text-slate-600">
            현재 내역 대조 불가 {data.unmatchedLedgerCount || 0}건 · 현재 내역에 연결되지 않은 검토기록 {data.unmatchedReviewCount || 0}건
          </p>
        </Panel>
      )}

      <Panel title="조 매트릭스" note={isOwner ? '제출 · 지출액 · 검수 · 이상' : '제출 · 지출액 · 검수'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">조</th>
                <th>제출</th>
                <th>지출액</th>
                <th>검수 (완료/요청/미검토/대조 불가)</th>
                {isOwner && <th>이상</th>}
              </tr>
            </thead>
            <tbody>
              {data.teams.map((team) => {
                const anom = isOwner && analyzed
                  ? (data.flags || []).filter((f) => (f.teams || []).includes(team.names)).length
                  : 0;
                return (
                  <tr key={team.names} className="border-t border-slate-100">
                    <td className="py-2 font-medium">{team.names}</td>
                    <td>{submissionLabel(team)}</td>
                    <td className="font-mono">{won(team.spent)}</td>
                    <td className="font-mono text-slate-500">
                      {team.review.ok} / {team.review.req} / {team.review.none} / {team.review.unknown || 0}
                    </td>
                    {isOwner && (
                      <td className={anom ? 'font-mono font-semibold text-orange-600' : 'font-mono text-slate-400'}>
                        {analyzed ? anom : '분석 미실행'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function TeamTab({ data, token }) {
  // 이름으로 선택을 기억한다 — 인덱스로 기억하면 월이 바뀌어 조 순서/구성이
  // 달라졌을 때(조 개편·변경이력) 사용자가 고른 것과 다른 조가 조용히 뜬다.
  const [selectedName, setSelectedName] = useState(null);
  const team = data.teams.find((tm) => tm.names === selectedName) || data.teams[0];
  if (!team) return <p className="text-sm text-slate-500">자료가 없습니다.</p>;
  const rows = data.ledger
    .filter((r) => r.team === team.names)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const dateA = String(a.row.date || '');
      const dateB = String(b.row.date || '');
      if (!dateA && dateB) return 1;
      if (dateA && !dateB) return -1;
      const dateOrder = dateA.localeCompare(dateB);
      if (dateOrder) return dateOrder;
      const timeOrder = String(a.row.time || '').localeCompare(String(b.row.time || ''));
      if (timeOrder) return timeOrder;
      const storeOrder = String(a.row.store || '').localeCompare(String(b.row.store || ''));
      return storeOrder || a.index - b.index;
    })
    .map(({ row }) => row);
  return (
    <>
      <div className="mb-4">
        <label className="mr-2 text-xs font-semibold uppercase text-slate-400">조 선택</label>
        <select
          value={team.names}
          onChange={(e) => setSelectedName(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          {data.teams.map((tm) => (
            <option key={tm.names} value={tm.names}>
              {tm.names}
            </option>
          ))}
        </select>
      </div>

      <Panel title={team.names} note="이번 달 지출">
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
          <span className="font-medium text-slate-500">이번 달 지출</span>
          <span className="font-mono">{won(team.spent)}</span>
          <span className="font-medium text-slate-500">유류·의료 외 지출</span>
          <span className="font-mono">{won(team.core)}</span>
          <span className="font-medium text-slate-500">유류·의료</span>
          <span className="font-mono">{won(team.spent - team.core)}</span>
          <span className="font-medium text-slate-500">영수증</span>
          <span className="font-mono">{team.receiptCount}건</span>
          <span className="font-medium text-slate-500">제출 확인</span>
          <span>{submissionLabel(team)}</span>
          <span className="font-medium text-slate-500">검수 (완료/요청/미검토/대조 불가)</span>
          <span className="font-mono">
            {team.review.ok} / {team.review.req} / {team.review.none} / {team.review.unknown || 0}
          </span>
        </div>
      </Panel>

      <Panel title="용도별 지출">
        <HBars rows={categoryNames(team.byCategory).map((c) => ({ label: c, value: team.byCategory[c] || 0, color: categoryColor(c) }))} />
      </Panel>

      <Panel title="정산서 · 영수증" note="표지 = 용도별 집계장, 이후 = 영수증 이미지">
        {/* key로 조 전환 시 remount → 열려 있던 PDF blob·상태 정리 */}
        <ReportsPanel key={team.names} token={token} reports={team.reports} />
      </Panel>

      <Panel title="출장 원장" note={`${rows.length}건 · 자료 취합용`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">일자</th>
                <th>용도</th>
                <th className="text-right">금액</th>
                <th>사용처</th>
                <th>검수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 font-mono">{r.date}</td>
                  <td>{r.category}</td>
                  <td className="text-right font-mono">{won(r.amount)}</td>
                  <td>{r.store}</td>
                  <td className="text-slate-500">{r.reviewStatus || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function TrendTab({ data }) {
  return (
    <Panel title="월별 추이" note="용도별 · 월 폴더 존재 범위">
      <StackBars trend={data.trend} />
    </Panel>
  );
}

function AnomalyTab({ data }) {
  const analyzed = analysisAvailable(data);
  const cats = useMemo(() => categoryNames(data.byCategory), [data.byCategory]);
  const flags = useMemo(() => data.flags || [], [data.flags]);
  const byRule = useMemo(() => {
    const m = new Map();
    flags.forEach((f) => {
      if (!m.has(f.rule)) m.set(f.rule, []);
      m.get(f.rule).push(f);
    });
    return [...m.entries()];
  }, [flags]);

  const dotData = useMemo(() => {
    const byCat = Object.create(null);
    cats.forEach((c) => {
      byCat[c] = data.ledger
        .filter((r) => r.category === c && r.amount)
        .map((r) => ({ amount: r.amount, date: r.date, store: r.store }));
    });
    return byCat;
  }, [data.ledger, cats]);

  return (
    <>
      <Panel title="이상 지출" note={analyzed ? `${flags.length}건` : '분석 미실행'}>
        {!analyzed && <p className="text-sm text-slate-600">이상 지출 분석이 아직 실행되지 않았습니다.</p>}
        {analyzed && byRule.length === 0 && <p className="text-sm text-slate-500">지금 표시할 이상 지출이 없습니다.</p>}
        <div className="flex flex-col gap-3">
          {analyzed && byRule.map(([rule, items]) => {
            const sev = SEVERITY[items[0].severity] || SEVERITY.info;
            return (
              <div key={rule} className="rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm font-semibold">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${sev.cls}`}>{sev.label}</span>
                  {rule}
                  <span className="ml-auto font-mono text-xs text-slate-400">{items.length}건</span>
                </div>
                {items.map((f, i) => (
                  <div key={i} className="flex flex-wrap gap-x-2 border-t border-slate-100 px-3 py-2 text-sm first:border-t-0">
                    <span className="font-medium">{(f.teams || []).join(', ')}</span>
                    <span className="text-slate-500">{f.store}</span>
                    {f.amount ? <span className="font-mono text-slate-400">{won(f.amount)}원</span> : null}
                    <span className="font-mono text-slate-400">{f.date}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="용도별 금액 분포" note="점 하나 = 영수증 한 건, 멀리 떨어진 점이 이상치 후보">
        <div className="flex flex-col gap-2">
          {cats.map((c) => (
            <DotStrip key={c} label={c} values={dotData[c] || []} color={categoryColor(c)} />
          ))}
        </div>
      </Panel>

      {!analyzed ? (
        <Panel title="함께 식사한 조" note="분석 미실행">
          <p className="text-sm text-slate-600">함께 식사한 조 분석이 아직 실행되지 않았습니다.</p>
        </Panel>
      ) : (
        <Panel title="함께 식사한 조" note="참고 · 경고 아님">
          {data.coDining.length === 0 && <p className="text-sm text-slate-500">해당 없음.</p>}
          <div className="flex flex-col gap-2">
            {data.coDining.map((d, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-b-0">
                <span className="font-mono text-xs text-slate-400">{d.date}</span>
                <span className="font-semibold">{(d.members || []).map((m) => m.team).join(' + ')}</span>
                <span className="ml-auto text-slate-500">{d.store}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700">
                  {d.confidence === 'time' ? '5분 이내' : '날짜·사용처만'}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

export default function DashboardShell({ data: raw, token, month, months, onMonthChange, includeProgress, onIncludeProgressChange, onRefresh, onLogout, updatedAt }) {
  // 계약상 배열 필드는 항상 존재하지만, 부분 응답에도 흰 화면 대신 화면이 뜨도록 방어.
  const data = {
    ...raw,
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
    trend: Array.isArray(raw.trend) ? raw.trend : [],
    totals: raw.totals || { spent: 0, core: 0, fuelMed: 0, receiptCount: 0, prevMonthSpent: null },
    byCategory: raw.byCategory || {},
  };
  const isOwner = data.role === 'owner';
  const tabs = [
    ['overview', '전체 현황'],
    ['team', '조별 상세'],
    ['trend', '추이 · 과거'],
    ...(isOwner ? [['anomaly', '이상 지출']] : []),
  ];
  const [tab, setTab] = useState('overview');
  const activeTab = tabs.some(([id]) => id === tab) ? tab : 'overview';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="mx-auto max-w-4xl px-4 py-5">
        <header className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-lg font-bold">출장비 집행 현황</h1>
            <p className="text-xs text-slate-500">
              {isOwner ? '노경호 (owner)' : '담당자 (staff)'} · 예산 개념 없음
              {data.stub && ' · 예시 데이터(스텁)'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <button onClick={onRefresh} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
              ↻ 새로고침
            </button>
            <button
              onClick={() => onIncludeProgressChange(!includeProgress)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${includeProgress ? 'border-red-300 bg-red-50 font-semibold text-red-700' : 'border-slate-300 text-slate-600'}`}
            >
              {includeProgress ? '임시 자료 포함' : '공식 자료만'}
            </button>
            <button onClick={onLogout} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
              로그아웃
            </button>
          </div>
        </header>

        {updatedAt && <p className="mb-3 font-mono text-[11px] text-slate-400">갱신 {updatedAt}</p>}

        {data.provisional?.active && (
          <section className="mb-4 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
            <h2 className="text-sm font-bold">임시 집계 — 최종 제출 전 자료 포함</h2>
            <p className="mt-1 text-xs leading-5">
              공식 월 집계 {data.provisional.aggregateReceiptCount}건에 자동 공유 자료 {data.provisional.provisionalReceiptCount}건을 더해 표시합니다.
              임시 자료는 사진·PDF·검토가 확인되지 않았으며, 공식 월 집계와 같은 영수증은 제외됩니다.
              자동 공유 목록에서 사라진 자료는 최종 재제출 전까지 공식 집계에서 자동 차감하지 않습니다.
            </p>
            <p className="mt-1 font-mono text-[11px] text-red-700">
              마지막 자동 공유 {data.provisional.lastSharedAt ? new Date(data.provisional.lastSharedAt).toLocaleString('ko-KR') : '확인 불가'}
              {data.provisional.exactOfficialMatchCount > 0 ? ` · 공식 집계 일치로 제외 ${data.provisional.exactOfficialMatchCount}건` : ''}
              {data.provisional.changedOfficialCount > 0 ? ` · 공식 집계와 달라 재제출 대기 ${data.provisional.changedOfficialCount}건` : ''}
              {data.provisional.ambiguousProgressCount > 0 ? ` · 중복 식별값 제외 ${data.provisional.ambiguousProgressCount}건` : ''}
              {data.provisional.unidentifiedProgressCount > 0 ? ` · 식별값 없음 제외 ${data.provisional.unidentifiedProgressCount}건` : ''}
              {data.provisional.deletionReconciliationUnavailable ? ' · 삭제 여부는 최종 재제출 전 확정 불가' : ''}
            </p>
          </section>
        )}

        <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === id ? 'border-blue-500 text-slate-900' : 'border-transparent text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'overview' && <OverviewTab data={data} isOwner={isOwner} />}
        {activeTab === 'team' && <TeamTab data={data} token={token} />}
        {activeTab === 'trend' && <TrendTab data={data} />}
        {activeTab === 'anomaly' && isOwner && <AnomalyTab data={data} />}
      </div>
    </div>
  );
}
