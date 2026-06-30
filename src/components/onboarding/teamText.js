import { normalizeTeamNames } from '../../utils/teamNames';

export function parseTeamsText(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const cleaned = line
        .replace(/^\d+조\s*/u, '')
        .replace(/^조\d+\s*/u, '')
        .replace(/^\d+[.:)\s]\s*/u, '')
        .trim();
      const parts = cleaned.split(/,\s*|\s{2,}/).map(n => n.trim()).filter(Boolean);
      return { id: idx + 1, names: normalizeTeamNames(parts.join(', ')) };
    })
    .filter(team => team.names.length > 0);
}

export function teamsToText(teams) {
  return (Array.isArray(teams) ? teams : [])
    .map(team => normalizeTeamNames(team.names))
    .join('\n');
}
