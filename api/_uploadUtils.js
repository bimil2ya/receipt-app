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
