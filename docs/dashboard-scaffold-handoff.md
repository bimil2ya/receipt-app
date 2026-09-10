# 대시보드 착수 골격 — Codex 인계 문서

> 작성 2026-09-11 · 기준: 계획서 v0.9, 착수 키트 초판
> 계획서: https://claude.ai/code/artifact/5b539111-92c6-4cb0-a538-a22cf8429f81
> 착수 키트: https://claude.ai/code/artifact/b092bbaa-0556-48e1-9916-d69bc827b49e

## 브랜치 상태

- 브랜치: `feat/dashboard-scaffold` (origin에 push됨), main HEAD `939e067` 위 3커밋:
  - `9637ed3` — API 골격 7파일 (라우터·토큰·KV·rate·데이터스텁·메일스텁·테스트 21개)
  - `68d40b3` — 이 문서
  - `cb39f19` — 클라이언트 화면 `#/dashboard` 7파일 (로그인·역할별 탭·차트)
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
| `api/_dashboardMail.js` | 복구 메일 — sender 미연결, 로그만 |
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
- `scripts/verify-env.mjs`의 `requiredEnvVars`에 대시보드 env 추가
  (`DASHBOARD_PW_OWNER`/`STAFF`, `DASHBOARD_TOKEN_SECRET`, `RECOVERY_EMAIL` — KV는 이미 연결됨).
- `incr`+`expire`는 별개 명령이라 원자적이지 않음 — `expire`를 매번 `NX`로 호출해 self-heal(이미 구현).
- SW precache: `DashboardApp-*.js` 청크가 현장 유저에게도 precache됨 → `workbox.globIgnores` 검토.

## Codex 작업과의 정합 (2026-09-11 확인)

Codex 진행 상황(P0 최종 제출 신뢰성, 6단계 진입): `_submissionLock.js`·`_submissionJob.js`가
`api/_kv.js`의 `KvUnavailableError`를 import 중. Upstash Redis가 이미 Vercel 프로젝트에 연결됨
(`.env.local`에 `KV_REST_API_URL`/`KV_REST_API_TOKEN` 존재). → **"KV 저장소 결정" 선결조건 해소.**

이 브랜치에서 맞춘 것(커밋 `5e325b8`):
- `_kv.js` = 공유 Redis foundation. `getRedis()`는 Codex의 `getSubmissionRedis()`와 같은 계약
  (env·`new Redis({url,token})`·`KvUnavailableError`). `KvUnavailableError` 이름·code 불변.
- 차이: `getRedis()`는 **로컬에서 인메모리 셰임**(rate-limit 잠금이 프로덕션 Redis에 새면
  실제 대시보드가 잠기므로). Codex의 `getSubmissionRedis()`는 로컬도 실제 Redis — 병합 시 재검토.
- `_dashboardRate.js` 키 namespace = `dashboard:v1:rl:*` (Codex의 `submission-lock:v1:*`와 분리).

**병합 시 Codex가 할 수 있는 정리(선택)**: `_submissionLock.js`의 `getSubmissionRedis()`를
`import { getRedis } from './_kv.js'`로 대체 가능(계약 동일). 지금은 중복이지만 충돌 아님.

## 안 해도 되는 것 (별도 트랙 — Codex는 건드리지 말 것)

- `api/_kv.js` — Codex와 정합 완료(위). `getRedis()`/`memoryRedis()`/`KvUnavailableError` 유지
- `api/_dashboardMail.js` 의 실제 이메일 전송 — sender 미정 (Resend/Nodemailer)
- 클라이언트 `#/dashboard` 화면 — `cb39f19`에서 완료(스텁 데이터로 동작).
  `_dashboardData.js`가 실데이터로 바뀌면 자동으로 실데이터를 그린다.
  단 **응답 필드 이름·구조를 바꾸면 `src/dashboard/DashboardShell.jsx`도 같이 고쳐야 한다.**
- 배포 (`api/dashboard.js`는 신규 라우트 +1, env: `DASHBOARD_PW_OWNER/STAFF`,
  `DASHBOARD_TOKEN_SECRET`, `RECOVERY_EMAIL`, KV 연동, 이메일 sender 키)
- SW 캐시: `#/dashboard` 청크(`DashboardApp-*.js`)는 현재 precache에 포함됨 —
  나중에 workbox `globIgnores` 또는 `dontCacheBustURLsMatching`로 제외 검토
