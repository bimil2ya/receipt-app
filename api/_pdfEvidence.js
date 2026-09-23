import crypto from 'crypto'
import { Readable } from 'stream'
import { driveQueryString } from './driveUtils.js'

const PDF_MIME = 'application/pdf'
const CHUNK_MIME = 'application/octet-stream'
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_PDF_CHUNKS = 20
const MAX_PDF_CHUNK_BYTES = 4 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA_RE = /^[0-9a-f]{64}$/i
const MD5_RE = /^[0-9a-f]{32}$/i
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export const PDF_EVIDENCE_PROPERTIES = Object.freeze({
  submissionId: 'receiptSubmissionId',
  submissionKind: 'receiptSubmissionKind',
  artifactKind: 'receiptArtifactKind',
  reportId: 'receiptPdfReportId',
  chunkIndex: 'receiptPdfChunkIndex',
  sha256: 'receiptContentSha256',
  byteLength: 'receiptContentByteLength',
})

function codedError(message, code, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function positiveSafeInteger(value, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max
}

function normalizeExpectedPdf(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw new TypeError('invalid expected PDF')
  if (!UUID_RE.test(expected.reportId || '')) throw new TypeError('invalid expected PDF reportId')
  if (!SHA_RE.test(expected.sha256 || '')) throw new TypeError('invalid expected PDF sha256')
  if (!positiveSafeInteger(expected.byteLength, MAX_PDF_BYTES)) throw new TypeError('invalid expected PDF byteLength')
  if (!Number.isSafeInteger(expected.chunkCount) || expected.chunkCount < 1 || expected.chunkCount > MAX_PDF_CHUNKS) {
    throw new TypeError('invalid expected PDF chunkCount')
  }
  if (!Array.isArray(expected.chunkSha256) || !Array.isArray(expected.chunkByteLength)
    || expected.chunkSha256.length !== expected.chunkCount || expected.chunkByteLength.length !== expected.chunkCount) {
    throw new TypeError('invalid expected PDF chunks')
  }
  const chunkSha256 = expected.chunkSha256.map((value) => {
    if (!SHA_RE.test(value || '')) throw new TypeError('invalid expected PDF chunk sha256')
    return value.toLowerCase()
  })
  const chunkByteLength = expected.chunkByteLength.map((value) => {
    if (!positiveSafeInteger(value, MAX_PDF_CHUNK_BYTES)) throw new TypeError('invalid expected PDF chunk byteLength')
    return value
  })
  if (chunkByteLength.reduce((sum, value) => sum + value, 0) !== expected.byteLength) {
    throw new TypeError('expected PDF byte lengths do not match')
  }
  return {
    reportId: expected.reportId,
    sha256: expected.sha256.toLowerCase(),
    byteLength: expected.byteLength,
    chunkCount: expected.chunkCount,
    chunkSha256,
    chunkByteLength,
  }
}

export function preflightPdfChunk({ reportId, chunkIndex, chunkCount, chunkBase64, expected }) {
  const normalized = normalizeExpectedPdf(expected)
  if (reportId !== normalized.reportId) throw new TypeError('PDF reportId mismatch')
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= normalized.chunkCount) {
    throw new TypeError('invalid PDF chunkIndex')
  }
  if (chunkCount !== normalized.chunkCount) throw new TypeError('PDF chunkCount mismatch')
  if (typeof chunkBase64 !== 'string' || chunkBase64.length === 0 || chunkBase64.length % 4 !== 0
    || chunkBase64.length > Math.ceil(MAX_PDF_CHUNK_BYTES / 3) * 4 || !BASE64_RE.test(chunkBase64)) {
    throw new TypeError('invalid PDF chunk base64')
  }
  const buffer = Buffer.from(chunkBase64, 'base64')
  if (buffer.length === 0 || buffer.length > MAX_PDF_CHUNK_BYTES || buffer.toString('base64') !== chunkBase64) {
    throw new TypeError('invalid PDF chunk base64')
  }
  if (buffer.length !== normalized.chunkByteLength[chunkIndex]
    || sha256(buffer) !== normalized.chunkSha256[chunkIndex]) {
    throw new TypeError('PDF chunk content mismatch')
  }
  return buffer
}

