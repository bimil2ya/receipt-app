import { useEffect, useRef } from 'react';
import { runDraftBackupWorker } from '../utils/draftBackupWorker';
import { createDraftBackupOutboxStore } from '../utils/draftBackupOutboxStore';
import { openReceiptDb } from '../utils/receiptDb';

/**
 * 영수증 초안을 IndexedDB 아웃박스에서 Drain하는 Worker를 관리.
 * 앱 시작, 온라인 복귀, 포커스 복귀, 저장/삭제 완료 후 자동으로 실행.
 *
 * @param {object} options
 * @param {boolean} options.enabled - Worker 실행 여부 (기본: false, 서버 endpoint 준비 후 true)
 * @param {Function} options.transport - (operation) => Promise<ack> - 서버 transport (선택사항)
 * @param {Function} options.onDrain - () => void - 실행 완료 콜백 (선택사항)
 * @param {Function} options.onError - (error) => void - 에러 핸들러 (선택사항)
 */
export default function useDraftBackupWorker({
  enabled = false,
  transport = undefined,
  onDrain = undefined,
  onError = undefined,
} = {}) {
  const storeRef = useRef(null);
  const drainTimeoutRef = useRef(null);

  // 한 번 store 생성 (재생성하지 않음)
  if (!storeRef.current) {
    storeRef.current = createDraftBackupOutboxStore({ dbOpen: openReceiptDb });
  }
  const store = storeRef.current;

  // Worker 한 번 실행 (지연 없음)
  const drainOnce = async () => {
    try {
      await runDraftBackupWorker({
        enabled,
        store,
        transport,
        now: () => Date.now(),
      });
      onDrain?.();
    } catch (error) {
      if (import.meta.env.DEV) console.error('[useDraftBackupWorker] Worker 실패:', error);
      onError?.(error);
    }
  };

  // 이벤트: online, focus, 저장/삭제 완료 후 drain
  // onDrain과 onError를 의존성에 포함해 stale closure 방지
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => drainOnce();
    const handleFocus = () => drainOnce();

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    // 앱 시작 시 한 번 drain
    drainOnce();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      if (drainTimeoutRef.current) {
        clearTimeout(drainTimeoutRef.current);
      }
    };
  }, [enabled, transport, onDrain, onError]);

  // 외부에서 saveReceipts/deleteReceipts 완료 후 호출할 수 있는 메서드 제공
  return {
    drainAfterMutation: () => {
      // 저장/삭제 직후 drain하되, 마이크로태스크 후에 실행
      // (IndexedDB 트랜잭션이 완료되도록)
      if (drainTimeoutRef.current) clearTimeout(drainTimeoutRef.current);
      drainTimeoutRef.current = setTimeout(drainOnce, 0);
    },
  };
}
