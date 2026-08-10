import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from './platform.js'

const { platform } = vi.hoisted(() => ({ platform: vi.fn() }))
vi.mock('./platform.js', () => ({ platform: () => platform() }))

const {
	claimInvitationCreation,
	invitationCreationClaimActive,
	invitationCreationClaimsAvailable,
	releaseInvitationCreationClaim,
} = await import('./invitation-creation-claim.js')

function atomicStore() {
	const values = new Set<string>()
	const kv: KvLike = {
		get: vi.fn(async (key) => (values.has(key) ? '1' : null)),
		put: vi.fn(async () => undefined),
		delete: vi.fn(async (key) => {
			values.delete(key)
		}),
		putIfAbsent: vi.fn(async (key) => {
			if (values.has(key)) return false
			values.add(key)
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
		await expect(claimInvitationCreation('grant-1', 'uid')).rejects.toThrow('unavailable')
		await expect(releaseInvitationCreationClaim('grant-1', 'uid')).resolves.toBeUndefined()
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
