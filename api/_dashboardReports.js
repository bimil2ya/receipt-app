// 조별 정산서 PDF(표지 = 용도별 집계장, 이후 = 영수증 이미지) 제공.
// 착수 키트 §7 확장. 담당자·노경호 모두 볼 수 있다(역할 제한 없음).
//
// 지금은 스텁이다:
//   - reportsForMonth(): 고정 예시 목록. P2에서 실제 Drive 폴더 walk로 교체.
//   - fetchReportPdf(): 최소 PDF를 만들어 반환. P2에서 Drive 다운로드로 교체.
//
// 보안: 클라이언트가 임의의 Drive fileId를 넘겨 아무 파일이나 받아가지 못하도록,
// dashboard-data가 내려준 report만 볼 수 있게 ref에 HMAC 서명을 건다.

import { createHmac, timingSafeEqual } from 'crypto';

function refSig(id) {
  const secret = process.env.DASHBOARD_TOKEN_SECRET;
  if (!secret) throw new Error('DASHBOARD_TOKEN_SECRET is not set');
  return createHmac('sha256', secret).update(`report:${id}`).digest('base64url').slice(0, 22);
}

/** fileId → 서명된 ref(클라이언트에 내려줌). */
export function signReportRef(id) {
  return `${id}~${refSig(id)}`;
}

/** 서명된 ref → fileId(검증 실패 시 null). */
export function verifyReportRef(ref) {
  if (typeof ref !== 'string' || !ref.includes('~')) return null;
  const idx = ref.lastIndexOf('~');
  const id = ref.slice(0, idx);
  const sig = ref.slice(idx + 1);
  if (!id || !sig) return null;
  let expected;
  try {
    expected = refSig(id);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

// ── 스텁 목록 ────────────────────────────────────────────────
// P2: <메인폴더>/<팀폴더>/<주간폴더>/정산서_*.pdf 를 team·month로 필터해 나열한다.
export function reportsForMonth({ teamNames, month }) {
  const [y, m] = String(month).split('-');
  return [
    {
      id: `stub-${teamNames}-${month}`.replace(/[^\w-]/g, '_'),
      label: `정산서 · ${teamNames} · ${Number(m)}월`,
      date: `${y}-${m}-11`,
      available: true, // 스텁 PDF가 실제로 열린다
      stub: true,
    },
  ];
}

// ── 스텁 PDF ─────────────────────────────────────────────────
// 오프셋을 계산해 xref가 정확한 최소 PDF를 만든다.
export function fetchReportPdf(/* id */) {
  const lines = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 420 200]/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const stream =
    'BT /F1 15 Tf 40 130 Td (Settlement report - stub) Tj ' +
    '0 -26 Td (Cover = category totals, then receipt images.) Tj ' +
    '0 -22 Td (Wired to Drive PDF in P2.) Tj ET';
  const objects = [
    ...lines,
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
