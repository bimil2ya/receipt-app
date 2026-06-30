import { describe, it, expect } from 'vitest';
import { parseTeamsText, teamsToText } from './teamText';

describe('team text helpers', () => {
  it('parses prefixed team lines into normalized teams', () => {
    const teams = parseTeamsText('1조 류준, 류수현\n조2 이선수, 박종일\n3. 정민, 김나래');

    expect(teams).toEqual([
      { id: 1, names: '류준, 류수현' },
      { id: 2, names: '이선수, 박종일' },
      { id: 3, names: '정민, 김나래' },
    ]);
  });

  it('round-trips a team list back to text', () => {
    expect(teamsToText([{ names: '류준, 류수현' }, { names: '이선수, 박종일' }])).toBe('류준, 류수현\n이선수, 박종일');
  });
});
