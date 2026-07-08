import { describe, expect, it } from 'vitest';
import { findDuplicateApprovalGroups, normalizeApprovalNum } from './approvalReportCore.js';

const accessors = {
  getApprovalNum: r => r.approvalNum,
  getAmount: r => r.amount,
  getDate: r => r.date,
};

describe('normalizeApprovalNum', () => {
  it('시각적 유사 문자를 숫자로 치환한다', () => {
    expect(normalizeApprovalNum('OoIilSsBbZz')).toBe('00111558822');
  });

  it('숫자 외 문자와 공백·하이픈을 제거한다', () => {
    expect(normalizeApprovalNum(' 0I-12 3O ')).toBe('011230');
  });

  it('null/undefined를 빈 문자열로 처리한다', () => {
    expect(normalizeApprovalNum(null)).toBe('');
    expect(normalizeApprovalNum(undefined)).toBe('');
  });
});

describe('findDuplicateApprovalGroups', () => {
  it('승인번호·날짜·금액이 모두 같으면 confirmed로 분류한다', () => {
    const items = [
      { approvalNum: '123-456', date: '2026-06-20', amount: 1000 },
      { approvalNum: '123456',  date: '2026-06-20', amount: 1000 },
    ];
    const { confirmedGroups, reviewGroups } = findDuplicateApprovalGroups(items, accessors);
    expect(confirmedGroups).toHaveLength(1);
    expect(confirmedGroups[0].count).toBe(2);
    expect(reviewGroups).toHaveLength(0);
  });

  it('같은 승인번호이나 날짜·금액이 다르면 review로 분류한다', () => {
    const items = [
      { approvalNum: '9999', date: '2026-06-20', amount: 1000 },
      { approvalNum: '9999', date: '2026-06-21', amount: 1000 },
    ];
    const { confirmedGroups, reviewGroups } = findDuplicateApprovalGroups(items, accessors);
    expect(confirmedGroups).toHaveLength(0);
    expect(reviewGroups).toHaveLength(1);
    expect(reviewGroups[0].reason).toBe('same_approval_different_date_or_amount');
  });

  it('승인번호 없는 항목은 missingApprovalCount에 집계되고 그룹에 포함되지 않는다', () => {
    const items = [
      { approvalNum: '',    date: '2026-06-20', amount: 500 },
      { approvalNum: null,  date: '2026-06-21', amount: 500 },
    ];
    const { missingApprovalCount, confirmedGroups } = findDuplicateApprovalGroups(items, accessors);
    expect(missingApprovalCount).toBe(2);
    expect(confirmedGroups).toHaveLength(0);
  });

  it('그룹 내 항목이 1개이면 중복 없음으로 처리한다', () => {
    const items = [{ approvalNum: '0001', date: '2026-06-20', amount: 100 }];
    const { confirmedGroups, reviewGroups } = findDuplicateApprovalGroups(items, accessors);
    expect(confirmedGroups).toHaveLength(0);
    expect(reviewGroups).toHaveLength(0);
  });

  it('items[]는 sampleLimit만큼 잘린다', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      approvalNum: '7777', date: '2026-06-20', amount: 1000, idx: i,
    }));
    const { confirmedGroups } = findDuplicateApprovalGroups(items, accessors, 3);
    expect(confirmedGroups[0].items).toHaveLength(3);
    expect(confirmedGroups[0].count).toBe(8);
  });
});
