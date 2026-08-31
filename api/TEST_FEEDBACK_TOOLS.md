# 사용자 테스트 피드백 수집 도구

**Day 43-50 사용자 피드백 수집용 설문지 및 로그 도구**

---

## 📋 설문지 1: 기본 정보 (테스트 시작 시)

### 설문 항목
```
Q1. 이름 (또는 익명 ID)
   답변 타입: 텍스트 (선택)
   이유: 추적용 (익명 가능)

Q2. 나이
   답변 타입: 숫자 (60-79)
   기준값: 60-70대

Q3. 성별
   답변 타입: 라디오 (남/여)

Q4. 현재 사용 중인 스마트폰 OS
   답변 타입: 라디오
   - iOS
   - Android

Q5. 스마트폰 사용 경험
   답변 타입: 라디오 (Likert 5점)
   1: 거의 안 함
   2: 가끔 함
   3: 보통
   4: 자주 함
   5: 매우 자주 함

Q6. 영수증 관리 경험
   답변 타입: 라디오 (Likert 5점)
   1: 전혀 못함
   2: 거의 못함
   3: 보통
   4: 어느 정도 함
   5: 매우 잘함

Q7. 현재 사용 중인 영수증 관리 방법
   답변 타입: 체크박스 (중복 선택)
   - 직접 보관 (종이)
   - 카카오톡으로 전송
   - 엑셀/스프레드시트
   - 가계부 앱
   - 기타: ________
```

### 작성 양식
```html
<form id="basicInfo">
  <h2>사용자 정보</h2>
  <p>간단한 설문입니다. 약 5분이 소요됩니다.</p>
  
  <label for="name">이름 (선택):</label>
  <input type="text" id="name" placeholder="익명 가능">
  
  <label for="age">나이:</label>
  <input type="number" id="age" min="60" max="79" required>
  
  <label for="gender">성별:</label>
  <input type="radio" name="gender" value="male"> 남성
  <input type="radio" name="gender" value="female"> 여성
  <input type="radio" name="gender" value="other"> 기타
  
  <label for="os">스마트폰:</label>
  <input type="radio" name="os" value="ios"> iOS (iPhone)
  <input type="radio" name="os" value="android"> Android
  
  <label for="experience">스마트폰 사용 경험:</label>
  <div>
    <label><input type="radio" name="experience" value="1"> 1: 거의 안함</label>
    <label><input type="radio" name="experience" value="2"> 2: 가끔</label>
    <label><input type="radio" name="experience" value="3"> 3: 보통</label>
    <label><input type="radio" name="experience" value="4"> 4: 자주</label>
    <label><input type="radio" name="experience" value="5"> 5: 매우 자주</label>
  </div>
  
  <button type="submit">계속</button>
</form>
```

---

## 📋 설문지 2: 사용성 평가 (테스트 후)

### Likert 5점 척도 설문

