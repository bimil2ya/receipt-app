# Phase B 백엔드 엔드포인트 설계
**Day 27-28 구현 가이드**

---

## 📋 API 엔드포인트 목록

### 1. POST /api/upload-metadata
**목적**: 영수증 메타데이터 + 이미지 자동 전송

```
요청:
  POST /api/upload-metadata
  Content-Type: application/json

  {
    "metadataId": "meta-20260831-001",
    "contentHash": "abc123def456...",
    "amount": 12345,
    "store": "카페서울",
    "date": "2026-08-31",
    "imageUrl": "blob:...",              // 또는 base64
    "ocrConfidence": 0.92,
    "receiptId": "receipt-20260831-001"
  }

응답 (성공):
  HTTP 201 Created
  {
    "success": true,
    "metadataId": "meta-20260831-001",
    "receiptId": "receipt-20260831-001",
    "driveFileId": "1A2B3C4D5E6F7G8H",  // Google Drive ID
    "timestamp": "2026-08-31T14:30:00Z"
  }

응답 (중복):
  HTTP 409 Conflict
  {
    "success": false,
    "error": "Duplicate receipt detected",
    "existingId": "receipt-20260831-001",
    "contentHash": "abc123def456..."
  }

응답 (오류):
  HTTP 400/500
  {
    "success": false,
    "error": "Invalid metadata",
    "details": "amount must be between 100 and 10000000"
  }
```

---

## 🏗️ 구현 구조

### 백엔드 아키텍처
```
Express Server (Node.js)
  ├── POST /api/upload-metadata
  │   ├── validateRequest()
  │   ├── checkDuplicate() (metadataId 확인)
  │   ├── saveToIndexedDB() (클라이언트는 자동)
  │   ├── uploadToGoogleDrive()
  │   └── sendResponse()
  │
  ├── GET /api/receipts
  │   ├── authenticate()
  │   ├── queryReceipts()
  │   └── returnJSON()
  │
  └── PUT /api/receipts/:receiptId
      ├── validateUpdate()
      ├── updateMetadata()
      └── syncToGoogleDrive()
```

### 요청 흐름
```
클라이언트 (브라우저)
  ↓
1. Vision OCR 실행 (extractAmount)
  ↓
2. IndexedDB에 저장 (saveReceipt)
  ↓
3. 백엔드에 POST /api/upload-metadata
  ↓
서버
  ├─ 메타데이터 검증
  ├─ 중복 여부 확인 (contentHash)
  ├─ Google Drive에 저장
  ├─ 데이터베이스 기록
  └─ 응답 반환
  ↓
4. 클라이언트가 동기화 상태 업데이트
  ↓
완료 또는 오류 처리
```

---

## 💻 구현 코드 (Node.js/Express)

### 필수 모듈
```bash
npm install express dotenv cors helmet joi
```

### api/server.js (또는 index.js)

