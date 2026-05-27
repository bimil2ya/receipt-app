export const TODAY = new Date().toISOString().split('T')[0];

export function formatDateKorean(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function parseDate(input) {
  if (!input) return TODAY;
  // 린트 에러 해결: 정규식 내 불필요한 이스케이프 제거
  const s = input.trim().replace(/[.\s/]/g, '-').replace(/--+/g, '-');
  const parts = s.split('-').filter(p => p.length > 0);
  if (parts.length >= 3) {
    let y = parts[0], m = parts[1].padStart(2, '0'), d = parts[2].padStart(2, '0');
    if (y.length === 2) y = '20' + y;
    const dt = new Date(`${y}-${m}-${d}T00:00:00`);
    if (!isNaN(dt.getTime())) return `${y}-${m}-${d}`;
  }
  return input;
}

export const formatCurrency = n => (n || 0).toLocaleString('ko-KR') + '원';

export const formatShortDate = dateStr => dateStr ? dateStr.slice(2).replace(/-/g, '.') : '';

/**
 * 날짜를 "MM/DD" 형식으로 반환합니다.
 */
export const formatDateSlash = dateStr => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[1]}/${parts[2]}`;
};

/**
 * 마스킹된 카드번호들을 병합하여 더 완전한 번호를 생성합니다.
 * 예: "4890-****-****-****" + "****-1604-****-****" => "4890-1604-****-****"
 */
export function mergeCardNumbers(num1, num2) {
  if (!num1) return num2 || '';
  if (!num2) return num1 || '';
  
  const s1 = num1.replace(/[^0-9*]/g, '');
  const s2 = num2.replace(/[^0-9*]/g, '');
  
  let merged = '';
  const maxLen = Math.max(s1.length, s2.length);
  
  for (let i = 0; i < maxLen; i++) {
    const c1 = s1[i] || '*';
    const c2 = s2[i] || '*';
    if (c1 !== '*' && c1 !== undefined) merged += c1;
    else if (c2 !== '*' && c2 !== undefined) merged += c2;
    else merged += '*';
  }
  
  // 4자리씩 하이픈 추가
  return merged.match(/.{1,4}/g)?.join('-') || merged;
}
