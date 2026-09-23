import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeHtmlEntities, getToday } from '../utils/formatter';
import { ReceiptAmountOverflowError, sumReceiptAmounts } from '../utils/receiptAmount';
import { readTeamAssignmentHistory } from '../utils/teamAssignmentHistory';
import { buildImageArtifactContract, buildPdfArtifactContract } from '../utils/submissionArtifactContract';
import { deleteSubmissionPdfArtifact, readSubmissionPdfArtifact, saveSubmissionPdfArtifact } from '../utils/submissionArtifactCache';
import {
  cleanupStaleSubmissionAttempt,
  clearSubmissionAttempt,
  fingerprintStorageKey,
  getOrCreateSubmissionAttempt,
  readSubmissionAttempt,
  transitionSubmissionAttempt,
} from '../utils/submissionAttemptJournal';

export {
  cleanupStaleSubmissionAttempt as cleanupStaleSubmissionAttemptJournal,
  clearSubmissionAttempt as clearSubmissionAttemptJournal,
  getOrCreateSubmissionAttempt as getOrCreateSubmissionAttemptJournal,
  readSubmissionAttempt as readSubmissionAttemptJournal,
  transitionSubmissionAttempt as transitionSubmissionAttemptJournal,
} from '../utils/submissionAttemptJournal';

export function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function fetchWithTimeout(url, options, timeoutMs = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('원본 사진 읽기 실패'));
    reader.onabort = () => reject(new Error('원본 사진 읽기 취소'));
    reader.readAsDataURL(blob);
  });
}

// 큰 Uint8Array를 스택 오버플로 없이 base64로 인코딩 (청크 단위 String.fromCharCode).
function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

const PDF_CHUNK_SIZE = 2_700_000;              // 원시 바이트 기준 (base64 ≈ 3.6MB, Vercel 4.5MB 한도 안)
const PDF_MAX_BYTES = 20 * 1024 * 1024;        // 상식 상한 — 넘으면 버그로 간주

function pdfChunksFromArtifact(artifact) {
  const chunks = [];
  let offset = 0;
  for (const length of artifact.chunkByteLength) {
    chunks.push(artifact.bytes.slice(offset, offset + length));
    offset += length;
  }
  return chunks;
}

function publicPdfContract(artifact) {
  return {
    reportId: artifact.reportId,
    sha256: artifact.sha256,
    byteLength: artifact.byteLength,
    chunkCount: artifact.chunkCount,
    chunkSha256: [...artifact.chunkSha256],
    chunkByteLength: [...artifact.chunkByteLength],
  };
}

export function buildUploadContext({ selectedTeam, canonicalNames, tripStartDate, tripEndDate }) {
  return {
    surveyorName: canonicalNames || '미설정',
    uploadContext: {
      teamId: selectedTeam?.id || null,
      teamNames: selectedTeam?.names || canonicalNames || '',
      tripStartDate: tripStartDate || getToday(),
      tripEndDate: tripEndDate || tripStartDate || getToday(),
    },
  };
}

