import { useState } from 'react';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const TODAY_STR = new Date().toLocaleDateString('sv-SE'); // 'YYYY-MM-DD'

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
  const initDate = startDate ? parseDate(startDate) : new Date();
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
    <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4">
      {/* 안내 텍스트 */}
      <p className={`text-sm font-bold mb-4 text-center ${hint.color}`}>{hint.text}</p>

      {/* 월 이동 헤더 */}
      <div className="flex items-center justify-between mb-4 px-1">
        <button
          onClick={prevMonth}
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800 text-slate-200 font-black active:scale-95"
        >‹</button>
        <span className="text-lg font-black text-white">
          {viewYear}년 {viewMonth + 1}월
        </span>
        <button
          onClick={nextMonth}
          className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800 text-slate-200 font-black active:scale-95"
        >›</button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-2">
        {DAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={`text-center text-sm font-black py-1 ${i === 0 ? 'text-red-300' : 'text-slate-400'}`}
          >{d}</div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div className="grid grid-cols-7">
        {/* 1일 이전 빈 셀 */}
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} className="h-12" />
        ))}

        {/* 날짜 셀 */}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const dateStr = toStr(viewYear, viewMonth, day);
          const isStart = dateStr === startDate;
          const isEnd = dateStr === endDate;
          const isInRange = startDate && endDate && dateStr > startDate && dateStr < endDate;
          const isToday = dateStr === TODAY_STR;
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

          // 범위 연결 배경: 시작일 오른쪽, 종료일 왼쪽 반원
          let rangeBg = '';
          if (isStart && endDate) rangeBg = 'bg-gradient-to-r from-transparent via-transparent to-blue-900/40';
          if (isEnd && startDate) rangeBg = 'bg-gradient-to-l from-transparent via-transparent to-blue-900/40';

          return (
            <div
              key={day}
              className={`relative h-12 flex items-center justify-center ${cellBg}`}
            >
              {rangeBg && <div className={`absolute inset-0 ${rangeBg}`} />}
              <button
                onClick={() => handleDayClick(dateStr)}
                className={`relative w-10 h-10 flex flex-col items-center justify-center text-sm font-bold active:scale-95 transition-transform ${circleStyle} ${!circleStyle ? textColor : ''}`}
              >
                <span>{day}</span>
                {isToday && !isStart && !isEnd && (
                  <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
