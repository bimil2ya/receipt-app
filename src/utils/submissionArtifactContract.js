const SHA_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_CHUNKS = 20;
const MAX_PDF_CHUNK_BYTES = 4 * 1024 * 1024;

export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256 input must be Uint8Array');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function imageArtifactKey(imageId) {
  if (typeof imageId !== 'string' || imageId.length === 0) throw new TypeError('invalid imageId');
  return sha256Hex(new TextEncoder().encode(imageId));
}

export async function buildPdfArtifactContract({ reportId, bytes, chunks, createdAt = new Date().toISOString() }) {
  if (!(bytes instanceof Uint8Array) || !Array.isArray(chunks) || chunks.length === 0) throw new TypeError('invalid PDF bytes or chunks');
  if (!UUID_RE.test(reportId || '') || bytes.byteLength > MAX_PDF_BYTES || chunks.length > MAX_PDF_CHUNKS
    || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new TypeError('invalid PDF artifact metadata');
  const stableBytes = bytes.slice();
  const chunkByteLength = chunks.map(chunk => {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 || chunk.byteLength > MAX_PDF_CHUNK_BYTES) throw new TypeError('invalid PDF chunk');
    return chunk.byteLength;
  });
  if (chunkByteLength.reduce((sum, length) => sum + length, 0) !== stableBytes.byteLength) throw new TypeError('PDF chunks do not match bytes');
  const stableChunks = [];
  let offset = 0;
  for (const chunk of chunks) {
    const stableChunk = chunk.slice();
    const expectedSlice = stableBytes.subarray(offset, offset + stableChunk.byteLength);
    if (stableChunk.some((value, index) => value !== expectedSlice[index])) throw new TypeError('PDF chunks do not match bytes');
    stableChunks.push(stableChunk);
    offset += stableChunk.byteLength;
  }
  const [sha256, ...chunkSha256] = await Promise.all([sha256Hex(stableBytes), ...stableChunks.map(sha256Hex)]);
  return { reportId, bytes: stableBytes, byteLength: stableBytes.byteLength, sha256, chunkCount: stableChunks.length, chunkSha256, chunkByteLength, createdAt };
}

export async function buildImageArtifactContract({ imageId, bytes, mimeType }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new TypeError('invalid image bytes');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new TypeError('invalid image MIME');
  const stableBytes = bytes.slice();
  const [key, sha256] = await Promise.all([imageArtifactKey(imageId), sha256Hex(stableBytes)]);
  if (!SHA_RE.test(key) || !SHA_RE.test(sha256)) throw new TypeError('invalid image digest');
  return { key, sha256, byteLength: stableBytes.byteLength, mimeType };
}
