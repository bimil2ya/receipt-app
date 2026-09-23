import { describe, expect, it, vi } from 'vitest';
import { FolderCache, folderCache, getOrCreateFolderWithCache, analyzeCacheEfficiency } from './cache.js';

describe('folder cache', () => {
  it('stores and reads a value', () => {
    const cache = new FolderCache();
    cache.set('folder-1', 'id-123');
    expect(cache.get('folder-1')).toBe('id-123');
  });

  it('expires values after TTL', () => {
    vi.useFakeTimers();
    const cache = new FolderCache(1000);
    cache.set('folder-2', 'id-456');
    vi.advanceTimersByTime(1001);
    expect(cache.get('folder-2')).toBeNull();
    vi.useRealTimers();
  });

  it('reports hit, miss, and size statistics', () => {
    const cache = new FolderCache();
    for (let i = 0; i < 5; i += 1) cache.set(`folder-${i}`, `id-${i}`);
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 5; j += 1) cache.get(`folder-${j}`);
    }
    cache.get('non-existent-1');
    cache.get('non-existent-2');
    expect(cache.getStats()).toMatchObject({ hits: 10, misses: 2, size: 5, total: 12 });
  });

  it('clears cached values and statistics', () => {
    const cache = new FolderCache();
    cache.set('folder-1', 'id-1');
    cache.set('folder-2', 'id-2');
    cache.clear();
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 0, size: 0 });
  });

  it('removes expired entries during cleanup', () => {
    vi.useFakeTimers();
    const cache = new FolderCache(500);
    for (let i = 0; i < 5; i += 1) cache.set(`folder-${i}`, `id-${i}`);
    vi.advanceTimersByTime(600);
    for (let i = 5; i < 8; i += 1) cache.set(`folder-${i}`, `id-${i}`);
    expect(cache.cleanup()).toBe(5);
    expect(cache.getStats().size).toBe(3);
    vi.useRealTimers();
  });

  it('uses the shared cache to avoid duplicate folder lookup', async () => {
    folderCache.clear();
    const createFolder = vi.fn(async (_drive, folderName) => `folder-id-${folderName}`);
    await expect(getOrCreateFolderWithCache({}, 'test-folder', 'parent-1', createFolder)).resolves.toBe('folder-id-test-folder');
    await expect(getOrCreateFolderWithCache({}, 'test-folder', 'parent-1', createFolder)).resolves.toBe('folder-id-test-folder');
    expect(createFolder).toHaveBeenCalledOnce();
  });

  it('reports efficiency from shared cache activity', () => {
    folderCache.clear();
    folderCache.set('folder-1', 'id-1');
    folderCache.get('folder-1');
    folderCache.get('missing');
    expect(analyzeCacheEfficiency()).toMatchObject({ hits: 1, misses: 1, efficiency: { apiCallsSaved: 1 } });
  });
});
