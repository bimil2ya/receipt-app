# 대시보드 착수 골격 — Codex 인계 문서

> 작성 2026-09-11 · 기준: 계획서 v0.9, 착수 키트 초판
> 계획서: https://claude.ai/code/artifact/5b539111-92c6-4cb0-a538-a22cf8429f81
> 착수 키트: https://claude.ai/code/artifact/b092bbaa-0556-48e1-9916-d69bc827b49e

## ⚠️ 배포 함수 상한 — Vercel Hobby 12개 (해소됨, 여유 없음)

이 브랜치의 preview 자동배포가 계속 실패했었다. Vercel API로 확인한 원인:
```
errorCode: exceeded_serverless_functions_per_deployment
"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan."
```
`npx vercel build` 로컬 실측:
| 상태 | `.vercel/output/functions/api/*.func` | 비고 |
|---|---|---|
| main (939e067) | 13 | 마지막 성공 프로덕션 배포 2026-09-06 |
| 이 브랜치 (조치 전) | 14 | main + `dashboard.func` + `review.func` − `monitoring`(.vercelignore) |
| **이 브랜치 (조치 후)** | **12** | 아래 `.vercelignore` 2건 추가 |

`api/`의 `.js`는 `export default`가 없는 순수 모듈(`driveUtils.js`·`cache.js`·`approvalReport.js`·
`indexeddb-schema.js`·`metadata.js`)도 Vercel이 (깨진) 함수로 카운트한다.

### 이 브랜치에서 한 조치
- `.vercelignore`에 3건 추가 — **전부 `export default` 없음 + 배포 코드에서 import 0**:
  - `api/monitoring.js` — 죽은 코드.
  - `api/metadata.js` — 코드 참조 없음(문서만). Drive 헬퍼지만 어디서도 안 씀.
  - `api/indexeddb-schema.js` — 유일 consumer `offline-sync.js`가 이미 제외됨. 브라우저 전용(`indexedDB`).
  → 로컬 빌드 14 → **12**. cloud 카운트도 그만큼 내려가 preview·프로덕션 모두 배포 가능.
- `vercel.json` → `git.deploymentEnabled: { "feat/dashboard-scaffold": false }` — 자동배포 중단.
  이제 12개로 맞았으니 **이 키를 지우면 preview 자동배포가 되살아난다**(단 preview엔 env가 없어
  대시보드 런타임은 503). **병합 시 이 키 제거.**

### 남은 리스크 — 여유가 0이다
- 병합 후 main = 12(로컬) / ~10(cloud 추정). 그래도 **다음에 함수 하나 늘면 다시 깨진다.**
- 근본 해결(택1, Codex/팀 판단):
  - `driveUtils.js`·`cache.js`·`approvalReport.js`를 `_` 접두사로 rename + import 경로 수정
    → 함수 3개 추가 감소. **⚠️ Codex WIP가 `driveUtils.js`를 9곳에서 import — 단독 실행 시 즉시
    깨짐. P0 병합 후 조율.**
  - **Vercel Pro 업그레이드** — 2인 내부 도구엔 이게 가장 단순.

## ⚠️ 배포 전 결정 (보안·신뢰성)

1. **비밀번호 = 패스프레이즈.** 이 화면은 영수증의 **카드번호·사업자번호·조원 실명·금액**을
   노출한다. 6자리 PIN(100만 조합)으로는 부족 — `DASHBOARD_PW_OWNER`/`STAFF`를 **12자 이상
   패스프레이즈**로. (코드는 부팅 시 경고만 — 강제하면 의도적 값도 잠김.)
2. **정산서 PDF 전달 전략 (P2).** `?action=report`는 지금 `res.end(buffer)` — **Vercel 응답
   본문 상한(~4.5MB)**을 넘는 정산서(영수증 이미지 다수, 최대 20MB)는 413(가드·클라 메시지 있음).
   P2에서 **짧은 수명 Drive 서명 URL 리다이렉트** 또는 스트리밍으로 교체. `fetchReportPdf` TODO.
3. **`?action=data` 응답 크기.** 스텁은 `ledger[]` 7행이지만 P2는 `전체내역`+`reviewsRaw` 전량
   → 바쁜 달 4.5MB 근접. `ledger` 페이지네이션 또는 조별 드릴다운에서만 로드(계획서 §5).
