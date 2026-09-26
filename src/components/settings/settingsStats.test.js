import { describe, it, expect } from 'vitest';
import { getSaveStatusLabel } from './settingsStats';

describe('getSaveStatusLabel', () => {
  it('maps each local save status to a label', () => {
    expect(getSaveStatusLabel('saving')[0]).toBe('저장 중');
    expect(getSaveStatusLabel('success')[0]).toBe('로컬 저장 정상');
    expect(getSaveStatusLabel('error')[0]).toBe('로컬 저장 실패');
    expect(getSaveStatusLabel('idle')[0]).toBe('대기');
  });
});
