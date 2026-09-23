# Receipt App

영수증 입력, 검토, 집계, Drive 전송을 한 화면에서 처리하는 운영용 앱입니다.

## 실행

```bash
npm install
npm run dev
```

검증용 명령:

```bash
npm run lint
npm test
npm run build
```

Google Drive 통합 테스트는 실제 Drive에 테스트 폴더와 파일을 만들 수 있으므로 기본 테스트에 포함하지 않습니다. 테스트 전용 Drive 폴더를 설정하고 아래 명령으로만 실행하세요.

```bash
npm run test:integration
```

필수 환경변수는 `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN`, `GDRIVE_MAIN_FOLDER_ID`, `GDRIVE_INTEGRATION_FOLDER_ID`입니다. `GDRIVE_INTEGRATION_FOLDER_ID`는 운영 루트와 다른 테스트 전용 폴더여야 합니다. 자격 증명이 없거나 두 폴더 ID가 같으면 이 명령은 실패하며, 기본 `npm test`는 이를 성공으로 처리하지 않고 실행 대상에서만 제외합니다.

## 핵심 기능

- 영수증 촬영, 업로드, 직접 입력
- 목록, 이미지, 집계 전환
- 주간 예산 관리
- JSON 백업과 복원
- Google Drive 전송
- 카카오 알림 전송
- 로컬 저장과 Supabase 동기화

## 환경변수

### 클라이언트

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 서버

- `ADMIN_PIN`
- `UPLOAD_API_TOKEN` optional, server-to-server Authorization only
- `GDRIVE_CLIENT_ID`
- `GDRIVE_CLIENT_SECRET`
- `GDRIVE_REFRESH_TOKEN`
- `GDRIVE_MAIN_FOLDER_ID`
- `KAKAO_REST_API_KEY`
- `KAKAO_MANAGER_REFRESH_TOKEN`
- `KAKAO_CLIENT_SECRET`  optional
- `ANTHROPIC_API_KEY` optional
- `CLAUDE_API_KEY` optional
- `BIZNO_API_KEY` optional

## 상태 점검

- `/api/health`

이 엔드포인트는 환경변수 존재 여부만 보지 않고, Drive와 Kakao는 실제 연결도 확인합니다.

## 운영 순서

1. 앱이 안 열리면 브라우저 콘솔과 화면 에러 메시지를 먼저 확인합니다.
2. 저장은 되는데 다른 기기에 안 보이면 상단의 동기화 상태와 `보류 N` 배지를 확인합니다.
3. Drive 전송이 실패하면 `/api/health`에서 `upload`, `drive`, `kakao` 상태를 확인합니다.
4. 관리자 인증 문제가 있으면 서버 환경변수 `ADMIN_PIN`과 재배포 여부를 먼저 봅니다.
5. 인증 관련 문제는 Vercel 환경변수와 재배포 여부를 먼저 봅니다.

## 데이터 저장

- 영수증 본문, 이미지, 편집 이력, 카드 매핑, 동기화 큐는 IndexedDB에 저장합니다.
- Supabase는 기기 간 동기화용입니다.
- JSON 백업은 로컬 복구용입니다.

## 배포

Vercel에 배포합니다.

```bash
vercel --prod
```

## 참고

- `PRODUCT.md`: 제품 목적과 사용자 기준
- `api/health.js`: 운영 점검
- `src/hooks/useReceipts.js`: 로컬 저장, 동기화 큐, 이미지 저장
