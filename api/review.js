import * as XLSX from 'xlsx';
import { createDrive, driveQueryString, MAIN_FOLDER_ID, normalizeDriveName } from './driveUtils.js';
import { applyCorsHeaders, checkOriginAllowed } from './_corsNode.js';
import { jsonError, Errors } from './_errorHandler.js';

export function filterTeamReviewRows(rows, teamNames) {
  const team = normalizeDriveName(teamNames);
  return (rows || []).filter(row => normalizeDriveName(row?.['팀']) === team)
    .filter(row => ['검토 상태', '담당자 메모', '추가 자료 요청'].some(key => String(row?.[key] || '').trim()));
}

export default async function handler(req, res) {
  if (applyCorsHeaders(req, res) === true) return;
  if (!checkOriginAllowed(req, res)) return;
  if (req.method !== 'GET') return jsonError(res, Errors.methodNotAllowed());
  const reportDate = String(req.query?.reportDate || '');
  const teamNames = normalizeDriveName(req.query?.teamNames || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !teamNames) return jsonError(res, Errors.badRequest('reportDate와 teamNames가 필요합니다.'));
  const yearMonth = `${reportDate.slice(0, 4)}년 ${reportDate.slice(5, 7)}월`;
  try {
    const drive = createDrive();
    const monthResult = await drive.files.list({ q: `'${driveQueryString(MAIN_FOLDER_ID)}' in parents and name = '${driveQueryString(yearMonth)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'files(id)', pageSize: 1 });
    const month = monthResult.data.files?.[0];
    if (!month) return res.json({ success: true, reviews: [], source: 'month_not_found' });
    const aggregateName = `전체집계_${yearMonth}`;
    const fileResult = await drive.files.list({ q: `'${driveQueryString(month.id)}' in parents and name = '${driveQueryString(aggregateName)}' and trashed = false`, fields: 'files(id,mimeType,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: 1 });
    const file = fileResult.data.files?.[0];
    if (!file) return res.json({ success: true, reviews: [], source: 'review_sheet_not_found' });
    const exported = await drive.files.export({ fileId: file.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(Buffer.from(exported.data), { type: 'buffer' });
    const sheet = workbook.Sheets['검토기록'];
    const reviews = filterTeamReviewRows(sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [], teamNames);
    return res.json({ success: true, reviews, source: 'drive' });
  } catch (error) {
    console.error('review read error:', error.message);
    return jsonError(res, Errors.internalError('검토기록을 읽지 못했습니다.'));
  }
}
