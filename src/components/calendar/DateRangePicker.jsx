import { useState } from 'react';
import { getToday } from '../../utils/formatter';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function toStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatKorean(str) {
  if (!str) return '';
  const [, m, d] = str.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/**
 * 날짜 범위 선택 캘린더
 *
 * @param {string}   startDate  'YYYY-MM-DD' | ''
 * @param {string}   endDate    'YYYY-MM-DD' | ''
 * @param {Function} onChange   (startDate: string, endDate: string) => void
 */
export default function DateRangePicker({ startDate, endDate, onChange }) {
  // 초기 표시 월: startDate가 있으면 해당 월, 없으면 오늘
  const initDate = startDate ? parseDate(startDate) : parseDate(getToday());
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth()); // 0-11

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleDayClick = (dateStr) => {
    if (!startDate || endDate) {
      // ① 시작일 없거나 범위 완성 상태 → 새 시작일 설정, 종료일 초기화
      onChange(dateStr, '');
    } else {
      // ② 시작일만 있는 상태
      if (dateStr >= startDate) {
        onChange(startDate, dateStr);      // 종료일 설정
      } else {
        onChange(dateStr, '');             // 클릭일이 더 이전 → 시작일 재설정
      }
    }
  };

  // 해당 월의 날짜 계산
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0=일
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // 안내 텍스트
  let hint;
  if (!startDate) {
    hint = { text: '출장 시작일을 선택하세요', color: 'text-slate-500' };
  } else if (!endDate) {
    hint = { text: `${formatKorean(startDate)} 선택됨 — 종료일을 선택하세요`, color: 'text-yellow-400' };
  } else {
    const n = Math.ceil((parseDate(endDate) - parseDate(startDate)) / 86400000) + 1;
    hint = {
      text: `${formatKorean(startDate)} ~ ${formatKorean(endDate)} (${n}일)`,
      color: 'text-blue-400',
    };
  }

  return (
    <>
    <div className="space-y-3 min-[480px]:hidden">
      <label className="block">출장 시작일
        <input className="block w-full rounded-xl bg-slate-900 p-3" type="date" value={startDate} onChange={e => onChange(e.target.value, endDate && endDate >= e.target.value ? endDate : '')} />
      </label>
      <label className="block">출장 종료일
        <input className="block w-full rounded-xl bg-slate-900 p-3" type="date" min={startDate} value={endDate} onChange={e => onChange(startDate, e.target.value)} />
      </label>
      <p className="text-sm">{hint.text}</p>
    </div>
    <div className="hidden min-[480px]:block">
    <div className="bg-slate-900 rounded-2xl border border-slate-700 p-3">
      {/* 안내 텍스트 */}
      <p className={`text-sm font-bold mb-2 text-center ${hint.color}`}>{hint.text}</p>

      {/* 월 이동 헤더 */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          onClick={prevMonth}
          aria-label="이전 달"
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-200 font-black active:scale-95"
        >‹</button>
        <span className="text-lg font-black text-white">
          {viewYear}년 {viewMonth + 1}월
        </span>
        <button
          onClick={nextMonth}
          aria-label="다음 달"
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-200 font-black active:scale-95"
        >›</button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-0.5">
        {DAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={`text-center text-xs font-black py-0 ${i === 0 ? 'text-red-300' : 'text-slate-400'}`}
          >{d}</div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div className="grid grid-cols-7">
        {/* 1일 이전 빈 셀 */}
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} className="h-9" />
        ))}

        {/* 날짜 셀 */}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const dateStr = toStr(viewYear, viewMonth, day);
          const isStart = dateStr === startDate;
          const isEnd = dateStr === endDate;
          const isInRange = startDate && endDate && dateStr > startDate && dateStr < endDate;
          const isToday = dateStr === getToday();
          const dayOfWeek = (firstDayOfMonth + day - 1) % 7; // 0=일
          const isSunday = dayOfWeek === 0;

          let cellBg = '';
          let textColor = isSunday ? 'text-red-400' : 'text-slate-300';
          let circleStyle = '';

          if (isStart || isEnd) {
            circleStyle = 'bg-blue-600 text-white rounded-full';
          } else if (isInRange) {
            cellBg = 'bg-blue-900/40';
            textColor = 'text-blue-300';
          }

          // 시작/끝 셀에 반쪽 범위 배경(연결감) — iOS 페인트 부담을 줄이려 그라디언트 대신 solid 사용
          let halfRangeBg = '';
          if (isStart && endDate) halfRangeBg = 'right-0 left-1/2 bg-blue-900/30';
          if (isEnd && startDate) halfRangeBg = 'left-0 right-1/2 bg-blue-900/30';

          return (
            <div
              key={day}
              className={`relative min-h-11 flex items-center justify-center ${cellBg}`}
            >
              {halfRangeBg && <div className={`absolute top-0 bottom-0 ${halfRangeBg}`} />}
              <button
                onClick={() => handleDayClick(dateStr)}
                aria-label={dateStr}
                aria-pressed={Boolean(isStart || isEnd || isInRange)}
                className={`relative w-11 h-11 flex flex-col items-center justify-center text-sm font-bold ${circleStyle} ${!circleStyle ? textColor : ''}`}
              >
                <span>{day}</span>
                {isToday && !isStart && !isEnd && (
                  <span className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
    </div>
    </>
  );
}
