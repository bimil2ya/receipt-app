const KST_TIME_ZONE = 'Asia/Seoul';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseYmd(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatYmdFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function getTodayKst(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = parts.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year}-${map.month}-${map.day}`;
}

export function getKstWeekRange(anchorDate = getTodayKst()) {
  const parsed = parseYmd(anchorDate);
  if (!parsed) {
    const today = getTodayKst();
    return { startDate: today, endDate: today };
  }

  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  const dayOfWeek = start.getUTCDay(); // 0=일, 1=월, ... 6=토
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return {
    startDate: formatYmdFromUtcDate(start),
    endDate: formatYmdFromUtcDate(end),
  };
}