4. **세션 토큰 폐기.** TTL 4h로 줄였으나 스테이트리스 HMAC이라 개별 폐기 불가 — 유출 시
   `DASHBOARD_TOKEN_SECRET` 로테이션(전원 재로그인). 진짜 로그아웃/폐기 필요하면 `jti` + KV denylist.
5. ~~"비밀번호 찾기"가 실제로 동작하지 않는다~~ — **해결됨.** `_dashboardMail.js`가
   Nodemailer로 실제 SMTP 발송을 한다(기존에 쓰던 메일 계정 사용, Resend 아님).
   `DASHBOARD_SMTP_HOST`/`DASHBOARD_SMTP_USER`/`DASHBOARD_SMTP_PASS`(필수) +
   `DASHBOARD_SMTP_PORT`(기본 587)/`DASHBOARD_SMTP_FROM`(기본 SMTP_USER, 선택)를
   Vercel env에 넣으면 된다. **env가 비어 있으면 이전처럼 로그만 남기고 조용히 생략**하므로
   (fail-safe, `handleForgot`은 항상 같은 200을 응답) 지금 당장 설정 안 해도 아무것도 안 깨진다.
   로컬 fake SMTP 서버로 `handleForgot → sendRecoveryEmail → 실제 발송`까지 통째로 E2E 검증함
   (envelope from/to, 제목, 본문의 실제 패스프레이즈까지 수신 확인). 단위테스트
   `api/_dashboardMail.test.js` 5개(미설정/수신처 없음/발송 성공/포트별 TLS/발송 실패) 추가.

### 확인 완료 — 문제 아님
- `maxDuration: 60` — **문제 없음.** `api/upload.js`가 이미 60으로 배포 중이고 Vercel 기본
  타임아웃이 300s로 올랐다. `api/dashboard.js`의 `config.maxDuration = 60` 그대로 둔다.
- Preview keyspace 오염 — **거의 무의미.** memory 확인: **Preview 타깃엔 env가 하나도 없다.**
  → preview에서 `getRedis()`는 `KV_REST_API_*` 없음 → `KvUnavailableError` → 503(로그인 자체 불가).
  Codex의 `getSubmissionRedis()`도 동일 → 제출도 preview에서 못 함. preview가 프로덕션
  Upstash를 건드릴 경로가 없다. (그래도 Codex 키에 env prefix는 방어적으로 권장.)

## 브랜치 상태

- 브랜치: `feat/dashboard-scaffold` (origin push), main HEAD `939e067` 위 ~40커밋.
- API: `dashboard.js`(라우터 `?action=auth|data|forgot|report`) + `_dashboardToken/Rate/Data/Mail/Reports.js` + `_kv.js`.
- 클라이언트: `src/dashboard/*` + `src/main.jsx`(`#/dashboard` lazy).
- main 대비 변경: 신규 파일 22개 + `src/main.jsx` +32/−2 + `.vercelignore`/`vercel.json`/`eslint.config.js`.
  **기존 앱 코드 중 손댄 것은 `src/main.jsx` 하나뿐** — 필드 앱 렌더 경로·스플래시 로직 불변,
  `hashchange` 리스너는 `#/dashboard` 경계를 넘을 때만 reload(필드 앱엔 inert).
- 검토 9회(내부 에이전트 2 + 자체 7). `npm run lint` 0 / `npx vitest run` 452 passed·15 skipped / `npm run build` OK.
  Codex의 `_submissionLock.test.js`·`_submissionJob.test.js` 그대로 green(`KvUnavailableError` 계약 불변).
- P2 WIP(현재 ~66개 미커밋 파일)와 **파일 충돌 없음** (전부 신규 파일).
  `git merge feat/dashboard-scaffold` 하거나 이 브랜치 위에서 이어서 작업하면 된다.
- `npm run lint` 0, `npm run build` 성공, `npx vitest run api/dashboard.test.js` 21/21.
- 로컬 dev에서 owner 로그인 → 4탭, staff 로그인 → 3탭(이상 지출 없음) 확인됨.
  (dev 실행: `DASHBOARD_PW_OWNER=… DASHBOARD_PW_STAFF=… DASHBOARD_TOKEN_SECRET=… npm run dev`
   후 `http://localhost:5173/#/dashboard`)

## 이미 있는 것 — 건드리지 말 것 (계약이 테스트로 고정됨)

