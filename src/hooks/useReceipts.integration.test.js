import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock 설정
vi.mock('react', () => ({
  useState: (initial) => [
    typeof initial === 'function' ? initial() : initial,
    vi.fn(),
  ],
  useCallback: (fn) => fn,
  useEffect: (fn) => fn(),
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
}));

vi.mock('../utils/supabase', () => ({
  supabase: null,
}));

vi.mock('./useReceiptSync', () => ({
  default: vi.fn(() => ({
    pendingSyncCount: 0,
    syncEvents: [],
    syncDaily: vi.fn(),
    appendSyncOp: vi.fn(),
    recordSyncEvent: vi.fn(),
    retryPendingSync: vi.fn(),
    resetActivityLogs: vi.fn(),
    resetSyncQueue: vi.fn(),
  })),
}));

vi.mock('./useReceiptBootstrap', () => ({
  default: vi.fn(),
}));

vi.mock('./useReceiptCrud', () => ({
  default: vi.fn((options) => ({
    saveReceipts: vi.fn(async () => {
      // Simulate IndexedDB save
      options.onReceiptsLoaded?.([]);
    }),
    deleteReceipt: vi.fn(async () => {
      options.onReceiptsLoaded?.([]);
    }),
    resetDeviceData: vi.fn(),
    saveCard: vi.fn(),
    getHistory: vi.fn(),
  })),
}));

vi.mock('./useDraftBackupWorker', () => ({
  default: vi.fn(() => ({
    drainAfterMutation: vi.fn(),
  })),
}));

import useReceipts from './useReceipts';
import useDraftBackupWorker from './useDraftBackupWorker';

describe('useReceipts - Draft Backup Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useDraftBackupWorker를 초기화 (enabled: false)', () => {
    useReceipts();

    expect(useDraftBackupWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        transport: undefined,
      })
    );
  });

  it('saveReceipts 호출 후 drainAfterMutation 트리거', async () => {
    const api = useReceipts();
    const drainSpy = useDraftBackupWorker.mock.results[0].value.drainAfterMutation;

    // saveReceipts 호출
    await api.saveReceipts([{ id: 'receipt1', amount: 10000 }]);

    // drain이 호출되었는지 확인
    expect(drainSpy).toHaveBeenCalled();
  });

  it('deleteReceipt 호출 후 drainAfterMutation 트리거', async () => {
    const api = useReceipts();
    const drainSpy = useDraftBackupWorker.mock.results[0].value.drainAfterMutation;

    // deleteReceipt 호출
    await api.deleteReceipt('receipt1');

    // drain이 호출되었는지 확인
    expect(drainSpy).toHaveBeenCalled();
  });

  it('saveReceipts와 deleteReceipt는 원본 함수 기능 유지', async () => {
    const api = useReceipts();

    // 함수가 존재하고 호출 가능해야 함
    expect(typeof api.saveReceipts).toBe('function');
    expect(typeof api.deleteReceipt).toBe('function');

    // 호출해도 에러 없음
    await expect(api.saveReceipts([])).resolves.not.toThrow();
    await expect(api.deleteReceipt('id')).resolves.not.toThrow();
  });

  it('drainAfterMutation은 여러 번 호출되어도 안전', async () => {
    const api = useReceipts();
    const drainSpy = useDraftBackupWorker.mock.results[0].value.drainAfterMutation;

    // 여러 번 저장
    await api.saveReceipts([{ id: 'r1' }]);
    await api.saveReceipts([{ id: 'r2' }]);
    await api.saveReceipts([{ id: 'r3' }]);

    // 각 호출마다 drain이 트리거되어야 함
    expect(drainSpy).toHaveBeenCalledTimes(3);
  });

  it('다른 API들은 래핑되지 않음 (resetAll, saveCard 등)', () => {
    const api = useReceipts();

    // 이 함수들은 원본 그대로 반환됨
    expect(typeof api.resetAll).toBe('function');
    expect(typeof api.saveCard).toBe('function');
    expect(typeof api.getHistory).toBe('function');
    expect(typeof api.retryPendingSync).toBe('function');
  });

  it('API 반환 구조 검증', () => {
    const api = useReceipts();

    // 필수 API
    expect(api).toHaveProperty('receipts');
    expect(api).toHaveProperty('loading');
    expect(api).toHaveProperty('syncStatus');
    expect(api).toHaveProperty('saveStatus');
    expect(api).toHaveProperty('pendingSyncCount');

    // 호출 API
    expect(api).toHaveProperty('saveReceipts');
    expect(api).toHaveProperty('deleteReceipt');
    expect(api).toHaveProperty('resetAll');
    expect(api).toHaveProperty('saveCard');
    expect(api).toHaveProperty('getHistory');
    expect(api).toHaveProperty('retryPendingSync');
    expect(api).toHaveProperty('getImageUrl');

    // drainDraftBackupAfterMutation은 노출되지 않음 (자동화됨)
    expect(api).not.toHaveProperty('drainDraftBackupAfterMutation');
  });
});
