import { createDrive, driveQueryString, MAIN_FOLDER_ID } from './driveUtils.js';

const TEAMS_FILENAME = 'receipt-app-teams.json';

const FALLBACK_TEAMS = [
  { id: 1, names: '류준, 류수현' },
  { id: 2, names: '이선수, 박종일' },
  { id: 3, names: '박정환, 김금섭' },
  { id: 4, names: '오수재, 권승호' },
  { id: 5, names: '송승수, 전상현' },
  { id: 6, names: '노경호, 김영일' },
  { id: 7, names: '신상대, 함윤성' },
];

const ALLOWED_ORIGINS = [
  'https://receipt-app-rho.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function setCors(res, origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function bufferFromStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function findTeamsFile(drive) {
  const safeId = driveQueryString(MAIN_FOLDER_ID);
  const res = await drive.files.list({
    q: `'${safeId}' in parents and name = '${TEAMS_FILENAME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return (res.data.files || [])[0] || null;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const drive = createDrive();
      const file = await findTeamsFile(drive);
      if (!file) return res.json({ success: true, teams: FALLBACK_TEAMS, source: 'bundled' });

      const stream = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
      const buffer = await bufferFromStream(stream.data);
      const teams = JSON.parse(buffer.toString('utf8'));
      return res.json({ success: true, teams, source: 'drive' });
    } catch {
      return res.json({ success: true, teams: FALLBACK_TEAMS, source: 'bundled' });
    }
  }

  if (req.method === 'POST') {
    const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (UPLOAD_TOKEN && provided !== UPLOAD_TOKEN) {
      return res.status(401).json({ success: false, error: '인증 실패' });
    }

    const { teams } = req.body || {};
    if (!Array.isArray(teams) || teams.length === 0) {
      return res.status(400).json({ success: false, error: '팀 목록이 없습니다.' });
    }
    for (const t of teams) {
      if (!t.names || typeof t.names !== 'string') {
        return res.status(400).json({ success: false, error: '팀 형식 오류' });
      }
    }

    try {
      const drive = createDrive();
      const content = Buffer.from(JSON.stringify(teams, null, 2), 'utf8');
      const existing = await findTeamsFile(drive);

      if (existing) {
        await drive.files.update({
          fileId: existing.id,
          media: { mimeType: 'application/json', body: content },
        });
      } else {
        await drive.files.create({
          requestBody: {
            name: TEAMS_FILENAME,
            mimeType: 'application/json',
            parents: [MAIN_FOLDER_ID],
          },
          media: { mimeType: 'application/json', body: content },
        });
      }

      return res.json({ success: true });
    } catch (e) {
      console.error('Teams save error:', e);
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}