| 파일 | 역할 |
|---|---|
| `api/dashboard.js` | 단일 라우트 `?action=auth\|data\|forgot`. 메서드 고정(405)·잘못된 action(400)·KV 장애 시 fail-closed(503) |
| `api/_dashboardToken.js` | HMAC-SHA256 스테이트리스 토큰 sign/verify (`_auth.js`엔 `safeCompare`만 있어 신규) |
| `api/_kv.js` | KV 어댑터 — 인메모리 fallback + `configureKv(client)` 주입구. 접근 실패는 `KvUnavailableError`(code `KV_UNAVAILABLE`)로 **전파**(삼키지 않음) |
| `api/_dashboardRate.js` | auth 10분 5회 잠금 / forgot 전역 1시간 1회 / IP는 sha256 앞 16자만 저장 |
| `api/_dashboardMail.js` | 복구 메일 — Nodemailer/SMTP로 실제 발송(env 없으면 로그만, fail-safe) |
| `api/dashboard.test.js` | vitest 21개 — **계속 green이어야 함** |
| `src/dashboard/*` + `src/main.jsx` | 클라이언트 화면. `payload.role`로 UI 결정 — API 응답 형태를 바꾸면 여기가 따라 깨진다 |

`npx vitest run api/dashboard.test.js` → 21 passed. 전체 스위트도 395 passed / 0 failed 확인됨.

## 채울 것 ①  `api/_dashboardData.js` 의 `buildDashboardPayload({ month, role })`

지금은 고정 스텁(`stub: true`). 이걸 **월별 전체집계 Google Sheet export 파싱**으로 교체한다.

- 응답 계약(필드 이름·구조)은 착수 키트 §7 그대로 유지:
  `contractVersion, month, role, generatedAt, sheetModifiedTime,
   totals{spent, core, fuelMed, receiptCount, prevMonthSpent},
   byCategory, teams[], ledger[], reviewsRaw[], unmatchedLedgerCount, trend[]`
- **역할 분리는 서버에서**: `role === 'staff'`면 `flags` / `coDining` 키를
  객체에 **넣지 않는다** (`delete`도 `null`도 아님 — `dashboard.test.js`의
  "omits flags and coDining keys entirely for staff" 테스트가 `'flags' in body === false`를 검사).
- `stub: true` 플래그 제거.
- 불변식 (테스트가 검증):
  - `ledger` 금액 합 === `totals.spent`
  - `byCategory` 합 === `totals.spent`
  - `totals.core + totals.fuelMed === totals.spent`
  - 조별 `review.ok + req + none` ≤ `receiptCount`
- 검수 카운트(`teams[].review`)는 `검토기록` 탭 **직접 집계**
  (`팀별검토현황`엔 완료/요청/미검토 3단 카운트가 없음).
- 원장 검수 상태(`ledger[].reviewStatus`): `영수증식별값`이 있으면 정확 조인,
  없으면 (팀·날짜·사용처·금액) 퍼지 매칭. 매칭 실패 건 수 = `unmatchedLedgerCount`.
- `maxDuration: 60` 은 `api/dashboard.js`에 이미 설정됨. Drive/Sheets 429는
  지수 백오프. 과거 월 순회는 요청받은 월만(화면이 여러 달 합침).

## 채울 것 ①-b  `api/_dashboardReports.js` — 조별 정산서 PDF

`?action=report`·클라이언트 `ReportsPanel`·HMAC 서명(ref)·PDF 스트리밍은 완성.
**두 함수만 실제 Drive 연동으로 교체:**
- `reportsForMonth({ teamNames, month })` — 지금은 고정 1개. → `<메인폴더>/<팀폴더>/<주간폴더>/정산서_*.pdf`
  (`api/upload.js`가 `정산서_{surveyorName}_{weekFolderName}.pdf`로 업로드)를 team·month로 필터해
  `[{ id: <Drive fileId>, label, date, available: true }]` 반환. 한 조에 2명이면 2개 나올 수 있음.
- `fetchReportPdf(id)` — 지금은 최소 스텁 PDF. → `createDrive()` +
  `drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' })` (upload.js의 `downloadFileBuffer` 참고).
- `id`는 클라이언트가 조작 못 한다(dashboard-data가 `signReportRef`로 서명, `?action=report`가 검증).
  **단 HMAC은 `_dashboardData.js`가 넘긴 id면 뭐든 인가한다** → `reportsForMonth`가 반드시
  `<메인>/<팀>/<주간>/정산서_*.pdf` 경로의 fileId만 반환하도록(다른 Drive 파일 id를 실수로
  서명하면 그 파일이 열린다). `fetchReportPdf`에서도 파일 mimeType=`application/pdf` + 이름 패턴 재확인 권장.
