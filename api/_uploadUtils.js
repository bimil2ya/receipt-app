export const KAKAO_TEXT_LIMIT = 180;

export function formatWon(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

export function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export function shorten(value, max) {
  const text = safeText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function hasControlChars(value) {
  for (const ch of String(value ?? '')) {
    if (ch.charCodeAt(0) < 32) return true;
  }
  return false;
}

const SUBMITTER_DEVICE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSubmitterDeviceId(value) {
  return typeof value === 'string' && SUBMITTER_DEVICE_RE.test(value);
}

export function isValidSubmitterName(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 40
    && !/[\\/:*?"<>|]/.test(value) && !hasControlChars(value);
}

// 파일 이름에 붙일 제출자 표시. 없으면 예전 이름 규칙을 그대로 쓴다.
export function submitterFileLabel(submitterName) {
  return isValidSubmitterName(submitterName) ? `_${submitterName.trim()}` : '';
}

export function buildKakaoChunks(headerLines, detailLines, maxLength = KAKAO_TEXT_LIMIT) {
  const chunks = [];
  let current = headerLines.join('\n');

  for (const line of detailLines) {
    const next = `${current}\n${line}`;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    chunks.push(current);
    current = line.length > maxLength ? shorten(line, maxLength) : line;
  }

  if (current) chunks.push(current);
  return chunks;
}
