# Claude 작업 지침 — receipt-app

## 코드 수정 시 회귀 오류 방지 규칙

### 1. 수정 범위 추적 & 배포 전 테스트

코드를 변경할 때마다 "이 변경이 영향을 미치는 UI 경로"를 파악하고,
배포 전에 해당 경로를 하나씩 직접 확인한다.

특히 여러 파일을 동시에 수정하는 대규모 변경일수록 전수 테스트가 중요하다.
(예: window.confirm → ConfirmModal 교체 시, 새로 시작 버튼·드라이브 업로드·초기화 등 모든 확인창 경로를 배포 전에 탭해서 확인해야 한다.)

### 2. 모달 안 모달(ConfirmModal) 렌더 순서 규칙

Modal 컴포넌트는 z-50을 사용한다.
같은 z-index일 때 DOM 순서가 늦은 요소가 위에 표시된다.

**반드시 이 순서를 지킨다:**

```jsx
// ✅ 올바른 순서 — ConfirmModal이 부모 Modal 위에 표시됨
return (
  <>
    <Modal ...>
      ...
    </Modal>
    <ConfirmModal {...confirmModalProps} />
  </>
);

// ❌ 잘못된 순서 — ConfirmModal이 부모 Modal 뒤에 가려짐
return (
  <>
    <ConfirmModal {...confirmModalProps} />
    <Modal ...>
      ...
    </Modal>
  </>
);
```

### 3. 신중하게 진행해야 하는 상황

아래 상황에서는 특히 주변 코드를 살펴보고 천천히 진행한다:

- 여러 파일을 동시에 수정할 때
- 기존 컴포넌트에 새로운 overlay/modal을 추가할 때
- hook의 파라미터나 반환값을 변경할 때
- prop 이름을 변경하거나 제거할 때

### 4. 환경변수 명명 규칙

- `VITE_` 접두사는 Vite 빌드 번들에 포함될 수 있으므로 서버 전용 시크릿에는 절대 사용하지 않는다.
- 서버 전용 환경변수: `ADMIN_PIN`, `UPLOAD_API_TOKEN`, `ANTHROPIC_API_KEY` 등 접두사 없이 사용.
- 프론트엔드 공개 값만: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등.

### 5. 배포 절차 (안전한 배포 시스템)

**반드시 이 순서를 따른다:**

```bash
# 1단계: 로컬 검증
npm run build    # 빌드 에러 확인
npm run lint     # 코드 문법 검사

# 2단계: 환경변수 검증 + Vercel 배포
npm run deploy:prod
```

**배포 완료 후 확인:**

```bash
# Health check로 배포 성공 여부 확인
curl https://receipt-app-rho.vercel.app/api/health
```

응답 예시:
```json
{
  "status": "ok",
  "environment": "production",
  "hasApiKey": true,
  "message": "✅ 배포 정상"
}
```

**주의:**
- `npm run deploy:prod`는 자동으로 환경변수를 검증한 후 배포한다
- `--force` 플래그를 사용하므로 Vercel의 캐시를 무시하고 강제 배포된다
- 빌드 에러가 있으면 배포하지 않는다