```
Q1. 앱 사용이 얼마나 쉬웠나요?
   1: 매우 어렵다 (거의 불가능)
   2: 어렵다 (도움이 필요)
   3: 보통 (어느 정도 가능)
   4: 쉽다 (쉽게 가능)
   5: 매우 쉽다 (매우 직관적)
   
   평가 기준:
   - 앱 설치 난이도
   - 처음 시작 이해도
   - 버튼 찾기 쉬움
   - 전체 흐름 명확함

Q2. 자동 인식 기능의 정확도는?
   1: 거의 틀렸다 (0-20% 정확)
   2: 종종 틀렸다 (20-40% 정확)
   3: 보통 (40-60% 정확)
   4: 자주 맞혔다 (60-80% 정확)
   5: 항상 맞혔다 (80-100% 정확)
   
   평가 항목:
   - 금액 추출 정확도
   - 상호 추출 정확도
   - 전체 완성도

Q3. 음성 알림이 도움이 되었나요?
   1: 방해만 됨 (싫고 방해)
   2: 거의 도움 안됨 (불필요)
   3: 보통 (있어도 없어도)
   4: 도움됨 (유용함)
   5: 매우 유용함 (없으면 안됨)
   
   평가 항목:
   - 완료 피드백 명확함
   - 음질 만족도
   - 속도 적절함
   - 한국어 발음 자연스러움

Q4. 분석 정보가 유용했나요?
   1: 쓸모없음 (필요 없음)
   2: 거의 도움 안됨 (관심 없음)
   3: 보통 (참고할 만함)
   4: 유용함 (도움됨)
   5: 매우 유용함 (매우 필요)
   
   평가 항목:
   - 월별 통계 이해도
   - 상점별 분석 유용성
   - 차트 가독성
   - 인사이트 도움 정도

Q5. 응답 속도는 만족스러웠나요?
   1: 매우 느림 (5초 이상)
   2: 느림 (3-5초)
   3: 보통 (2-3초)
   4: 빠름 (1-2초)
   5: 매우 빠름 (1초 이내)
   
   평가 항목:
   - 앱 로딩 시간
   - 사진 처리 시간
   - 업로드 시간
   - 전체 반응성

Q6. **전체적으로 만족하시나요?** (가장 중요)
   1: 매우 불만족 (다시 쓸 수 없음)
   2: 불만족 (계속 쓰기 어려움)
   3: 보통 (개선 필요)
   4: 만족 (계속 쓸 수 있음)
   5: 매우 만족 (강력 추천)
   
   목표: ≥ 4점 (80% 이상이 4-5점)
```

### 작성 양식 (HTML)
```html
<form id="usabilityEvaluation">
  <h2>사용성 평가</h2>
  <p>다음 각 항목에 대해 1-5점으로 평가해 주세요.</p>
  <p style="color: red;">* 표시는 필수 항목입니다.</p>
  
  <div class="question">
    <label>Q1. 앱 사용이 얼마나 쉬웠나요? *</label>
    <div class="rating">
      <label><input type="radio" name="q1" value="1" required> 1: 매우 어렵다</label>
      <label><input type="radio" name="q1" value="2"> 2: 어렵다</label>
      <label><input type="radio" name="q1" value="3"> 3: 보통</label>
      <label><input type="radio" name="q1" value="4"> 4: 쉽다</label>
      <label><input type="radio" name="q1" value="5"> 5: 매우 쉽다</label>
    </div>
  </div>
  
  <div class="question">
    <label>Q2. 자동 인식 기능의 정확도는? *</label>
    <div class="rating">
      <label><input type="radio" name="q2" value="1" required> 1: 거의 틀렸다</label>
      <label><input type="radio" name="q2" value="2"> 2: 종종 틀렸다</label>
      <label><input type="radio" name="q2" value="3"> 3: 보통</label>
      <label><input type="radio" name="q2" value="4"> 4: 자주 맞혔다</label>
      <label><input type="radio" name="q2" value="5"> 5: 항상 맞혔다</label>
    </div>
  </div>
  
  <div class="question">
    <label>Q3. 음성 알림이 도움이 되었나요? *</label>
    <div class="rating">
      <label><input type="radio" name="q3" value="1" required> 1: 방해만 됨</label>
      <label><input type="radio" name="q3" value="2"> 2: 거의 도움 안됨</label>
      <label><input type="radio" name="q3" value="3"> 3: 보통</label>
      <label><input type="radio" name="q3" value="4"> 4: 도움됨</label>
      <label><input type="radio" name="q3" value="5"> 5: 매우 유용함</label>
    </div>
  </div>
  
  <div class="question">
    <label>Q4. 분석 정보가 유용했나요? *</label>
    <div class="rating">
      <label><input type="radio" name="q4" value="1" required> 1: 쓸모없음</label>
      <label><input type="radio" name="q4" value="2"> 2: 거의 도움 안됨</label>
      <label><input type="radio" name="q4" value="3"> 3: 보통</label>
      <label><input type="radio" name="q4" value="4"> 4: 유용함</label>
      <label><input type="radio" name="q4" value="5"> 5: 매우 유용함</label>
    </div>
  </div>
  
  <div class="question">
    <label>Q5. 응답 속도는 만족스러웠나요? *</label>
    <div class="rating">
      <label><input type="radio" name="q5" value="1" required> 1: 매우 느림</label>
      <label><input type="radio" name="q5" value="2"> 2: 느림</label>
      <label><input type="radio" name="q5" value="3"> 3: 보통</label>
      <label><input type="radio" name="q5" value="4"> 4: 빠름</label>
      <label><input type="radio" name="q5" value="5"> 5: 매우 빠름</label>
    </div>
  </div>
  
  <div class="question">
    <label>Q6. **전체적으로 만족하시나요?** *</label>
    <div class="rating">
      <label><input type="radio" name="q6" value="1" required> 1: 매우 불만족</label>
      <label><input type="radio" name="q6" value="2"> 2: 불만족</label>
      <label><input type="radio" name="q6" value="3"> 3: 보통</label>
      <label><input type="radio" name="q6" value="4"> 4: 만족</label>
      <label><input type="radio" name="q6" value="5"> 5: 매우 만족</label>
    </div>
  </div>
  
  <button type="submit">다음</button>
</form>
```

