import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [], index: 0 }));
const artifactCache = vi.hoisted(() => new Map());
vi.mock('react', () => ({
  useCallback: fn => fn,
  useEffect: () => {},
  useMemo: fn => fn(),
  useRef: value => ({ current: value }),
  useState: initial => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], next => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next;
    }];
  },
}));
vi.mock('../utils/receiptPdfReport', () => ({
  buildReceiptPdfBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  sliceIntoChunks: vi.fn(bytes => [bytes]),
}));
vi.mock('../utils/submissionArtifactCache', () => ({
  readSubmissionPdfArtifact: vi.fn(async reportId => artifactCache.get(reportId) || null),
  saveSubmissionPdfArtifact: vi.fn(async artifact => artifactCache.set(artifact.reportId, artifact)),
  deleteSubmissionPdfArtifact: vi.fn(async reportId => artifactCache.delete(reportId)),
}));
import useDriveUpload, { buildSubmissionFingerprint, buildUploadContext, resetSubmissionAttemptsForTest } from './useDriveUpload';
import { buildReceiptPdfBytes, sliceIntoChunks } from '../utils/receiptPdfReport';

const response = (data, ok = true, parseError = false) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => {
    if (parseError) throw new SyntaxError('invalid json');
    return data;
  },
});
const imageAck = body => ({
  success: true,
  submissionId: body.submissionId,
  key: body.images[0].key,
  fileId: 'image-id',
  uploadStatus: 'uploaded',
  revision: 2,
  files: [body.images[0].filename],
  skipped: [],
});
let requests;
let options;
let imageMode;
let xlsxMode;
let pdfMode;
let finalMode;
let confirmGate;
function HookHarness() {
  hooks.index = 0;
  return useDriveUpload(options);
}
beforeEach(() => {
  vi.clearAllMocks();
  resetSubmissionAttemptsForTest();
  artifactCache.clear();
  sliceIntoChunks.mockImplementation(bytes => [bytes]);
  hooks.values = [];
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name, _options, operation) => operation()) } });
  requests = [];
  imageMode = xlsxMode = pdfMode = finalMode = 'success';
  options = {
    receipts: [{ id: 'r1', imageId: 'i1', date: '2026-09-01', storeName: '상점', category: '식비', totalAmount: 1000 }],
    getImageUrl: vi.fn(async () => 'blob:receipt'),
    canonicalNames: '원래팀', selectedTeam: { id: 1, names: '원래팀' },
    tripStartDate: '2026-09-01', tripEndDate: '2026-09-02',
    localApprovalReport: {}, setLastDuplicateReport: vi.fn(), setUploadSendCount: vi.fn(),
    tripStorageKey: 'receipt-app:send-count:team-1:2026-09-01', tripGeneration: 0,
    completedFingerprintKeys: [],
    commitUploadCompletion: vi.fn(async completion => {
      if (!options.completedFingerprintKeys.includes(completion.fingerprintKey)) options.completedFingerprintKeys.push(completion.fingerprintKey);
      return { applied: true, record: { uploadCount: options.completedFingerprintKeys.length } };
    }),
    showToast: vi.fn(), showConfirm: vi.fn(async () => {
      if (confirmGate) await confirmGate;
      return true;
    }),
  };
  vi.stubGlobal('FileReader', class {
    readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload(); }
  });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (url.startsWith('blob:')) return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
    const body = JSON.parse(init.body);
    if (body.isFinalizeOnly) {
      if (finalMode === 'network') throw new Error('offline');
      if (finalMode === 'http') return response({}, false);
      if (finalMode === 'parse') return response({}, true, true);
      if (finalMode === 'empty') return response({});
      if (finalMode === 'mismatch') return response({ success: true, type: 'completion', complete: true, submissionId: 'other', revision: 5 });
      if (finalMode === 'false') return response({ success: true, type: 'completion', complete: false, submissionId: body.submissionId, revision: 5 });
      if (finalMode === 'revision') return response({ success: true, type: 'completion', complete: true, submissionId: body.submissionId, revision: 0 });
      return response({ success: true, type: 'completion', complete: true, submissionId: body.submissionId, revision: 5 });
    }
    requests.push(body);
    if (body.xlsxBase64) {
      if (xlsxMode === 'http') return response({}, false);
      if (xlsxMode === 'empty') return response({});
      if (xlsxMode === 'parse') return response({}, true, true);
      if (xlsxMode === 'network') throw new Error('offline');
      if (xlsxMode === 'mismatch') return response({ success: true, submissionId: 'other-submission', revision: 1, fileId: 'xlsx-id', uploadStatus: 'uploaded', aggregate: { success: true, fileId: 'aggregate-id', count: 1 } });
      if (xlsxMode === 'malformed-aggregate') return response({ success: true, fileId: 'xlsx-id', aggregate: { success: true } });
      if (xlsxMode === 'malformed-status') return response({ success: true, fileId: 'xlsx-id', uploadStatus: 'unknown', aggregate: { success: true, fileId: 'aggregate-id', count: 1 } });
      return response({ success: true, submissionId: body.submissionId, revision: 1, fileId: 'xlsx-id', uploadStatus: 'uploaded', aggregate: xlsxMode === 'aggregate' ? null : { success: true, fileId: 'aggregate-id', count: 1 }, kakaoSent: xlsxMode !== 'kakao' });
    }
    if (body.isImageOnly) {
      if (imageMode === 'network') throw new Error('offline');
      if (imageMode === 'http') return response({}, false);
      if (imageMode === 'empty') return response({ success: true, files: [] });
      return response(imageAck(body));
    }
    if (pdfMode === 'network') throw new Error('offline');
    if (pdfMode === 'http') return response({}, false);
    if (pdfMode === 'parse') return response({}, true, true);
    if (pdfMode === 'malformed') return response({ success: true, assembled: true, fileId: 'pdf-id' });
    return response({ success: true, assembled: pdfMode === 'success' || pdfMode === 'kakao', fileId: 'pdf-id', submissionId: body.submissionId, reportId: body.reportId, revision: 4, received: body.chunkIndex, uploadStatus: 'uploaded', kakaoSent: pdfMode !== 'kakao' });
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Drive submission results', () => {
  it('counts completion only after all artifacts and aggregate are acknowledged', async () => {
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(3);
    expect(new Set(requests.map(request => request.submissionId)).size).toBe(1);
    expect(requests.every(request => request.submissionKind === 'final')).toBe(true);
    expect(requests[2].reportId).toBeTruthy();
    expect(requests[0].expected).toMatchObject({
      receiptCount: 1,
      totalAmount: 1000,
      images: [{ key: expect.stringMatching(/^[0-9a-f]{64}$/), sha256: expect.stringMatching(/^[0-9a-f]{64}$/), byteLength: 5, mimeType: 'image/png' }],
      pdf: { reportId: requests[2].reportId, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), byteLength: 3, chunkCount: 1, chunkByteLength: [3] },
    });
    expect(requests[0].expected.pdf).not.toHaveProperty('bytes');
    expect(requests[0].expected.pdf).not.toHaveProperty('createdAt');
    expect(requests[1].images[0].key).toBe(requests[0].expected.images[0].key);
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
    expect(options.commitUploadCompletion).toHaveBeenCalledOnce();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/^✅/));
  });
  it.each(['network', 'http', 'parse', 'empty', 'mismatch', 'false', 'revision'])('does not count an unconfirmed finalization ACK: %s', async mode => {
    finalMode = mode;
    await HookHarness().uploadToDrive();
    expect(options.commitUploadCompletion).not.toHaveBeenCalled();
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('최종 확인 대기'));
  });
  it('retries only finalization after a lost final response', async () => {
    finalMode = 'network';
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(3);
    finalMode = 'success';
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(3);
    expect(options.showConfirm).toHaveBeenCalledOnce();
    expect(options.commitUploadCompletion).toHaveBeenCalledOnce();
  });
  it.each(['http', 'empty', 'aggregate', 'malformed-aggregate', 'malformed-status', 'mismatch', 'parse', 'network'])('does not count failed or unconfirmed spreadsheet/aggregate: %s', async mode => {
    xlsxMode = mode;
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/^⚠️/));
  });
  it('does not trust a skipped XLSX response that did not actually rebuild the aggregate', async () => {
    xlsxMode = 'skipped-without-aggregate';
    fetch.mockImplementation(async (url, init) => {
      if (url.startsWith('blob:')) return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
      const body = JSON.parse(init.body);
      if (body.isFinalizeOnly) return response({ success: true, type: 'completion', complete: true, submissionId: body.submissionId, revision: 5 });
      requests.push(body);
      if (body.xlsxBase64) return response({
        success: true,
        submissionId: body.submissionId,
        revision: 1,
        skipped: true,
        fileId: 'xlsx-id',
        uploadStatus: 'skipped',
        aggregate: { success: true, skipped: true },
      });
      if (body.isImageOnly) return response(imageAck(body));
      return response({ success: true, assembled: true, fileId: 'pdf-id', submissionId: body.submissionId, reportId: body.reportId, revision: 4, received: body.chunkIndex, uploadStatus: 'recovered' });
    });
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('집계 미확인'));
  });
  it('accepts an explicitly verified recovered PDF', async () => {
    pdfMode = 'skipped';
    fetch.mockImplementation(async (url, init) => {
      if (url.startsWith('blob:')) return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
      const body = JSON.parse(init.body);
      if (body.isFinalizeOnly) return response({ success: true, type: 'completion', complete: true, submissionId: body.submissionId, revision: 5 });
      requests.push(body);
      if (body.xlsxBase64) return response({ success: true, submissionId: body.submissionId, revision: 1, fileId: 'xlsx-id', uploadStatus: 'uploaded', aggregate: { success: true, fileId: 'aggregate-id', count: 1 } });
      if (body.isImageOnly) return response(imageAck(body));
      return response({ success: true, assembled: true, fileId: 'pdf-id', submissionId: body.submissionId, reportId: body.reportId, revision: 4, received: body.chunkIndex, uploadStatus: 'recovered' });
    });
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
  });
  it('accepts a skipped XLSX only when aggregate rebuild is acknowledged', async () => {
    fetch.mockImplementation(async (url, init) => {
      if (url.startsWith('blob:')) return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
      const body = JSON.parse(init.body);
      if (body.isFinalizeOnly) return response({ success: true, type: 'completion', complete: true, submissionId: body.submissionId, revision: 5 });
      requests.push(body);
      if (body.xlsxBase64) return response({
        success: true,
        submissionId: body.submissionId,
        revision: 1,
        skipped: true,
        fileId: 'xlsx-id',
        uploadStatus: 'skipped',
        aggregate: { success: true, fileId: 'aggregate-id', count: 1 },
      });
      if (body.isImageOnly) return response(imageAck(body));
      return response({ success: true, assembled: true, fileId: 'pdf-id', submissionId: body.submissionId, reportId: body.reportId, revision: 4, received: body.chunkIndex, uploadStatus: 'recovered' });
    });
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
  });
  it.each(['network', 'http', 'empty'])('retains failed image and retries to original destination: %s', async mode => {
    imageMode = mode;
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
    expect(HookHarness().lastUploadFailures).toHaveLength(1);
    options.selectedTeam = { id: 99, names: '다른팀' };
    options.tripStartDate = '2026-10-01';
    imageMode = 'success';
    await HookHarness().retryFailedUploads();
    expect(requests.at(-1)).toMatchObject({ teamId: 1, tripStartDate: '2026-09-01', surveyorName: '원래팀' });
    expect(requests.at(-1).submissionId).toBe(requests[0].submissionId);
    expect(requests.at(-1).images[0].key).toBe(requests[1].images[0].key);
    expect(HookHarness().lastUploadFailures).toEqual([]);
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
    await HookHarness().retryFailedUploads();
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
  });
  it('does not treat an empty retry response as success', async () => {
    imageMode = 'http';
    await HookHarness().uploadToDrive();
    imageMode = 'empty';
    await HookHarness().retryFailedUploads();
    expect(HookHarness().lastUploadFailures).toHaveLength(1);
  });
  it('stops before sending if a referenced original is missing', async () => {
    options.getImageUrl.mockResolvedValue(null);
    await HookHarness().uploadToDrive();
    expect(requests).toEqual([]);
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('원본 사진을 찾을 수 없습니다'));
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
  });
  it('allows manual entries without an image reference', async () => {
    delete options.receipts[0].imageId;
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(2);
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
  });
  it('does not count incomplete PDF assembly', async () => {
    pdfMode = 'incomplete';
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
  });
  it.each(['http', 'network', 'parse', 'malformed'])('does not count PDF %s failure', async mode => {
    pdfMode = mode;
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).not.toHaveBeenCalled();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/^⚠️/));
  });
  it('reports optional notification failures without invalidating Drive artifacts', async () => {
    xlsxMode = 'kakao';
    pdfMode = 'kakao';
    await HookHarness().uploadToDrive();
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/^⚠️.*명세 알림 미발송.*PDF 알림 미발송/));
  });
  it('does not send or count the same completed payload twice', async () => {
    await HookHarness().uploadToDrive();
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(3);
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('이미 완전히 전송'));
  });
  it('reuses the same submission and PDF IDs after an XLSX response is lost and the hook remounts', async () => {
    xlsxMode = 'network';
    await HookHarness().uploadToDrive();
    const firstAttemptId = requests[0].submissionId;
    const firstPdfId = requests.find(request => request.isPdfChunk)?.reportId;
    hooks.values = [];
    xlsxMode = 'success';
    await HookHarness().uploadToDrive();
    const secondAttemptId = requests.find((request, index) => index > 2 && request.xlsxBase64)?.submissionId;
    const secondPdfId = requests.filter(request => request.isPdfChunk).at(-1)?.reportId;
    expect(secondAttemptId).toBe(firstAttemptId);
    expect(secondPdfId).toBe(firstPdfId);
    expect(requests.filter(request => request.xlsxBase64)[1].expected.pdf)
      .toEqual(requests.filter(request => request.xlsxBase64)[0].expected.pdf);
    expect(buildReceiptPdfBytes).toHaveBeenCalledOnce();
  });
  it('keeps identical submission bytes and contracts when receipt order changes after reload', async () => {
    const first = options.receipts[0];
    options.receipts = [{ ...first, id: 'r2', imageId: 'i2', category: '숙박비' }, first];
    xlsxMode = 'network';
    await HookHarness().uploadToDrive();
    const initial = requests.find(request => request.xlsxBase64);
    expect(buildReceiptPdfBytes.mock.calls[0][0].receipts.map(receipt => receipt.id)).toEqual(['r1', 'r2']);
    hooks.values = [];
    resetSubmissionAttemptsForTest();
    options.receipts = [...options.receipts].reverse();
    await HookHarness().uploadToDrive();
    const retry = requests.filter(request => request.xlsxBase64)[1];
    expect(retry.submissionId).toBe(initial.submissionId);
    expect(retry.xlsxBase64).toBe(initial.xlsxBase64);
    expect(retry.expected).toEqual(initial.expected);
    expect(retry.receiptSummary).toEqual(initial.receiptSummary);
    expect(buildReceiptPdfBytes).toHaveBeenCalledOnce();
  });
  it('blocks cache loss after a request was sent instead of regenerating different PDF bytes', async () => {
    xlsxMode = 'network';
    await HookHarness().uploadToDrive();
    const count = requests.length;
    artifactCache.clear();
    hooks.values = [];
    resetSubmissionAttemptsForTest();
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(count);
    expect(buildReceiptPdfBytes).toHaveBeenCalledOnce();
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('SUBMISSION_ARTIFACT_CACHE_MISSING'));
  });
  it('stops sending chunks once the server verifies an already assembled PDF', async () => {
    sliceIntoChunks.mockImplementation(bytes => [bytes.slice(0, 1), bytes.slice(1)]);
    await HookHarness().uploadToDrive();
    const pdfRequests = requests.filter(request => request.isPdfChunk);
    expect(pdfRequests).toHaveLength(1);
    expect(pdfRequests[0]).toMatchObject({ chunkIndex: 0, chunkCount: 2 });
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
  });
  it('remembers multiple completed payloads across hook remounts', async () => {
    await HookHarness().uploadToDrive();
    options.receipts = [{ ...options.receipts[0], totalAmount: 2000 }];
    hooks.values = [];
    await HookHarness().uploadToDrive();
    options.receipts = [{ ...options.receipts[0], totalAmount: 1000 }];
    hooks.values = [];
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(6);
    expect(options.setUploadSendCount).toHaveBeenCalledTimes(2);
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('이미 완전히 전송'));
  });
  it('allows a changed XLSX audit field to create a new final submission after completion', async () => {
    await HookHarness().uploadToDrive();
    options.receipts = [{ ...options.receipts[0], assignmentTeamName: '홍길동, 강감찬' }];
    hooks.values = [];
    await HookHarness().uploadToDrive();
    expect(requests).toHaveLength(6);
    expect(options.setUploadSendCount).toHaveBeenCalledTimes(2);
  });
  it('migrates a legacy completed payload so it is not transmitted again', async () => {
    const { surveyorName, uploadContext } = buildUploadContext({ selectedTeam: options.selectedTeam, canonicalNames: options.canonicalNames, tripStartDate: options.tripStartDate, tripEndDate: options.tripEndDate });
    const fingerprint = buildSubmissionFingerprint({ receipts: options.receipts, surveyorName, uploadContext, assignmentHistory: [] });
    localStorage.setItem('receipt-app:completed-uploads', JSON.stringify([fingerprint]));
    hooks.values = [];
    await HookHarness().uploadToDrive();
    expect(requests).toEqual([]);
    expect(options.showToast).toHaveBeenLastCalledWith(expect.stringContaining('이미 완전히 전송'));
    expect(localStorage.getItem('receipt-app:completed-uploads')).toBeNull();
    expect(localStorage.getItem('receipt-app:completed-uploads:v2')).toMatch(/^\[/);
  });
  it('blocks rapid double taps while the confirmation is pending', async () => {
    let release;
    confirmGate = new Promise(resolve => { release = resolve; });
    const hook = HookHarness();
    const first = hook.uploadToDrive();
    const second = hook.uploadToDrive();
    release();
    await Promise.all([first, second]);
    expect(options.showConfirm).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(3);
    expect(options.setUploadSendCount).toHaveBeenCalledOnce();
  });
});

it('keeps pending retries when a new upload confirmation is cancelled', async () => {
  imageMode = 'http';
  await HookHarness().uploadToDrive();
  options.showConfirm.mockResolvedValue(false);
  await HookHarness().uploadToDrive();
  expect(HookHarness().lastUploadFailures).toHaveLength(1);
});
