import { normalizeErrorMessage } from './errorCopy';

const FAILURE_BUCKETS = [
  {
    label: '네트워크',
    test: /(failed to fetch|network|offline|timeout|request aborted|connection)/i,
    hint: '네트워크를 확인한 뒤 다시 시도하세요.',
  },
  {
    label: '인증',
    test: /(401|403|unauthorized|forbidden|jwt|token|api key|auth)/i,
    hint: '설정에서 연결 정보를 다시 확인하세요.',
  },
  {
    label: '입력',
    test: /(400|bad request|payload|invalid|parse)/i,
    hint: '입력값과 형식을 다시 확인하세요.',
  },
  {
    label: '데이터',
    test: /(404|not found|missing|undefined|null|blob)/i,
    hint: '대상 데이터가 있는지 확인하세요.',
  },
];

function classifyFailure(text) {
  const value = normalizeErrorMessage(text, '').toLowerCase();
  const bucket = FAILURE_BUCKETS.find(item => item.test.test(value));
  return bucket || { label: '기타', hint: '문제가 계속되면 설정을 다시 확인하세요.' };
}

export function summarizeSyncFailureReasons(events = [], limit = 4) {
  const counts = new Map();
  for (const event of events || []) {
    if (event?.status !== 'error') continue;
    const source = `${event?.title || ''} ${event?.detail || ''}`.trim();
    const bucket = classifyFailure(source);
    const prev = counts.get(bucket.label) || { label: bucket.label, count: 0, hint: bucket.hint };
    prev.count += 1;
    counts.set(bucket.label, prev);
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'))
    .slice(0, limit);
}

export function getSyncFailureHint(value) {
  return classifyFailure(value).hint;
}