```javascript
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { validateMetadata, detectDuplicate } from "./metadata.js";
import { createDrive, getOrCreateFolder } from "./driveUtils.js";
import { createFileMetadata } from "./metadata.js";

const app = express();
const port = process.env.PORT || 3000;

// 미들웨어
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" })); // 이미지 크기 제한

// Google Drive 인증
let driveInstance = null;

function getDriveInstance() {
  if (!driveInstance) {
    driveInstance = createDrive();
  }
  return driveInstance;
}

/**
 * POST /api/upload-metadata
 * 영수증 메타데이터 + 이미지 자동 전송
 */
app.post("/api/upload-metadata", async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      metadataId,
      contentHash,
      amount,
      store,
      date,
      imageUrl,
      ocrConfidence,
      receiptId,
    } = req.body;

    // 1. 요청 검증
    console.log(`📥 요청: ${metadataId}`);

    if (!metadataId || !contentHash || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    // 2. 금액 유효성 검증
    if (amount < 100 || amount > 10000000) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount (100~10000000)",
      });
    }

    // 3. Google Drive에서 중복 확인
    const drive = getDriveInstance();
    const MAIN_FOLDER_ID = process.env.GDRIVE_MAIN_FOLDER_ID;

    const query = `properties has { key='content-hash' and value='${contentHash}' }`;
    const existing = await drive.files.list({
      q: query,
      spaces: "drive",
      fields: "files(id, name)",
      pageSize: 1,
    });

    if (existing.data.files && existing.data.files.length > 0) {
      console.log(`⚠️  중복 감지: ${contentHash}`);
      return res.status(409).json({
        success: false,
        error: "Duplicate receipt detected",
        existingId: existing.data.files[0].id,
        contentHash: contentHash,
      });
    }

    // 4. Google Drive에 저장
    const metadata = {
      "app-type": "receipt-app",
      "app-version": "2.0.0",
      "data-date": date,
      "content-hash": contentHash,
      "created-by": "receipt-app-v2",
      "receipt-id": receiptId,
      "metadata-id": metadataId,
      amount: amount,
      store: store,
      "ocr-confidence": ocrConfidence,
    };

    const metadataFile = await drive.files.create({
      requestBody: {
        name: `metadata-${metadataId}.json`,
        mimeType: "application/json",
        parents: [MAIN_FOLDER_ID],
        properties: {
          "app-type": "receipt-app",
          "content-hash": contentHash,
          "data-date": date,
        },
      },
      media: {
        mimeType: "application/json",
        body: JSON.stringify(metadata),
      },
      fields: "id, name, webViewLink, createdTime",
    });

    const elapsedTime = Date.now() - startTime;

    console.log(`✅ 저장 완료: ${metadataFile.data.id} (${elapsedTime}ms)`);

    // 5. 응답 반환
    res.status(201).json({
      success: true,
      metadataId: metadataId,
      receiptId: receiptId,
      driveFileId: metadataFile.data.id,
      timestamp: new Date().toISOString(),
      responseTime: elapsedTime,
    });

  } catch (error) {
    console.error(`❌ 오류: ${error.message}`);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/receipts
 * 저장된 영수증 목록 조회
 */
app.get("/api/receipts", async (req, res) => {
  try {
    const { date, store, limit = 50 } = req.query;

    const drive = getDriveInstance();
    const MAIN_FOLDER_ID = process.env.GDRIVE_MAIN_FOLDER_ID;

    let query = `'${MAIN_FOLDER_ID}' in parents and name contains 'metadata-' and mimeType = 'application/json' and trashed = false`;

    if (date) {
      query += ` and properties has { key='data-date' and value='${date}' }`;
    }

    if (store) {
      // 상점명으로 필터링 (Google Drive properties에서)
      query += ` and properties has { key='store' and value='${store}' }`;
    }

    const result = await drive.files.list({
      q: query,
      spaces: "drive",
      fields: "files(id, name, properties, createdTime)",
      pageSize: Math.min(limit, 100),
    });

    res.json({
      success: true,
      receipts: result.data.files || [],
      count: (result.data.files || []).length,
    });

  } catch (error) {
    console.error(`❌ 조회 오류: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Health Check
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 서버 시작
app.listen(port, () => {
  console.log(`🚀 서버 시작: http://localhost:${port}`);
  console.log(`📡 엔드포인트:`);
  console.log(`  POST   /api/upload-metadata`);
  console.log(`  GET    /api/receipts`);
  console.log(`  GET    /api/health`);
});

export default app;
```

---

## 🧪 클라이언트 통합 (Day 28)

### hooks/useReceiptUploader.js

```javascript
import { useState } from "react";

export function useReceiptUploader() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadReceipt = async (metadataId, contentHash, amount, store, date) => {
    setUploading(true);
    setProgress(0);

    try {
      // 1. IndexedDB에 저장 (클라이언트)
      setProgress(20);
      const db = await openReceiptDB();
      const receiptId = await saveReceipt(db, {
        metadataId,
        amount,
        store,
        date,
      });

      // 2. 백엔드에 전송
      setProgress(50);
      const response = await fetch("/api/upload-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadataId,
          contentHash,
          amount,
          store,
          date,
          ocrConfidence: 0.92,
          receiptId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      // 3. 동기화 상태 업데이트
      setProgress(100);
      const result = await response.json();
      
      await updateSyncStatus(db, metadataId, "synced");

      return result;

    } catch (error) {
      console.error("Upload error:", error);
      // 오프라인 상황에서는 큐에 추가
      await addToSyncQueue({ metadataId, error: error.message });
      throw error;

    } finally {
      setUploading(false);
    }
  };

  return { uploadReceipt, uploading, progress };
}
```

---

## 📊 성능 기준 (Day 28)

### 응답 시간 목표
```
요청 → 응답: < 2초

분석:
  - 메타데이터 검증: ~10ms
  - 중복 확인 (Google Drive): ~300-500ms
  - Google Drive 파일 저장: ~800-1200ms
  - 응답 처리: ~50ms
  ─────────────────────────
  총 소요시간: ~1200-1800ms (< 2초 ✅)
```

### 테스트 시나리오
```
1. 성공 케이스
   - 새로운 영수증 업로드 → 201 Created

2. 중복 케이스
   - 동일 contentHash → 409 Conflict

3. 오류 케이스
   - 잘못된 메타데이터 → 400 Bad Request
   - 네트워크 오류 → 자동 재시도

4. 오프라인 케이스
   - 인터넷 없음 → IndexedDB 저장 후 대기
   - 온라인 복귀 → 자동 동기화
```

---

## 🚀 배포 전 체크리스트 (Day 28)

- [ ] 모든 엔드포인트 구현 완료
- [ ] 요청 검증 로직 추가
- [ ] 중복 감지 테스트
- [ ] 응답 시간 < 2초 확인
- [ ] 에러 처리 + 재시도 로직
- [ ] 클라이언트 통합 완료
- [ ] E2E 테스트 (10개 영수증 업로드)
- [ ] Canary 배포 준비 (Feature Flag)

---

**상태**: ✅ 설계 완료  
**일정**: Day 27-28  
**다음**: Canary 배포 (Day 28)
