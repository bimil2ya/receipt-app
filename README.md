# 법인카드 영수증 정산 앱

(주)미래생태공간 법인카드 영수증 정산용 PWA (Progressive Web App).

## 배포 방법 (GitHub + Vercel)

### 1. 이 전체 폴더를 GitHub에 업로드
본 저장소에 모든 파일을 업로드하세요 (README.md 외 모두).

### 2. Vercel 연결
1. https://vercel.com 접속 → GitHub 계정으로 로그인
2. "Add New..." → "Project" 선택
3. 이 저장소 선택 → "Import"
4. Framework Preset: **Vite** 자동 감지됨
5. "Deploy" 클릭

약 1~2분 후 배포 URL이 나옵니다 (예: `receipt-app-abc123.vercel.app`).

### 3. 모바일에서 앱으로 설치

**갤럭시 (Chrome 또는 삼성 인터넷):**
- URL 접속 → 메뉴 → "앱 설치" 또는 "홈 화면에 추가"

**아이폰 (Safari 필수):**
- URL 접속 → 하단 공유 버튼(📤) → "홈 화면에 추가"

## 주요 기능
- 영수증 사진 업로드 시 Claude Vision으로 자동 항목 추출
- 여러 장 동시 업로드, 한 장에 여러 영수증 포함 지원
- 용도별/일자별 집계
- CSV/XLSX 다운로드
- 이미지 캡쳐 (공유 시트로 저장 위치 선택)
- 작업 저장/불러오기 (앱 내부 또는 JSON 파일)
- 오프라인 작동 (PWA)

## 기술 스택
- React 18 + Vite
- Tailwind CSS
- Claude Sonnet 4 API (Vision)
- vite-plugin-pwa
