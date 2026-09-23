import { describe, expect, it } from 'vitest';
import { requireIntegrationFolderId } from '../../api/_integrationTestConfig.js';

describe('integration test Drive folder', () => {
  it('requires a dedicated integration folder', () => {
    expect(() => requireIntegrationFolderId({ integrationFolderId: '', mainFolderId: 'main' }))
      .toThrow('GDRIVE_INTEGRATION_FOLDER_ID');
  });

  it('rejects the production Drive root', () => {
    expect(() => requireIntegrationFolderId({ integrationFolderId: 'main', mainFolderId: 'main' }))
      .toThrow('GDRIVE_MAIN_FOLDER_ID');
  });

  it('returns a dedicated folder id', () => {
    expect(requireIntegrationFolderId({ integrationFolderId: 'integration', mainFolderId: 'main' }))
      .toBe('integration');
  });
});
