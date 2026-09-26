export function getSaveStatusLabel(value) {
  if (value === 'saving') return ['저장 중', 'bg-blue-900/20 border-blue-800 text-blue-200'];
  if (value === 'success') return ['로컬 저장 정상', 'bg-emerald-900/20 border-emerald-800 text-emerald-200'];
  if (value === 'error') return ['로컬 저장 실패', 'bg-red-900/20 border-red-900 text-red-200'];
  return ['대기', 'bg-slate-800 border-slate-700 text-slate-200'];
}
