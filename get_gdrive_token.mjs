#!/usr/bin/env node
/**
 * Google Drive OAuth2 Refresh Token 발급 (로컬 백업 스크립트)
 *
 * ⚠️ 웹 버전 권장: https://receipt-app-rho.vercel.app/api/gdrive-token
 *
 * 이 스크립트는 로컬 백업용입니다.
 * 실행 전에 먼저 환경변수를 로컬에 내려받아야 합니다:
 *
 *   vercel env pull .env.local
 *   node --env-file=.env.local get_gdrive_token.mjs
 *
 * 또는 환경변수를 직접 설정:
 *   GDRIVE_CLIENT_ID=xxx GDRIVE_CLIENT_SECRET=yyy node get_gdrive_token.mjs
 */

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const PORT          = 3999;
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ 환경변수를 설정해주세요:');
  console.error('   vercel env pull .env.local');
  console.error('   node --env-file=.env.local get_gdrive_token.mjs');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope:       ['https://www.googleapis.com/auth/drive'],
  prompt:      'consent',
});

console.log('\n1. 아래 URL을 브라우저에서 열어 fespacecrew@gmail.com으로 로그인하세요:');
console.log('\n' + authUrl + '\n');
console.log('(로그인 후 자동으로 토큰이 발급됩니다)\n');

// 로컬 서버로 콜백 수신
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('<h2>코드가 없습니다. 다시 시도해주세요.</h2>');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n✅ 성공! 아래 값을 Vercel에 추가하세요:\n');
    console.log('GDRIVE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\n명령어:');
    console.log('  vercel env add GDRIVE_REFRESH_TOKEN production');
    console.log('  vercel --prod\n');

    res.end(`
      <h2 style="color:green">✅ 토큰 발급 완료</h2>
      <p>터미널에서 GDRIVE_REFRESH_TOKEN 값을 확인하세요.</p>
      <p>이 창을 닫아도 됩니다.</p>
    `);
  } catch (e) {
    console.error('오류:', e.message);
    res.end(`<h2>오류</h2><pre>${e.message}</pre>`);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`(로컬 서버 대기 중: http://localhost:${PORT})`);
});
