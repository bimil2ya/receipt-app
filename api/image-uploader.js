/**
 * 이미지 배경 업로드 (병렬 처리)
 * Day 29-32 구현
 *
 * 특징:
 * - 동시 5개 이미지 업로드
 * - 느린 네트워크 자동 감지 (1Mbps 이하)
 * - 지수 백오프 재시도 (3회)
 * - 업로드 진행률 추적
 */

import { folderCache } from './cache.js';

/**
 * 업로드 설정
 */
export const UPLOAD_CONFIG = {
  maxConcurrent: 5,           // 동시 업로드 개수
  timeout: 30000,              // 타임아웃: 30초
  maxRetries: 3,               // 최대 재시도 횟수
  chunkSize: 262144,           // 청크 크기: 256KB
  slowNetworkThreshold: 1,     // 느린 네트워크: 1Mbps 이하
};

/**
 * 이미지 업로드 큐
 */
class ImageUploadQueue {
  constructor() {
    this.queue = [];
    this.activeUploads = 0;
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      totalBytes: 0,
      uploadedBytes: 0,
    };
  }

  /**
   * 큐에 이미지 추가
   * @param {Object} item - 업로드 항목
   */
  enqueue(item) {
    this.queue.push({
      ...item,
      id: `upload-${Date.now()}-${Math.random()}`,
      retries: 0,
      status: "pending",
      progress: 0,
      error: null,
      timestamp: Date.now(),
    });

    this.stats.total++;
    this.stats.totalBytes += item.size || 0;

    console.log(`📥 큐에 추가: ${item.name} (${this.queue.length}개)`);
  }

  /**
   * 다음 업로드 항목 가져오기
   */
  dequeue() {
    const item = this.queue.find(i => i.status === "pending");
    if (item) {
      item.status = "uploading";
    }
    return item;
  }

  /**
   * 큐 상태
   */
  getStatus() {
    return {
      pending: this.queue.filter(i => i.status === "pending").length,
      uploading: this.activeUploads,
      completed: this.stats.completed,
      failed: this.stats.failed,
      progress: this.stats.totalBytes > 0
        ? Math.round((this.stats.uploadedBytes / this.stats.totalBytes) * 100)
        : 0,
    };
  }
}

export const uploadQueue = new ImageUploadQueue();

/**
 * 네트워크 속도 감지
 * @returns {Promise<number>} Mbps 단위 속도
 */
export async function detectNetworkSpeed() {
  try {
    if (navigator.connection?.downlink) {
      // Chrome/Edge: Connection API
      const speed = navigator.connection.downlink;
      console.log(`🌐 네트워크 속도: ${speed.toFixed(2)}Mbps`);
      return speed;
    }

    // Fallback: 1MB 다운로드 테스트
    const testUrl = "https://speedtest.ftp.otenet.gr/files/test1Mb.db";
    const startTime = performance.now();

    const response = await fetch(testUrl, {
      method: "HEAD",
      cache: "no-cache",
    });

    const sizeInBytes = parseInt(response.headers.get("content-length") || 0);
    const elapsedSeconds = (performance.now() - startTime) / 1000;

    if (sizeInBytes === 0 || elapsedSeconds === 0) {
      return 10; // 기본값: 10Mbps
    }

    const speedMbps = (sizeInBytes * 8) / (elapsedSeconds * 1000000);
    console.log(`🌐 네트워크 속도: ${speedMbps.toFixed(2)}Mbps`);
    return speedMbps;

  } catch (error) {
    console.warn("⚠️ 네트워크 속도 감지 실패, 기본값 사용");
    return 10; // 기본값
  }
}

/**
 * 지수 백오프 재시도
 * @param {number} attempt - 시도 번호 (0부터)
 * @param {number} baseDelay - 기본 지연시간 (ms)
 */
async function exponentialBackoff(attempt, baseDelay = 1000) {
  const delay = Math.pow(2, attempt) * baseDelay;
  const jitter = Math.random() * 1000;
  const totalDelay = delay + jitter;

  console.log(`⏳ ${attempt + 1}회 재시도: ${(totalDelay / 1000).toFixed(1)}초 후`);
  await new Promise(resolve => setTimeout(resolve, totalDelay));
}

/**
 * 단일 이미지 업로드
 * @param {File} file - 업로드할 파일
 * @param {string} receiptId - 영수증 ID
 * @param {Object} metadata - 메타데이터
 * @param {Function} onProgress - 진행 콜백
 * @returns {Promise<Object>} 업로드 결과
 */
export async function uploadImage(file, receiptId, metadata, onProgress) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("receiptId", receiptId);
  formData.append("metadata", JSON.stringify(metadata));

  for (let attempt = 0; attempt <= UPLOAD_CONFIG.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPLOAD_CONFIG.timeout);

      const response = await fetch("/api/upload-image", {
        method: "POST",
        body: formData,
        signal: controller.signal,
        onUploadProgress: (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            onProgress?.(progress);
          }
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`✅ 업로드 완료: ${file.name}`);
      return result;

    } catch (error) {
      if (attempt < UPLOAD_CONFIG.maxRetries) {
        console.warn(`⚠️ 업로드 오류 (${attempt + 1}/${UPLOAD_CONFIG.maxRetries}): ${error.message}`);
        await exponentialBackoff(attempt);
      } else {
        console.error(`❌ 업로드 실패 (최종): ${error.message}`);
        throw error;
      }
    }
  }
}

