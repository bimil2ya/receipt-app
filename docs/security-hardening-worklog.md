# Security Hardening Worklog

Start time: 2026-06-28 09:55:38 KST
Start branch: main
Start commit: 5a2a79b

## Baseline

The worktree was already dirty before this hardening pass started. Existing modified files and untracked assets were recorded through `git status --short`, `git diff --stat`, `git diff --name-only`, and `git ls-files --others --exclude-standard`.

No existing user changes should be reverted by this work. Each code change should be scoped, verified, and recorded here.

## Planned Safe Order

1. Run baseline build/tests where possible.
2. Remove browser-exposed upload token usage while preserving server-side API behavior.
3. Move admin PIN verification out of browser code.
4. Clarify client-side crypto limitations without breaking legacy data.
5. Persist Kakao/upload completion state per trip session.
6. Replace disruptive `alert()` paths with existing toast/modal patterns.
7. Split `App.jsx` only after functional changes are stable.
8. Re-check ObjectURL cleanup and reduced-motion behavior.

## Change Log

- 2026-06-28 09:55 KST: Created this worklog before code changes.
- 2026-06-28 09:56 KST: Baseline `npm run build` passed.
- 2026-06-28 09:56 KST: Baseline `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 09:58 KST: Removed browser use of `VITE_UPLOAD_TOKEN` from upload/restore requests.
- 2026-06-28 09:58 KST: Moved admin PIN comparison from `AdminTeamModal` to `api/teams.js`.
- 2026-06-28 09:58 KST: Updated upload/restore APIs so static browser tokens are not required; Authorization remains supported only for server-to-server calls.
- 2026-06-28 09:58 KST: Post-change `npm run build` passed.
- 2026-06-28 09:58 KST: Post-change `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:00 KST: Added server-side admin PIN verify action before showing the team editor.
- 2026-06-28 10:00 KST: Admin verify change `npm run build` passed.
- 2026-06-28 10:00 KST: Admin verify change `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:01 KST: Added trip-scoped `sessionStorage` persistence for Kakao/upload completion state, keyed by owner and trip dates and guarded by receipt payload signature.
- 2026-06-28 10:01 KST: Completion persistence `npm run build` passed.
- 2026-06-28 10:01 KST: Completion persistence `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:02 KST: Replaced remaining `alert()` calls in app source with toast callbacks while preserving share/download fallbacks.
- 2026-06-28 10:02 KST: Verified `rg -n "alert\\(" src` returns no matches.
- 2026-06-28 10:02 KST: Alert removal `npm run build` passed.
- 2026-06-28 10:02 KST: Alert removal `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:03 KST: Replaced `animate-pulse` with `motion-safe:animate-pulse` for reduced-motion users.
- 2026-06-28 10:03 KST: Reduced-motion change `npm run build` passed.
- 2026-06-28 10:03 KST: Reduced-motion change `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:03 KST: Removed hardcoded client crypto seed from unused `src/utils/crypto.js`; kept no-op compatibility exports.
- 2026-06-28 10:03 KST: Verified hardcoded crypto seed and frontend `VITE_*` token/PIN imports are absent from `src`/`api` search results.
- 2026-06-28 10:03 KST: Crypto seed removal `npm run build` passed.
- 2026-06-28 10:03 KST: Crypto seed removal `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:07 KST: Added `clearReceiptImageUrlCache()` cleanup when `useReceipts` unmounts.
- 2026-06-28 10:07 KST: ObjectURL cleanup `npm run build` passed.
- 2026-06-28 10:07 KST: ObjectURL cleanup `npm run test` passed: 12 test files, 30 tests.
- 2026-06-28 10:08 KST: Final `npm run lint` passed.
- 2026-06-28 10:10 KST: Added `api/teams` admin PIN verification tests for missing config, wrong PIN, and valid PIN.
- 2026-06-28 10:10 KST: Targeted `npm run test -- tests/api/teams.test.js` passed: 4 tests.
- 2026-06-28 10:10 KST: Full `npm run test` passed: 12 test files, 33 tests.
- 2026-06-28 10:10 KST: Full `npm run build` and `npm run lint` passed.
- 2026-06-28 10:11 KST: Updated README and offline setup docs to remove browser-exposed upload token guidance and document server-side `ADMIN_PIN`.
- 2026-06-28 10:11 KST: Documentation update `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 10:22 KST: Extracted the trip close/backup UI from `App.jsx` into `src/components/trip/TripClosePanel.jsx`; parent upload/share/backup logic remains in `App.jsx`.
- 2026-06-28 10:22 KST: Trip close panel extraction `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 10:22 KST: `App.jsx` line count is now 1,524; `TripClosePanel.jsx` is 108 lines.
- 2026-06-28 10:23 KST: Extracted receipt input action buttons into `src/components/receipts/ReceiptInputActions.jsx`.
- 2026-06-28 10:23 KST: Receipt input action extraction `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 10:24 KST: Extracted budget/input/close workflow tabs into `src/components/trip/TripWorkflowTabs.jsx`.
- 2026-06-28 10:24 KST: Workflow tab extraction `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 10:24 KST: `App.jsx` line count is now 1,488.
- 2026-06-28 11:02 KST: Extracted receipt search/filter summary into `src/components/receipts/ReceiptListControls.jsx`.
- 2026-06-28 11:02 KST: Extracted receipt table sort header into `src/components/receipts/ReceiptTableHeader.jsx`.
- 2026-06-28 11:02 KST: Receipt list UI extractions `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:03 KST: Moved `BudgetStats` from `App.jsx` to `src/components/budget/BudgetStats.jsx`.
- 2026-06-28 11:03 KST: BudgetStats extraction `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:03 KST: `App.jsx` line count is now 1,430.
- 2026-06-28 11:04 KST: Extracted delete confirmation and manual receipt modals into receipt components.
- 2026-06-28 11:06 KST: Extracted inline receipt edit modal into `src/components/receipts/ReceiptEditModal.jsx`.
- 2026-06-28 11:09 KST: Extracted budget modal into `src/components/budget/BudgetModal.jsx`.
- 2026-06-28 11:10 KST: Extracted duplicate approval notice and modal into receipt components.
- 2026-06-28 11:10 KST: Removed stale unused `Modal` import after duplicate modal extraction.
- 2026-06-28 11:10 KST: Modal/UI extractions `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:10 KST: `App.jsx` line count is now 1,222.
- 2026-06-28 11:12 KST: Extracted processing banner and hidden file inputs into receipt components.
- 2026-06-28 11:12 KST: Processing/input extractions `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:14 KST: Started local dev server on `http://127.0.0.1:5173/`; HEAD `/` returned 200 and HEAD `/src/main.jsx` returned 200. In-app browser setup failed due a tool metadata error, and root GET via curl intermittently failed despite HEAD success. Dev server was stopped.
- 2026-06-28 11:14 KST: `App.jsx` line count is now 1,218.
- 2026-06-28 11:15 KST: Extracted summary capture overlay into `src/components/summary/SummaryCaptureOverlay.jsx`.
- 2026-06-28 11:16 KST: Extracted launch splash, update banner, and toast into layout components.
- 2026-06-28 11:18 KST: Extracted header/status/tabs into `src/components/layout/AppHeader.jsx`.
- 2026-06-28 11:19 KST: Extracted budget display panel into `src/components/budget/BudgetPanel.jsx`.
- 2026-06-28 11:19 KST: Layout/budget extractions `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:41 KST: Extracted Drive upload and failed-image retry logic into `src/hooks/useDriveUpload.js`; `xlsx` is now lazy-loaded only during upload.
- 2026-06-28 11:41 KST: Drive upload extraction `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:41 KST: `App.jsx` line count is now 609.
- 2026-06-28 11:43 KST: Extracted Drive restore/OCR recovery flow into `src/hooks/useDriveRestore.js` without changing SettingsModal props.
- 2026-06-28 11:43 KST: Drive restore extraction `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 11:43 KST: `App.jsx` line count is now 508.
- 2026-06-28 11:44 KST: Removed the remaining server compatibility fallback to `VITE_ADMIN_PIN`; admin verification and health checks now require server-only `ADMIN_PIN`.
- 2026-06-28 11:44 KST: Verified no `VITE_ADMIN_PIN`, `VITE_UPLOAD_TOKEN`, hardcoded master key seed, or app-source `alert()` matches remain outside this worklog.
- 2026-06-28 11:44 KST: Final `npm run build`, `npm run test`, and `npm run lint` passed after the stricter admin PIN change.
- 2026-06-28 11:45 KST: Started local dev server at `http://127.0.0.1:5173/`; `curl -I /`, `curl -I /src/main.jsx`, and root HTML fetch returned 200/content successfully.
- 2026-06-28 18:34 KST: Exported pure helpers from `useDriveUpload` and `useDriveRestore`, then added unit tests for upload context, filename sanitization, and restore month formatting.
- 2026-06-28 18:34 KST: New hook-helper tests passed, followed by full `npm run build`, `npm run test`, and `npm run lint` passing again.
- 2026-06-28 18:34 KST: `App.jsx` line count remains 508; helper hooks are `src/hooks/useDriveUpload.js` and `src/hooks/useDriveRestore.js`.
- 2026-06-28 18:34 KST: Local dev server still returns 200 for `/` and `/src/main.jsx`.
- 2026-06-28 18:39 KST: Added `src/hooks/useBudgetControls.js` to isolate budget/save/start-new-trip actions and hardened budget parsing for comma-separated input.
- 2026-06-28 18:39 KST: Added `src/hooks/useBudgetControls.test.js`; hook-helper tests passed and then full `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 18:39 KST: `App.jsx` line count is now 498.
- 2026-06-28 19:43 KST: Extracted settings operations/history into `src/components/settings/SettingsOperationsPanel.jsx` and maintenance/danger-zone controls into `src/components/settings/SettingsMaintenancePanel.jsx`.
- 2026-06-28 19:43 KST: Settings modal refactor `npm run build`, `npm run test`, and `npm run lint` passed.
- 2026-06-28 19:43 KST: `src/components/settings/SettingsModal.jsx` is now 224 lines; helper panels are 267 and 117 lines.
- 2026-06-28 21:09 KST: Added a settings-entry help button and full-screen FAQ/help modal in `src/components/settings/SettingsHelpModal.jsx` with structured content from `src/components/settings/helpFaqData.js`.
- 2026-06-28 21:09 KST: Added `src/components/settings/helpFaqData.test.js` to lock the corrected Q6/Q8 copy and basic help structure.
- 2026-06-28 21:09 KST: Help screen verification `npm run build`, `npm run test`, and `npm run lint` passed; full `npm run test` now passes with 16 files and 41 tests.
- 2026-06-28 21:09 KST: `src/components/settings/SettingsModal.jsx` is now 248 lines; `SettingsHelpModal.jsx` is 308 lines; `helpFaqData.js` is 270 lines.
- 2026-06-28 21:17 KST: Removed any phone-number/call handling from the help footer, leaving only the admin name `앱관리자 노경호` as requested.
- 2026-06-28 21:17 KST: Re-verified `npm run build`, `npm run test`, and `npm run lint` all passed after the contact-label change.
