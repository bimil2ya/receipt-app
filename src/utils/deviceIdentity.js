import { getOrCreateDeviceId as getStoredDeviceId, readStorageItem, writeStorageItem } from './storage';

const USER_NAME_KEY = 'receipt_user_name';

export function getOrCreateDeviceId() {
  return getStoredDeviceId();
}

export function getFixedUserName() {
  return String(readStorageItem(USER_NAME_KEY, '') || '').trim();
}

// The UI may set this only during first device registration. Changing a name
// later requires the office-managed re-registration flow.
export function registerFixedUserName(name) {
  const existing = getFixedUserName();
  if (existing && existing !== name) throw new Error('등록된 사용자 이름은 이 기기에서 변경할 수 없습니다.');
  const value = String(name || '').trim();
  if (!value) throw new Error('등록할 사용자 이름이 없습니다.');
  writeStorageItem(USER_NAME_KEY, value);
  return value;
}

export function buildReceiptAudit({ action, before = null, userName = getFixedUserName() }) {
  return {
    action,
    at: Date.now(),
    userName: userName || '작성자 미등록',
    deviceId: getOrCreateDeviceId(),
    before,
  };
}
