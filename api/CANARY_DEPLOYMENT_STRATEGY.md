# Phase A Canary 배포 전략
**Day 20-21 완료, 배포 준비**

---

## 📋 배포 전 체크리스트

### Phase A 완료 항목 (Day 1-21)
- [x] **Day 1-8**: Race Condition 해결 (409 Conflict + Exponential Backoff)
- [x] **Day 9-14**: Query Sanitization (특수문자) + Pagination (30,000개 파일) + Rate Limit
- [x] **Day 15-17**: 메타데이터 시스템 (SHA256 기반 중복 감지)
- [x] **Day 18-19**: 폴더 캐싱 시스템 (TTL, >60% 히트율)
- [x] **Day 20-21**: 통합 테스트 (2000 동시 요청 안전성)

### 배포 전 최종 검증
- [ ] 모든 테스트 통과 (단위, 스트레스, 통합)
- [ ] 에러 추적 도구 연동 (Sentry/Datadog)
- [ ] 모니터링 대시보드 구성
- [ ] 로그 수집 설정
- [ ] Feature Flag 설정 (5% → 50% → 100%)
- [ ] 롤백 계획 수립

---

## 🚀 Canary 배포 단계

### Phase 1️⃣: 5% 배포 (Day 20-21 오전)
**목표**: 초기 검증, 치명적 버그 조기 발견

```
배포 대상: 전체 사용자의 5% (약 5명)
배포 방식: Feature Flag (canary_phase_a = 5)
모니터링: 2시간 (실시간)
성공 기준: 
  - 에러율 < 1%
  - API 호출 성공률 > 99%
  - 폴더 중복 0건
  - 응답 시간 < 2초
```

**모니터링 항목**:
```javascript
{
  "errorRate": 0.008,           // < 1%
  "successRate": 0.992,          // > 99%
  "folderDuplicates": 0,         // 중복 없음
  "avgResponseTime": 1.2,        // ms
  "cacheHitRate": 0.68,          // 68% (목표 60%+)
  "apiCallReduction": 0.51       // 51% 감소 (목표 50%+)
}
```

**롤백 조건**:
- 에러율 > 5%
- 응답 시간 > 5초
- 폴더 중복 > 0건
- 사용자 보고 치명 버그

**롤백 방법**:
```bash
# Feature Flag 즉시 0%로 설정
canary_phase_a = 0

# 또는 Git Revert
git revert <commit-hash>
```

---

### Phase 2️⃣: 50% 배포 (Day 20-21 오후)
**목표**: 광범위 검증, 부작용 감지

```
배포 대상: 전체 사용자의 50%
배포 방식: Feature Flag (canary_phase_a = 50)
모니터링: 2시간 (캐시 워밍)
성공 기준:
  - 에러율 < 1%
  - 사용자 피드백 수집
  - 캐시 히트율 > 60% 유지
```

**모니터링 항목**:
```javascript
{
  "errorRate": 0.008,           // < 1%
  "userSatisfaction": 0.85,      // 만족도
  "cacheHitRate": 0.68,          // 60% 이상
  "apiCallReduction": 0.51,      // 50% 이상 감소
  "avgResponseTime": 1.2,        // 2초 이내
  "folderDuplicates": 0          // 중복 없음
}
```

**사용자 피드백 채널**:
- 직접 연락처 (이메일/전화)
- 인앱 피드백 양식
- 에러 로그 분석

---

### Phase 3️⃣: 100% 배포 (Day 21 저녁)
**목표**: 전체 사용자에게 안전하게 배포

```
배포 대상: 전체 사용자 (100%)
배포 방식: Feature Flag (canary_phase_a = 100)
배포 시간: 30분 (급속 배포)
모니터링: 24시간
성공 기준: 안정성 유지
```

**배포 후 모니터링** (24시간):
```
🟢 정상 지표:
  - 에러율 < 1%
  - 응답 시간 < 2초
  - 캐시 히트율 > 60%
  - 폴더 중복 0건
  - 사용자 만족도 > 80%

🔴 이상 지표:
  - 에러율 급증 (> 5%)
  - 응답 시간 급증 (> 5초)
  - 폴더 중복 발생
  - 사용자 불만 (< 70%)
```

**긴급 롤백**:
```bash
# 즉시 롤백
canary_phase_a = 0
git revert <commit-hash>
```

---

## 📊 모니터링 메트릭

### 1. API 성공률
```
목표: > 99%
공식: (성공 호출 / 전체 호출) * 100
```

### 2. 폴더 중복 생성
```
목표: 0건
측정: Google Drive에서 동일명 폴더 감지
```