function finalProperties({ submissionId, expected }) {
  return {
    [PDF_EVIDENCE_PROPERTIES.submissionId]: submissionId,
    [PDF_EVIDENCE_PROPERTIES.submissionKind]: 'final',
    [PDF_EVIDENCE_PROPERTIES.artifactKind]: 'pdf',
    [PDF_EVIDENCE_PROPERTIES.reportId]: expected.reportId,
    [PDF_EVIDENCE_PROPERTIES.sha256]: expected.sha256,
    [PDF_EVIDENCE_PROPERTIES.byteLength]: String(expected.byteLength),
  }
}

function chunkProperties({ submissionId, expected, chunkIndex }) {
  return {
    [PDF_EVIDENCE_PROPERTIES.submissionId]: submissionId,
    [PDF_EVIDENCE_PROPERTIES.artifactKind]: 'pdf-chunk',
    [PDF_EVIDENCE_PROPERTIES.reportId]: expected.reportId,
    [PDF_EVIDENCE_PROPERTIES.chunkIndex]: String(chunkIndex),
    [PDF_EVIDENCE_PROPERTIES.sha256]: expected.chunkSha256[chunkIndex],
    [PDF_EVIDENCE_PROPERTIES.byteLength]: String(expected.chunkByteLength[chunkIndex]),
  }
}

function validateProcessOptions({ submissionId, expected, chunkIndex, buffer, weekId, pdfName, assertOwned, expectedFileId }) {
  if (!UUID_RE.test(submissionId || '')) throw new TypeError('invalid PDF submissionId')
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= expected.chunkCount) throw new TypeError('invalid PDF chunkIndex')
  if (!Buffer.isBuffer(buffer) || buffer.length !== expected.chunkByteLength[chunkIndex]
    || sha256(buffer) !== expected.chunkSha256[chunkIndex]) throw new TypeError('PDF chunk content mismatch')
  if (typeof weekId !== 'string' || weekId.length < 1 || weekId.length > 256) throw new TypeError('invalid PDF weekId')
  if (typeof pdfName !== 'string' || pdfName.length < 1 || pdfName.length > 180 || !pdfName.endsWith('.pdf')
    || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(pdfName)) throw new TypeError('invalid PDF filename')
  if (typeof assertOwned !== 'function') throw new TypeError('invalid PDF ownership assertion')
  if (expectedFileId !== undefined && expectedFileId !== null
    && (typeof expectedFileId !== 'string' || expectedFileId.length < 1 || expectedFileId.length > 256)) {
    throw new TypeError('invalid expected PDF file id')
  }
}

async function listEvidenceIds(drive, query, code) {
  const ids = []
  const seenTokens = new Set()
  let pageToken
  do {
    let response
    try {
      response = await drive.files.list({
        q: query,
        fields: 'incompleteSearch,nextPageToken,files(id)',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      })
    } catch (cause) {
      throw codedError('Drive PDF evidence list could not be read', code, { cause: cause?.message || String(cause) })
    }
    const data = response?.data
    if (!data || (data.incompleteSearch !== undefined && data.incompleteSearch !== false) || !Array.isArray(data.files)) {
      throw codedError('Drive PDF evidence list is incomplete or malformed', code)
    }
    for (const candidate of data.files) {
      if (!candidate || typeof candidate.id !== 'string' || candidate.id.length === 0) {
        throw codedError('Drive PDF evidence list is incomplete or malformed', code)
      }
      ids.push(candidate.id)
    }
    const next = data.nextPageToken
    if (next !== undefined && next !== null && (typeof next !== 'string' || next.length === 0)) {
      throw codedError('Drive PDF evidence list is incomplete or malformed', code)
    }
    if (next && seenTokens.has(next)) throw codedError('Drive PDF evidence pagination repeated', code)
    if (next) seenTokens.add(next)
    pageToken = next || undefined
  } while (pageToken)
  return ids
}

