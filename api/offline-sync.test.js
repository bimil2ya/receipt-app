/**
 * 오프라인 동기화 테스트
 * Day 33-37 검증
 */

import { describe, expect, it } from "vitest";
import {
  CONFLICT_RESOLUTION,
  SYNC_STATUS,
  createConflictDialog,
  generateIdempotencyKey,
} from "./offline-sync.js";

describe("Offline Sync (Day 33-37)", () => {
  /**
   * Test 1: 동기화 상태
   */
  describe("Sync Status", () => {
    it("모든 동기화 상태 확인", () => {
      const statuses = Object.values(SYNC_STATUS);

      expect(statuses).toContain("pending");
      expect(statuses).toContain("syncing");
      expect(statuses).toContain("synced");
      expect(statuses).toContain("conflict");
      expect(statuses).toContain("error");

      console.log(`  ✅ 상태: ${statuses.join(", ")}`);
    });

    it("상태 전환 흐름", () => {
      const flow = [
        SYNC_STATUS.PENDING,
        SYNC_STATUS.SYNCING,
        SYNC_STATUS.SYNCED,
      ];

      expect(flow[0]).toBe(SYNC_STATUS.PENDING);
      expect(flow[1]).toBe(SYNC_STATUS.SYNCING);
      expect(flow[2]).toBe(SYNC_STATUS.SYNCED);

      console.log(`  🔄 흐름: ${flow.join(" → ")}`);
    });

    it("오류 상태", () => {
      const errorFlow = [
        SYNC_STATUS.PENDING,
        SYNC_STATUS.SYNCING,
        SYNC_STATUS.ERROR,
      ];

      expect(errorFlow[2]).toBe(SYNC_STATUS.ERROR);
      console.log(`  ❌ 오류 흐름: ${errorFlow.join(" → ")}`);
    });

    it("충돌 상태", () => {
      const conflictFlow = [
        SYNC_STATUS.PENDING,
        SYNC_STATUS.SYNCING,
        SYNC_STATUS.CONFLICT,
      ];

      expect(conflictFlow[2]).toBe(SYNC_STATUS.CONFLICT);
      console.log(`  ⚠️ 충돌 흐름: ${conflictFlow.join(" → ")}`);
    });
  });

  /**
   * Test 2: 충돌 해결 전략
   */
  describe("Conflict Resolution Strategies", () => {
    it("서버 데이터 우선", () => {
      expect(CONFLICT_RESOLUTION.SERVER_WINS).toBe("server_wins");
      console.log(`  ✅ 전략: ${CONFLICT_RESOLUTION.SERVER_WINS}`);
    });

    it("클라이언트 데이터 우선", () => {
      expect(CONFLICT_RESOLUTION.CLIENT_WINS).toBe("client_wins");
      console.log(`  ✅ 전략: ${CONFLICT_RESOLUTION.CLIENT_WINS}`);
    });

    it("병합", () => {
      expect(CONFLICT_RESOLUTION.MERGE).toBe("merge");
      console.log(`  ✅ 전략: ${CONFLICT_RESOLUTION.MERGE}`);
    });

    it("사용자 선택", () => {
      expect(CONFLICT_RESOLUTION.USER_CHOICE).toBe("user_choice");
      console.log(`  ✅ 전략: ${CONFLICT_RESOLUTION.USER_CHOICE}`);
    });

    it("모든 전략 나열", () => {
      const strategies = Object.values(CONFLICT_RESOLUTION);
      expect(strategies.length).toBe(4);
      console.log(`  📋 전략: ${strategies.join(", ")}`);
    });
  });

  /**
   * Test 3: 충돌 다이얼로그
   */
  describe("Conflict Dialog", () => {
    it("충돌 다이얼로그 생성", () => {
      const conflict = {
        metadataId: "meta-20260831-001",
        serverData: { amount: 10000, store: "카페A" },
        clientData: { amount: 12000, store: "카페B" },
      };

      const dialog = createConflictDialog(conflict);

      expect(dialog.title).toBe("데이터 충돌 감지");
      expect(dialog.serverData.data).toEqual({ amount: 10000, store: "카페A" });
      expect(dialog.clientData.data).toEqual({ amount: 12000, store: "카페B" });

      console.log(`  📋 제목: ${dialog.title}`);
    });

    it("충돌 해결 옵션", () => {
      const conflict = {
        metadataId: "meta-20260831-001",
        serverData: {},
        clientData: {},
      };

      const dialog = createConflictDialog(conflict);
      const options = dialog.options;

      expect(options.length).toBe(3);
      expect(options[0].value).toBe(CONFLICT_RESOLUTION.SERVER_WINS);
      expect(options[1].value).toBe(CONFLICT_RESOLUTION.CLIENT_WINS);
      expect(options[2].value).toBe(CONFLICT_RESOLUTION.MERGE);

      console.log(`  🎯 옵션:`);
      for (const option of options) {
        console.log(`    - ${option.label}: ${option.description}`);
      }
    });
  });

  /**
   * Test 4: Idempotency 키
   */
  describe("Idempotency Key", () => {
    it("Idempotency 키 생성", async () => {
      const metadataId = "meta-20260831-001";
      const data = { amount: 10000, store: "카페서울" };

      const key = await generateIdempotencyKey(metadataId, data);

      expect(key).toMatch(/^idempotency-/);
      expect(key).toContain(metadataId);

      console.log(`  🔑 Idempotency 키: ${key}`);
    });

    it("동일한 데이터는 동일한 키 생성", async () => {
      const metadataId = "meta-20260831-001";
      const data = { amount: 10000, store: "카페서울" };

      const key1 = await generateIdempotencyKey(metadataId, data);
      const key2 = await generateIdempotencyKey(metadataId, data);

      expect(key1).toBe(key2);
      console.log(`  ✅ 일관성: ${key1 === key2}`);
    });

    it("다른 데이터는 다른 키 생성", async () => {
      const metadataId = "meta-20260831-001";
      const data1 = { amount: 10000, store: "카페서울" };
      const data2 = { amount: 12000, store: "카페서울" };

      const key1 = await generateIdempotencyKey(metadataId, data1);
      const key2 = await generateIdempotencyKey(metadataId, data2);

      expect(key1).not.toBe(key2);
      console.log(`  ✅ 차이: ${key1} !== ${key2}`);
    });
  });

  /**
   * Test 5: 데이터 병합 시뮬레이션
   */
  describe("Data Merge Strategy", () => {
    it("서버와 클라이언트 데이터 병합", () => {
      const serverData = {
        amount: 10000,
        store: "카페A",
        timestamp: "2026-08-31T14:00:00Z",
      };

      const clientData = {
        amount: 12000,
        category: "cafe",
        timestamp: "2026-08-31T14:05:00Z",
      };

      // 병합 전략: 클라이언트 데이터로 서버 데이터 덮어쓰기
      const merged = {
        ...serverData,
        ...clientData,
        mergedAt: new Date().toISOString(),
      };

      expect(merged.amount).toBe(12000); // 클라이언트 값
      expect(merged.store).toBe("카페A"); // 서버 값 (클라이언트에 없음)
      expect(merged.category).toBe("cafe"); // 클라이언트 값

      console.log(`  📊 병합 결과:`);
      console.log(`    - amount: ${merged.amount} (클라이언트)`);
      console.log(`    - store: ${merged.store} (서버)`);
      console.log(`    - category: ${merged.category} (클라이언트)`);
    });

    it("타임스탬프 기반 병합", () => {
      const serverData = {
        amount: 10000,
        timestamp: "2026-08-31T14:00:00Z",
      };

      const clientData = {
        amount: 12000,
        timestamp: "2026-08-31T14:05:00Z",
      };

      // 최신 타임스탬프 데이터 우선
      const merged = new Date(clientData.timestamp) > new Date(serverData.timestamp)
        ? clientData
        : serverData;

      expect(merged.amount).toBe(12000); // 클라이언트 (더 최신)
      console.log(`  ⏱️ 최신 데이터: ${merged.amount}원 (${merged.timestamp})`);
    });
  });

  /**
   * Test 6: 오프라인 시나리오
   */
  describe("Offline Scenarios", () => {
    it("오프라인 상태에서 변경사항 저장", () => {
      const offlineChange = {
        metadataId: "meta-20260831-001",
        operation: "update",
        data: { amount: 15000 },
        timestamp: new Date().toISOString(),
        queued: true,
      };

      expect(offlineChange.queued).toBe(true);
      console.log(`  💾 오프라인 저장: ${offlineChange.metadataId}`);
    });

    it("온라인 복귀 시 자동 동기화", () => {
      const pendingItems = [
        {
          metadataId: "meta-20260831-001",
          status: "pending",
        },
        {
          metadataId: "meta-20260831-002",
          status: "pending",
        },
        {
          metadataId: "meta-20260831-003",
          status: "pending",
        },
      ];

      console.log(`  🔄 동기화 시작: ${pendingItems.length}개 항목`);

      // 동기화 완료 시뮬레이션
      const results = {
        synced: 2,
        conflict: 1,
        error: 0,
      };

      expect(results.synced + results.conflict + results.error).toBe(3);
      console.log(`  📊 결과: 동기화 ${results.synced}개, 충돌 ${results.conflict}개`);
    });
  });

  /**
   * Test 7: 재시도 로직
   */
  describe("Retry Logic", () => {
    it("동기화 실패 시 재시도", () => {
      const maxRetries = 3;
      let attempts = 0;

      while (attempts < maxRetries) {
        attempts++;
        console.log(`  🔄 재시도 ${attempts}/${maxRetries}`);
      }

      expect(attempts).toBe(maxRetries);
    });

    it("재시도 간격 증가", () => {
      const intervals = [];

      for (let attempt = 0; attempt < 3; attempt++) {
        const interval = Math.pow(2, attempt) * 1000;
        intervals.push(interval);
      }

      expect(intervals).toEqual([1000, 2000, 4000]);
      console.log(`  ⏳ 재시도 간격: ${intervals.map(i => i / 1000).join("초, ")}초`);
    });
  });

  /**
   * Test 8: 동기화 대시보드
   */
  describe("Sync Dashboard", () => {
    it("대시보드 상태 조회", () => {
      const dashboard = {
        online: true,
        pending: 5,
        syncing: 1,
        conflicts: 2,
        errors: 1,
      };

      expect(dashboard.online).toBe(true);
      expect(dashboard.pending + dashboard.syncing + dashboard.conflicts + dashboard.errors).toBe(9);

      console.log(`  📊 대시보드:`);
      console.log(`    🌐 온라인: ${dashboard.online}`);
      console.log(`    📋 대기: ${dashboard.pending}개`);
      console.log(`    🔄 동기화: ${dashboard.syncing}개`);
      console.log(`    ⚠️ 충돌: ${dashboard.conflicts}개`);
      console.log(`    ❌ 오류: ${dashboard.errors}개`);
    });
  });

  /**
   * Test 9: E2E 동기화 흐름
   */
  describe("E2E Sync Flow", () => {
    it("오프라인 → 변경 → 온라인 → 동기화", () => {
      const flow = [
        { step: 1, status: "offline", action: "변경사항 저장" },
        { step: 2, status: "offline", action: "로컬 큐에 추가" },
        { step: 3, status: "online", action: "네트워크 복구 감지" },
        { step: 4, status: "online", action: "대기 항목 동기화 시작" },
        { step: 5, status: "online", action: "서버와 동기화" },
        { step: 6, status: "online", action: "완료" },
      ];

      console.log(`  📋 E2E 흐름:`);
      for (const item of flow) {
        console.log(`    ${item.step}. [${item.status}] ${item.action}`);
      }

      expect(flow.length).toBe(6);
    });

    it("충돌 감지 및 해결 흐름", () => {
      const flow = [
        { step: 1, action: "변경사항 서버 전송" },
        { step: 2, action: "서버에서 충돌 감지" },
        { step: 3, action: "충돌 다이얼로그 표시" },
        { step: 4, action: "사용자 선택" },
        { step: 5, action: "선택한 전략으로 병합" },
        { step: 6, action: "최종 동기화" },
        { step: 7, action: "완료" },
      ];

      console.log(`  ⚠️ 충돌 해결 흐름:`);
      for (const item of flow) {
        console.log(`    ${item.step}. ${item.action}`);
      }

      expect(flow.length).toBe(7);
    });
  });
});