export function sanitizeUploadPart(value, fallback = '') {
  return safeText(value, fallback).replace(/[/\\:*?"<>|]/g, '_');
}

export function isImageUploadAcknowledged(data, image, submissionId) {
  return data?.success === true
    && data.submissionId === submissionId
    && data.key === image?.key
    && typeof data.fileId === 'string' && data.fileId.length > 0
    && ['uploaded', 'recovered', 'confirmed'].includes(data.uploadStatus)
    && Number.isSafeInteger(data.revision) && data.revision > 0;
}

export function isXlsxAcknowledged(data, submissionId) {
  return data?.success === true
    && data.submissionId === submissionId
    && Number.isSafeInteger(data.revision) && data.revision > 0
    && typeof data.fileId === 'string'
    && data.fileId.length > 0
    && ['uploaded', 'updated', 'replaced', 'skipped'].includes(data.uploadStatus);
}

export function isAggregateAcknowledged(xlsxData, expectedReceiptCount) {
  const aggregate = xlsxData?.aggregate;
  return aggregate?.success === true
    && typeof aggregate.fileId === 'string'
    && aggregate.fileId.length > 0
    && Number.isInteger(aggregate.count)
    && aggregate.count >= expectedReceiptCount;
}

export function isPdfAcknowledged(data, submissionId, reportId) {
  return data?.success === true
    && data?.assembled === true
    && data.submissionId === submissionId && data.reportId === reportId
    && Number.isSafeInteger(data.revision) && data.revision > 0
    && typeof data.fileId === 'string'
    && data.fileId.length > 0
    && ['uploaded', 'recovered'].includes(data.uploadStatus);
}

export function isCompletionAcknowledged(data, submissionId) {
  return data?.success === true
    && data.type === 'completion'
    && data.submissionId === submissionId
    && data.complete === true
    && Number.isSafeInteger(data.revision)
    && data.revision > 0;
}

export function buildSubmissionFingerprint({ receipts, surveyorName, uploadContext, assignmentHistory = [] }) {
  const stableReceipts = [...(receipts || [])]
    .map(receipt => ({
      id: receipt.id || '',
      imageId: receipt.imageId || '',
      date: receipt.date || '',
      useTime: receipt.useTime || '',
      storeName: receipt.storeName || '',
      totalAmount: receipt.totalAmount || 0,
      category: receipt.category || '',
      approvalNum: receipt.approvalNum || '',
      bizNum: receipt.bizNum || '',
      cardNumber: receipt.cardNumber || '',
      note: receipt.note || '',
      updatedAt: receipt.updatedAt || '',
      revision: Math.max(1, Number(receipt.revision) || 1),
      relatedReviewReceiptId: receipt.relatedReviewReceiptId || '',
      assignmentTeamName: receipt.assignmentTeamName || '',
      createdBy: receipt.createdBy || null,
      updatedBy: receipt.updatedBy || null,
      createdAt: receipt.createdAt || '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  // XLSX도 같은 순서로 기록하므로 순서를 보존한다.
  const stableAssignmentHistory = assignmentHistory
    .map(entry => ({ at: entry.at || '', previousTeam: entry.previousTeam || '', nextTeam: entry.nextTeam || '', userName: entry.userName || '', deviceId: entry.deviceId || '' }));
  return JSON.stringify({ surveyorName, uploadContext, receipts: stableReceipts, assignmentHistory: stableAssignmentHistory });
}

const COMPLETED_FINGERPRINTS_KEY = 'receipt-app:completed-uploads:v2';
const LEGACY_COMPLETED_FINGERPRINTS_KEY = 'receipt-app:completed-uploads';
const COMPLETED_FINGERPRINTS_LIMIT = 20;
export function resetSubmissionAttemptsForTest() {
  // v2 journal is storage-first and has no process-local cache.
}

function readCompletedFingerprints() {
  try {
    const currentRaw = localStorage.getItem(COMPLETED_FINGERPRINTS_KEY);
    if (currentRaw !== null) {
      const current = JSON.parse(currentRaw);
      return new Set(Array.isArray(current) ? current.filter(value => /^f[0-9a-f]{32}$/.test(value)) : []);
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_COMPLETED_FINGERPRINTS_KEY) || '[]');
    const migrated = new Set(Array.isArray(legacy) ? legacy.filter(value => typeof value === 'string').map(fingerprintStorageKey) : []);
    if (migrated.size) writeCompletedFingerprints(migrated);
    return migrated;
  } catch { return new Set(); }
}

function writeCompletedFingerprints(values) {
  try {
    localStorage.setItem(COMPLETED_FINGERPRINTS_KEY, JSON.stringify(
      [...values].slice(-COMPLETED_FINGERPRINTS_LIMIT)
    ));
    localStorage.removeItem(LEGACY_COMPLETED_FINGERPRINTS_KEY);
  } catch { /* 메모리 가드가 현재 앱 세션의 중복 완료를 계속 막는다. */ }
}

export default function useDriveUpload({
  receipts,
  getImageUrl,
  canonicalNames,
  selectedTeam,
  tripStartDate,
  tripEndDate,
  localApprovalReport,
  setLastDuplicateReport,
  tripStorageKey,
  tripGeneration,
  completedFingerprintKeys = [],
  commitUploadCompletion,
  setUploadSendCount,
  showToast,
  showConfirm,
}) {
  const [driveUploading, setDriveUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lastUploadFailures, setLastUploadFailures] = useState([]);
  // 동기 재진입 가드 — React state는 같은 렌더 사이클 내 더블탭·확인창 대기 중 재탭을 못 막는다.
  const uploadingRef = useRef(false);
  const legacyCompletedFingerprintsRef = useRef(readCompletedFingerprints());
  const { surveyorName: currentSurveyorName, uploadContext: currentUploadContext } = buildUploadContext({ selectedTeam, canonicalNames, tripStartDate, tripEndDate });
  const currentAssignmentHistory = readTeamAssignmentHistory();
  const currentSubmissionFingerprint = buildSubmissionFingerprint({ receipts, surveyorName: currentSurveyorName, uploadContext: currentUploadContext, assignmentHistory: currentAssignmentHistory });
  const currentFingerprintKey = fingerprintStorageKey(currentSubmissionFingerprint);
  const completedForCurrentTrip = useMemo(() => new Set(completedFingerprintKeys), [completedFingerprintKeys]);
  const currentAlreadyCompleted = completedForCurrentTrip.has(currentFingerprintKey)
    || (tripGeneration === 0 && legacyCompletedFingerprintsRef.current.has(currentFingerprintKey));
  const submissionNeedsResend = Boolean(receipts?.length) && !currentAlreadyCompleted;

  const finalizeSubmission = useCallback(async ({ fingerprint, attempt, ensurePending = true }) => {
    const scope = attempt.scope;
    let pending = attempt;
    if (ensurePending && attempt.phase !== 'finalize_pending') {
      pending = await transitionSubmissionAttempt({ fingerprint, submissionId: attempt.submissionId,
        scope, generation: attempt.generation, phase: 'finalize_pending' });
    }
    let response;
    let data = {};
    try {
      response = await fetchWithTimeout('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isFinalizeOnly: true, submissionKind: 'final', submissionId: pending.submissionId,
          surveyorName: scope.surveyorName, reportDate: scope.reportDate,
          ...(scope.tripStartDate ? { tripStartDate: scope.tripStartDate } : {}),
        }),
      }, 120_000);
      data = await response.json();
    } catch (error) {
      throw new Error(`FINALIZATION_UNCONFIRMED: ${error.message}`);
    }
    if (data?.error === 'LEGACY_SUBMISSION_RESTART_REQUIRED') {
      await transitionSubmissionAttempt({ fingerprint, submissionId: pending.submissionId,
        scope, generation: pending.generation, phase: 'recovery_required', patch: { recoveryCode: data.error } });
      throw new Error(data.error);
    }
    if (!response.ok || !isCompletionAcknowledged(data, pending.submissionId)) {
      throw new Error(data?.error || 'FINALIZATION_ACK_UNCONFIRMED');
    }
    const committed = await commitUploadCompletion({
      submissionId: pending.submissionId, fingerprintKey: pending.fingerprintKey,
      revision: data.revision, generation: pending.generation, storageKey: scope.tripStorageKey,
    });
    if (typeof setUploadSendCount === 'function') setUploadSendCount(() => committed.record?.uploadCount);
    let cleanupPending = false;
    try {
      await deleteSubmissionPdfArtifact(pending.pdfReportId);
      await clearSubmissionAttempt({ fingerprint, submissionId: pending.submissionId });
    } catch {
      // The durable completion record is already authoritative. Preserve the
      // attempt as a cleanup witness instead of losing the only PDF reference.
      cleanupPending = true;
    }
    return { data, committed, cleanupPending };
  }, [commitUploadCompletion, setUploadSendCount]);

  const autoFinalizeRef = useRef('');
  useEffect(() => {
    if (!receipts?.length || currentAlreadyCompleted || autoFinalizeRef.current === currentFingerprintKey) return;
    let cancelled = false;
    (async () => {
      const attempt = await readSubmissionAttempt(currentSubmissionFingerprint);
      if (cancelled || !attempt || attempt.phase !== 'finalize_pending' || attempt.generation !== tripGeneration) return;
      autoFinalizeRef.current = currentFingerprintKey;
      if (uploadingRef.current) return;
      uploadingRef.current = true;
      setDriveUploading(true);
      try {
        await finalizeSubmission({ fingerprint: currentSubmissionFingerprint, attempt, ensurePending: false });
        if (!cancelled) showToast('✅ Drive 자료 전체 완료');
      } catch (error) {
        if (!cancelled) showToast(`⚠️ 최종 확인 대기(${error.message})`);
      } finally {
        uploadingRef.current = false;
        if (!cancelled) setDriveUploading(false);
      }
    })().catch(error => {
      if (!cancelled) showToast(`⚠️ 최종 확인 기록 오류(${error.message})`);
    });
    return () => { cancelled = true; };
  }, [currentAlreadyCompleted, currentFingerprintKey, currentSubmissionFingerprint, finalizeSubmission, receipts?.length, showToast, tripGeneration]);

  // A completed submission can survive a tab close between its durable trip
  // record and cache cleanup. This path never calls Drive and only removes an
  // attempt after its cached PDF was removed successfully.
  useEffect(() => {
    if (!currentAlreadyCompleted) return;
    let cancelled = false;
    (async () => {
      const attempt = await readSubmissionAttempt(currentSubmissionFingerprint);
      if (cancelled || !attempt || attempt.generation !== tripGeneration) return;
      await deleteSubmissionPdfArtifact(attempt.pdfReportId);
      if (!cancelled) await clearSubmissionAttempt({ fingerprint: currentSubmissionFingerprint, submissionId: attempt.submissionId });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [currentAlreadyCompleted, currentSubmissionFingerprint, tripGeneration]);

  const uploadToDrive = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    const sessionFailures = [];
    let started = false;
    try {
      if (!receipts || receipts.length === 0) {
        showToast('업로드할 영수증이 없습니다. 영수증을 추가한 뒤 다시 시도해 주세요.');
        return;
      }
      let totalAmount;
      try {
        totalAmount = sumReceiptAmounts(receipts);
      } catch (error) {
        if (!(error instanceof ReceiptAmountOverflowError)) throw error;
        showToast('합계가 안전한 정수 범위를 넘어 전송하지 않았습니다. 금액을 확인해 주세요.');
        return;
      }
      const { surveyorName, uploadContext } = buildUploadContext({ selectedTeam, canonicalNames, tripStartDate, tripEndDate });
      const assignmentHistory = readTeamAssignmentHistory();
      const submissionFingerprint = buildSubmissionFingerprint({ receipts, surveyorName, uploadContext, assignmentHistory });
      const submissionStorageKey = fingerprintStorageKey(submissionFingerprint);
      let priorAttempt = await readSubmissionAttempt(submissionFingerprint);
      if (priorAttempt && priorAttempt.generation < tripGeneration) {
        await cleanupStaleSubmissionAttempt({ fingerprint: submissionFingerprint, submissionId: priorAttempt.submissionId,
          currentGeneration: tripGeneration, deletePdfArtifact: deleteSubmissionPdfArtifact });
        priorAttempt = null;
      }
      if (priorAttempt?.phase === 'finalize_pending') {
        await finalizeSubmission({ fingerprint: submissionFingerprint, attempt: priorAttempt, ensurePending: false });
        showToast('✅ Drive 자료 전체 완료');
        return;
      }
      if (priorAttempt?.phase === 'recovery_required') {
        const restart = await showConfirm({ title: '제출 다시 시작', message: '이전 제출 기록을 복구할 수 없습니다. 새 제출로 다시 시작합니다.', confirmLabel: '다시 시작', variant: 'primary' });
        if (!restart) return;
        await cleanupStaleSubmissionAttempt({ fingerprint: submissionFingerprint, submissionId: priorAttempt.submissionId,
          currentGeneration: priorAttempt.generation + 1, deletePdfArtifact: deleteSubmissionPdfArtifact });
        priorAttempt = null;
      }
      const approvalWarnings = [];
      if (localApprovalReport.confirmedGroupCount > 0) approvalWarnings.push(`승인번호 중복 후보 ${localApprovalReport.confirmedGroupCount}건`);
      if (localApprovalReport.reviewGroupCount > 0) approvalWarnings.push(`승인번호 확인 필요 ${localApprovalReport.reviewGroupCount}건`);
      if (localApprovalReport.missingApprovalCount > 0) approvalWarnings.push(`승인번호 없음 ${localApprovalReport.missingApprovalCount}건`);
      const approvalWarningText = approvalWarnings.length > 0 ? `\n확인: ${approvalWarnings.join(' / ')}` : '';
      const ok = await showConfirm({
        title: 'Drive 업로드',
        message: `${receipts.length}건 / ${totalAmount.toLocaleString()}원을 Drive로 업로드합니다.${approvalWarningText}`,
        confirmLabel: '업로드',
        variant: 'primary',
      });
      if (!ok) return;

      setDriveUploading(true);
      setUploadProgress(0);

      const XLSX = await import('xlsx');
      // Match the fingerprint order so reload/list sorting cannot change a retry's bytes.
      const submissionReceipts = [...receipts].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      if (completedForCurrentTrip.has(submissionStorageKey)
        || (tripGeneration === 0 && legacyCompletedFingerprintsRef.current.has(submissionStorageKey))) {
        showToast('ℹ️ 현재 자료는 이미 완전히 전송되었습니다. 내용을 수정한 경우에만 다시 전송해 주세요.');
        return;
      }
      const ws = XLSX.utils.json_to_sheet(submissionReceipts.map(receipt => ({
        날짜: receipt.date,
        영수증식별값: receipt.id,
        연결검토영수증: receipt.relatedReviewReceiptId || '',
        수정버전: Math.max(1, Number(receipt.revision) || 1),
        사용시간: receipt.useTime || '',
        사용처: decodeHtmlEntities(receipt.storeName),
        금액: receipt.totalAmount,
        용도: receipt.category,
        승인번호: receipt.approvalNum || '',
        사업자번호: receipt.bizNum || '',
        카드번호: receipt.cardNumber || '',
        비고: decodeHtmlEntities(receipt.note),
        작업조: receipt.assignmentTeamName || '',
        작성자: receipt.createdBy?.userName || '',
        기기태그: receipt.createdBy?.deviceId || receipt.updatedBy?.deviceId || '',
        생성시각: receipt.createdAt || '',
        수정시각: receipt.updatedBy?.at || '',
      })));
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:I1');
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
        if (cell) {
          cell.t = 'n';
          cell.z = '#,##0';
        }
      }
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 24 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '영수증내역');
      const assignmentHistoryRows = assignmentHistory.map(entry => ({
        시각: entry.at, 작업: '작업조 변경', 이전작업조: entry.previousTeam, 새작업조: entry.nextTeam,
        작성자: entry.userName, 기기태그: entry.deviceId,
      }));
      if (assignmentHistoryRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(assignmentHistoryRows), '작업조변경이력');
      const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const attemptScope = {
        surveyorName,
        reportDate: tripStartDate || getToday(),
        tripStartDate: uploadContext.tripStartDate,
        tripStorageKey,
        teamId: uploadContext.teamId,
        teamNames: uploadContext.teamNames,
        tripEndDate: uploadContext.tripEndDate,
      };
      let submissionAttempt = priorAttempt || await getOrCreateSubmissionAttempt({
        fingerprint: submissionFingerprint, scope: attemptScope, generation: tripGeneration,
      });

      const seenImageIds = new Set();
      const images = [];
      for (const receipt of submissionReceipts.filter(item => item.imageId)) {
        if (seenImageIds.has(receipt.imageId)) continue;
        seenImageIds.add(receipt.imageId);
        const objectUrl = await getImageUrl(receipt.imageId);
        if (!objectUrl) throw new Error(`원본 사진을 찾을 수 없습니다 (${receipt.imageId}). 사진을 복원한 뒤 다시 업로드해 주세요.`);
        const imageResponse = await fetch(objectUrl);
        if (!imageResponse.ok) throw new Error('원본 사진 읽기 실패');
        const imageBlob = await imageResponse.blob();
        if (!imageBlob.size) throw new Error('원본 사진이 비어 있습니다');
        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        const artifact = await buildImageArtifactContract({
          imageId: receipt.imageId,
          bytes: imageBytes,
          mimeType: imageBlob.type,
        });
        const dataUrl = await blobToDataUrl(imageBlob);
        const datePart = sanitizeUploadPart(receipt.date, '날짜없음');
        const storePart = sanitizeUploadPart(decodeHtmlEntities(receipt.storeName), '미상').slice(0, 15);
        const imagePart = safeText(receipt.imageId, 'image').slice(0, 5);
        const imageReceipts = submissionReceipts
          .filter(item => item.imageId === receipt.imageId)
          .map(item => ({
            id: item.id,
            date: item.date || '',
            useTime: item.useTime || '',
            storeName: decodeHtmlEntities(item.storeName) || '',
            totalAmount: item.totalAmount || 0,
            category: item.category || '',
            approvalNum: item.approvalNum || '',
            bizNum: item.bizNum || '',
            cardNumber: item.cardNumber || '',
          }));
        images.push({ id: receipt.id, filename: `${datePart}_${storePart}_${imagePart}.jpg`, dataUrl, receipts: imageReceipts, ...artifact });
      }


      // PDF는 최초 XLSX 요청 전에 한 번만 만들고 제출 ID에 연결된 바이트를 재사용한다.
      // 네트워크 응답이 유실돼도 같은 reportId의 SHA/청크 계약이 달라지지 않는다.
      const { buildReceiptPdfBytes, sliceIntoChunks } = await import('../utils/receiptPdfReport');
      let pdfArtifact = await readSubmissionPdfArtifact(submissionAttempt.pdfReportId);
      if (submissionAttempt.pdfSha256 && (!pdfArtifact
        || pdfArtifact.sha256 !== submissionAttempt.pdfSha256 || pdfArtifact.byteLength !== submissionAttempt.pdfByteLength)) {
        throw new Error('SUBMISSION_ARTIFACT_CACHE_MISSING: 이전 제출 PDF를 확인할 수 없어 재생성을 중단했습니다.');
      }
      if (!pdfArtifact) {
        const generatedBytes = await buildReceiptPdfBytes({
          receipts: submissionReceipts,
          images,
          teamNames: uploadContext.teamNames || surveyorName,
          tripStartDate: tripStartDate || getToday(),
          tripEndDate: tripEndDate || tripStartDate || getToday(),
        });
        const stableBytes = generatedBytes instanceof Uint8Array ? generatedBytes : new Uint8Array(generatedBytes);
        const generatedChunks = sliceIntoChunks(stableBytes, PDF_CHUNK_SIZE);
        pdfArtifact = await buildPdfArtifactContract({
          reportId: submissionAttempt.pdfReportId,
          bytes: stableBytes,
          chunks: generatedChunks,
        });
        await saveSubmissionPdfArtifact(pdfArtifact);
      }
      submissionAttempt = await transitionSubmissionAttempt({
        fingerprint: submissionFingerprint, submissionId: submissionAttempt.submissionId,
        scope: submissionAttempt.scope, generation: submissionAttempt.generation, phase: 'preparing',
        patch: { pdfSha256: pdfArtifact.sha256, pdfByteLength: pdfArtifact.byteLength },
      });
      const pdfChunks = pdfChunksFromArtifact(pdfArtifact);
      const expected = {
        images: images.map(({ key, sha256, byteLength, mimeType }) => ({ key, sha256, byteLength, mimeType })),
        pdf: publicPdfContract(pdfArtifact),
        receiptCount: receipts.length,
        totalAmount,
      };
      started = true;
      setLastUploadFailures([]);
      const totalSteps = 1 + images.length + pdfChunks.length;
      let currentStep = 0;

      const receiptSummary = {
        totalCount: receipts.length,
        totalAmount,
        imageCount: images.length,
        categories: submissionReceipts.reduce((acc, receipt) => {
          acc[receipt.category] = (acc[receipt.category] || 0) + (receipt.totalAmount || 0);
          return acc;
        }, {}),
      };

      const authHeaders = { 'Content-Type': 'application/json' };

      // ── 1. 엑셀 명세서 (서버가 이 요청에서 전체집계 재생성 + 카카오 알림)
      let xlsxData = {};
      let xlsxSucceeded = false;
      try {
        const xlsxRes = await fetchWithTimeout('/api/upload', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ surveyorName, reportDate: tripStartDate || getToday(), xlsxBase64, isImageOnly: false, receiptSummary, expected, submissionId: submissionAttempt.submissionId, submissionKind: 'final', ...uploadContext }),
        }, 60_000);
        if (!xlsxRes.ok) {
          console.warn('명세 업로드 실패:', xlsxRes.status);
        } else {
          xlsxData = await xlsxRes.json().catch(() => ({}));
          xlsxSucceeded = isXlsxAcknowledged(xlsxData, submissionAttempt.submissionId);
        }
      } catch (err) {
        console.warn('명세 업로드 중 오류:', err.message);
      }
      currentStep += 1;
      setUploadProgress(Math.floor((currentStep / totalSteps) * 100));

      // ── 2. 낱장 영수증 사진 (서버가 weekId/_원본/ 에 저장 — 복원 기능 전용)
      const imageResult = { uploaded: 0, skipped: 0, failed: [] };
      for (const image of images) {
        try {
          const imageResponse = await fetchWithTimeout('/api/upload', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ surveyorName, reportDate: tripStartDate || getToday(), images: [image], isImageOnly: true, submissionId: submissionAttempt.submissionId, submissionKind: 'final', ...uploadContext }),
          }, 120_000);
          const imageData = await imageResponse.json().catch(() => ({}));
          if (imageResponse.ok && isImageUploadAcknowledged(imageData, image, submissionAttempt.submissionId)) {
            imageResult.uploaded += imageData.files?.length || 0;
            imageResult.skipped += imageData.skipped?.length || 0;
          } else {
            console.warn(`원본 사진 업로드 API 에러: ${image.filename}, 상태 ${imageResponse.status}`);
            imageResult.failed.push(image);
            sessionFailures.push({ kind: 'image', img: image, surveyorName, uploadContext, reportDate: tripStartDate || getToday(), submissionId: submissionAttempt.submissionId });
          }
        } catch (err) {
          console.warn(`원본 사진 업로드 중 네트워크 오류 (${image.filename}):`, err.message);
          imageResult.failed.push(image);
          sessionFailures.push({ kind: 'image', img: image, surveyorName, uploadContext, reportDate: tripStartDate || getToday(), submissionId: submissionAttempt.submissionId });
        }
        currentStep += 1;
        setUploadProgress(Math.floor((currentStep / totalSteps) * 100));
      }

      // ── 3. 정산서 PDF: 캐시에 고정한 바이트를 순차 업로드 → 마지막 청크에서 서버가 조립
      let pdfAssembled = false;
      let pdfError = null;
      let pdfData = {};
      try {
        if (pdfArtifact.bytes.length > PDF_MAX_BYTES) {
          console.error(`정산서 PDF가 비정상적으로 큼: ${pdfArtifact.bytes.length} bytes`);
          throw new Error('정산서가 비정상적으로 큽니다 — 관리자 문의');
        }
        const reportId = submissionAttempt.pdfReportId;

        for (let i = 0; i < pdfChunks.length; i += 1) {
          const isLast = i === pdfChunks.length - 1;
          const res = await fetchWithTimeout('/api/upload', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              isPdfChunk: true,
              reportId,
              chunkIndex: i,
              chunkCount: pdfChunks.length,
              chunkBase64: bytesToBase64(pdfChunks[i]),
              surveyorName,
              reportDate: tripStartDate || getToday(),
              submissionId: submissionAttempt.submissionId,
              submissionKind: 'final',
              ...uploadContext,
            }),
          }, isLast ? 120_000 : 60_000);

          if (!res.ok) {
            pdfError = `HTTP ${res.status}`;
            throw new Error(`청크 ${i + 1}/${pdfChunks.length} 업로드 실패 (${res.status})`);
          }
          const chunkData = await res.json();
          if (chunkData?.success !== true || chunkData.submissionId !== submissionAttempt.submissionId
            || chunkData.reportId !== reportId || !Number.isSafeInteger(chunkData.revision) || chunkData.revision < 1
            || chunkData.received !== i) throw new Error('PDF_CHUNK_ACK_UNCONFIRMED');
          if (isLast || chunkData.assembled === true) {
            pdfData = chunkData;
            pdfAssembled = isPdfAcknowledged(pdfData, submissionAttempt.submissionId, reportId);
            if (!pdfAssembled) throw new Error(pdfData.error || 'ASSEMBLY_INCOMPLETE');
          }
          currentStep += 1;
          setUploadProgress(Math.floor((currentStep / totalSteps) * 100));
          if (pdfAssembled) break; // A verified recovered final PDF needs no further chunk requests.
        }
      } catch (err) {
        if (!pdfError) pdfError = err.message;
        console.warn('정산서 PDF 생성/업로드 실패:', err.message);
      }
      setUploadProgress(100);

      // ── 결과 토스트
      const parts = [];
      const xlsxStatusLabel = !xlsxSucceeded ? '실패' : ['updated', 'replaced'].includes(xlsxData?.uploadStatus)
        ? '갱신'
        : xlsxData?.skipped
          ? '중복'
          : '완료';
      parts.push(`명세 ${xlsxStatusLabel}`);
      parts.push(`원본사진 ${imageResult.uploaded}장${imageResult.skipped ? `, 중복 ${imageResult.skipped}장` : ''}`);
      const aggregateSucceeded = xlsxSucceeded && isAggregateAcknowledged(xlsxData, receipts.length);
      parts.push(aggregateSucceeded ? (xlsxData.aggregate.skipped ? '집계 변경 없음' : '집계 완료') : xlsxData?.aggregate?.success === false ? '집계 실패' : '집계 미확인');
      parts.push(pdfAssembled
        ? '정산서 PDF 완료'
        : `정산서 PDF 실패${pdfError ? `(${String(pdfError).slice(0, 30)})` : ''} — 다시 업로드하세요`);
      const duplicateReport = xlsxData?.aggregate?.duplicateReport || xlsxData?.receiptDuplicateReport;
      setLastDuplicateReport(duplicateReport || null);
      if (duplicateReport?.confirmedGroupCount > 0) parts.push(`승인번호 중복 후보 ${duplicateReport.confirmedGroupCount}건`);
      if (duplicateReport?.reviewGroupCount > 0) parts.push(`승인번호 확인필요 ${duplicateReport.reviewGroupCount}건`);
      const xlsxKakaoSucceeded = xlsxData?.kakaoSent === true;
      const pdfKakaoSucceeded = pdfData?.kakaoSent === true;
      parts.push(xlsxKakaoSucceeded ? '명세 알림 완료' : `명세 알림 미발송${xlsxData?.kakaoError ? `(${xlsxData.kakaoError.slice(0, 34)})` : ''}`);
      parts.push(pdfKakaoSucceeded ? 'PDF 알림 완료' : `PDF 알림 미발송${pdfData?.kakaoError ? `(${pdfData.kakaoError.slice(0, 34)})` : ''}`);
      if (xlsxData?.targetPath) parts.push(`대상 ${xlsxData.targetPath}`);
      if (imageResult.failed.length > 0) parts.push(`사진 실패 ${imageResult.failed.length}장 — 자료관리에서 재전송 가능`);
      const complete = xlsxSucceeded && aggregateSucceeded && !imageResult.failed.length && pdfAssembled;
      const requiredOthersSucceeded = xlsxSucceeded && aggregateSucceeded && pdfAssembled;
      sessionFailures.forEach(failure => {
        failure.requiredOthersSucceeded = requiredOthersSucceeded;
        failure.submissionFingerprint = submissionFingerprint;
      });
      if (!complete) parts.push('전체 업로드를 다시 실행해 결과를 확인해 주세요');
      const notificationComplete = xlsxKakaoSucceeded && pdfKakaoSucceeded;
      if (complete) {
        try {
          await finalizeSubmission({ fingerprint: submissionFingerprint, attempt: submissionAttempt });
          showToast(`${notificationComplete ? '✅' : '⚠️'} ${parts.join(' · ')} · Drive 자료 전체 완료`);
        } catch (error) {
          showToast(`⚠️ ${parts.join(' · ')} · 최종 확인 대기(${error.message})`);
        }
      } else {
        showToast(`⚠️ ${parts.join(' · ')}`);
      }
    } catch (error) {
      showToast(`❌ ${error.message}`);
    } finally {
      if (started) setLastUploadFailures(sessionFailures);
      uploadingRef.current = false;
      setDriveUploading(false);
    }
  }, [canonicalNames, completedForCurrentTrip, finalizeSubmission, getImageUrl, localApprovalReport, receipts, selectedTeam, setLastDuplicateReport, showConfirm, showToast, tripEndDate, tripGeneration, tripStartDate, tripStorageKey]);

  const retryFailedUploads = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      if (lastUploadFailures.length === 0) return;
      setDriveUploading(true);
      setUploadProgress(0);

      const authHeaders = { 'Content-Type': 'application/json' };

      const remaining = [];
      const retryFingerprint = lastUploadFailures[0]?.submissionFingerprint || '';
      const completesSubmission = lastUploadFailures.every(failure =>
        failure.kind === 'image'
        && failure.requiredOthersSucceeded === true
        && failure.submissionFingerprint === retryFingerprint
      );
      let succeeded = 0;
      let processed = 0;
      const total = lastUploadFailures.length;

      for (const failure of lastUploadFailures) {
        let ok = false;
        try {
          if (failure.kind === 'image') {
            const res = await fetchWithTimeout('/api/upload', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ surveyorName: failure.surveyorName, reportDate: failure.reportDate, images: [failure.img], isImageOnly: true, submissionId: failure.submissionId, submissionKind: 'final', ...failure.uploadContext }),
            }, 120_000);
            const data = await res.json().catch(() => ({}));
            ok = res.ok && isImageUploadAcknowledged(data, failure.img, failure.submissionId);
          }
        } catch {
          ok = false;
        }

        if (ok) succeeded += 1;
        else remaining.push(failure);
        processed += 1;
        setUploadProgress(Math.floor((processed / total) * 100));
      }

      setLastUploadFailures(remaining);
      if (remaining.length === 0 && completesSubmission && retryFingerprint
        && !completedForCurrentTrip.has(fingerprintStorageKey(retryFingerprint))) {
        const attempt = await readSubmissionAttempt(retryFingerprint);
        if (!attempt || attempt.submissionId !== lastUploadFailures[0]?.submissionId) {
          throw new Error('SUBMISSION_ATTEMPT_UNCONFIRMED');
        }
        await finalizeSubmission({ fingerprint: retryFingerprint, attempt });
        showToast(`✅ 실패한 원본사진 ${succeeded}건 재전송 완료 · Drive 자료 전체 완료`);
      } else {
        showToast(`${remaining.length === 0 ? '✅' : '⚠️'} 재전송 ${succeeded}건 성공${remaining.length > 0 ? ` / ${remaining.length}건 실패` : ''}`);
      }
    } catch (error) {
      showToast(`❌ ${error.message}`);
    } finally {
      uploadingRef.current = false;
      setDriveUploading(false);
      setUploadProgress(0);
    }
  }, [completedForCurrentTrip, finalizeSubmission, lastUploadFailures, showToast]);

  return {
    driveUploading,
    uploadProgress,
    lastUploadFailures,
    submissionNeedsResend,
    uploadToDrive,
    retryFailedUploads,
  };
}
