# 무표시 Drive 초안 보관 인계

## 현재 완료

- P0 최종 제출 신뢰성(Drive 산출물 확인, 서버 finalization, 완료 횟수 원자 기록)은 구현·검토·회귀 검증을 마쳤다. 배포는 하지 않았다.
- 4D 초안 보관의 로컬 기반:
  - `src/utils/receiptDb.js`: DB v10, additive `draft_backup_outbox` store.
  - `src/utils/draftBackupOutbox.js`: immutable receipt/image snapshot, SHA-256, chunk metadata, tombstone builder.
  - `src/hooks/useReceiptCrud.js`: receipt/history/image/outbox를 하나의 IndexedDB RW transaction에서 기록한다. 기존 outbox의 high-water revision을 반영해 delete 뒤 re-save도 단조 증가한다.
  - `src/hooks/useReceiptCrud.atomic.test.js`: 기존 사진 수정, 공유 사진 삭제, outbox 실패 rollback, delete→resave high-water, Web Locks 없는 겹친 save/delete를 검증한다.
  - `src/utils/draftBackupWorker.js`: 주입형 순수 worker. 기본 `enabled:false`, network/UI/final completion을 건드리지 않는다. strict ACK, lease, claim, backoff, 실패 보존 계약을 테스트한다.

## 아직 미구현

1. 실제 IndexedDB outbox adapter와 `useDraftBackupWorker` hook 연결. 앱 시작·저장/삭제 성공 후·online/focus에서만 조용히 drain한다. 서버 endpoint 전에는 반드시 disabled 상태여야 한다.
2. `api/upload.js`의 엄격히 격리된 `isDraftBackup` 분기. 새 Vercel 함수는 만들지 않는다(현재 12/12). final XLSX/image/PDF/aggregate/job/lock과 혼합된 요청은 Drive 접근 전 거절한다.
3. 초안 전용 Drive 경로의 chunk staging, receipt별 latest manifest, revision/tombstone ordering, strict commit ACK.
4. 실제 transport를 capability gate 뒤에 연결하고 worker+server 통합/E2E를 검증한다.

## 필수 제약

- 화면 상태, toast, 완료 횟수, Supabase sync journal을 초안 보관 때문에 변경하지 않는다.
- `/api/upload`의 기존 final 제출 경로를 초안 worker가 호출하지 않는다.
- 이미지 원본은 outbox 안의 Blob/hash snapshot을 사용한다. `imageId`를 나중에 다시 읽어 대체하지 않는다.
- 실패·timeout·빈 응답·ACK 불일치에서는 outbox를 삭제하지 않는다.
- draft backup은 final 제출 또는 사무실 집계 자료가 아니다. Drive 경로와 dashboard/aggregate/recovery 탐색에서 격리한다.
- 큰 원본은 2MiB 이하 raw chunk, chunk/whole SHA, manifest commit 계약으로 처리한다.
- 배포하지 않는다. 기존의 관련 없는 변경은 덮어쓰지 않는다.

## 검증 현황

- 최근 전체 Vitest: 717 passed, 15 skipped (worker 추가 뒤에는 worker focused 8 passed/lint pass만 재실행됨).
- 최근 build: 성공(atomic refactor 시점).
- 새 worker 후 전체 suite/build/E2E는 다시 실행 필요.
- 내부 검토: atomic outbox 단위는 SHIP. worker는 아직 adapter/server 연결 전이므로 별도 구현·검토 필요.

## 시작 명령

```bash
cd /Users/kyounghomac/Projects/receipt-app
npx vitest run
npm run lint
npm run build
```
