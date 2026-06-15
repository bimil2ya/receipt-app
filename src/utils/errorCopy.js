const FAILURE_HINTS = [
  {
    test: /(failed to fetch|network|connection|offline|timeout|request aborted)/i,
    hint: '네트워크를 확인한 뒤 잠시 후 다시 시도하세요.',
  },
  {
    test: /(401|403|unauthorized|forbidden|jwt|token|api key|auth)/i,
    hint: '설정에서 연결 정보를 다시 확인하세요.',
  },
  {
    test: /(404|not found)/i,
    hint: '대상 경로나 데이터가 맞는지 확인하세요.',
  },
  {
    test: /(400|bad request|payload|invalid|parse)/i,
    hint: '입력값과 형식을 다시 확인하세요.',
  },
];

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeErrorMessage(error, fallback = '알 수 없는 오류') {
  const raw =
    typeof error === 'string'
      ? error
      : error?.message || error?.error || error?.detail || fallback;
  const text = compactText(raw || fallback);
  return text.length > 96 ? `${text.slice(0, 95)}…` : text;
}

export function getFailureHint(errorMessage) {
  const text = compactText(errorMessage);
  const match = FAILURE_HINTS.find(item => item.test.test(text));
  return match?.hint || '문제가 계속되면 설정을 다시 확인하세요.';
}

export function formatFailureMessage(subject, error, fallback = '알 수 없는 오류') {
  const reason = normalizeErrorMessage(error, fallback);
  const hint = getFailureHint(reason);
  return `${subject}: ${reason} · ${hint}`;
}

export function formatFailureDetail(error, fallback = '알 수 없는 오류') {
  const reason = normalizeErrorMessage(error, fallback);
  const hint = getFailureHint(reason);
  return `${reason} · ${hint}`;
}