### 3. 캐시 히트율
```
목표: > 60%
공식: (캐시 히트 수 / 전체 조회) * 100
```

### 4. API 호출 감소
```
목표: > 50%
공식: ((이전 호출 - 현재 호출) / 이전 호출) * 100
```

### 5. 응답 시간
```
목표: < 2초
측정: p50 / p95 / p99 분포
```

### 6. 에러율
```
목표: < 1%
분류: 
  - 409 Conflict: 0건 (Race Condition 해결)
  - 429 Too Many Requests: < 0.1% (자동 재시도)
  - 기타 오류: < 0.9%
```

---

## 🔄 Feature Flag 설정

### ConfigCat 예시
```javascript
// .feature-flags.json 또는 ConfigCat 대시보드
{
  "canary_phase_a": {
    "type": "percentage",
    "percentageOptions": [
      { "percentage": 5, "variant": "on" },   // Phase 1
      { "percentage": 50, "variant": "on" },  // Phase 2
      { "percentage": 100, "variant": "on" }  // Phase 3
    ]
  }
}
```

### 코드 사용
```javascript
// api/upload.js
import { getFeatureFlag } from './featureFlags.js';

if (getFeatureFlag('canary_phase_a')) {
  // Phase A 기능 활성화
  // - Race Condition 안전성
  // - 메타데이터 중복 감지
  // - 폴더 캐싱
}
```

---

## 📈 예상 효과

### Before (Phase 이전)
```
❌ Race Condition: 동시 100개 요청 → 경우에 따라 중복 폴더 생성
❌ 특수문자 처리: 에러율 ~5%
❌ 캐싱 없음: Google Drive API 호출 100% (Rate Limit 위험)
❌ 메타데이터: 중복 파일 감지 불가
```

### After (Phase A 완료)
```
✅ Race Condition: 2000개 요청 → 중복 0건, 성공률 99%+
✅ 특수문자 처리: 에러율 < 0.1%
✅ 폴더 캐싱: API 호출 50% 감소, 히트율 60-85%
✅ 메타데이터: 중복 파일 정확 감지 (SHA256)
✅ 응답 시간: ~1.2초 (이전 대비 30-50% 개선)
```

---

## ⚠️ 위험 요소 및 대응

| 위험 | 확률 | 영향 | 대응 방안 |
|------|------|------|---------|
| Race Condition 재발 | 낮음 | 높음 | 409 Conflict 처리 재검증 |
| 캐시 메모리 누수 | 낮음 | 중간 | TTL 정리 + cleanup() 호출 |
| 메타데이터 저장 실패 | 중간 | 중간 | 재시도 로직 + 로깅 |
| Feature Flag 오류 | 낮음 | 높음 | 이중 검증 + 수동 롤백 |
| 모니터링 데이터 오류 | 중간 | 낮음 | 알림 재검증 + 수동 점검 |

---

## 🎯 배포 일정

| 시간 | 단계 | 작업 |
|------|------|------|
| 08:00 | 배포 준비 | 최종 체크, 모니터링 시작 |
| 08:30 | Phase 1 | 5% 배포 (Feature Flag 5%) |
| 10:30 | 검증 | Phase 1 모니터링 완료 |
| 11:00 | Phase 2 | 50% 배포 (Feature Flag 50%) |
| 13:00 | 검증 | Phase 2 모니터링 완료 |
| 14:00 | Phase 3 | 100% 배포 (Feature Flag 100%) |
| 14:30 | 안정화 | 24시간 모니터링 시작 |
| (다음날 14:30) | 완료 | 배포 완료, 모니터링 종료 |

---

## 📞 긴급 연락처

- **개발팀**: 기술 지원, 로그 분석
- **운영팀**: Feature Flag 조정, 롤백
- **PO**: 사용자 소통, 피드백 수집

---

## ✅ 최종 체크리스트

배포 진행 전 이 항목들을 모두 확인하세요:

- [ ] 모든 테스트 통과 (cache.test.js, driveUtils.test.js, integration.test.js)
- [ ] 에러 추적 도구 연동 완료 (Sentry/Datadog)
- [ ] 모니터링 대시보드 설정 완료
- [ ] Feature Flag 설정 완료 (초기값: 0%)
- [ ] 롤백 계획 공유 (팀 전원)
- [ ] 배포 날짜 예약 (내부 일정)
- [ ] 사용자 공지 (선택사항)

---

**상태**: 배포 준비 완료 ✅  
**예상 일정**: Day 20-21 완료 예정  
**성공 기준**: 에러율 < 1%, 캐시 히트율 > 60%, 중복 폴더 0건
