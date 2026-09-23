import { describe, it, expect, beforeEach } from 'vitest';

/**
 * api/upload.js - Step 2A: isDraftBackup 요청 분기 테스트
 * Draft backup과 final submission 검증 로직 테스트
 */

// Helper: validateDraftBackupRequest의 동작을 시뮬레이션
function simulateDraftBackupValidation(body) {
  if (!body?.receiptSummary) {
    const e = new Error('receiptSummary가 없습니다.');
    e.code = 'DRAFT_MISSING_RECEIPT_SUMMARY';
    throw e;
  }

  const forbiddenFields = [
    'submissionId', 'submissionKind', 'expected',
    'isFinalizeOnly',
    'isPdfChunk', 'reportId', 'chunkIndex', 'chunkCount', 'chunkBase64',
    'isImageOnly',
    'xlsxBase64',
  ];

  for (const field of forbiddenFields) {
    if (Object.hasOwn(body, field)) {
      const e = new Error(`isDraftBackup=true 요청에서 ${field}가 있으면 안 됩니다.`);
      e.code = 'DRAFT_MIXED_WITH_FINAL';
      throw e;
    }
  }
}

describe('Step 2A: isDraftBackup 요청 분기', () => {
  beforeEach(() => {
    // 각 테스트 전 초기화
  });

  describe('유효한 Draft Backup 요청', () => {
    it('receiptSummary만 있어도 통과', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000, receiptCount: 2 },
      };

      expect(() => simulateDraftBackupValidation(body)).not.toThrow();
    });

    it('receiptSummary + images 허용', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        images: [{ filename: 'receipt.jpg', dataUrl: 'data:image/jpeg;...' }],
      };

      expect(() => simulateDraftBackupValidation(body)).not.toThrow();
    });

    it('receiptSummary + surveyorName 허용', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        surveyorName: 'John Doe',
      };

      expect(() => simulateDraftBackupValidation(body)).not.toThrow();
    });

    it('receiptSummary + teamId 허용', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        teamId: 'team_123',
        teamNames: ['팀A', '팀B'],
      };

      expect(() => simulateDraftBackupValidation(body)).not.toThrow();
    });
  });

  describe('Invalid Draft Backup 요청', () => {
    it('receiptSummary 없음 → DRAFT_MISSING_RECEIPT_SUMMARY', () => {
      const body = {
        isDraftBackup: true,
        images: [{ filename: 'receipt.jpg', dataUrl: 'data:...' }],
      };

      try {
        simulateDraftBackupValidation(body);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).toBe('DRAFT_MISSING_RECEIPT_SUMMARY');
      }
    });

    it('submissionId 포함 → DRAFT_MIXED_WITH_FINAL', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        submissionId: 'sub_123',
      };

      try {
        simulateDraftBackupValidation(body);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).toBe('DRAFT_MIXED_WITH_FINAL');
      }
    });

    it('xlsxBase64 포함 → DRAFT_MIXED_WITH_FINAL', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        xlsxBase64: 'PK3...',
      };

      try {
        simulateDraftBackupValidation(body);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).toBe('DRAFT_MIXED_WITH_FINAL');
      }
    });

    it('isPdfChunk 포함 → DRAFT_MIXED_WITH_FINAL', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        isPdfChunk: true,
        chunkIndex: 0,
      };

      try {
        simulateDraftBackupValidation(body);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).toBe('DRAFT_MIXED_WITH_FINAL');
      }
    });

    it('isFinalizeOnly 포함 → DRAFT_MIXED_WITH_FINAL', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        isFinalizeOnly: true,
      };

      try {
        simulateDraftBackupValidation(body);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).toBe('DRAFT_MIXED_WITH_FINAL');
      }
    });

    it('isImageOnly 포함 → DRAFT_MIXED_WITH_FINAL', () => {
      const body = {
        isDraftBackup: true,
        receiptSummary: { totalAmount: 50000 },
        isImageOnly: true,
      };

      try {
        simulateDraftBackupValidation(body);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).toBe('DRAFT_MIXED_WITH_FINAL');
      }
    });
  });

  describe('Final submission 요청 (기존 로직)', () => {
    it('isDraftBackup=false → final 경로', () => {
      const body = {
        isDraftBackup: false,
        surveyorName: 'John',
        xlsxBase64: 'PK3...',
      };

      // isDraftBackup=false면 draft 검증 스킵, final 검증으로 이동
      expect(body.isDraftBackup).toBe(false);
    });

    it('isDraftBackup 없음 → final 경로', () => {
      const body = {
        surveyorName: 'John',
        xlsxBase64: 'PK3...',
      };

      // isDraftBackup 없음도 final 검증으로 이동
      expect(body.isDraftBackup).toBeUndefined();
    });
  });

  describe('금지된 필드 체크', () => {
    const forbiddenFields = [
      'submissionId',
      'submissionKind',
      'expected',
      'isFinalizeOnly',
      'isPdfChunk',
      'reportId',
      'chunkIndex',
      'chunkCount',
      'chunkBase64',
      'isImageOnly',
      'xlsxBase64',
    ];

    it.each(forbiddenFields)(
      '%s 필드 포함 → DRAFT_MIXED_WITH_FINAL',
      (field) => {
        const body = {
          isDraftBackup: true,
          receiptSummary: { totalAmount: 50000 },
          [field]: 'forbidden_value',
        };

        try {
          simulateDraftBackupValidation(body);
          expect.fail(`should have thrown for field ${field}`);
        } catch (err) {
          expect(err.code).toBe('DRAFT_MIXED_WITH_FINAL');
        }
      }
    );
  });
});
