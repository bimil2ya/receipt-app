/**
 * 폴더 캐싱 시스템 테스트
 * Day 18-19 검증
 */

import { FolderCache, folderCache, getOrCreateFolderWithCache, analyzeCacheEfficiency } from './cache.js';

/**
 * Test 1: 기본 캐시 저장/조회
 */
async function test_basic_set_get() {
  console.log('\n📝 Test 1: 기본 캐시 저장/조회');
  const cache = new FolderCache();

  cache.set('folder-1', 'id-123');
  const result = cache.get('folder-1');

  console.log(`  ✅ 저장된 값: ${result}`);
  console.assert(result === 'id-123', '캐시 값이 일치하지 않음');
  console.log(`  ✅ Pass`);
}

/**
 * Test 2: TTL 만료
 */
async function test_ttl_expiration() {
  console.log('\n📝 Test 2: TTL 만료');
  const cache = new FolderCache(1000); // 1초 TTL

  cache.set('folder-2', 'id-456');
  console.log(`  저장 직후: ${cache.get('folder-2')}`);
  console.assert(cache.get('folder-2') === 'id-456', '초기 값 조회 실패');

  // 1.2초 대기
  await new Promise(resolve => setTimeout(resolve, 1200));

  const expired = cache.get('folder-2');
  console.log(`  1.2초 후: ${expired || '(null)'}`);
  console.assert(expired === null, 'TTL 만료 후에도 값이 반환됨');
  console.log(`  ✅ Pass`);
}

/**
 * Test 3: 캐시 통계
 */
async function test_cache_stats() {
  console.log('\n📝 Test 3: 캐시 통계 (히트율)');
  const cache = new FolderCache();

  // 5개 항목 저장
  for (let i = 0; i < 5; i++) {
    cache.set(`folder-${i}`, `id-${i}`);
  }

  // 10번 조회 (모두 히트)
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 5; j++) {
      cache.get(`folder-${j}`);
    }
  }

  // 미스 2번
  cache.get('non-existent-1');
  cache.get('non-existent-2');

  const stats = cache.getStats();
  console.log(`  히트: ${stats.hits}, 미스: ${stats.misses}, 히트율: ${stats.hitRate}`);
  console.log(`  캐시 크기: ${stats.size}`);

  console.assert(stats.hits === 10, '히트 수 불일치');
  console.assert(stats.misses === 2, '미스 수 불일치');
  console.assert(stats.size === 5, '캐시 크기 불일치');
  console.log(`  ✅ Pass`);
}

/**
 * Test 4: 캐시 초기화
 */
async function test_cache_clear() {
  console.log('\n📝 Test 4: 캐시 초기화');
  const cache = new FolderCache();

  cache.set('folder-1', 'id-1');
  cache.set('folder-2', 'id-2');
  console.log(`  초기화 전: ${cache.getStats().size} 항목`);

  cache.clear();
  console.log(`  초기화 후: ${cache.getStats().size} 항목`);

  console.assert(cache.getStats().size === 0, '캐시 초기화 실패');
  console.assert(cache.getStats().hits === 0, '통계 초기화 실패');
  console.log(`  ✅ Pass`);
}

/**
 * Test 5: 캐시 정리 (TTL 만료 항목 제거)
 */
async function test_cache_cleanup() {
  console.log('\n📝 Test 5: 캐시 정리 (TTL 만료)');
  const cache = new FolderCache(500); // 500ms TTL

  // 첫 번째 배치: 5개 항목
  for (let i = 0; i < 5; i++) {
    cache.set(`folder-${i}`, `id-${i}`);
  }

  console.log(`  저장 직후: ${cache.getStats().size} 항목`);

  // 600ms 대기
  await new Promise(resolve => setTimeout(resolve, 600));

  // 두 번째 배치: 3개 항목 (새로 저장)
  for (let i = 5; i < 8; i++) {
    cache.set(`folder-${i}`, `id-${i}`);
  }

  console.log(`  추가 저장 후: ${cache.getStats().size} 항목`);

  // 정리 실행
  const cleaned = cache.cleanup();
  console.log(`  정리됨: ${cleaned} 항목, 남은 것: ${cache.getStats().size} 항목`);

  console.assert(cleaned === 5, '정리된 항목 수 불일치');
  console.assert(cache.getStats().size === 3, '정리 후 크기 불일치');
  console.log(`  ✅ Pass`);
}

/**
 * Test 6: getOrCreateFolderWithCache 인터페이스
 */
