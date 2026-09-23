import { describe, expect, it } from 'vitest';
import { teamIncludesRegisteredUser } from './teamMembership';

describe('team membership', () => {
  it('allows a registered user only in a team roster that contains that name', () => {
    expect(teamIncludesRegisteredUser('홍길동, 강감찬', '홍길동')).toBe(true);
    expect(teamIncludesRegisteredUser('성춘향, 이몽룡', '홍길동')).toBe(false);
  });
});
