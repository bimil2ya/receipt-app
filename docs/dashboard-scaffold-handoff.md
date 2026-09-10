# 대시보드 착수 골격 — Codex 인계 문서

> 작성 2026-09-11 · 기준: 계획서 v0.9, 착수 키트 초판
> 계획서: https://claude.ai/code/artifact/5b539111-92c6-4cb0-a538-a22cf8429f81
> 착수 키트: https://claude.ai/code/artifact/b092bbaa-0556-48e1-9916-d69bc827b49e

## 브랜치 상태

- 브랜치: `feat/dashboard-scaffold`
- 커밋: `9637ed3` (main HEAD `939e067` 위, **신규 파일 7개만** — 735줄)
- P2 WIP(현재 ~66개 미커밋 파일)와 **파일 충돌 없음** (전부 신규 파일).
  이 브랜치를 `git merge feat/dashboard-scaffold` 또는 `git cherry-pick 9637ed3` 하거나
  이 브랜치 위에서 이어서 작업하면 된다.

## 이미 있는 것 — 건드리지 말 것 (계약이 테스트로 고정됨)

| 파일 | 역할 |
|---|---|
| `api/dashboard.js` | 단일 라우트 `?action=auth\|data\|forgot`. 메서드 고정(405)·잘못된 action(400)·KV 장애 시 fail-closed(503) |
| `api/_dashboardToken.js` | HMAC-SHA256 스테이트리스 토큰 sign/verify (`_auth.js`엔 `safeCompare`만 있어 신규) |
| `api/_kv.js` | KV 어댑터 — 인메모리 fallback + `configureKv(client)` 주입구. 접근 실패는 `KvUnavailableError`(code `KV_UNAVAILABLE`)로 **전파**(삼키지 않음) |
| `api/_dashboardRate.js` | auth 10분 5회 잠금 / forgot 전역 1시간 1회 / IP는 sha256 앞 16자만 저장 |
| `api/_dashboardMail.js` | 복구 메일 — sender 미연결, 로그만 |
| `api/dashboard.test.js` | vitest 21개 — **계속 green이어야 함** |

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

## 안 해도 되는 것 (별도 트랙)

- `api/_kv.js` 의 `configureKv()` 실구현 + `@upstash/redis` 설치 — Upstash 승인 대기 중
- `api/_dashboardMail.js` 의 실제 이메일 전송 — sender 미정 (Resend/Nodemailer)
- 클라이언트 `#/dashboard` 화면 — 착수 키트 §8
- 배포 (`api/dashboard.js`는 신규 라우트 +1, env 5종)
