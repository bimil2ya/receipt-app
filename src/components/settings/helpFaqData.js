export const helpIntro = {
  id: 'getting-started',
  title: '처음에는 무엇부터 하나요?',
  keywords: ['처음', '시작', '첫사용', '등록'],
  answer: [
    '설정에서 내 조를 먼저 고르세요.',
    '아래 영수증 입력에서 사진을 찍으세요.',
    '출장이 끝나면 3 마감에서 Drive 저장을 누르세요.',
  ],
};

export const helpShortcuts = [
  {
    label: '처음 사용',
    target: { type: 'intro' },
  },
  {
    label: '영수증 찍기',
    target: { type: 'question', categoryId: 'capture', questionId: 'where-to-capture' },
  },
  {
    label: '금액 수정',
    target: { type: 'question', categoryId: 'edit', questionId: 'amount-wrong' },
  },
  {
    label: '구글 저장',
    target: { type: 'question', categoryId: 'drive', questionId: 'upload-how' },
  },
  {
    label: '새 출장 시작',
    target: { type: 'question', categoryId: 'settings', questionId: 'new-trip-start' },
  },
];

export const helpCategories = [
  {
    id: 'capture',
    icon: '📷',
    title: '영수증 찍기',
    questions: [
      {
        id: 'where-to-capture',
        question: '영수증은 어디서 찍나요?',
        keywords: ['카메라', '찍기', '촬영', '입력'],
        answer: [
          '아래 탭에서 영수증 입력을 누르세요.',
          '화면 아래 카메라 버튼을 누르세요.',
          '영수증이 화면 안에 들어오게 하고 찍으세요.',
        ],
      },
      {
        id: 'blurry-photo',
        question: '사진이 흐리게 찍혔어요',
        keywords: ['흐림', '흔들림', '초점', '안보임'],
        answer: [
          '영수증을 평평한 곳에 놓으세요.',
          '카메라를 영수증에서 20cm에서 30cm 떨어뜨리세요.',
          '흔들리지 않게 두 손으로 잡고 찍으세요.',
          '빛이 너무 강하거나 어두우면 다른 곳에서 찍어보세요.',
        ],
      },
      {
        id: 'auto-read-failed',
        question: '자동으로 금액이 읽히지 않아요',
        keywords: ['자동읽기', '금액읽기', '인식', '숫자'],
        answer: [
          '사진이 잘 안 보이면 자동 읽기가 실패할 수 있어요.',
          '숫자가 잘 보이게 다시 찍어보세요.',
          '그래도 안 되면 연필 버튼으로 나중에 직접 고치세요.',
        ],
      },
      {
        id: 'no-receipt',
        question: '영수증이 없어요, 카드 문자로 대신하고 싶어요',
        keywords: ['카드문자', '문자', '캡처', '대신'],
        answer: [
          '카드 결제 문자 화면을 캡처해서 대신 쓸 수 있어요.',
          '카메라 버튼 옆 사진 버튼을 누르세요.',
          '저장된 캡처 화면을 선택하세요.',
        ],
      },
    ],
  },
  {
    id: 'edit',
    icon: '✏️',
    title: '내용 수정하기',
    questions: [
      {
        id: 'date-wrong',
        question: '날짜가 잘못 읽혔어요',
        keywords: ['날짜수정', '날짜', '오류'],
        answer: [
          '목록에서 해당 영수증 오른쪽의 연필 버튼을 누르세요.',
          '날짜 칸을 찾아 수정하세요.',
          '수정 후 저장 버튼을 누르세요.',
        ],
      },
      {
        id: 'amount-wrong',
        question: '금액이 틀렸어요',
        keywords: ['돈', '가격', '숫자', '원'],
        answer: [
          '해당 영수증 오른쪽의 연필 버튼을 누르세요.',
          '금액 칸을 찾아 숫자를 수정하세요.',
          '쉼표 없이 숫자만 입력하세요. 예: 35000',
          '저장 버튼을 누르세요.',
        ],
      },
      {
        id: 'purpose-wrong',
        question: '용도(숙박비, 식비 등)를 바꾸고 싶어요',
        keywords: ['용도', '분류', '숙박비', '식비', '기타'],
        answer: [
          '해당 영수증 오른쪽의 연필 버튼을 누르세요.',
          '용도 칸을 찾아 다른 항목으로 바꾸세요.',
          '저장 버튼을 누르세요.',
        ],
      },
      {
        id: 'delete-receipt',
        question: '잘못 입력한 영수증을 지우고 싶어요',
        keywords: ['삭제', '지우기', '휴지통'],
        answer: [
          '해당 영수증 오른쪽의 휴지통 버튼을 누르세요.',
          '확인 창이 나오면 삭제를 누르세요.',
        ],
      },
    ],
  },
  {
    id: 'kakao',
    icon: '💬',
    title: '카톡으로 보내기',
    questions: [
      {
        id: 'kakao-how',
        question: '집계 내역을 카톡으로 어떻게 보내나요?',
        keywords: ['카톡', '보내기', '공유'],
        answer: [
          '위쪽 집계 탭을 누르세요.',
          '📸 이미지 저장 버튼을 누르세요.',
          '공유 화면에서 카카오톡을 고르세요.',
          '공유 화면이 안 뜨면 저장된 이미지를 카카오톡에서 직접 첨부하세요.',
        ],
      },
      {
        id: 'kakao-not-open',
        question: '공유하기를 눌렀는데 카카오톡이 안 열려요',
        keywords: ['카카오톡', '안열림', '공유오류'],
        answer: [
          '폰에 카카오톡이 설치되어 있는지 확인하세요.',
          '카카오톡 앱을 먼저 열었다가 다시 시도해보세요.',
          '그래도 안 되면 저장된 이미지를 카카오톡에서 직접 첨부하세요.',
        ],
      },
      {
        id: 'kakao-what-sent',
        question: '어떤 내용이 전송되나요?',
        keywords: ['무엇', '내용', '전송', '이미지'],
        answer: [
          '집계 탭에서 보고 있는 화면(용도별 또는 일자별)이 한 장 이미지로 만들어집니다.',
          '카카오톡으로 그 이미지가 전송됩니다.',
        ],
      },
    ],
  },
  {
    id: 'drive',
    icon: '☁️',
    title: '구글에 저장하기',
    questions: [
      {
        id: 'why-drive',
        question: '구글 저장은 왜 하나요?',
        keywords: ['구글드라이브', '보관', '백업', '저장'],
        answer: [
          '찍은 영수증 사진을 회사 구글 드라이브에 보관합니다.',
          '나중에 관리자가 다시 확인할 수 있어요.',
        ],
      },
      {
        id: 'upload-how',
        question: '구글 저장은 어떻게 하나요?',
        keywords: ['업로드', '전송', '저장하기'],
        answer: [
          '목록 화면에서 3 마감을 누르세요.',
          'Drive 저장 버튼을 누르세요.',
          '영수증 수에 따라 1분에서 3분 정도 걸릴 수 있어요.',
        ],
      },
      {
        id: 'upload-close',
        question: '저장 중에 앱을 닫으면 어떻게 되나요?',
        keywords: ['중단', '닫기', '실패'],
        answer: [
          '저장이 중단됩니다.',
          '다시 앱을 열고 구글 업로드를 다시 누르세요.',
          '이미 보낸 것은 중복되지 않아요.',
        ],
      },
      {
        id: 'upload-failed',
        question: '저장이 실패했다고 나와요',
        keywords: ['오류', '와이파이', '인터넷'],
        answer: [
          '인터넷이 연결되어 있는지 확인하세요.',
          '와이파이가 있는 곳에서 다시 시도해보세요.',
          '실패한 것만 다시 보내기 버튼을 누르면 됩니다.',
        ],
      },
    ],
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: '설정 / 내 조 변경',
    questions: [
      {
        id: 'team-change',
        question: '내 조는 어떻게 바꾸나요?',
        keywords: ['조변경', '이름변경', '설정'],
        answer: [
          '오른쪽 위 설정 버튼을 누르세요.',
          '내 조 선택을 누르세요.',
          '목록에서 내 이름이 있는 조를 누르세요.',
        ],
      },
      {
        id: 'name-missing',
        question: '내 이름이 목록에 없어요',
        keywords: ['없음', '명단', '추가'],
        answer: [
          '관리자에게 연락하세요.',
          '관리자가 조 명단을 수정해줄 수 있어요.',
        ],
      },
      {
        id: 'trip-date',
        question: '출장 시작일을 바꾸고 싶어요',
        keywords: ['기간', '날짜변경', '시작일'],
        answer: [
          '설정 버튼을 누르세요.',
          '출장 기간을 누르세요.',
          '날짜를 다시 선택하세요.',
        ],
      },
      {
        id: 'new-trip-start',
        question: '새 출장을 시작하고 기존 영수증을 비우고 싶어요',
        keywords: ['새출장', '새출발', '새로시작', '영수증삭제', '영수증비우기', '예산설정'],
        answer: [
          '새 출장을 시작하면 지금 기기에 남아 있는 영수증 목록이 비워집니다.',
          '이전 출장 정산이 끝났는지 먼저 확인하세요.',
          '아래 탭에서 예산을 누르세요.',
          '예산 설정 화면에서 출장 시작일과 종료일을 고르세요.',
          '계산된 예산 금액을 누르거나, 예산 직접 입력 칸에 금액을 적으세요.',
          '화면 아래로 끝까지 내려가세요.',
          '맨 아래의 새 출장 시작 부분은 실수로 누르지 않도록 접혀 있습니다.',
          '새 출장 시작 줄의 펼치기를 누르세요.',
          '빨간 새로 시작 버튼이 보이면 누르세요.',
          '확인 창이 한 번 더 나오면 내용을 읽고, 맞을 때만 확인을 누르세요.',
        ],
      },
      {
        id: 'budget-date-range',
        question: '예산 설정에서 출장 기간은 어떻게 고르나요?',
        keywords: ['예산', '기간설정', '시작일', '종료일', '달력', '날짜선택'],
        answer: [
          '예산은 출장 시작일과 종료일을 기준으로 계산됩니다.',
          '먼저 달력에서 출장 첫날을 누르세요.',
          '예를 들어 6월 30일에 출발하면 6월 30일을 누르세요.',
          '화면에 종료일을 선택하라는 안내가 나오면 출장 마지막 날을 누르세요.',
          '시작일과 종료일이 같은 날이면 같은 날짜를 한 번 더 누르면 됩니다.',
          '날짜를 잘못 눌렀다면 다시 원하는 시작일을 누르고, 종료일을 다시 고르세요.',
        ],
      },
      {
        id: 'budget-next-month',
        question: '종료일이 다음 달인데 날짜가 안 보여요',
        keywords: ['다음달', '다음 달', '7월', '월넘기기', '종료일', '달력'],
        answer: [
          '시작일이 6월 30일이고 종료일이 7월이면, 먼저 6월 30일을 누르세요.',
          '7월 날짜가 보이지 않으면 달력 위쪽 오른쪽의 › 버튼을 누르세요.',
          '› 버튼을 누르면 다음 달로 넘어갑니다.',
          '화면 가운데 제목이 7월로 바뀌었는지 확인하세요.',
          '7월 달력이 보이면 출장 마지막 날짜를 누르세요.',
          '이전 달로 돌아가야 할 때는 왼쪽의 ‹ 버튼을 누르세요.',
        ],
      },
      {
        id: 'budget-save-only',
        question: '예산만 바꾸고 영수증은 그대로 두고 싶어요',
        keywords: ['예산만', '예산변경', '저장', '영수증유지'],
        answer: [
          '아래 탭에서 예산을 누르세요.',
          '출장 기간을 확인하세요.',
          '계산된 예산을 누르거나, 예산 직접 입력 칸에 금액을 적으세요.',
          '파란 저장 버튼을 누르세요.',
          '이 방법은 예산만 바꾸며, 기존 영수증은 지워지지 않습니다.',
        ],
      },
    ],
  },
  {
    id: 'issues',
    icon: '❓',
    title: '문제가 생겼어요',
    questions: [
      {
        id: 'slow-app',
        question: '앱이 느리거나 버벅여요',
        keywords: ['느림', '멈춤', '버벅임'],
        answer: [
          '앱을 완전히 종료하고 다시 열어보세요.',
          '폰을 재시작해보세요.',
          '와이파이 연결을 확인해보세요.',
        ],
      },
      {
        id: 'missing-data',
        question: '입력한 영수증이 사라졌어요',
        keywords: ['사라짐', '없어짐', '필터'],
        answer: [
          '앱을 닫아도 데이터는 폰 안에 저장됩니다.',
          '날짜 필터가 다른 기간으로 되어 있는지 확인하세요.',
          '상단의 날짜를 눌러 전체 기간으로 바꿔보세요.',
        ],
      },
      {
        id: 'white-screen',
        question: '화면이 하얗게 됩니다, 앱이 멈춰요',
        keywords: ['하얀화면', '멈춤', '흰색'],
        answer: [
          '앱을 완전히 종료하세요.',
          '다시 열어보세요.',
          '반복되면 폰의 인터넷 브라우저에서 앱 주소를 직접 열어보세요.',
        ],
      },
      {
        id: 'updated',
        question: '앱이 업데이트되었다고 합니다',
        keywords: ['업데이트', '버전'],
        answer: [
          '자동으로 최신 버전으로 바뀝니다.',
          '그냥 계속 사용하시면 됩니다.',
        ],
      },
    ],
  },
];

export function normalizeHelpQuery(value) {
  return String(value || '').trim().toLowerCase();
}

export function helpQuestionMatches(query, question) {
  if (!query) return true;
  const answerText = (question.answer || []).join(' ');
  const keywordText = (question.keywords || []).join(' ');
  return [question.question, answerText, keywordText].some(text => String(text || '').toLowerCase().includes(query));
}