async function test_get_or_create_with_cache() {
  console.log('\n📝 Test 6: getOrCreateFolderWithCache');

  // Mock Drive API
  const mockDrive = {};
  let callCount = 0;

  const mockGetOrCreateFolder = async (drive, folderName, parentId) => {
    callCount++;
    console.log(`    [API 호출 #${callCount}] ${folderName}`);
    return `folder-id-${folderName}`;
  };

  // 첫 번째 호출: API 호출 → 캐시 저장
  const id1 = await getOrCreateFolderWithCache(
    mockDrive,
    'test-folder',
    'parent-1',
    mockGetOrCreateFolder
  );
  console.log(`  1번째: ${id1}, API 호출: ${callCount}`);
  console.assert(callCount === 1, '첫 번째 API 호출 실패');

  // 두 번째 호출: 캐시 히트
  const id2 = await getOrCreateFolderWithCache(
    mockDrive,
    'test-folder',
    'parent-1',
    mockGetOrCreateFolder
  );
  console.log(`  2번째: ${id2}, API 호출: ${callCount} (변화 없음)`);
  console.assert(callCount === 1, '캐시 히트 실패 (API 재호출됨)');
  console.assert(id1 === id2, '반환값 불일치');

  // 세 번째 호출: 다른 폴더명 → API 호출
  const id3 = await getOrCreateFolderWithCache(
    mockDrive,
    'different-folder',
    'parent-1',
    mockGetOrCreateFolder
  );
  console.log(`  3번째 (다른 폴더): ${id3}, API 호출: ${callCount}`);
  console.assert(callCount === 2, 'API 재호출 실패');

  console.log(`  ✅ Pass`);
}

/**
 * Test 7: 캐시 효율성 분석
 */
async function test_cache_efficiency() {
  console.log('\n📝 Test 7: 캐시 효율성 분석');

  // 캐시 상태 초기화
  folderCache.clear();

  // 의도적으로 캐시 히트 생성
  for (let i = 0; i < 10; i++) {
    folderCache.set(`folder-${i}`, `id-${i}`);
  }

  // 30번 히트
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 10; j++) {
      folderCache.get(`folder-${j}`);
    }
  }

  // 5번 미스
  for (let i = 0; i < 5; i++) {
    folderCache.get(`non-existent-${i}`);
  }

  const analysis = analyzeCacheEfficiency();
  console.log(`  히트: ${analysis.hits}`);
  console.log(`  미스: ${analysis.misses}`);
  console.log(`  히트율: ${analysis.hitRate}`);
  console.log(`  API 호출 절감: ${analysis.efficiency.apiCallsSaved}개`);
  console.log(`  권장사항: ${analysis.efficiency.recommendation}`);

  console.assert(analysis.hits === 30, '히트 수 불일치');
  console.assert(analysis.misses === 5, '미스 수 불일치');
  console.log(`  ✅ Pass`);
}

/**
 * Test 8: 동시 다중 폴더 캐싱 시뮬레이션
 */
async function test_concurrent_multiple_folders() {
  console.log('\n📝 Test 8: 동시 다중 폴더 캐싱');

  const cache = new FolderCache();
  const folderNames = ['dates', 'receipts', 'images', 'archive', 'temp'];
  const parentId = 'parent-root';

  // 캐시에 저장
  for (const name of folderNames) {
    cache.set(`${parentId}:${name}`, `folder-id-${name}`);
  }

  // 5x10 = 50번 조회 (캐시 히트)
  for (let batch = 0; batch < 10; batch++) {
    for (const name of folderNames) {
      cache.get(`${parentId}:${name}`);
    }
  }

  const stats = cache.getStats();
  console.log(`  저장된 폴더: ${folderNames.length}개`);
  console.log(`  조회 횟수: 50번`);
  console.log(`  히트: ${stats.hits}, 미스: ${stats.misses}`);
  console.log(`  히트율: ${stats.hitRate}`);

  console.assert(stats.hits === 50, '모든 조회가 히트되지 않음');
  console.assert(stats.misses === 0, '미스 발생');
  console.log(`  ✅ Pass`);
}

/**
 * 모든 테스트 실행
 */
async function runAllTests() {
  console.log('\n🚀 캐시 시스템 테스트 시작\n');
  console.log('═'.repeat(60));

  try {
    await test_basic_set_get();
    await test_ttl_expiration();
    await test_cache_stats();
    await test_cache_clear();
    await test_cache_cleanup();
    await test_get_or_create_with_cache();
    await test_cache_efficiency();
    await test_concurrent_multiple_folders();

    console.log('\n' + '═'.repeat(60));
    console.log('\n✅ 모든 테스트 통과!\n');

  } catch (error) {
    console.error('\n❌ 테스트 실패:', error.message);
    process.exit(1);
  }
}

runAllTests();
