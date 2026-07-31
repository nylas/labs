import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runRotateKey } from './rotate.js'

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
	log: { step: vi.fn(), warn: vi.fn() },
}))
vi.mock('@nylas-labs/cli-kit', () => ({
	GatewayError: class GatewayError extends Error {
		constructor(
			message: string,
			readonly requestId?: string,
		) {
			super(message)
			this.name = 'GatewayError'
		}
	},
}))
vi.mock('../deploy/wrangler.js', () => ({
	CloudflareNoChangeError: class CloudflareNoChangeError extends Error {},
	putSecret: vi.fn(),
}))
vi.mock('../state/pending-secrets.js', () => ({
	clearPendingSecret: vi.fn((project: ProjectState) => {
		delete project.pendingSecrets.apiKey
	}),
	storePendingSecret: vi.fn(),
}))
vi.mock('../state/store.js', () => ({ saveProject: vi.fn() }))
vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(),
	requireGateway: vi.fn(),
	tokens: vi.fn(() => ({ userToken: 't' })),
}))
vi.mock('./shared.js', () => ({
	pickExistingProject: vi.fn(),
	supportReference: vi.fn((err: { requestId?: string }) =>
		err.requestId ? `Request ID: ${err.requestId}. Include this ID if you contact Nylas Support.` : undefined,
	),
}))

import * as p from '@clack/prompts'
import { GatewayError } from '@nylas-labs/cli-kit'
import { CloudflareNoChangeError, putSecret } from '../deploy/wrangler.js'
import { clearPendingSecret, storePendingSecret } from '../state/pending-secrets.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway } from '../steps/context.js'
import { pickExistingProject } from './shared.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	} as ProjectState
}

