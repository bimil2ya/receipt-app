import { describe, expect, it } from 'vitest'
import { acquireArtifactSubmissionLock, acquireSubmissionLock, artifactSubmissionLockKey, monthLockKey, releaseSubmissionLock, renewSubmissionLock } from './_submissionLock.js'

describe('submission lock', () => {
  it('uses one stable, non-identifying key per month and acquires with NX expiry', async () => {
    const calls = []
    const redis = { set: async (...args) => { calls.push(args); return 'OK' } }
    const lock = await acquireSubmissionLock({ yearMonth: '2026년 09월', token: 'owner', ttlSeconds: 120, redis })
    expect(lock.acquired).toBe(true)
    expect(lock.key).toBe(monthLockKey('2026년 09월'))
    expect(lock.key).not.toContain('2026년')
    expect(calls).toEqual([[lock.key, 'owner', { nx: true, ex: 120 }]])
  })

  it('does not treat an existing lock as acquired', async () => {
    const lock = await acquireSubmissionLock({ yearMonth: '2026년 09월', token: 'owner', redis: { set: async () => null } })
    expect(lock.acquired).toBe(false)
  })

  it('uses a separate hashed lock for one artifact submission', async () => {
    const calls = []
    const redis = { set: async (...args) => { calls.push(args); return 'OK' } }
    const submissionId = '9f7dfaf1-a4bd-44f1-83e1-c2a1e4f27f20'
    const lock = await acquireArtifactSubmissionLock({ submissionId, token: 'child-owner', ttlSeconds: 90, redis })
    expect(lock).toMatchObject({ acquired: true, key: artifactSubmissionLockKey(submissionId), token: 'child-owner', ttlSeconds: 90 })
    expect(lock.key).not.toContain(submissionId)
    expect(lock.key).not.toBe(monthLockKey(submissionId))
    expect(calls).toEqual([[lock.key, 'child-owner', { nx: true, ex: 90 }]])
  })

  it('rejects a malformed artifact submission ID before Redis', async () => {
    await expect(acquireArtifactSubmissionLock({ submissionId: 'not-a-uuid', redis: { set: async () => { throw new Error('must not run') } } }))
      .rejects.toThrow('invalid submissionId')
  })

  it('fails closed when Redis cannot acquire the lock', async () => {
    await expect(acquireSubmissionLock({ yearMonth: '2026년 09월', redis: { set: async () => { throw new Error('offline') } } }))
      .rejects.toMatchObject({ code: 'KV_UNAVAILABLE' })
  })

  it('renews and releases only through token-conditional Lua scripts', async () => {
    const calls = []
    const redis = { eval: async (...args) => { calls.push(args); return 1 } }
    await expect(renewSubmissionLock({ key: 'lock', token: 'owner', ttlSeconds: 120, redis })).resolves.toBe(true)
    await expect(releaseSubmissionLock({ key: 'lock', token: 'owner', redis })).resolves.toBe(true)
    expect(calls[0][1]).toEqual(['lock'])
    expect(calls[0][2]).toEqual(['owner', '120'])
    expect(calls[1][1]).toEqual(['lock'])
    expect(calls[1][2]).toEqual(['owner'])
  })

  it('does not renew or release a lock owned by another request', async () => {
    const redis = { eval: async () => 0 }
    await expect(renewSubmissionLock({ key: 'lock', token: 'owner', redis })).resolves.toBe(false)
    await expect(releaseSubmissionLock({ key: 'lock', token: 'owner', redis })).resolves.toBe(false)
  })
})
