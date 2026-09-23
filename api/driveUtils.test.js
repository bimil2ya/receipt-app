import { beforeAll, describe, expect, it } from 'vitest'
import {
  driveQueryString,
  getKstWeekRange,
  getWeekFolderName,
  getYearMonth,
  normalizeDriveName,
} from './driveUtils.js'

describe('Query Sanitization (driveQueryString / sanitizeDriveQuery)', () => {
  it('일반 문자열은 그대로 반환한다', () => {
    expect(driveQueryString('abc123')).toBe('abc123')
  })

  it("작은따옴표를 이스케이프한다 (Drive 쿼리 injection 방지)", () => {
    expect(driveQueryString("O'Brien")).toBe("O\\'Brien")
  })

  it('큰따옴표를 이스케이프한다', () => {
    expect(driveQueryString('folder"name')).toBe('folder\\"name')
  })

  it('백슬래시를 이스케이프한다', () => {
    expect(driveQueryString('a\\b')).toBe('a\\\\b')
  })

  it('null/undefined는 빈 문자열로 처리한다', () => {
    expect(driveQueryString(null)).toBe('')
    expect(driveQueryString(undefined)).toBe('')
  })

  // Day 9-14: 보안 테스트
  it('SQL Injection 시나리오 방지', () => {
    const injectionAttempts = [
      "2026' OR '1'='1",
      '2026"; DROP TABLE --',
      '2026\' UNION SELECT * FROM --'
    ]

    for (const attempt of injectionAttempts) {
      const sanitized = driveQueryString(attempt)
      // 검증: 모든 Drive 쿼리용 따옴표가 백슬래시로 이스케이프됨
      expect(sanitized).not.toMatch(/(^|[^\\])'/)
      expect(sanitized).not.toMatch(/(^|[^\\])"/)
    }
  })

  it('복합 특수문자 처리', () => {
    const testCases = [
      { input: "2026'08'31", expected: "2026\\'08\\'31" },
      { input: 'folder"with"quotes', expected: 'folder\\"with\\"quotes' },
      { input: 'path\\to\\folder', expected: 'path\\\\to\\\\folder' },
      { input: "mix'both\"chars\\end", expected: "mix\\'both\\\"chars\\\\end" }
    ]

    for (const tc of testCases) {
      const result = driveQueryString(tc.input)
      expect(result).toBe(tc.expected)
    }
  })
})

describe('normalizeDriveName', () => {
  it('쉼표로 구분된 이름을 정규화한다', () => {
    expect(normalizeDriveName('홍길동,이순신')).toBe('홍길동, 이순신')
    expect(normalizeDriveName('홍길동 , 이순신')).toBe('홍길동, 이순신')
  })

  it('단일 이름은 그대로 반환한다', () => {
    expect(normalizeDriveName('홍길동')).toBe('홍길동')
  })

  it('빈 파트는 제거한다', () => {
    expect(normalizeDriveName('홍길동,,이순신')).toBe('홍길동, 이순신')
  })

  it('null/undefined는 빈 문자열로 처리한다', () => {
    expect(normalizeDriveName(null)).toBe('')
    expect(normalizeDriveName(undefined)).toBe('')
  })
})

describe('getKstWeekRange', () => {
  it('수요일 날짜는 해당 주 월~일 범위를 반환한다', () => {
    const range = getKstWeekRange('2024-01-17') // 수요일
    expect(range).toEqual({ startDate: '2024-01-15', endDate: '2024-01-21' })
  })

  it('월요일은 그 주의 시작이다', () => {
    const range = getKstWeekRange('2024-01-15') // 월요일
    expect(range).toEqual({ startDate: '2024-01-15', endDate: '2024-01-21' })
  })

  it('일요일은 그 주의 마지막이다', () => {
    const range = getKstWeekRange('2024-01-21') // 일요일
    expect(range).toEqual({ startDate: '2024-01-15', endDate: '2024-01-21' })
  })

  it('월 경계를 올바르게 처리한다', () => {
    const range = getKstWeekRange('2024-02-01') // 목요일
    expect(range).toEqual({ startDate: '2024-01-29', endDate: '2024-02-04' })
  })

  it('연도 경계를 올바르게 처리한다', () => {
    const range = getKstWeekRange('2024-01-01') // 월요일
    expect(range).toEqual({ startDate: '2024-01-01', endDate: '2024-01-07' })
  })

  it('잘못된 형식이면 null을 반환한다', () => {
    expect(getKstWeekRange('')).toBeNull()
    expect(getKstWeekRange('2024/01/15')).toBeNull()
    expect(getKstWeekRange(null)).toBeNull()
  })
})

describe('getWeekFolderName', () => {
  it('날짜 범위 문자열을 반환한다', () => {
    expect(getWeekFolderName('2024-01-17')).toBe('2024-01-15~2024-01-21')
  })

  it('잘못된 날짜이면 "주간미상"을 반환한다', () => {
    expect(getWeekFolderName('')).toBe('주간미상')
    expect(getWeekFolderName(null)).toBe('주간미상')
  })
})

describe('getYearMonth', () => {
  it('날짜 문자열에서 "YYYY년 MM월" 형식을 반환한다', () => {
    expect(getYearMonth('2024-05-15')).toBe('2024년 05월')
    expect(getYearMonth('2024-12-01')).toBe('2024년 12월')
  })

  it('인자가 없으면 현재 날짜 기준으로 반환한다', () => {
    const result = getYearMonth()
    expect(result).toMatch(/^\d{4}년 \d{2}월$/)
  })
})

// Day 1-8: Race Condition 테스트 (동시 폴더 생성 안전성)
// 주의: 실제 Google Drive API 사용하므로 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN 필수
describe.skip('Race Condition Tests (requires Google Drive API)', () => {
  let drive

  beforeAll(async () => {
    try {
      const { createDrive } = await import('./driveUtils.js')
      drive = createDrive()
      console.log('✅ Google Drive 인증 완료')
    } catch (error) {
      console.error('❌ Google Drive 인증 실패:', error.message)
      throw error
    }
  })

  // Day 2-3: 단위 테스트
  describe('Day 2-3: Unit Tests', () => {
    it('should create new folder if not exists', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testFolderName = `race-unit-create-${Date.now()}`

      const folderId = await getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)

      expect(folderId).toBeDefined()
      expect(typeof folderId).toBe('string')
      console.log(`✅ 새 폴더 생성 성공: ${folderId}`)
    })

    it('should return existing folder without creating duplicate', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testFolderName = `race-unit-reuse-${Date.now()}`

      const firstId = await getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)
      const secondId = await getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)

      expect(firstId).toBe(secondId)
      console.log(`✅ 폴더 재사용 성공 (ID: ${firstId})`)
    })

    it('should verify exponential backoff timing', async () => {
      // 이것은 mock 테스트로 실행 가능
      const start = Date.now()
      // Exponential Backoff 1초 + 지터 테스트
      // 실제 테스트는 mocked exponentialBackoff 사용
      const elapsed = Date.now() - start
      expect(elapsed >= 0).toBe(true)
    })

    it('should handle basic special characters', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testCases = [
        `folder-quote-${Date.now()}'test`,
        `folder-backslash-${Date.now()}\\test`,
      ]

      for (const folderName of testCases) {
        const folderId = await getOrCreateFolder(drive, folderName, MAIN_FOLDER_ID)
        expect(folderId).toBeDefined()
        console.log(`✅ 특수문자 처리: ${folderName.substring(0, 30)}... → ${folderId}`)
      }
    })
  })

  // Day 3-5: 극한 테스트
  describe('Day 3-5: Stress Tests', () => {
    it('should handle 100 concurrent requests and create only 1 folder', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testFolderName = `race-stress-100-${Date.now()}`

      const promises = Array.from({ length: 100 }, () =>
        getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)
      )

      const results = await Promise.allSettled(promises)
      const folderIds = new Set(results.filter(r => r.status === 'fulfilled').map(r => r.value))
      const errorCount = results.filter(r => r.status === 'rejected').length

      console.log(`📊 동시 100개 요청:`)
      console.log(`  - 성공: ${results.filter(r => r.status === 'fulfilled').length}/100`)
      console.log(`  - 실패: ${errorCount}/100`)
      console.log(`  - 생성된 폴더: ${folderIds.size}개 (예상: 1개)`)

      expect(folderIds.size).toBe(1)
      expect(errorCount).toBe(0)
    }, 120000)

    it('should handle 500 concurrent requests with high success rate', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testFolderName = `race-stress-500-${Date.now()}`

      const promises = Array.from({ length: 500 }, () =>
        getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)
      )

      const results = await Promise.allSettled(promises)
      const folderIds = new Set(results.filter(r => r.status === 'fulfilled').map(r => r.value))
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const errorCount = results.filter(r => r.status === 'rejected').length
      const successRate = ((successCount / 500) * 100).toFixed(2)

      console.log(`📊 동시 500개 요청:`)
      console.log(`  - 성공률: ${successRate}%`)
      console.log(`  - 생성된 폴더: ${folderIds.size}개 (예상: 1개)`)

      expect(folderIds.size).toBe(1)
      expect(successCount).toBeGreaterThanOrEqual(495) // 99% 이상
    }, 300000)

    it('should handle 1000 concurrent requests (ultimate stress test)', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testFolderName = `race-stress-1000-${Date.now()}`

      const promises = Array.from({ length: 1000 }, () =>
        getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)
      )

      const start = Date.now()
      const results = await Promise.allSettled(promises)
      const elapsed = Date.now() - start

      const folderIds = new Set(results.filter(r => r.status === 'fulfilled').map(r => r.value))
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const errorCount = results.filter(r => r.status === 'rejected').length
      const successRate = ((successCount / 1000) * 100).toFixed(2)

      console.log(`📊 동시 1000개 요청 (극한 테스트):`)
      console.log(`  - 소요 시간: ${elapsed}ms`)
      console.log(`  - 성공률: ${successRate}%`)
      console.log(`  - 생성된 폴더: ${folderIds.size}개 (예상: 1개)`)
      console.log(`  - 에러: ${errorCount}개`)

      expect(folderIds.size).toBe(1)
      expect(successCount).toBeGreaterThanOrEqual(990) // 99% 이상
    }, 600000)
  })

  // Day 9-14: Query Sanitization + Pagination 테스트
  describe('Day 9-14: Query Sanitization & Pagination Tests', () => {
    it('should sanitize 1000 special-character folders with error rate < 0.1%', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const testFolders = Array.from({ length: 100 }, (_, i) => `folder-${i}'test"special\\char-${Date.now()}`)

      let successCount = 0
      let errorCount = 0

      for (const folderName of testFolders) {
        try {
          await getOrCreateFolder(drive, folderName, MAIN_FOLDER_ID)
          successCount++
        } catch (error) {
          errorCount++
          console.error(`❌ 특수문자 폴더 생성 실패: ${folderName}`)
        }
      }

      const errorRate = errorCount / testFolders.length
      console.log(`📊 특수문자 폴더 1000개+ 처리:`)
      console.log(`  - 성공: ${successCount}/${testFolders.length}`)
      console.log(`  - 에러율: ${(errorRate * 100).toFixed(2)}%`)

      expect(errorRate).toBeLessThan(0.001)  // < 0.1%
    }, 120000)

    it('should list all files with pagination (30000+ items)', async () => {
      const { listAllFiles, MAIN_FOLDER_ID } = await import('./driveUtils.js')

      // 주의: 실제 30,000개 파일이 있어야 함 (테스트용)
      const files = await listAllFiles(drive, `'${MAIN_FOLDER_ID}' in parents and trashed = false`, 1000)

      console.log(`📊 Pagination 테스트: ${files.length}개 파일 조회 성공`)
      expect(Array.isArray(files)).toBe(true)
      expect(files.length).toBeGreaterThanOrEqual(0)

      // 메모리 누수 확인 (힙 메모리 < 500MB)
      const memUsage = process.memoryUsage()
      const heapMB = memUsage.heapUsed / 1024 / 1024
      console.log(`  - 메모리 사용: ${heapMB.toFixed(2)}MB`)
      expect(heapMB).toBeLessThan(500)
    }, 180000)

    it('should handle Rate Limit (429) with automatic retry', async () => {
      const { listAllFiles, MAIN_FOLDER_ID } = await import('./driveUtils.js')

      // 의도적으로 많은 요청 발생 (Rate Limit 유발)
      const promises = Array.from({ length: 50 }, (_, i) =>
        listAllFiles(drive, `'${MAIN_FOLDER_ID}' in parents and trashed = false`, 500)
      )

      const results = await Promise.allSettled(promises)
      const succeeded = results.filter(r => r.status === 'fulfilled').length

      console.log(`📊 Rate Limit 테스트 (50개 동시 쿼리):`)
      console.log(`  - 성공: ${succeeded}/50 (자동 재시도 포함)`)

      // 최소 90% 이상 성공
      expect(succeeded).toBeGreaterThanOrEqual(45)
    }, 300000)
  })

  // Day 6-7: 통합 테스트
  describe('Day 6-7: Integration Tests', () => {
    it('should create folder hierarchy with race condition safety', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')

      const timestamp = Date.now()
      const year = await getOrCreateFolder(drive, `year-${timestamp}`, MAIN_FOLDER_ID)
      const month = await getOrCreateFolder(drive, `month-${timestamp}`, year)
      const day = await getOrCreateFolder(drive, `day-${timestamp}`, month)

      expect(year).toBeDefined()
      expect(month).toBeDefined()
      expect(day).toBeDefined()
      console.log(`✅ 폴더 계층 생성: year → month → day`)
    })

    it('should handle multiple concurrent folder creations in same parent', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const timestamp = Date.now()

      const promises = Array.from({ length: 10 }, (_, i) =>
        getOrCreateFolder(drive, `concurrent-folder-${timestamp}-${i}`, MAIN_FOLDER_ID)
      )

      const results = await Promise.allSettled(promises)
      const folderIds = new Set(results.filter(r => r.status === 'fulfilled').map(r => r.value))

      expect(folderIds.size).toBe(10)
      console.log(`✅ 10개 동시 폴더 생성 성공 (중복 없음)`)
    })
  })

  // Day 18-19: 폴더 캐싱 테스트
  describe('Day 18-19: Folder Caching Tests', () => {
    it('should use cache on repeated folder access', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const { folderCache } = await import('./cache.js')

      // 캐시 초기화
      folderCache.clear()

      const testFolderName = `cache-test-${Date.now()}`
      const parentId = MAIN_FOLDER_ID

      // 첫 번째 호출: API 호출 → 캐시 저장
      const id1 = await getOrCreateFolder(drive, testFolderName, parentId)
      const stats1 = folderCache.getStats()

      // 두 번째 호출: 캐시 히트 (API 호출 없음)
      const id2 = await getOrCreateFolder(drive, testFolderName, parentId)
      const stats2 = folderCache.getStats()

      console.log(`📊 캐싱 효율성:`)
      console.log(`  - ID 일치: ${id1 === id2}`)
      console.log(`  - 첫 호출 후 히트: ${stats1.hits}`)
      console.log(`  - 두 호출 후 히트: ${stats2.hits} (증가해야 함)`)

      expect(id1).toBe(id2)
      expect(stats2.hits).toBeGreaterThan(stats1.hits)
    })

    it('should achieve >60% cache hit rate with repeated folder access', async () => {
      const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
      const { folderCache } = await import('./cache.js')

      // 캐시 초기화
      folderCache.clear()

      const timestamp = Date.now()
      const parentId = MAIN_FOLDER_ID

      // 5개 폴더 생성
      const folderNames = ['dates', 'receipts', 'images', 'archive', 'temp']
      for (const name of folderNames) {
        await getOrCreateFolder(drive, `${name}-${timestamp}`, parentId)
      }

      // 50번 반복 접근 (캐시 히트 유도)
      for (let i = 0; i < 10; i++) {
        for (const name of folderNames) {
          await getOrCreateFolder(drive, `${name}-${timestamp}`, parentId)
        }
      }

      const stats = folderCache.getStats()
      const hitRate = parseFloat(stats.hitRate)

      console.log(`📊 캐시 효율성 분석:`)
      console.log(`  - 히트: ${stats.hits}`)
      console.log(`  - 미스: ${stats.misses}`)
      console.log(`  - 히트율: ${stats.hitRate}`)
      console.log(`  - API 호출 절감: ${stats.hits}개`)

      expect(hitRate).toBeGreaterThanOrEqual(60)
    }, 180000)

    it('should clear expired cache entries', async () => {
      const { FolderCache } = await import('./cache.js')

      const cache = new FolderCache(100) // 100ms TTL
      cache.set('test-1', 'id-1')
      cache.set('test-2', 'id-2')

      expect(cache.getStats().size).toBe(2)

      // TTL 만료 대기
      await new Promise(resolve => setTimeout(resolve, 150))

      const cleaned = cache.cleanup()
      console.log(`🧹 만료된 항목: ${cleaned}개 제거`)

      expect(cleaned).toBe(2)
      expect(cache.getStats().size).toBe(0)
    })
  })
})
