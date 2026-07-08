import { timingSafeEqual, createHash } from 'crypto'

// Node.js 런타임 전용 — Edge 런타임(analyze.js, lookup-biz.js)에서 import 금지.
// 토큰/PIN 비교: sha256 해시 후 timingSafeEqual로 길이 차이에 의한 타이밍 누출 방지.
export function safeCompare(a, b) {
  const ha = createHash('sha256').update(String(a)).digest()
  const hb = createHash('sha256').update(String(b)).digest()
  return timingSafeEqual(ha, hb)
}