---

## 📋 설문지 3: 개방형 질문 (테스트 후)

### 질문 항목

```
Q1. 가장 좋았던 기능은 무엇이었나요?
   답변 타입: 텍스트 (자유로운 답변)
   힌트: "예: 자동 인식, 음성 알림, 분석 기능 등"
   예상 답변: 1-3개 문장

Q2. 가장 불편했던 부분은 무엇이었나요?
   답변 타입: 텍스트 (자유로운 답변)
   힌트: "예: 버튼이 작아요, 설명이 부족해요 등"
   예상 답변: 1-3개 문장

Q3. 개선되었으면 좋을 기능은?
   답변 타입: 텍스트 (자유로운 답변)
   힌트: "예: OO 기능 추가, XX 기능 간편화 등"
   예상 답변: 0-2개 문장

Q4. 추가 의견이 있으신가요?
   답변 타입: 텍스트 (자유로운 답변)
   예상 답변: 0-2개 문장

Q5. 이 앱을 다른 분들께 추천하시겠어요?
   답변 타입: 라디오 (Yes/No/Maybe)
   - 예, 강력 추천합니다
   - 네, 추천합니다
   - 잘 모르겠습니다
   - 아니요, 추천하지 않습니다
   
   후속 질문: "왜 그렇게 생각하세요?" (자유 텍스트)
```

### 작성 양식
```html
<form id="openEndedQuestions">
  <h2>개방형 질문</h2>
  <p>자유롭게 의견을 남겨주세요. 답변 불필요 항목도 있습니다.</p>
  
  <div class="question">
    <label for="q1">Q1. 가장 좋았던 기능은 무엇이었나요?</label>
    <textarea id="q1" name="q1" rows="3" 
              placeholder="예: 자동 인식, 음성 알림 등"></textarea>
  </div>
  
  <div class="question">
    <label for="q2">Q2. 가장 불편했던 부분은 무엇이었나요? *</label>
    <textarea id="q2" name="q2" rows="3" required
              placeholder="예: 버튼이 작다, 설명이 부족하다 등"></textarea>
  </div>
  
  <div class="question">
    <label for="q3">Q3. 개선되었으면 좋을 기능은?</label>
    <textarea id="q3" name="q3" rows="3" 
              placeholder="예: XX 기능 추가, OO 간편화 등"></textarea>
  </div>
  
  <div class="question">
    <label for="q4">Q4. 추가 의견이 있으신가요?</label>
    <textarea id="q4" name="q4" rows="3" 
              placeholder="자유로운 의견"></textarea>
  </div>
  
  <div class="question">
    <label>Q5. 이 앱을 다른 분들께 추천하시겠어요? *</label>
    <div>
      <label><input type="radio" name="q5" value="strong_yes" required> 예, 강력 추천</label>
      <label><input type="radio" name="q5" value="yes"> 네, 추천</label>
      <label><input type="radio" name="q5" value="maybe"> 잘 모르겠어요</label>
      <label><input type="radio" name="q5" value="no"> 아니요</label>
    </div>
    
    <label for="q5_reason">왜 그렇게 생각하세요? *</label>
    <textarea id="q5_reason" name="q5_reason" rows="3" required
              placeholder="이유를 간단히 적어주세요"></textarea>
  </div>
  
  <button type="submit">완료</button>
</form>
```

