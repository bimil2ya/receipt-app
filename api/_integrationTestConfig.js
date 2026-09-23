export function requireIntegrationFolderId({ integrationFolderId, mainFolderId }) {
  const folderId = String(integrationFolderId || '').trim();
  if (!folderId) {
    throw new Error('GDRIVE_INTEGRATION_FOLDER_ID가 필요합니다. 운영 Drive와 분리된 테스트 전용 폴더를 지정하세요.');
  }
  if (folderId === String(mainFolderId || '').trim()) {
    throw new Error('GDRIVE_INTEGRATION_FOLDER_ID는 GDRIVE_MAIN_FOLDER_ID와 달라야 합니다.');
  }
  return folderId;
}
