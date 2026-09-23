import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildImageArtifactContract, buildPdfArtifactContract, imageArtifactKey, sha256Hex } from './submissionArtifactContract';

const digest = value => createHash('sha256').update(value).digest('hex');

describe('submission artifact contract', () => {
  it('hashes bytes and image IDs without exposing the original ID', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(sha256Hex(bytes)).resolves.toBe(digest(bytes));
    const key = await imageArtifactKey('private-image-id');
    expect(key).toBe(digest('private-image-id'));
    expect(key).not.toContain('private-image-id');
  });

  it('builds image evidence from actual bytes', async () => {
    const bytes = new Uint8Array([4, 5]);
    await expect(buildImageArtifactContract({ imageId: 'image-1', bytes, mimeType: 'image/png' })).resolves.toEqual({
      key: digest('image-1'), sha256: digest(bytes), byteLength: 2, mimeType: 'image/png',
    });
  });

  it('builds final and per-chunk PDF evidence', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const chunks = [bytes.subarray(0, 3), bytes.subarray(3)];
    const reportId = '11111111-1111-4111-8111-111111111111';
    const contract = await buildPdfArtifactContract({ reportId, bytes, chunks, createdAt: '2026-09-12T00:00:00Z' });
    expect(contract).toMatchObject({ reportId, byteLength: 4, sha256: digest(bytes), chunkCount: 2, chunkSha256: [digest(chunks[0]), digest(chunks[1])], chunkByteLength: [3, 1] });
    expect(contract.bytes).not.toBe(bytes);
    bytes[0] = 9;
    expect([...contract.bytes]).toEqual([1, 2, 3, 4]);
  });

  it('rejects unsupported image MIME and mismatched PDF chunks', async () => {
    await expect(buildImageArtifactContract({ imageId: 'x', bytes: new Uint8Array([1]), mimeType: 'image/gif' })).rejects.toThrow('MIME');
    const reportId = '11111111-1111-4111-8111-111111111111';
    await expect(buildPdfArtifactContract({ reportId, bytes: new Uint8Array([1, 2]), chunks: [new Uint8Array([1])] })).rejects.toThrow('do not match');
    await expect(buildPdfArtifactContract({ reportId, bytes: new Uint8Array([1, 2]), chunks: [new Uint8Array([2]), new Uint8Array([1])] })).rejects.toThrow('do not match');
    await expect(buildPdfArtifactContract({ reportId: 'bad', bytes: new Uint8Array([1]), chunks: [new Uint8Array([1])] })).rejects.toThrow('metadata');
  });
});
