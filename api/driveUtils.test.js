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

  it('should create new folder if not exists', async () => {
    const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
    const testFolderName = `race-test-${Date.now()}`

    const folderId = await getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)

    expect(folderId).toBeDefined()
    expect(typeof folderId).toBe('string')
  })

  it('should return existing folder without creating duplicate', async () => {
    const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
    const testFolderName = `race-test-existing-${Date.now()}`

    const firstId = await getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)
    const secondId = await getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)

    expect(firstId).toBe(secondId)
  })

  it('should handle 100 concurrent requests and create only 1 folder', async () => {
    const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
    const testFolderName = `race-concurrent-${Date.now()}`

    const promises = Array.from({ length: 100 }, () =>
      getOrCreateFolder(drive, testFolderName, MAIN_FOLDER_ID)
    )

    const results = await Promise.allSettled(promises)
    const folderIds = new Set(results.filter(r => r.status === 'fulfilled').map(r => r.value))
    const errorCount = results.filter(r => r.status === 'rejected').length

    console.log(`📊 동시 100개 요청: 성공=${results.filter(r => r.status === 'fulfilled').length}, 실패=${errorCount}, 폴더=${folderIds.size}`)

    expect(folderIds.size).toBe(1)
    expect(errorCount).toBe(0)
  }, 60000)

  it('should handle special characters safely', async () => {
    const { getOrCreateFolder, MAIN_FOLDER_ID } = await import('./driveUtils.js')
    const specialCases = [`folder-2026'08'31-${Date.now()}`, `folder-test"special-${Date.now()}`, `folder-back\\slash-${Date.now()}`]

    for (const folderName of specialCases) {
      const folderId = await getOrCreateFolder(drive, folderName, MAIN_FOLDER_ID)
      expect(folderId).toBeDefined()
    }
  })
})
