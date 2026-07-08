// Vercel 파일 기반 라우팅에서 _ 접두사 파일은 API 라우트에서 제외됩니다.
// analyze.js / upload.js / aggregate.js / lookup-biz.js / teams.js / restore.js
// 6개 파일이 공통으로 사용하는 허용 출처 목록입니다.
// Edge 런타임(analyze.js, lookup-biz.js)도 import하므로 Node.js 전용 모듈 사용 금지.
export const ALLOWED_ORIGINS = [
  'https://receipt-app-rho.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];
