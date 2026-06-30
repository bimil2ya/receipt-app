import { useCallback, useEffect, useRef, useState } from 'react';

export default function useToastMessage(durationMs = 4000) {
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setMessage(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setMessage('');
      timerRef.current = null;
    }, durationMs);
  }, [durationMs]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { message, showToast };
}
