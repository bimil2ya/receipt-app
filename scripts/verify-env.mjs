#!/usr/bin/env node

import { execSync } from 'child_process';

const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'KAKAO_CLIENT_SECRET',
  'GDRIVE_CLIENT_ID',
  'GDRIVE_CLIENT_SECRET',
  'GDRIVE_REFRESH_TOKEN',
];

console.log('🔍 환경변수 검증 중...\n');

let allValid = true;

// Vercel에서 환경변수 목록 조회
try {
  const output = execSync('vercel env list 2>&1', { encoding: 'utf8' });

  for (const envVar of requiredEnvVars) {
    if (output.includes(envVar)) {
      console.log(`✅ ${envVar} - 설정됨`);
    } else {
      console.log(`❌ ${envVar} - 미설정!`);
      allValid = false;
    }
  }
} catch (error) {
  console.error('❌ Vercel 환경변수 조회 실패:', error.message);
  console.error('   → `vercel login` 으로 로그인한 후 다시 시도하세요.');
  process.exit(1);
}

console.log('');

if (!allValid) {
  console.error('❌ 필수 환경변수가 누락되었습니다!');
  console.error('   → Vercel 대시보드에서 Settings > Environment Variables에서 확인하세요.');
  process.exit(1);
}

console.log('✅ 모든 환경변수가 설정되어 있습니다!');
console.log('   배포를 진행합니다...\n');
