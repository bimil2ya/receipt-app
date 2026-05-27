// Web Crypto API를 이용한 가장 안정적인 암호화 유틸리티
// 복잡한 기기 정보를 배제하여 복호화 실패를 원천 차단합니다.
const MASTER_KEY_SEED = 'mirae-ecosystem-final-stable-vault';

async function getStableKey() {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) return null;
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(MASTER_KEY_SEED));
  return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// 과거 모든 버전의 암호화 키 리스트 (복구용)
const LEGACY_SEEDS = [
  'mirae-ecosystem-secret-key',
  'mirae-ecosystem-v3-secure-key',
  'mirae-ecosystem-v4-stable-key'
];

export async function encryptData(text) {
  if (!text || text.startsWith('sk-ant-')) return text;
  
  try {
    const key = await getStableKey();
    if (!key) return text;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv); combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch { return text; }
}

export async function decryptData(encB64) {
  if (!encB64 || encB64.startsWith('sk-ant-')) return encB64;
  
  try {
    const combined = new Uint8Array(atob(encB64).split('').map(c => c.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    // 1. 최신 안정화 키로 시도
    try {
      const key = await getStableKey();
      if (!key) return encB64;
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
    } catch (e) {
      // 2. 모든 레거시 키로 순차 시도
      for (const seed of LEGACY_SEEDS) {
        try {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
          const k = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt']);
          return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, data));
        } catch { continue; }
      }
      // 3. V3 특수 케이스 (deviceId 포함) 대응
      try {
        const devId = typeof localStorage !== 'undefined' ? localStorage.getItem('device_num') || 'default-device' : 'default-device';
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 20) : 'unknown';
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mirae-ecosystem-v3-secure-key:${devId}:${ua}`));
        const k = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt']);
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, data));
      } catch { return encB64; }
    }
  } catch { return encB64; }
}