- 정산서 표지가 이미 "용도별 집계장", 이후 페이지가 영수증 이미지다(`src/utils/receiptPdfReport.js`) — 별도 가공 불필요.

## 채울 것 ②  P2 확정 사항 회신 (착수 키트 §2)

- `검토기록` 탭 최종 열 목록 (writable 열 포함)
- `전체내역`에 `영수증식별값` 열이 실제로 들어갔나 (`buildDetailRows`의 `.map()` 출력)
- **옛 영수증의 `영수증식별값` 완결성** — 빈 건 비율, 소급 채우기 가능 여부
- "검토 시점 버전" 정보 저장 위치 (`REVIEW_WRITABLE_COLUMNS`에 없음 →
  `검토 시각` 기준 추정 폴백이 실제로 필요한지)
- `api/review.js`가 미검토 행을 버리는 현재 동작 유지 여부
- Sheet 탭 이름이 `검토필요 · 변경이력 · 팀별검토현황 · 날짜별집계 · 전체내역 · 검토기록` 으로 확정인지
  (Google Sheet 변환 시 그대로 넘어오는지)

## 채울 것 ③  P2 커밋 + e2e green

현재 ~66개 파일 미커밋, 테스트 실패 상태. 논리 단위로 커밋하고 e2e를 통과시킨다.
커밋 후 `검토기록` 시트 열 구성을 "동결"로 선언 → 계획서 §3을 실제 산출물과 재대조.

## 코드 리뷰 상태 (2026-09-11 — 내부 리뷰 1 + 자체 정독 2)

판정: **Codex에게 넘겨도 되는 상태** — `_dashboardData.js` 실구현은 어떤 이슈로도 차단되지 않는다.
- `1d459fb`: 내부 에이전트 리뷰 반영(fail-closed 기본값, x-real-ip, PIN 경고, expire NX 등)
- `db43834`: 정독 2 (api.js 네트워크 실패 방어, recentMonths 월 롤오버 버그, preview도 fail-closed)
- `6f219ce`: 정독 3 (forgot가 KV 다운에도 동일 200, _dashboardMail 조용한 거짓말 제거, 스플래시 하드폴백)
- `7035c6d`: 정독 4 (부분 응답에도 흰 화면 대신 렌더, won이 콤마 문자열 허용)

**응답 필드 이름·구조를 바꾸면 `src/dashboard/DashboardShell.jsx`도 같이 고쳐라.**
`_dashboardData`가 amount를 숫자로 emit해야 한다(문자열도 won이 파싱하지만 다른 계산은 숫자 가정).

**배포(또는 실 로그인 노출) 전 남은 것 — Codex 작업과 무관, 별도:**
- Vercel 함수 예산: `dashboard.js` +1. `api/`의 non-`_` 헬퍼(`driveUtils.js`,
  `indexeddb-schema.js` 등)가 함수로 세어질 수 있음 → `.vercelignore` 추가 또는 `_` 개명 검토.
- `scripts/verify-env.mjs`: 대시보드 env는 **경고만**(배포는 안 막음 — 대시보드가 아직
  미배포라 무관한 배포를 깨지 않게). 대시보드를 실제 배포·활성화할 때
  `dashboardEnvVars`를 `requiredEnvVars`로 옮기고 Vercel에 값 설정:
  `DASHBOARD_PW_OWNER`/`STAFF`/`DASHBOARD_TOKEN_SECRET`/`RECOVERY_EMAIL`
  (`KV_REST_API_*`는 Upstash 연동이 이미 넣어둠).
- `incr`+`expire`는 별개 명령이라 원자적이지 않음 — `expire`를 매번 `NX`로 호출해 self-heal(이미 구현).
- SW precache: `DashboardApp-*.js` 청크가 현장 유저에게도 precache됨 → `workbox.globIgnores` 검토.
- **공유 IP 잠금**: rate-limit이 IP별이라 노경호·담당자가 같은 사무실 망(같은 공인 IP)이면
  한 사람의 5회 오타가 둘 다 10분 잠금. 2인·10분 대기로 수용하기로 함(현행 유지, 결정 완료).
  "비밀번호 찾기"는 이제 실제로 메일이 가므로(위 §5) 잠금 중에도 복구는 가능.
