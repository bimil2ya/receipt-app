import crypto from 'crypto'
import { Readable } from 'stream'
import { driveQueryString } from './driveUtils.js'

export const FINAL_IMAGE_PROPERTIES = Object.freeze({
  submissionId: 'receiptSubmissionId',
  submissionKind: 'receiptSubmissionKind',
  artifactKind: 'receiptArtifactKind',
  key: 'receiptArtifactKey',
  sha256: 'receiptContentSha256',
})

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/
const SHA_RE = /^[0-9a-f]{64}$/i
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function preflightFinalImage({ image, expected }) {
  if (!image || typeof image !== 'object' || !expected || typeof expected !== 'object') throw new TypeError('invalid final image')
  if (!SHA_RE.test(image.key || '') || image.key.toLowerCase() !== expected.key) throw new TypeError('final image key mismatch')
  if (typeof image.filename !== 'string' || image.filename.length < 1 || image.filename.length > 160 || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(image.filename)) {
    throw new TypeError('invalid final image filename')
  }
  const match = DATA_URL_RE.exec(image.dataUrl || '')
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) throw new TypeError('invalid final image data URL')
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length < 1 || buffer.length > MAX_IMAGE_BYTES || buffer.toString('base64') !== match[2]) throw new TypeError('invalid final image base64')
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  if (match[1] !== expected.mimeType || buffer.length !== expected.byteLength || sha256 !== expected.sha256) throw new TypeError('final image content mismatch')
  return {
    key: expected.key,
    sha256,
    md5: crypto.createHash('md5').update(buffer).digest('hex'),
    byteLength: buffer.length,
    mimeType: match[1],
    filename: image.filename,
    buffer,
  }
}

export function buildFinalImageAppProperties({ submissionId, evidence }) {
  return {
    [FINAL_IMAGE_PROPERTIES.submissionId]: submissionId,
    [FINAL_IMAGE_PROPERTIES.submissionKind]: 'final',
    [FINAL_IMAGE_PROPERTIES.artifactKind]: 'image',
    [FINAL_IMAGE_PROPERTIES.key]: evidence.key,
    [FINAL_IMAGE_PROPERTIES.sha256]: evidence.sha256,
  }
}

function isVerifiedImage(file, { originalsId, submissionId, evidence }) {
  const props = file?.appProperties || {}
  return file?.trashed === false
    && file?.mimeType === evidence.mimeType
    && Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === originalsId
    && Number(file.size) === evidence.byteLength
    && file.md5Checksum === evidence.md5
    && props[FINAL_IMAGE_PROPERTIES.submissionId] === submissionId
    && props[FINAL_IMAGE_PROPERTIES.submissionKind] === 'final'
    && props[FINAL_IMAGE_PROPERTIES.artifactKind] === 'image'
    && props[FINAL_IMAGE_PROPERTIES.key] === evidence.key
    && props[FINAL_IMAGE_PROPERTIES.sha256] === evidence.sha256
}

async function readEvidence(drive, fileId) {
  return (await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,parents,appProperties,trashed,size,md5Checksum',
  })).data
}

export async function resolveFinalImageEvidence(drive, { originalsId, submissionId, evidence }) {
  const sid = driveQueryString(submissionId)
  const key = driveQueryString(evidence.key)
  const query = `appProperties has { key='${FINAL_IMAGE_PROPERTIES.submissionId}' and value='${sid}' } and appProperties has { key='${FINAL_IMAGE_PROPERTIES.artifactKind}' and value='image' } and appProperties has { key='${FINAL_IMAGE_PROPERTIES.key}' and value='${key}' }`
  const candidates = []
  let pageToken
  do {
    const listed = await drive.files.list({ q: query, fields: 'nextPageToken,files(id)', pageSize: 100, ...(pageToken ? { pageToken } : {}) })
    candidates.push(...(listed.data.files || []))
    if (candidates.length > 1) {
      const error = new Error('ambiguous final image evidence')
      error.code = 'IMAGE_EVIDENCE_AMBIGUOUS'
      throw error
    }
    pageToken = listed.data.nextPageToken
  } while (pageToken)
  if (candidates.length === 1) {
    let file
    try { file = await readEvidence(drive, candidates[0].id) } catch (cause) {
      const error = new Error(`final image evidence unreadable: ${cause.message}`)
      error.code = 'IMAGE_EVIDENCE_UNREADABLE'
      throw error
    }
    if (!isVerifiedImage(file, { originalsId, submissionId, evidence })) {
      const error = new Error('final image evidence conflict')
      error.code = 'IMAGE_EVIDENCE_CONFLICT'
      throw error
    }
    return { status: 'recovered', id: file.id, file }
  }

  const created = await drive.files.create({
    requestBody: {
      name: evidence.filename,
      parents: [originalsId],
      appProperties: buildFinalImageAppProperties({ submissionId, evidence }),
    },
    media: { mimeType: evidence.mimeType, body: Readable.from(evidence.buffer) },
    fields: 'id',
  })
  const file = await readEvidence(drive, created.data.id)
  if (!isVerifiedImage(file, { originalsId, submissionId, evidence })) {
    const error = new Error('created final image could not be verified')
    error.code = 'IMAGE_EVIDENCE_UNCONFIRMED'
    throw error
  }
  return { status: 'uploaded', id: file.id, file }
}
