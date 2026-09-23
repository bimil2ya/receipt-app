import { describe, expect, it } from 'vitest';
import { buildSubmissionFingerprint, buildUploadContext, sanitizeUploadPart, isPdfAcknowledged } from './useDriveUpload';

describe('drive upload helpers', () => {
  it('builds the upload context from selected team and dates', () => {
    expect(buildUploadContext({
      selectedTeam: { id: 7, names: 'A조, B조' },
      canonicalNames: 'A조, B조',
      tripStartDate: '2026-06-01',
      tripEndDate: '2026-06-03',
    })).toEqual({
      surveyorName: 'A조, B조',
      uploadContext: {
        teamId: 7,
        teamNames: 'A조, B조',
        tripStartDate: '2026-06-01',
        tripEndDate: '2026-06-03',
      },
    });
  });

  it('falls back to neutral values when team or names are missing', () => {
    expect(buildUploadContext({
      selectedTeam: null,
      canonicalNames: '',
      tripStartDate: '2026-06-01',
      tripEndDate: '',
    })).toEqual({
      surveyorName: '미설정',
      uploadContext: {
        teamId: null,
        teamNames: '',
        tripStartDate: '2026-06-01',
        tripEndDate: '2026-06-01',
      },
    });
  });

  it('sanitizes filename parts for drive upload images', () => {
    expect(sanitizeUploadPart('2026/06:01*영수증?')).toBe('2026_06_01_영수증_');
  });

  it('changes the submission fingerprint when XLSX audit fields or assignment history change', () => {
    const base = {
      surveyorName: 'A조', uploadContext: { teamId: 1, teamNames: 'A조', tripStartDate: '2026-09-01', tripEndDate: '2026-09-02' },
      receipts: [{ id: 'r1', date: '2026-09-01', storeName: '상점', totalAmount: 1000, assignmentTeamName: '홍길동, 성춘향', createdBy: { userName: '홍길동', deviceId: 'device-a' } }],
      assignmentHistory: [{ at: '2026-09-01T00:00:00.000Z', previousTeam: '', nextTeam: '홍길동, 성춘향', userName: '홍길동', deviceId: 'device-a' }],
    };
    const original = buildSubmissionFingerprint(base);
    expect(buildSubmissionFingerprint({ ...base, receipts: [{ ...base.receipts[0], assignmentTeamName: '홍길동, 강감찬' }] })).not.toBe(original);
    expect(buildSubmissionFingerprint({ ...base, assignmentHistory: [...base.assignmentHistory, { at: '2026-09-02T00:00:00.000Z', previousTeam: '홍길동, 성춘향', nextTeam: '홍길동, 강감찬', userName: '홍길동', deviceId: 'device-a' }] })).not.toBe(original);
  });
});


describe('PDF acknowledgement identity', () => {
  const valid = { success: true, assembled: true, submissionId: 'submission', reportId: 'report',
    revision: 3, fileId: 'pdf', uploadStatus: 'recovered' };
  it('accepts only the exact submission and PDF report identity', () => {
    expect(isPdfAcknowledged(valid, 'submission', 'report')).toBe(true);
    expect(isPdfAcknowledged(valid, 'different', 'report')).toBe(false);
    expect(isPdfAcknowledged(valid, 'submission', 'different')).toBe(false);
  });
  it.each([{ revision: undefined }, { revision: 0 }, { assembled: false }, { fileId: '' }, { uploadStatus: 'skipped' }])(
    'rejects unverified final response %j', override => {
      expect(isPdfAcknowledged({ ...valid, ...override }, 'submission', 'report')).toBe(false);
    });
});
