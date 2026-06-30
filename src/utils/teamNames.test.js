import { describe, expect, it } from 'vitest';
import { normalizeTeamNames } from './teamNames';

describe('team names utils', () => {
  it('normalizes comma spacing', () => {
    expect(normalizeTeamNames('류준,류수현')).toBe('류준, 류수현');
    expect(normalizeTeamNames(' 류준 ,  류수현 ')).toBe('류준, 류수현');
  });
});