function gateway(overrides: Record<string, unknown> = {}) {
	return {
		createApiKey: vi.fn().mockResolvedValue({ id: 'new-key', apiKey: 'nyk_new' }),
		revokeApiKey: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('runRotateKey', () => {
	it('throws when the project has not deployed (no worker)', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ applicationId: 'app-1' }))
		await expect(runRotateKey({})).rejects.toThrow(/hasn.t deployed yet/)
	})

	it('throws when the application id is missing', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1' }))
		await expect(runRotateKey({})).rejects.toThrow(/hasn.t deployed yet/)
	})

	it('throws when not logged in', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1', applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)
		await expect(runRotateKey({})).rejects.toThrow(/Not logged in/)
	})

	it('mints, swaps, persists, and revokes the old key', async () => {
		const proj = project({ workerName: 'w1', applicationId: 'app-1', apiKeyId: 'old-key' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		await runRotateKey({})
		// New key put on the worker before the old one is revoked (no gap).
		expect(putSecret).toHaveBeenCalledWith('w1', 'NYLAS_API_KEY', 'nyk_new')
		expect(proj.apiKeyId).toBe('new-key')
		expect(saveProject).toHaveBeenCalledWith(proj)
		expect(gw.revokeApiKey).toHaveBeenCalledWith({ userToken: 't' }, 'us', 'app-1', 'old-key')
		expect(p.log.step).toHaveBeenCalledWith('Old key revoked.')
		expect(storePendingSecret).toHaveBeenCalledWith(proj, 'apiKey', 'nyk_new', {
			allowLocalFallback: false,
		})
		expect(proj.pendingApiKeyRotation).toBeUndefined()
	})

	it('reconciles a pending predecessor before rotating the installed key', async () => {
		const proj = project({
			workerName: 'w1',
			applicationId: 'app-1',
			apiKeyId: 'current-key',
			pendingApiKeyRotation: {
				previousKeyId: 'pending-old-key',
				replacementKeyId: 'current-key',
			},
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)

		await runRotateKey({})

		expect(gw.revokeApiKey).toHaveBeenNthCalledWith(1, { userToken: 't' }, 'us', 'app-1', 'pending-old-key')
		expect(gw.revokeApiKey).toHaveBeenNthCalledWith(2, { userToken: 't' }, 'us', 'app-1', 'current-key')
		expect(gw.revokeApiKey.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(putSecret).mock.invocationCallOrder[0],
		)
		expect(proj.pendingApiKeyRotation).toBeUndefined()
	})

	it('does not mint another key while predecessor revocation is still failing', async () => {
		const proj = project({
			workerName: 'w1',
			applicationId: 'app-1',
			apiKeyId: 'current-key',
			pendingApiKeyRotation: {
				previousKeyId: 'pending-old-key',
				replacementKeyId: 'current-key',
			},
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway({ revokeApiKey: vi.fn().mockRejectedValue(new Error('offline')) })
		vi.mocked(requireGateway).mockReturnValue(gw as never)

		await expect(runRotateKey({})).rejects.toThrow(/previously pending old key/)

		expect(gw.createApiKey).not.toHaveBeenCalled()
		expect(putSecret).not.toHaveBeenCalled()
		expect(proj.pendingApiKeyRotation).toEqual({
			previousKeyId: 'pending-old-key',
			replacementKeyId: 'current-key',
		})
	})

	it('includes the request ID when pending predecessor revocation fails', async () => {
		const proj = project({
			workerName: 'w1',
			applicationId: 'app-1',
			apiKeyId: 'current-key',
			pendingApiKeyRotation: {
				previousKeyId: 'pending-old-key',
				replacementKeyId: 'current-key',
			},
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		vi.mocked(requireGateway).mockReturnValue(
			gateway({
				revokeApiKey: vi.fn().mockRejectedValue(new GatewayError('hidden detail', 'req-pending-revoke-123')),
			}) as never,
		)

		const error = await runRotateKey({}).catch((cause: unknown) => cause)
		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toContain('Request ID: req-pending-revoke-123')
		expect((error as Error).message).not.toContain('hidden detail')
	})

	it('rejects inconsistent pending rotation state before minting', async () => {
		const proj = project({
			workerName: 'w1',
			applicationId: 'app-1',
			apiKeyId: 'different-key',
			pendingApiKeyRotation: {
				previousKeyId: 'pending-old-key',
				replacementKeyId: 'current-key',
			},
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)

		await expect(runRotateKey({})).rejects.toThrow(/inconsistent API-key rotation state/)

		expect(gw.createApiKey).not.toHaveBeenCalled()
	})

	it('clears an obsolete secret reference when the rotated key cannot be retained', async () => {
		const proj = project({
			workerName: 'w1',
			applicationId: 'app-1',
			apiKeyId: 'old-key',
			pendingSecrets: { apiKey: 'nyk_old' },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		vi.mocked(requireGateway).mockReturnValue(gateway() as never)
		vi.mocked(storePendingSecret).mockImplementationOnce(() => {
			throw new Error('keyring unavailable')
		})

		await runRotateKey({})

		expect(clearPendingSecret).toHaveBeenCalledWith(proj, 'apiKey')
		expect(proj.pendingSecrets.apiKey).toBeUndefined()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('OS credential store'))
	})

	it('skips revocation when there was no previous key', async () => {
		const proj = project({ workerName: 'w1', applicationId: 'app-1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		await runRotateKey({})
		expect(gw.revokeApiKey).not.toHaveBeenCalled()
	})

	it('skips revocation when the new key id equals the old one', async () => {
		const proj = project({ workerName: 'w1', applicationId: 'app-1', apiKeyId: 'new-key' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		await runRotateKey({})
		expect(gw.revokeApiKey).not.toHaveBeenCalled()
	})

	it('preserves the new key when the Cloudflare key swap cannot be confirmed', async () => {
		const proj = project({ workerName: 'w1', applicationId: 'app-1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		vi.mocked(putSecret).mockRejectedValueOnce(new Error('timeout'))
		await expect(runRotateKey({})).rejects.toThrow(/left active because Cloudflare may already be using it/)
		expect(gw.revokeApiKey).not.toHaveBeenCalled()
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('explains how to reconcile an unconfirmed Cloudflare key swap', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1', applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		vi.mocked(putSecret).mockRejectedValueOnce(new Error('timeout'))
		await expect(runRotateKey({})).rejects.toThrow(/check your Cloudflare Worker and the Nylas dashboard/)
		expect(gw.revokeApiKey).not.toHaveBeenCalled()
	})

	it('preserves the no-change recovery and revokes the unused new key', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1', applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway()
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		const error = new CloudflareNoChangeError(
			'OwnMail could not start its bundled Cloudflare deployment helper. Reinstall or update OwnMail, then retry the same OwnMail command. No Cloudflare changes were made.',
		)
		vi.mocked(putSecret).mockRejectedValueOnce(error)

		await expect(runRotateKey({})).rejects.toThrow(error.message)
		expect(gw.revokeApiKey).toHaveBeenCalledWith({ userToken: 't' }, 'us', 'app-1', 'new-key')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('warns if it cannot reclaim a key after a confirmed no-change failure', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1', applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway({ revokeApiKey: vi.fn().mockRejectedValue(new Error('network down')) })
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		vi.mocked(putSecret).mockRejectedValueOnce(
			new CloudflareNoChangeError('Reinstall OwnMail. No Cloudflare changes were made.'),
		)

		await expect(runRotateKey({})).rejects.toThrow(/No Cloudflare changes were made/)
		expect(p.log.warn).toHaveBeenCalledWith(
			expect.stringContaining('could not revoke the unused new Nylas key'),
		)
	})

	it('includes the request ID if reclaiming the unused new key fails in Nylas', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1', applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway({
			revokeApiKey: vi
				.fn()
				.mockRejectedValue(new GatewayError('hidden upstream detail', 'req-unused-key-123')),
		})
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		vi.mocked(putSecret).mockRejectedValueOnce(
			new CloudflareNoChangeError('Reinstall OwnMail. No Cloudflare changes were made.'),
		)

		await expect(runRotateKey({})).rejects.toThrow(/No Cloudflare changes were made/)
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Request ID: req-unused-key-123'))
		expect(p.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('hidden upstream detail'))
	})

	it('warns with the gateway request ID without exposing provider detail', async () => {
		const proj = project({ workerName: 'w1', applicationId: 'app-1', apiKeyId: 'old-key' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway({
			revokeApiKey: vi.fn().mockRejectedValue(new GatewayError('403 forbidden', 'req-revoke-123')),
		})
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		await runRotateKey({})
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Request ID: req-revoke-123'))
		expect(p.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('403 forbidden'))
		expect(proj.pendingApiKeyRotation).toEqual({
			previousKeyId: 'old-key',
			replacementKeyId: 'new-key',
		})
	})

	it('does not expose arbitrary non-gateway errors on revocation failure', async () => {
		const proj = project({ workerName: 'w1', applicationId: 'app-1', apiKeyId: 'old-key' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		const gw = gateway({
			revokeApiKey: vi.fn().mockRejectedValue(new Error('network down')),
		})
		vi.mocked(requireGateway).mockReturnValue(gw as never)
		await runRotateKey({})
		expect(p.log.warn).toHaveBeenCalledWith('Could not revoke the old key. Revoke it in the Nylas dashboard.')
		expect(p.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('network down'))
	})
})