---

## 🔍 자동 로그 수집 스크립트

### 목적
```
자동으로 수집할 성능 데이터:
  1. 앱 로딩 시간 (밀리초)
  2. OCR 처리 시간
  3. API 응답 시간
  4. 오류 발생 로그
  5. 네트워크 상태 변화
  6. 사용자 행동 (터치, 클릭 패턴)
```

### 로그 수집 함수 (JavaScript)
```javascript
/**
 * 성능 로그 수집
 */
class TestLogger {
  constructor() {
    this.logs = [];
    this.startTime = performance.now();
  }

  /**
   * 앱 로딩 시간 기록
   */
  recordAppLoad() {
    const loadTime = performance.now() - this.startTime;
    this.logs.push({
      timestamp: new Date().toISOString(),
      event: 'app_load',
      duration_ms: Math.round(loadTime),
      status: loadTime < 3000 ? 'success' : 'slow'
    });
    console.log(`✅ 앱 로딩: ${Math.round(loadTime)}ms`);
  }

  /**
   * OCR 처리 시간 기록
   */
  recordOcrProcessing(startTime, imageName) {
    const duration = performance.now() - startTime;
    this.logs.push({
      timestamp: new Date().toISOString(),
      event: 'ocr_processing',
      image: imageName,
      duration_ms: Math.round(duration),
      status: duration < 5000 ? 'success' : 'slow'
    });
    console.log(`📸 OCR 처리: ${Math.round(duration)}ms`);
  }

  /**
   * API 응답 시간 기록
   */
  recordApiCall(endpoint, startTime, status) {
    const duration = performance.now() - startTime;
    this.logs.push({
      timestamp: new Date().toISOString(),
      event: 'api_call',
      endpoint: endpoint,
      duration_ms: Math.round(duration),
      http_status: status,
      status: (status === 200 && duration < 2000) ? 'success' : 'error'
    });
    console.log(`🌐 API [${endpoint}]: ${Math.round(duration)}ms (${status})`);
  }

  /**
   * 오류 기록
   */
  recordError(errorType, message) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      event: 'error',
      error_type: errorType,
      message: message,
      severity: this.getSeverity(errorType)
    });
    console.error(`❌ 오류: [${errorType}] ${message}`);
  }

  /**
   * 네트워크 상태 변화 기록
   */
  recordNetworkChange(status) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      event: 'network_change',
      status: status // 'online' | 'offline'
    });
    console.log(`📡 네트워크: ${status}`);
  }

  /**
   * 사용자 행동 기록
   */
  recordUserAction(action, target) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      event: 'user_action',
      action: action, // 'click', 'tap', 'scroll'
      target: target
    });
  }

  /**
   * 모든 로그 반환
   */
  getLogs() {
    return {
      total_entries: this.logs.length,
      duration_ms: performance.now() - this.startTime,
      logs: this.logs
    };
  }

  /**
   * 로그를 JSON으로 내보내기
   */
  exportJSON() {
    const data = JSON.stringify(this.getLogs(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test-logs-${new Date().toISOString()}.json`;
    link.click();
  }

  /**
   * 로그를 CSV로 내보내기
   */
  exportCSV() {
    let csv = 'Timestamp,Event,Duration(ms),Status,Details\n';
    for (const log of this.logs) {
      const details = JSON.stringify(log).replace(/"/g, '""');
      csv += `"${log.timestamp}","${log.event}","${log.duration_ms || ''}","${log.status || ''}","${details}"\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test-logs-${new Date().toISOString()}.csv`;
    link.click();
  }

  /**
   * 오류 심각도 판단
   */
  getSeverity(errorType) {
    const severityMap = {
      'camera_error': 'high',
      'network_error': 'medium',
      'permission_denied': 'high',
      'storage_error': 'high',
      'api_error': 'medium',
      'ocr_failure': 'medium',
      'ui_error': 'low'
    };
    return severityMap[errorType] || 'unknown';
  }
}

// 글로벌 로거 인스턴스
const testLogger = new TestLogger();
```

### 사용 예시
```javascript
// 앱 로딩
testLogger.recordAppLoad();

// OCR 처리
const ocrStart = performance.now();
// ... OCR 처리 ...
testLogger.recordOcrProcessing(ocrStart, 'receipt_001.jpg');

// API 호출
const apiStart = performance.now();
const response = await fetch('/api/upload-metadata');
testLogger.recordApiCall('/api/upload-metadata', apiStart, response.status);

// 오류 발생
try {
  // ... 처리 ...
} catch (error) {
  testLogger.recordError('network_error', error.message);
}

// 네트워크 상태 변화
window.addEventListener('online', () => {
  testLogger.recordNetworkChange('online');
});

// 로그 내보내기
testLogger.exportJSON();
testLogger.exportCSV();
```

---

## 📊 데이터 분석 템플릿

### 설문 결과 분석
```javascript
/**
 * 설문 결과 분석
 */
function analyzeSurveyResults(responses) {
  const analysis = {
    total_responses: responses.length,
    satisfaction: {
      average: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      success_rate: 0 // ≥4점 비율
    },
    ocr_accuracy: {
      average: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    },
    demographics: {
      age_range: '60-70',
      ios_count: 0,
      android_count: 0,
      average_experience: 0
    },
    errors: [],
    recommendations: []
  };

  // Q6 만족도 계산
  let satisfactionSum = 0;
  for (const response of responses) {
    const q6_score = parseInt(response.q6);
    satisfactionSum += q6_score;
    analysis.satisfaction.distribution[q6_score]++;
    
    if (q6_score >= 4) {
      analysis.satisfaction.success_rate++;
    }
  }
  
  analysis.satisfaction.average = (satisfactionSum / responses.length).toFixed(2);
  analysis.satisfaction.success_rate = 
    ((analysis.satisfaction.success_rate / responses.length) * 100).toFixed(1);

  // 결론
  const satisfactionAvg = parseFloat(analysis.satisfaction.average);
  if (satisfactionAvg >= 4.0) {
    analysis.verdict = '✅ PASS - 사용자 만족도 ≥ 80% 달성';
  } else if (satisfactionAvg >= 3.5) {
    analysis.verdict = '⚠️ WARNING - 만족도 높지만 개선 필요';
  } else {
    analysis.verdict = '❌ FAIL - 사용자 만족도 미달';
  }

  return analysis;
}

// 사용 예시
const results = await fetchSurveyResults();
const analysis = analyzeSurveyResults(results);
console.log(analysis);
```

---

## 📱 결과 리포트 템플릿

### Day 43 테스트 완료 후 리포트 예시
```markdown
# Day 43 기본 사용 흐름 테스트 결과

## 📊 요약
- 참여자: 10명
- 완료율: 100%
- 오류 발생: 0건
- 평균 만족도: 4.2/5.0

## 📈 상세 결과

### 설문 결과
- Q1 (사용 난이도): 평균 4.1점
  - 5점: 7명, 4점: 3명
  
- Q6 (전체 만족도): 평균 4.2점
  - 5점: 6명, 4점: 4명
  - **성공률: 100% (10/10 = 4점 이상)**

### 성능 지표
- 앱 로딩: 평균 1.8초 (목표 < 3초) ✅
- OCR 처리: 평균 3.2초 (목표 < 5초) ✅
- API 응답: 평균 1.1초 (목표 < 2초) ✅

### 오류 발생
- 없음 ✅

### 주요 피드백
**좋은 점:**
- "자동으로 인식되니까 편하다"
- "음성으로 알려줘서 좋다"
- "버튼이 크고 쉽다"

**개선 요청:**
- "화면이 조금 복잡해 보인다" (1명)
- "글씨가 더 크면 좋겠다" (2명)

## 🎯 결론
**Day 43 PASS** ✅
- 기본 사용 흐름 테스트 성공
- 사용자 만족도 ≥ 80% 달성
- 모든 성능 지표 목표 달성

## ➡️ 다음 단계
- Day 44-46: 네트워크 안정성 테스트
```

---

**상태**: 🟢 피드백 수집 도구 준비 완료  
**다음**: Day 43 기본 사용 흐름 테스트 실행
