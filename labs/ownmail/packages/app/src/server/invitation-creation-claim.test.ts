import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from './platform.js'

const { platform } = vi.hoisted(() => ({ platform: vi.fn() }))
vi.mock('./platform.js', () => ({ platform: () => platform() }))

const {
	claimInvitationCreation,
	invitationCreationClaimActive,
	invitationCreationClaimsAvailable,
	invitationCancellationSequence,
	recordInvitationCancellation,
	releaseInvitationCreationClaim,
} = await import('./invitation-creation-claim.js')

function atomicStore() {
	const values = new Map<string, string>()
	const kv: KvLike = {
		get: vi.fn(async (key) => values.get(key) ?? null),
		put: vi.fn(async (key, value) => {
			values.set(key, value)
		}),
		delete: vi.fn(async (key) => {
			values.delete(key)
		}),
		putIfAbsent: vi.fn(async (key) => {
			if (values.has(key)) return false
			values.set(key, '1')
			return true
		}),
	}
	return kv
}

describe('invitation creation claims', () => {
	beforeEach(() => platform.mockReset())

	it('acquires one hashed distributed claim and releases it explicitly', async () => {
		const kv = atomicStore()
		platform.mockResolvedValue({ kv, env: { SESSION_SECRET: 'secret' } })

		await expect(invitationCreationClaimsAvailable()).resolves.toBe(true)
		await expect(claimInvitationCreation('grant-1', 'uid@example.com')).resolves.toBe(true)
		await expect(invitationCreationClaimActive('grant-1', 'uid@example.com')).resolves.toBe(true)
		await expect(claimInvitationCreation('grant-1', 'uid@example.com')).resolves.toBe(false)
		expect(vi.mocked(kv.putIfAbsent as NonNullable<KvLike['putIfAbsent']>).mock.calls[0]?.[0]).not.toContain(
			'grant-1',
		)
		expect(vi.mocked(kv.putIfAbsent as NonNullable<KvLike['putIfAbsent']>).mock.calls[0]?.[0]).not.toContain(
			'uid@example.com',
		)

		await releaseInvitationCreationClaim('grant-1', 'uid@example.com')
		await expect(invitationCreationClaimActive('grant-1', 'uid@example.com')).resolves.toBe(false)
		await expect(claimInvitationCreation('grant-1', 'uid@example.com')).resolves.toBe(true)
	})

	it('fails closed when no atomic shared store is available', async () => {
		platform.mockResolvedValue({ kv: null, env: { SESSION_SECRET: 'secret' } })

		await expect(invitationCreationClaimsAvailable()).resolves.toBe(false)
		await expect(invitationCreationClaimActive('grant-1', 'uid')).resolves.toBe(false)
		await expect(
			invitationCancellationSequence('grant-1', 'uid', 'grace@example.com'),
		).resolves.toBeUndefined()
		await expect(recordInvitationCancellation('grant-1', 'uid', 2, 'grace@example.com')).resolves.toBe(2)
		await expect(claimInvitationCreation('grant-1', 'uid')).rejects.toThrow('unavailable')
		await expect(releaseInvitationCreationClaim('grant-1', 'uid')).resolves.toBeUndefined()
	})

	it('records a monotonic hashed cancellation tombstone', async () => {
		const kv = atomicStore()
		platform.mockResolvedValue({ kv, env: { SESSION_SECRET: 'secret' } })

		await expect(
			invitationCancellationSequence('grant-1', 'uid@example.com', 'grace@example.com'),
		).resolves.toBeUndefined()
		await expect(
			recordInvitationCancellation('grant-1', 'uid@example.com', 3, 'Grace@Example.com'),
		).resolves.toBe(3)
		await expect(
			recordInvitationCancellation('grant-1', 'uid@example.com', 2, 'grace@example.com'),
		).resolves.toBe(3)
		await expect(
			invitationCancellationSequence('grant-1', 'uid@example.com', 'GRACE@example.com'),
		).resolves.toBe(3)
		await expect(
			invitationCancellationSequence('grant-1', 'uid@example.com', 'other@example.com'),
		).resolves.toBeUndefined()

		const cancellationKey = vi
			.mocked(kv.put)
			.mock.calls.map(([key]) => key)
			.find((key) => key.startsWith('invitation-cancel:'))
		expect(cancellationKey).toBeDefined()
		expect(cancellationKey).not.toContain('grant-1')
		expect(cancellationKey).not.toContain('uid@example.com')
		expect(cancellationKey).not.toContain('grace@example.com')
		await kv.put(cancellationKey as string, '2147483648')
		await expect(
			invitationCancellationSequence('grant-1', 'uid@example.com', 'grace@example.com'),
		).resolves.toBeUndefined()
	})

	it('persists cancellation tombstones on a non-atomic Cloudflare KV store', async () => {
		const values = new Map<string, string>()
		const kv: KvLike = {
			get: vi.fn(async (key) => values.get(key) ?? null),
			put: vi.fn(async (key, value) => {
				values.set(key, value)
			}),
			delete: vi.fn(async (key) => {
				values.delete(key)
			}),
		}
		platform.mockResolvedValue({ kv, env: { SESSION_SECRET: 'secret' } })

		await expect(
			recordInvitationCancellation('grant-1', 'uid@example.com', 3, 'grace@example.com'),
		).resolves.toBe(3)
		await expect(
			recordInvitationCancellation('grant-1', 'uid@example.com', 2, 'grace@example.com'),
		).resolves.toBe(3)
		await expect(
			invitationCancellationSequence('grant-1', 'uid@example.com', 'grace@example.com'),
		).resolves.toBe(3)
		expect(kv.put).toHaveBeenCalledTimes(1)
	})

	it('validates tombstone revisions and serializes writers', async () => {
		const kv = atomicStore()
		platform.mockResolvedValue({ kv, env: { SESSION_SECRET: 'secret' } })

		for (const sequence of [-1, 1.5, Number.NaN, 2_147_483_648]) {
			await expect(
				recordInvitationCancellation('grant-1', 'uid', sequence, 'grace@example.com'),
			).rejects.toThrow('Invalid invitation cancellation sequence')
		}
		await expect(recordInvitationCancellation('grant-1', 'uid', 1, 'invalid')).rejects.toThrow(
			'Invalid invitation cancellation organizer',
		)
		await expect(invitationCancellationSequence('grant-1', 'uid', 'invalid')).resolves.toBeUndefined()
		await expect(invitationCancellationSequence('grant-1', 'uid', null as never)).resolves.toBeUndefined()
		vi.mocked(kv.delete).mockRejectedValueOnce(new Error('cleanup outage'))
		await expect(
			recordInvitationCancellation('grant-1', 'uid-cleanup', 1, 'grace@example.com'),
		).resolves.toBe(1)
		vi.mocked(kv.putIfAbsent as NonNullable<KvLike['putIfAbsent']>).mockResolvedValueOnce(false)
		await expect(recordInvitationCancellation('grant-1', 'uid', 1, 'grace@example.com')).rejects.toThrow(
			'already being recorded',
		)
	})

	it('reports unavailable platform state without exposing its failure', async () => {
		platform.mockImplementationOnce(() => {
			throw new Error('secret platform detail')
		})
		await expect(invitationCreationClaimsAvailable()).resolves.toBe(false)
	})

	it('propagates an atomic store failure without leaving a local fallback claim', async () => {
		const kv = atomicStore()
		vi.mocked(kv.putIfAbsent as NonNullable<KvLike['putIfAbsent']>).mockRejectedValue(
			new Error('claim failed'),
		)
		platform.mockResolvedValue({ kv, env: { SESSION_SECRET: 'secret' } })

		await expect(claimInvitationCreation('grant-1', 'uid')).rejects.toThrow('claim failed')
		expect(kv.delete).not.toHaveBeenCalled()
	})

	it('validates claim secrets before using them as HMAC keys', async () => {
		platform.mockResolvedValue({ kv: atomicStore(), env: { SESSION_SECRET: '' } })
		await expect(claimInvitationCreation('grant-1', 'uid')).rejects.toThrow('secret is unavailable')
	})
})
