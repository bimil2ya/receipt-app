import { useCallback, useRef, useState } from 'react';

const INITIAL = { show: false, title: '확인', message: '', confirmLabel: '확인', cancelLabel: '취소', variant: 'danger' };

export default function useConfirmModal() {
  const [state, setState] = useState(INITIAL);
  const resolveRef = useRef(null);

  const showConfirm = useCallback(({ title, message, confirmLabel, cancelLabel, variant } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        show: true,
        title: title ?? '확인',
        message: message ?? '',
        confirmLabel: confirmLabel ?? '확인',
        cancelLabel: cancelLabel ?? '취소',
        variant: variant ?? 'danger',
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(INITIAL);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = useCallback(() => {
    setState(INITIAL);
    resolveRef.current?.(false);
  }, []);

  return {
    confirmModalProps: { ...state, onConfirm: handleConfirm, onCancel: handleCancel },
    showConfirm,
  };
}
