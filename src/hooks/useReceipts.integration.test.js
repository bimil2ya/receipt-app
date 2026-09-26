import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const crud = vi.hoisted(() => ({
  saveReceipts: vi.fn(async () => {}),
  deleteReceipt: vi.fn(async () => {}),
  resetDeviceData: vi.fn(),
  saveCard: vi.fn(),
  getHistory: vi.fn(),
}));

vi.mock('./useReceiptCrud', () => ({
  default: vi.fn(() => crud),
}));

import useReceipts from './useReceipts';

describe('useReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the CRUD save and delete functions without wrapping them', () => {
    const api = useReceipts();
    expect(api.saveReceipts).toBe(crud.saveReceipts);
    expect(api.deleteReceipt).toBe(crud.deleteReceipt);
  });

  it('returns the API that App.jsx destructures', () => {
    const api = useReceipts();
    for (const key of [
      'receipts', 'loading', 'syncStatus', 'saveStatus', 'pendingSyncCount', 'syncEvents', 'syncDaily',
      'saveReceipts', 'deleteReceipt', 'resetAll', 'resetDeviceData', 'resetActivityLogs',
      'saveCard', 'getHistory', 'retryPendingSync', 'getImageUrl',
    ]) {
      expect(api).toHaveProperty(key);
    }
  });
});
