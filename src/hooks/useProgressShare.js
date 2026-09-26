import { useEffect, useRef, useState } from 'react';
import { decodeHtmlEntities } from '../utils/formatter';
import { getFixedUserName, getOrCreateDeviceId } from '../utils/deviceIdentity';
import { readStorageItem, writeStorageItem } from '../utils/storage';

// 출장 중 영수증 목록(사진·카드번호 제외)을 사무실 진행현황으로 조용히 공유한다.
// 공식 제출(Drive 저장)과는 별개이며 실패해도 사용자에게 알리지 않고 다음에 다시 시도한다.
export const PROGRESS_STORAGE_KEY = 'receipt-app:progress-share:v1';
export const PROGRESS_IDLE_MS = 60_000;
export const PROGRESS_MIN_INTERVAL_MS = 5 * 60_000;
export const PROGRESS_RETRY_MS = 10 * 60_000;
const PROGRESS_CHECK_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'input', 'scroll'];

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

export function buildProgressPayload({ receipts, teamNames, tripStartDate, tripEndDate, submitted }) {
  return {
    teamNames,
    tripStartDate,
    tripEndDate: tripEndDate || '',
    submitterName: getFixedUserName(),
    submitterDeviceId: getOrCreateDeviceId(),
    submitted: Boolean(submitted),
    receipts: [...(receipts || [])]
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
      .map(receipt => ({
        id: clip(receipt.id, 64),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(receipt.date || '')) ? receipt.date : '',
        useTime: clip(receipt.useTime, 20),
        storeName: clip(decodeHtmlEntities(receipt.storeName || ''), 100),
        category: clip(receipt.category, 30),
        totalAmount: Number.isSafeInteger(Number(receipt.totalAmount)) ? Number(receipt.totalAmount) : 0,
        approvalNum: clip(receipt.approvalNum, 40),
        note: clip(decodeHtmlEntities(receipt.note || ''), 200),
      })),
  };
}

export function progressShareLabel(sharedAt, now = new Date()) {
  const time = Date.parse(sharedAt || '');
  if (!Number.isFinite(time)) return '사무실 진행 공유 전';
  const kst = value => new Date(value + 9 * 3600 * 1000);
  const shared = kst(time);
  const today = kst(now.getTime());
  const pad = value => String(value).padStart(2, '0');
  const clock = `${pad(shared.getUTCHours())}:${pad(shared.getUTCMinutes())}`;
  const sameDay = shared.getUTCFullYear() === today.getUTCFullYear()
    && shared.getUTCMonth() === today.getUTCMonth() && shared.getUTCDate() === today.getUTCDate();
  return `사무실 진행 공유 ${sameDay ? '오늘' : `${shared.getUTCMonth() + 1}/${shared.getUTCDate()}`} ${clock}`;
}

function readShareState() {
  try { return JSON.parse(readStorageItem(PROGRESS_STORAGE_KEY, '') || '{}') || {}; } catch { return {}; }
}

export default function useProgressShare({ receipts, teamNames, tripStartDate, tripEndDate, submitted, busy }) {
  const [lastSharedAt, setLastSharedAt] = useState(() => readShareState().at || '');
  const latestRef = useRef({});
  latestRef.current = { receipts, teamNames, tripStartDate, tripEndDate, submitted, busy };
  const lastActivityRef = useRef(Date.now());
  const inFlightRef = useRef(false);
  const retryAfterRef = useRef(0);

  useEffect(() => {
    const markActive = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, markActive, { passive: true, capture: true }));
    return () => ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, markActive, { capture: true }));
  }, []);

  useEffect(() => {
    const tick = async () => {
      const state = latestRef.current;
      const now = Date.now();
      if (!state.teamNames || !state.tripStartDate || state.busy || inFlightRef.current) return;
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (now - lastActivityRef.current < PROGRESS_IDLE_MS || now < retryAfterRef.current) return;
      const payload = buildProgressPayload(state);
      if (!payload.submitterDeviceId) return;
      const fingerprint = JSON.stringify(payload);
      const saved = readShareState();
      if (saved.fingerprint === fingerprint) return;
      if (!payload.receipts.length && !saved.fingerprint) return;
      if (saved.at && now - Date.parse(saved.at) < PROGRESS_MIN_INTERVAL_MS) return;
      inFlightRef.current = true;
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
        const at = data.sharedAt || new Date().toISOString();
        writeStorageItem(PROGRESS_STORAGE_KEY, JSON.stringify({ fingerprint, at }));
        setLastSharedAt(at);
      } catch {
        retryAfterRef.current = Date.now() + PROGRESS_RETRY_MS;
      } finally {
        inFlightRef.current = false;
      }
    };
    const timer = setInterval(tick, PROGRESS_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  return { lastSharedAt };
}
