// Client-side JavaScript cannot safely keep an app-wide secret.
// Keep these helpers as no-op compatibility wrappers for older imports.

export async function encryptData(text) {
  return text;
}

export async function decryptData(text) {
  return text;
}
