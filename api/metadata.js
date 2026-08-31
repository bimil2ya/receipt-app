/**
 * 메타데이터 시스템: 파일 중복 감지를 위한 SHA256 해시 기반 식별
 * Day 15-17 구현
 */

import crypto from 'crypto';

/**
 * 메타데이터 스키마 (Google Drive Custom Properties)
 */
export const METADATA_SCHEMA = {
  'app-type': 'receipt-app',
  'app-version': '2.0.0',
  'data-date': '2026-08-31',          // ISO 8601
  'content-hash': 'abc123def456...',  // SHA256 앞 32자
  'created-by': 'receipt-app-v2',
  'receipt-id': 'receipt-20260831-001',
  'metadata-id': 'meta-20260831-001'  // Idempotency key
};

/**
 * 파일 콘텐츠로부터 메타데이터 생성
 * @param {Buffer} fileContent - 파일 바이너리
 * @param {string} fileName - 파일명 (선택사항)
 * @returns {Promise<Object>} 메타데이터 객체
 */
export async function createFileMetadata(fileContent, fileName = '') {
  // SHA256 해시 계산 (앞 32자만 사용)
  const contentHash = crypto
    .createHash('sha256')
    .update(fileContent)
    .digest('hex')
    .substring(0, 32);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  return {
    'app-type': 'receipt-app',
    'app-version': '2.0.0',
    'data-date': dateStr,
    'content-hash': contentHash,
    'created-by': 'receipt-app-v2',
    'receipt-id': `receipt-${dateStr}-${Date.now()}`,
    'metadata-id': `meta-${dateStr}-${Date.now()}`,
    'file-name': fileName
  };
}

/**
 * 메타데이터 검증
 * @param {Object} metadata - 검증할 메타데이터
 * @returns {boolean} 유효하면 true
 * @throws {Error} 검증 실패 시 에러
 */
export function validateMetadata(metadata) {
  const required = ['app-type', 'data-date', 'content-hash', 'created-by', 'metadata-id'];

  for (const field of required) {
    if (!metadata[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // 해시 형식 검증 (32자 16진수)
  if (!/^[a-f0-9]{32}$/.test(metadata['content-hash'])) {
    throw new Error(`Invalid content-hash format: ${metadata['content-hash']}`);
  }

  return true;
}

/**
 * 중복 파일 감지
 * @param {Object} existing - 기존 메타데이터
 * @param {Object} newMetadata - 새로운 메타데이터
 * @returns {boolean} 중복이면 true
 */
export function detectDuplicate(existing, newMetadata) {
  // 같은 날짜 + 같은 해시 = 중복
  if (
    existing['data-date'] === newMetadata['data-date'] &&
    existing['content-hash'] === newMetadata['content-hash']
  ) {
    return true;
  }

  return false;
}

/**
 * Google Drive에 메타데이터 저장 (JSON 파일)
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} folderId - 저장할 폴더 ID
 * @param {Object} metadata - 메타데이터
 * @returns {Promise<Object>} 생성된 파일 정보
 */
export async function saveMetadataToGoogleDrive(drive, folderId, metadata) {
  validateMetadata(metadata);

  const metadataJson = JSON.stringify(metadata, null, 2);
  const metadataFileName = `metadata-${metadata['metadata-id']}.json`;

  try {
    const file = await drive.files.create({
      requestBody: {
        name: metadataFileName,
        mimeType: 'application/json',
        parents: [folderId],
        properties: {
          'app-type': metadata['app-type'],
          'content-hash': metadata['content-hash'],
          'data-date': metadata['data-date']
        }
      },
      media: {
        mimeType: 'application/json',
        body: metadataJson
      },
      fields: 'id, name, webViewLink, createdTime'
    });

    console.log(`✅ 메타데이터 저장 성공: ${file.data.id}`);
    return file.data;

  } catch (error) {
    console.error(`❌ 메타데이터 저장 실패: ${error.message}`);
    throw error;
  }
}

/**
 * Google Drive에서 메타데이터 조회
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} folderId - 조회 폴더 ID
 * @param {string} contentHash - 콘텐츠 해시 (선택사항)
 * @returns {Promise<Array>} 메타데이터 파일 배열
 */
export async function loadMetadataFromGoogleDrive(drive, folderId, contentHash = null) {
  let query = `'${folderId}' in parents and name contains 'metadata-' and mimeType = 'application/json' and trashed = false`;

  if (contentHash) {
    query += ` and properties has { key='content-hash' and value='${contentHash}' }`;
  }

  try {
    const result = await drive.files.list({
      q: query,
      spaces: 'drive',
      fields: 'files(id, name, properties, createdTime)',
      pageSize: 100
    });

    return result.data.files || [];

  } catch (error) {
    console.error(`❌ 메타데이터 조회 실패: ${error.message}`);
    throw error;
  }
}
