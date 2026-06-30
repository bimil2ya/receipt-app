import { describe, expect, it } from 'vitest';
import { buildUploadContext, sanitizeUploadPart } from './useDriveUpload';

describe('drive upload helpers', () => {
  it('builds the upload context from selected team and dates', () => {
    expect(buildUploadContext({
      selectedTeam: { id: 7, names: 'A조, B조' },
      canonicalNames: 'A조, B조',
      tripStartDate: '2026-06-01',
      tripEndDate: '2026-06-03',
    })).toEqual({
      surveyorName: 'A조, B조',
      uploadContext: {
        teamId: 7,
        teamNames: 'A조, B조',
        tripStartDate: '2026-06-01',
        tripEndDate: '2026-06-03',
      },
    });
  });

  it('falls back to neutral values when team or names are missing', () => {
    expect(buildUploadContext({
      selectedTeam: null,
      canonicalNames: '',
      tripStartDate: '2026-06-01',
      tripEndDate: '',
    })).toEqual({
      surveyorName: '미설정',
      uploadContext: {
        teamId: null,
        teamNames: '',
        tripStartDate: '2026-06-01',
        tripEndDate: '2026-06-01',
      },
    });
  });

  it('sanitizes filename parts for drive upload images', () => {
    expect(sanitizeUploadPart('2026/06:01*영수증?')).toBe('2026_06_01_영수증_');
  });
});
