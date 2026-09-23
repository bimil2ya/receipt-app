import { describe, expect, it } from 'vitest';
import { filterTeamReviewRows } from './review.js';

describe('filterTeamReviewRows', () => {
  it('returns only the selected team rows that contain an office-entered record', () => {
    const reviews = filterTeamReviewRows([
      { '팀': '홍길동, 성춘향', '영수증 식별값': 'a', '검토 상태': '추가 자료 요청' },
      { '팀': '강감찬, 이몽룡', '영수증 식별값': 'b', '담당자 메모': '다른 팀 메모' },
      { '팀': '홍길동, 성춘향', '영수증 식별값': 'c' },
    ], '홍길동,성춘향');
    expect(reviews).toEqual([{ '팀': '홍길동, 성춘향', '영수증 식별값': 'a', '검토 상태': '추가 자료 요청' }]);
  });
});
