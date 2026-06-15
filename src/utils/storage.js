export function readStorageItem(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장소가 막힌 환경에서는 앱 동작을 계속 유지한다.
  }
}

export function base64ToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