- `ErrorBoundary`(공유)는 다크 테마 — 대시보드에서 렌더 크래시 시 어두운 오류 박스가 뜬다
  (데이터 로드 실패는 `DashboardApp`이 자체 라이트 테마로 처리). 수용 가능, 필요 시 라우트별 분기.
- **Vercel 함수 예산** → 위 "배포 함수 상한" 섹션으로 통합. 조치 후 로컬 빌드 12/12(여유 0).

## Codex 작업과의 정합 (2026-09-11 확인)

Codex 진행 상황(P0 최종 제출 신뢰성, 6단계 진입): `_submissionLock.js`·`_submissionJob.js`가
`api/_kv.js`의 `KvUnavailableError`를 import 중. Upstash Redis가 이미 Vercel 프로젝트에 연결됨
(`.env.local`에 `KV_REST_API_URL`/`KV_REST_API_TOKEN` 존재). → **"KV 저장소 결정" 선결조건 해소.**

이 브랜치에서 맞춘 것(커밋 `5e325b8`·`<이번>`):
- `_kv.js`에 3개 export: `KvUnavailableError`(이름·code 불변 — Codex import), `createUpstashClient()`
  (자격증명당 1개 메모이즈, Codex의 `new Redis()` 블록과 통합 가능한 유일한 지점),
  `getRedis()`(대시보드 rate-limit 전용), `memoryRedis()`(로컬 셰임 — incr/expire(NX)/del/get/set(nx,ex)만, **Lua eval 없음**).
- `_dashboardRate.js` 키 = `dashboard:v1:${VERCEL_ENV}:rl:*` — **환경 prefix**로 preview↔production 잠금 카운터 격리.

### ⚠️ `getRedis()`를 `getSubmissionRedis()`와 **통합하지 말 것**
- `getRedis()`는 `VERCEL_ENV`가 production/preview가 **아닌 모든 환경**(로컬 vitest, `vercel dev`,
  CI, `npm run dev`)에서 `memoryRedis()` 셰임을 준다. 셰임엔 `eval`이 없어서 `_submissionLock.js`의
  Lua `EVAL` renew/release가 즉시 `KvUnavailableError` → **로컬 제출 흐름이 fail-closed로 깨진다.**
  또 셰임은 프로세스 로컬이라 분산 잠금으로 무의미.
- 통합하려면 `_submissionLock.js`의 `getSubmissionRedis()`가 `_kv.js`의 **`createUpstashClient()`**
  를 호출하게 하라(둘 다 실제 Upstash, 셰임 없음). `getRedis()`가 아니다.

### ⚠️ 로컬 개발 비대칭 (병합 후)
`npm run dev` + `.env.local`(KV 자격증명 있음)에서 **대시보드는 셰임 / 제출 흐름은 실제 프로덕션
Upstash**에 붙는다(`getSubmissionRedis()`는 자격증명 존재만 확인). 로컬에서 최종 제출을 한 번
돌리면 `submission-lock:*`·`receipt-submission:*`(TTL 14일)이 프로덕션 Redis에 쓰인다.
→ Codex 권고: `getSubmissionRedis()`도 `VERCEL_ENV` 게이트 또는 `.env.local`에 dev 전용 Upstash DB.

## 안 해도 되는 것 (별도 트랙 — Codex는 건드리지 말 것)

- `api/_kv.js` — Codex와 정합 완료(위). `getRedis()`/`memoryRedis()`/`KvUnavailableError` 유지
- `api/_dashboardMail.js` — 완료(Nodemailer/SMTP). env만 채우면 됨(위 §5)
- 클라이언트 `#/dashboard` 화면 — `cb39f19`에서 완료(스텁 데이터로 동작).
  `_dashboardData.js`가 실데이터로 바뀌면 자동으로 실데이터를 그린다.
  단 **응답 필드 이름·구조를 바꾸면 `src/dashboard/DashboardShell.jsx`도 같이 고쳐야 한다.**
- 배포 (`api/dashboard.js`는 신규 라우트 +1, env: `DASHBOARD_PW_OWNER/STAFF`,
  `DASHBOARD_TOKEN_SECRET`, `RECOVERY_EMAIL`, KV 연동,
  `DASHBOARD_SMTP_HOST/USER/PASS`[필수 3개]+`PORT/FROM`[선택])
- SW 캐시: `#/dashboard` 청크(`DashboardApp-*.js`)는 현재 precache에 포함됨 —
  나중에 workbox `globIgnores` 또는 `dontCacheBustURLsMatching`로 제외 검토
