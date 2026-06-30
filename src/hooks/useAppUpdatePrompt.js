import { useEffect, useRef, useState } from 'react';

export default function useAppUpdatePrompt() {
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const applyUpdateRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setShowLaunchSplash(false), 180);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('receipt-app:booted'));
  }, []);

  useEffect(() => {
    const onUpdateAvailable = (event) => {
      applyUpdateRef.current = event?.detail?.applyUpdate || null;
      setShowUpdateBanner(true);
    };
    window.addEventListener('receipt-app:update-available', onUpdateAvailable);
    if (window.__receiptAppPendingUpdate?.applyUpdate) {
      applyUpdateRef.current = window.__receiptAppPendingUpdate.applyUpdate;
      setShowUpdateBanner(true);
    }
    return () => window.removeEventListener('receipt-app:update-available', onUpdateAvailable);
  }, []);

  const dismissUpdate = () => setShowUpdateBanner(false);
  const applyUpdate = () => {
    setShowUpdateBanner(false);
    applyUpdateRef.current?.();
  };

  return {
    showLaunchSplash,
    showUpdateBanner,
    dismissUpdate,
    applyUpdate,
  };
}
