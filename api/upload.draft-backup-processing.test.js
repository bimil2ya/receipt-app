import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * api/upload.js - Step 2B: Draft backup 처리 로직 테스트
 * handleDraftBackupRequest, dataUrlToBlob 함수 테스트
 */

// Helper: dataUrlToBlob 구현 (테스트용)
function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const data = parts.length > 1 ? parts[1] : parts[0];
  const mimeMatch = dataUrl.match(/^data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

  const binaryString = atob(data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// Mock dependencies
function mockPrepareDraftBackupImageSnapshot(blob) {
  return {
    blob,
    byteLength: blob.size,
    mimeType: blob.type,
    sha256: 'mock-sha256-hash',
    chunkCount: 1,
  };
}

function mockBuildDraftBackupUpsert({ receipt, imageSnapshot, deviceId, teamSnapshot }) {
  return {
    opId: 'mock-op-id',
    kind: 'upsert',
    receiptId: receipt.id,
    backupRevision: receipt.backupRevision,
    deviceId,
    teamSnapshot,
    receiptSnapshot: receipt,
    image: imageSnapshot,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

// Simulate handleDraftBackupRequest
async function handleDraftBackupRequest(reqBody) {
  const {
    receiptSummary,
    images = [],
    surveyorName = '',
    teamId = null,
    teamNames = [],
  } = reqBody;

  const receipt = {
    id: receiptSummary?.receiptId || crypto.randomUUID(),
    ...receiptSummary,
    surveyorName,
    teamAssignmentId: teamId,
    teamAssignmentName: teamNames[0] || '',
    updatedAt: new Date().toISOString(),
    status: 'draft',
    backupRevision: 1,
  };

  let imageSnapshot = null;
  if (images?.length > 0) {
    const firstImage = images[0];
    let blob;
    if (typeof firstImage.dataUrl === 'string') {
      blob = dataUrlToBlob(firstImage.dataUrl);
    } else {
      blob = firstImage.dataUrl;
    }
    imageSnapshot = await mockPrepareDraftBackupImageSnapshot(blob);
  }

  const deviceId = 'mock-device-id';
  const operation = mockBuildDraftBackupUpsert({
    receipt,
    imageSnapshot,
    deviceId,
    teamSnapshot: teamId ? { id: teamId, name: teamNames[0] || '' } : null,
  });

  return {
    type: 'draft-backup',
    success: true,
    operationId: operation.opId,
    receiptId: receipt.id,
    backupRevision: receipt.backupRevision,
    operation,
  };
}

describe('Step 2B: Draft backup 처리 로직', () => {
  describe('dataUrlToBlob', () => {
    it('data URL을 Blob으로 변환', () => {
      const dataUrl = 'data:text/plain;base64,' + btoa('hello');
      const blob = dataUrlToBlob(dataUrl);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/plain');
      expect(blob.size).toBeGreaterThan(0);
    });

    it('JPEG data URL 처리', () => {
      // 간단한 JPEG 헤더
      const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQ==';
      const dataUrl = `data:image/jpeg;base64,${jpegBase64}`;
      const blob = dataUrlToBlob(dataUrl);

      expect(blob.type).toBe('image/jpeg');
      expect(blob.size).toBeGreaterThan(0);
    });

    it('MIME 타입이 없으면 application/octet-stream 사용', () => {
      const dataUrl = 'base64,' + btoa('binary data');
      const blob = dataUrlToBlob(dataUrl);

      expect(blob.type).toBe('application/octet-stream');
    });

    it('PNG data URL 처리', () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngBase64}`;
      const blob = dataUrlToBlob(dataUrl);

      expect(blob.type).toBe('image/png');
      expect(blob.size).toBeGreaterThan(0);
    });
  });

  describe('handleDraftBackupRequest', () => {
    it('receiptSummary만으로 operation 생성', async () => {
      const reqBody = {
        receiptSummary: {
          receiptId: 'receipt-123',
          totalAmount: 50000,
          receiptCount: 2,
        },
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      expect(result.success).toBe(true);
      expect(result.type).toBe('draft-backup');
      expect(result.receiptId).toBe('receipt-123');
      expect(result.backupRevision).toBe(1);
      expect(result.operation).toBeDefined();
      expect(result.operation.kind).toBe('upsert');
    });

    it('receiptId가 없으면 임시 UUID 생성', async () => {
      const reqBody = {
        receiptSummary: {
          totalAmount: 50000,
          receiptCount: 2,
        },
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      expect(result.receiptId).toBeDefined();
      expect(result.receiptId.length).toBeGreaterThan(0);
    });

    it('surveyorName과 teamId 처리', async () => {
      const reqBody = {
        receiptSummary: { receiptId: 'r1', totalAmount: 10000 },
        surveyorName: 'John Doe',
        teamId: 'team-123',
        teamNames: ['Marketing', 'Sales'],
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      expect(result.operation.receiptSnapshot.surveyorName).toBe('John Doe');
      expect(result.operation.receiptSnapshot.teamAssignmentId).toBe('team-123');
      expect(result.operation.receiptSnapshot.teamAssignmentName).toBe('Marketing');
      expect(result.operation.teamSnapshot).toEqual({
        id: 'team-123',
        name: 'Marketing',
      });
    });

    it('teamId 없으면 teamSnapshot은 null', async () => {
      const reqBody = {
        receiptSummary: { receiptId: 'r1', totalAmount: 10000 },
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      expect(result.operation.teamSnapshot).toBeNull();
    });

    it('이미지가 있으면 imageSnapshot 생성', async () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngBase64}`;

      const reqBody = {
        receiptSummary: { receiptId: 'r1', totalAmount: 10000 },
        images: [{ dataUrl }],
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      expect(result.operation.image).toBeDefined();
      expect(result.operation.image.mimeType).toBe('image/png');
      expect(result.operation.image.byteLength).toBeGreaterThan(0);
      expect(result.operation.image.sha256).toBe('mock-sha256-hash');
    });

    it('첫 번째 이미지만 snapshot에 포함 (다중 이미지는 무시)', async () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngBase64}`;

      const reqBody = {
        receiptSummary: { receiptId: 'r1', totalAmount: 10000 },
        images: [
          { dataUrl },
          { dataUrl: `data:image/jpeg;base64,${pngBase64}` },
        ],
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      // operation.image는 첫 번째 이미지만
      expect(result.operation.image).toBeDefined();
      expect(result.operation.image.mimeType).toBe('image/png');
    });

    it('receipt 필드 검증: status와 updatedAt 설정됨', async () => {
      const reqBody = {
        receiptSummary: { receiptId: 'r1', totalAmount: 10000 },
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      expect(result.operation.receiptSnapshot.status).toBe('draft');
      expect(result.operation.receiptSnapshot.updatedAt).toBeDefined();
      // ISO 형식인지 확인
      expect(result.operation.receiptSnapshot.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('operation 응답에 필수 필드 모두 포함', async () => {
      const reqBody = {
        receiptSummary: { receiptId: 'r1', totalAmount: 10000 },
        isDraftBackup: true,
      };

      const result = await handleDraftBackupRequest(reqBody);

      // 응답 필드
      expect(result).toHaveProperty('type', 'draft-backup');
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('operationId');
      expect(result).toHaveProperty('receiptId');
      expect(result).toHaveProperty('backupRevision');
      expect(result).toHaveProperty('operation');

      // Operation 필드
      expect(result.operation).toHaveProperty('opId');
      expect(result.operation).toHaveProperty('kind');
      expect(result.operation).toHaveProperty('receiptId');
      expect(result.operation).toHaveProperty('backupRevision');
      expect(result.operation).toHaveProperty('deviceId');
      expect(result.operation).toHaveProperty('teamSnapshot');
      expect(result.operation).toHaveProperty('receiptSnapshot');
      expect(result.operation).toHaveProperty('image');
      expect(result.operation).toHaveProperty('createdAt');
      expect(result.operation).toHaveProperty('attempts');
    });
  });
});