/**
 * 병렬 이미지 업로드 (큐 기반)
 * @param {Array<File>} files - 업로드할 파일 배열
 * @param {string} receiptId - 영수증 ID
 * @param {Object} metadata - 메타데이터
 * @returns {Promise<Array>} 업로드 결과
 */
export async function uploadImagesInParallel(files, receiptId, metadata) {
  const results = [];

  // 큐에 모든 파일 추가
  for (const file of files) {
    uploadQueue.enqueue({
      file,
      receiptId,
      metadata,
      size: file.size,
      name: file.name,
    });
  }

  // 병렬 처리 (동시 5개)
  const activePromises = [];

  while (uploadQueue.queue.length > 0 || activePromises.length > 0) {
    // 새로운 업로드 시작
    while (uploadQueue.activeUploads < UPLOAD_CONFIG.maxConcurrent) {
      const item = uploadQueue.dequeue();
      if (!item) break;

      uploadQueue.activeUploads++;

      const uploadPromise = uploadImage(
        item.file,
        item.receiptId,
        item.metadata,
        (progress) => {
          item.progress = progress;
          console.log(`📊 진행: ${item.name} - ${progress}%`);
        }
      )
        .then((result) => {
          uploadQueue.stats.completed++;
          uploadQueue.stats.uploadedBytes += item.size || 0;
          results.push({ ...result, name: item.name });
          console.log(`✅ 완료: ${item.name}`);
        })
        .catch((error) => {
          item.error = error.message;
          uploadQueue.stats.failed++;
          results.push({
            name: item.name,
            error: error.message,
            receiptId: item.receiptId
          });
          console.error(`❌ 실패: ${item.name} - ${error.message}`);
        })
        .finally(() => {
          uploadQueue.activeUploads--;
        });

      activePromises.push(uploadPromise);
    }

    // 하나의 업로드가 완료될 때까지 대기
    if (activePromises.length > 0) {
      await Promise.race(activePromises);
      // 완료된 Promise 제거
      const index = activePromises.findIndex(p => p.settled);
      if (index !== -1) {
        activePromises.splice(index, 1);
      }
    }
  }

  const status = uploadQueue.getStatus();
  console.log(`📊 최종 상태: ${status.completed}개 완료, ${status.failed}개 실패`);

  return results;
}

/**
 * 느린 네트워크 모드로 업로드
 * @param {File} file - 업로드할 파일
 * @param {string} receiptId - 영수증 ID
 * @param {number} speed - 네트워크 속도 (Mbps)
 */
export async function uploadImageSlowNetwork(file, receiptId, speed) {
  console.log(`🐢 느린 네트워크 모드: ${speed.toFixed(2)}Mbps`);

  // 청크 단위 업로드로 변경
  const chunks = Math.ceil(file.size / UPLOAD_CONFIG.chunkSize);
  console.log(`📦 청크 분할: ${chunks}개`);

  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    const start = chunkIndex * UPLOAD_CONFIG.chunkSize;
    const end = Math.min(start + UPLOAD_CONFIG.chunkSize, file.size);
    const chunk = file.slice(start, end);

    console.log(`📤 청크 ${chunkIndex + 1}/${chunks} (${chunk.size}B)`);

    const formData = new FormData();
    formData.append("chunk", chunk);
    formData.append("chunkIndex", chunkIndex);
    formData.append("chunkTotal", chunks);
    formData.append("receiptId", receiptId);

    try {
      const response = await fetch("/api/upload-chunk", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Chunk upload failed: ${response.statusText}`);
      }

      console.log(`✅ 청크 완료: ${chunkIndex + 1}/${chunks}`);

    } catch (error) {
      console.error(`❌ 청크 실패: ${error.message}`);
      throw error;
    }
  }

  console.log(`✅ 느린 네트워크 업로드 완료: ${file.name}`);
}

/**
 * 업로드 진행률 모니터링
 * @returns {Object} 실시간 상태
 */
export function getUploadProgress() {
  const status = uploadQueue.getStatus();
  const stats = uploadQueue.stats;

  return {
    ...status,
    totalBytes: stats.totalBytes,
    uploadedBytes: stats.uploadedBytes,
    averageSpeed: stats.uploadedBytes > 0
      ? `${(stats.uploadedBytes / 1024 / 1024).toFixed(2)}MB`
      : "0MB",
  };
}

/**
 * 업로드 큐 초기화
 */
export function resetUploadQueue() {
  uploadQueue.queue = [];
  uploadQueue.activeUploads = 0;
  uploadQueue.stats = {
    total: 0,
    completed: 0,
    failed: 0,
    totalBytes: 0,
    uploadedBytes: 0,
  };
  console.log("🔄 업로드 큐 초기화");
}