function globalFinalQuery(submissionId) {
  const sid = driveQueryString(submissionId)
  return `appProperties has { key='${PDF_EVIDENCE_PROPERTIES.submissionId}' and value='${sid}' } and appProperties has { key='${PDF_EVIDENCE_PROPERTIES.artifactKind}' and value='pdf' }`
}

function globalChunkQuery(submissionId, chunkIndex) {
  const sid = driveQueryString(submissionId)
  return `appProperties has { key='${PDF_EVIDENCE_PROPERTIES.submissionId}' and value='${sid}' } and appProperties has { key='${PDF_EVIDENCE_PROPERTIES.artifactKind}' and value='pdf-chunk' } and appProperties has { key='${PDF_EVIDENCE_PROPERTIES.chunkIndex}' and value='${chunkIndex}' }`
}

async function readMetadata(drive, fileId, code) {
  try {
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,parents,appProperties,trashed,size,md5Checksum',
    })
    if (!response?.data || typeof response.data !== 'object') throw new Error('malformed metadata response')
    return response.data
  } catch (cause) {
    throw codedError('Drive PDF evidence metadata could not be read', code, { fileId, cause: cause?.message || String(cause) })
  }
}

async function downloadBuffer(drive, fileId, expectedLength, code) {
  try {
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    const body = response?.data
    if (!body || Buffer.isBuffer(body) || typeof body[Symbol.asyncIterator] !== 'function') {
      throw new Error('malformed media response')
    }
    const chunks = []
    let byteLength = 0
    for await (const value of body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      byteLength += chunk.length
      if (byteLength > expectedLength) {
        if (typeof body.destroy === 'function') body.destroy()
        throw new Error('media response exceeds expected byte length')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, byteLength)
  } catch (cause) {
    throw codedError('Drive PDF evidence bytes could not be read', code, { fileId, cause: cause?.message || String(cause) })
  }
}

function hasExactParent(file, weekId) {
  return Array.isArray(file?.parents) && file.parents.length === 1 && file.parents[0] === weekId
}

async function verifyFinal(drive, fileId, { submissionId, expected, weekId }, code) {
  const file = await readMetadata(drive, fileId, code)
  const props = file.appProperties || {}
  const metadataValid = file.id === fileId
    && file.trashed === false
    && file.mimeType === PDF_MIME
    && hasExactParent(file, weekId)
    && Number(file.size) === expected.byteLength
    && expected.byteLength <= MAX_PDF_BYTES
    && MD5_RE.test(file.md5Checksum || '')
    && props[PDF_EVIDENCE_PROPERTIES.submissionId] === submissionId
    && props[PDF_EVIDENCE_PROPERTIES.submissionKind] === 'final'
    && props[PDF_EVIDENCE_PROPERTIES.artifactKind] === 'pdf'
    && props[PDF_EVIDENCE_PROPERTIES.reportId] === expected.reportId
    && props[PDF_EVIDENCE_PROPERTIES.sha256] === expected.sha256
    && props[PDF_EVIDENCE_PROPERTIES.byteLength] === String(expected.byteLength)
  if (!metadataValid) throw codedError('Drive PDF evidence conflicts with the submission contract', code, { fileId })
  const bytes = await downloadBuffer(drive, fileId, expected.byteLength, code)
  const actualSha = sha256(bytes)
  const actualMd5 = md5(bytes)
  const bytesValid = file.md5Checksum.toLowerCase() === actualMd5
    && bytes.length === expected.byteLength
    && actualSha === expected.sha256
    && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
  if (!bytesValid) throw codedError('Drive PDF evidence conflicts with the submission contract', code, { fileId })
  return { file, bytes }
}

async function findFinal(drive, { submissionId, expected, weekId, expectedFileId }) {
  const ids = await listEvidenceIds(drive, globalFinalQuery(submissionId), 'PDF_EVIDENCE_LIST_UNCONFIRMED')
  if (ids.length > 1) throw codedError('More than one final PDF evidence file exists', 'PDF_EVIDENCE_AMBIGUOUS', { fileIds: ids })
  if (expectedFileId && (ids.length !== 1 || ids[0] !== expectedFileId)) {
    throw codedError('Stored final PDF evidence id is missing or does not match Drive', 'PDF_EVIDENCE_PIN_MISMATCH', {
      expectedFileId, fileIds: ids,
    })
  }
  if (ids.length === 0) return null
  const verified = await verifyFinal(drive, ids[0], { submissionId, expected, weekId }, 'PDF_EVIDENCE_CONFLICT')
  return { id: ids[0], ...verified }
}

async function verifyChunk(drive, fileId, { submissionId, expected, chunkIndex, weekId }, code) {
  const file = await readMetadata(drive, fileId, code)
  const props = file.appProperties || {}
  const expectedLength = expected.chunkByteLength[chunkIndex]
  const expectedSha = expected.chunkSha256[chunkIndex]
  const metadataValid = file.id === fileId
    && file.trashed === false
    && file.mimeType === CHUNK_MIME
    && hasExactParent(file, weekId)
    && Number(file.size) === expectedLength
    && expectedLength <= MAX_PDF_CHUNK_BYTES
    && MD5_RE.test(file.md5Checksum || '')
    && props[PDF_EVIDENCE_PROPERTIES.submissionId] === submissionId
    && props[PDF_EVIDENCE_PROPERTIES.artifactKind] === 'pdf-chunk'
    && props[PDF_EVIDENCE_PROPERTIES.reportId] === expected.reportId
    && props[PDF_EVIDENCE_PROPERTIES.chunkIndex] === String(chunkIndex)
    && props[PDF_EVIDENCE_PROPERTIES.sha256] === expectedSha
    && props[PDF_EVIDENCE_PROPERTIES.byteLength] === String(expectedLength)
  if (!metadataValid) throw codedError('Drive PDF chunk evidence conflicts with the submission contract', code, { fileId, chunkIndex })
  const bytes = await downloadBuffer(drive, fileId, expectedLength, code)
  const actualSha = sha256(bytes)
  const actualMd5 = md5(bytes)
  const bytesValid = file.md5Checksum.toLowerCase() === actualMd5
    && bytes.length === expectedLength
    && actualSha === expectedSha
  if (!bytesValid) throw codedError('Drive PDF chunk evidence conflicts with the submission contract', code, { fileId, chunkIndex })
  return { file, bytes }
}

async function findChunk(drive, options, { required = false } = {}) {
  const ids = await listEvidenceIds(
    drive,
    globalChunkQuery(options.submissionId, options.chunkIndex),
    'PDF_CHUNK_LIST_UNCONFIRMED',
  )
  if (ids.length > 1) {
    throw codedError('More than one PDF chunk evidence file exists', 'PDF_CHUNK_AMBIGUOUS', {
      chunkIndex: options.chunkIndex, fileIds: ids,
    })
  }
  if (ids.length === 0) {
    if (required) throw codedError('An expected PDF chunk is missing', 'PDF_ASSEMBLY_INCOMPLETE', { chunkIndex: options.chunkIndex })
    return null
  }
  const verified = await verifyChunk(drive, ids[0], options, 'PDF_CHUNK_CONFLICT')
  return { id: ids[0], ...verified }
}

async function assertMutationOwned(assertOwned) {
  const result = await assertOwned()
  if (result === false) throw codedError('PDF evidence mutation lock is no longer owned', 'PDF_LOCK_LOST')
}

async function createChunk(drive, options) {
  const { submissionId, expected, chunkIndex, buffer, weekId, assertOwned } = options
  await assertMutationOwned(assertOwned)
  let created
  try {
    created = await drive.files.create({
      requestBody: {
        name: `_정산서청크_${expected.reportId}_${chunkIndex}.bin`,
        parents: [weekId],
        appProperties: chunkProperties({ submissionId, expected, chunkIndex }),
      },
      media: { mimeType: CHUNK_MIME, body: Readable.from(buffer) },
      fields: 'id',
    })
  } finally {
    await assertMutationOwned(assertOwned)
  }
  const id = created?.data?.id
  if (typeof id !== 'string' || id.length === 0) throw codedError('PDF chunk create response is malformed', 'PDF_CHUNK_UNCONFIRMED')
  const verified = await verifyChunk(drive, id, options, 'PDF_CHUNK_UNCONFIRMED')
  return { id, ...verified }
}

async function createFinal(drive, options, pdfBuffer) {
  const { submissionId, expected, weekId, pdfName, assertOwned } = options
  await assertMutationOwned(assertOwned)
  let created
  try {
    created = await drive.files.create({
      requestBody: {
        name: pdfName,
        parents: [weekId],
        appProperties: finalProperties({ submissionId, expected }),
      },
      media: { mimeType: PDF_MIME, body: Readable.from(pdfBuffer) },
      fields: 'id',
    })
  } finally {
    await assertMutationOwned(assertOwned)
  }
  const id = created?.data?.id
  if (typeof id !== 'string' || id.length === 0) throw codedError('Final PDF create response is malformed', 'PDF_EVIDENCE_UNCONFIRMED')
  const verified = await verifyFinal(drive, id, options, 'PDF_EVIDENCE_UNCONFIRMED')
  return { id, ...verified }
}

export async function processPdfEvidence(drive, options) {
  if (!drive?.files || typeof drive.files.list !== 'function' || typeof drive.files.get !== 'function'
    || typeof drive.files.create !== 'function') throw new TypeError('invalid Drive client')
  const expected = normalizeExpectedPdf(options?.expected)
  const normalizedOptions = { ...options, expected }
  validateProcessOptions(normalizedOptions)

  const existingFinal = await findFinal(drive, normalizedOptions)
  if (existingFinal) {
    return {
      assembled: true,
      status: 'recovered',
      id: existingFinal.id,
      received: normalizedOptions.chunkIndex,
      file: normalizedOptions.pdfName,
    }
  }

  let chunk = await findChunk(drive, normalizedOptions)
  const chunkStatus = chunk ? 'recovered' : 'uploaded'
  if (!chunk) chunk = await createChunk(drive, normalizedOptions)

  if (normalizedOptions.chunkIndex !== expected.chunkCount - 1) {
    return { assembled: false, status: chunkStatus, received: normalizedOptions.chunkIndex }
  }

  const chunks = []
  for (let index = 0; index < expected.chunkCount; index += 1) {
    const found = await findChunk(drive, { ...normalizedOptions, chunkIndex: index }, { required: true })
    chunks.push(found.bytes)
  }
  const pdfBuffer = Buffer.concat(chunks)
  if (pdfBuffer.length !== expected.byteLength || sha256(pdfBuffer) !== expected.sha256
    || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw codedError('Assembled PDF bytes do not match the submission contract', 'PDF_ASSEMBLY_CONFLICT')
  }

  // Recheck immediately before the final create so a retry that finished while
  // chunks were being read cannot produce a second durable PDF witness.
  const racedFinal = await findFinal(drive, normalizedOptions)
  if (racedFinal) {
    return {
      assembled: true,
      status: 'recovered',
      id: racedFinal.id,
      received: normalizedOptions.chunkIndex,
      file: normalizedOptions.pdfName,
    }
  }

  const created = await createFinal(drive, normalizedOptions, pdfBuffer)
  return {
    assembled: true,
    status: 'uploaded',
    id: created.id,
    received: normalizedOptions.chunkIndex,
    file: normalizedOptions.pdfName,
  }
}
