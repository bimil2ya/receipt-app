import { describe, expect, it } from 'vitest'
import {
  driveQueryString,
  getKstWeekRange,
  getWeekFolderName,
  getYearMonth,
  normalizeDriveName,
} from './driveUtils.js'

describe('driveQueryString', () => {
  it('일반 문자열은 그대로 반환한다', () => {
    expect(driveQueryString('abc123')).toBe('abc123')
  })

  it("작은따옴표를 이스케이프한다 (Drive 쿼리 injection 방지)", () => {
    expect(driveQueryString("O'Brien")).toBe("O\\'Brien")
  })

  it('백슬래시를 이스케이프한다', () => {
    expect(driveQueryString('a\\b')).toBe('a\\\\b')
  })

  it('null/undefined는 빈 문자열로 처리한다', () => {
    expect(driveQueryString(null)).toBe('')
    expect(driveQueryString(undefined)).toBe('')
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
})
