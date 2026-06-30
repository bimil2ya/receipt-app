export function normalizeTeamNames(value) {
  return String(value ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .join(', ');
}
