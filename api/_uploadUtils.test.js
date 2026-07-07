import { describe, expect, it } from 'vitest';
import {
  buildKakaoChunks,
  formatWon,
  hasControlChars,
  KAKAO_TEXT_LIMIT,
  safeText,
  shorten,
} from './_uploadUtils.js';

describe('formatWon', () => {
  it('숫자를 한국 원화 형식으로 변환한다', () => {
    expect(formatWon(15000)).toBe('15,000원');
    expect(formatWon(1000000)).toBe('1,000,000원');
  });

  it('0이나 falsy 값은 0원으로 처리한다', () => {
    expect(formatWon(0)).toBe('0원');
    expect(formatWon(null)).toBe('0원');
    expect(formatWon(undefined)).toBe('0원');
  });
});

describe('safeText', () => {
  it('문자열을 trim해서 반환한다', () => {
    expect(safeText('  hello  ')).toBe('hello');
  });

  it('null/undefined이면 fallback을 반환한다', () => {
    expect(safeText(null)).toBe('');
    expect(safeText(undefined, '기본값')).toBe('기본값');
  });

  it('숫자도 문자열로 변환한다', () => {
    expect(safeText(42)).toBe('42');
  });
});

describe('shorten', () => {
  it('max 이하면 그대로 반환한다', () => {
    expect(shorten('hello', 10)).toBe('hello');
    expect(shorten('hello', 5)).toBe('hello');
  });

  it('max 초과하면 말줄임표로 자른다', () => {
    const result = shorten('0123456789', 5);
    expect(result).toBe('0123…');
    expect(result.length).toBe(5);
  });

  it('null/undefined는 빈 문자열로 처리한다', () => {
    expect(shorten(null, 5)).toBe('');
  });
});

describe('hasControlChars', () => {
  it('제어 문자가 없으면 false를 반환한다', () => {
    expect(hasControlChars('정상 텍스트')).toBe(false);
    expect(hasControlChars('hello world')).toBe(false);
  });

  it('제어 문자(\\n, \\t, \\r 등)가 있으면 true를 반환한다', () => {
    expect(hasControlChars('hello\nworld')).toBe(true);
    expect(hasControlChars('tab\there')).toBe(true);
    expect(hasControlChars('\r')).toBe(true);
  });

  it('null/undefined는 false를 반환한다', () => {
    expect(hasControlChars(null)).toBe(false);
    expect(hasControlChars(undefined)).toBe(false);
  });
});

describe('buildKakaoChunks', () => {
  it('maxLength 이내면 단일 청크를 반환한다', () => {
    const chunks = buildKakaoChunks(['헤더'], ['줄1', '줄2'], 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('헤더');
    expect(chunks[0]).toContain('줄1');
  });

  it('maxLength 초과 시 여러 청크로 분리한다', () => {
    const header = ['헤더'];
    const details = Array.from({ length: 10 }, (_, i) => `항목${i}: ${'x'.repeat(20)}`);
    const chunks = buildKakaoChunks(header, details, 50);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(50));
  });

  it('KAKAO_TEXT_LIMIT가 180이다', () => {
    expect(KAKAO_TEXT_LIMIT).toBe(180);
  });

  it('빈 detailLines이면 헤더만 담긴 청크를 반환한다', () => {
    const chunks = buildKakaoChunks(['헤더1', '헤더2'], []);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('헤더1\n헤더2');
  });
});
