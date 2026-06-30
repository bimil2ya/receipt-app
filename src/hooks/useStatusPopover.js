import { useEffect, useRef, useState } from 'react';

export default function useStatusPopover() {
  const [statusPopover, setStatusPopover] = useState(null);
  const statusRef = useRef(null);

  useEffect(() => {
    if (!statusPopover) return undefined;
    const timer = setTimeout(() => setStatusPopover(null), 1500);
    const onOutside = (event) => {
      if (statusRef.current && !statusRef.current.contains(event.target)) {
        setStatusPopover(null);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [statusPopover]);

  return { statusPopover, setStatusPopover, statusRef };
}
