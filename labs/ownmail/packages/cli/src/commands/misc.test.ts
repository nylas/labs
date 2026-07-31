import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runCleanupSecrets, runDeleteProject, runDestroy, runGrants, runLogin } from './misc.js'

const { listGrants } = vi.hoisted(() => ({ listGrants: vi.fn() }))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	text: vi.fn(),
	isCancel: vi.fn(() => false),
	log: { info: vi.fn(), warn: vi.fn(), step: vi.fn(), message: vi.fn() },
}))
vi.mock('@nylas-labs/cli-kit', () => ({
	NylasV3Client: vi.fn().mockImplementation(function NylasV3ClientMock() {
		return { listGrants }
	}),
}))
vi.mock('../deploy/wrangler.js', () => ({
	runWrangler: vi.fn(),
	cloudflareFailure: vi.fn(() => new Error('Safe Cloudflare recovery')),
}))
vi.mock('../nylas-env.js', () => ({ apiBaseUrl: vi.fn(() => 'https://api.example.com') }))
vi.mock('../state/store.js', () => ({
	clearAuth: vi.fn(),
	deleteProject: vi.fn(() => true),
	newProject: vi.fn((slug: string, region: string) => ({ slug, region })),
	saveProject: vi.fn(),
}))
vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(),
	requireGateway: vi.fn(),
	tokens: vi.fn(() => ({ userToken: 't' })),
}))
vi.mock('../steps/provision.js', () => ({ stepDashboardAuth: vi.fn() }))
vi.mock('./shared.js', () => ({ pickExistingProject: vi.fn() }))

import * as p from '@clack/prompts'
import { cloudflareFailure, runWrangler } from '../deploy/wrangler.js'
import { clearAuth, deleteProject, saveProject } from '../state/store.js'
import { createContext, requireGateway } from '../steps/context.js'
import { stepDashboardAuth } from '../steps/provision.js'
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

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(p.isCancel).mockReturnValue(false)
})

describe('runLogin', () => {
	it('clears stale auth and forces a fresh dashboard login', async () => {
		const ctx = { auth: { userToken: 'old' } }
		vi.mocked(createContext).mockResolvedValue(ctx as never)
		await runLogin()
		expect(clearAuth).toHaveBeenCalled()
		// Context auth is wiped so the dashboard-auth step re-authenticates.
		expect(ctx.auth).toBeNull()
		expect(stepDashboardAuth).toHaveBeenCalledWith(ctx)
		expect(deleteProject).toHaveBeenCalledWith('__login__')
		expect(p.outro).toHaveBeenCalledWith('Logged in.')
	})
})

describe('runGrants', () => {
	it('throws when not logged in', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)
		await expect(runGrants({})).rejects.toThrow(/Not logged in or app missing/)
	})

	it('throws when the application id is missing', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ applicationId: undefined }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		await expect(runGrants({})).rejects.toThrow(/Not logged in or app missing/)
	})

	it('reports when no inboxes exist yet', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ applicationId: 'app-1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		vi.mocked(requireGateway).mockReturnValue({
			createApiKey: vi.fn().mockResolvedValue({ apiKey: 'k' }),
		} as never)
		listGrants.mockResolvedValue({ data: [{ provider: 'google', email: 'x@g.com' }] })
		await runGrants({ name: 'acme' })
		expect(p.log.info).toHaveBeenCalledWith('No inboxes on this app yet.')
	})

	it('lists agent inboxes, marking the current app grant', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			project({ applicationId: 'app-1', grantId: 'g-current' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		vi.mocked(requireGateway).mockReturnValue({
			createApiKey: vi.fn().mockResolvedValue({ apiKey: 'k' }),
		} as never)
		listGrants.mockResolvedValue({
			data: [
				{ provider: 'nylas', email: 'a@x.com', id: 'g-current', grant_status: 'valid' },
				{ provider: 'nylas', email: 'b@x.com', id: 'g-other' },
				{ provider: 'google', email: 'c@x.com', id: 'g-google' },
			],
		})
		await runGrants({})
		const messages = vi.mocked(p.log.message).mock.calls.map((c) => c[0])
		expect(messages[0]).toContain('a@x.com  (valid, g-current) ← this app')
		expect(messages[1]).toContain('b@x.com  (valid, g-other)')
		expect(messages[1]).not.toContain('← this app')
		expect(p.log.info).toHaveBeenCalledWith('2/5 sandbox inboxes used.')
	})
})

describe('runCleanupSecrets', () => {
	it('does nothing when there are no pending setup secrets', async () => {
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await runCleanupSecrets({ name: 'acme' })

		expect(p.log.info).toHaveBeenCalledWith('No pending setup secrets are stored for this project.')
		expect(p.outro).toHaveBeenCalledWith('Nothing to clean up.')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('keeps pending setup secrets when confirmation is cancelled', async () => {
		const proj = project({
			pendingSecrets: { apiKey: 'nyk_secret', appPassword: 'Sup3rSecret!!x' },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(p.isCancel).mockReturnValueOnce(true)

		await runCleanupSecrets({})

		expect(p.cancel).toHaveBeenCalledWith('Cleanup cancelled — pending setup secrets were kept.')
		expect(proj.pendingSecrets).toEqual({ apiKey: 'nyk_secret', appPassword: 'Sup3rSecret!!x' })
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('keeps pending setup secrets when the typed project name does not match', async () => {
		const proj = project({ pendingSecrets: { apiKey: 'nyk_secret' } })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('wrong')

		await runCleanupSecrets({})

		expect(p.cancel).toHaveBeenCalledWith('Cleanup cancelled — pending setup secrets were kept.')
		expect(proj.pendingSecrets).toEqual({ apiKey: 'nyk_secret' })
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('clears pending setup secrets without printing secret values', async () => {
		const proj = project({
			pendingSecrets: {
				apiKey: 'nyk_secret',
				clientSecret: 'client-secret',
				appPassword: 'Sup3rSecret!!x',
			},
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')

		await runCleanupSecrets({})

		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('Nylas API key')
		expect(warning).toContain('Legacy Nylas application client secret')
		expect(warning).toContain('Inbox password awaiting final verification')
		expect(warning).not.toContain('nyk_secret')
		expect(warning).not.toContain('client-secret')
		expect(warning).not.toContain('Sup3rSecret!!x')
		expect(proj.pendingSecrets).toEqual({})
		expect(saveProject).toHaveBeenCalledWith(proj)
		expect(p.outro).toHaveBeenCalledWith(
			'Pending setup secrets cleared from local state/keyring. Remote resources and mail were untouched.',
		)
	})
})

describe('runDeleteProject', () => {
	it('refuses to claim a non-Cloudflare hosted deployment was deleted', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ hostingProvider: 'vercel' }))
		await expect(runDeleteProject({ hosted: true })).rejects.toThrow(/cannot delete this vercel deployment/)
		expect(deleteProject).not.toHaveBeenCalled()
	})
	function ok() {
		return { code: 0, stdout: '', stderr: '' }
	}

	it('deletes only local project state by default', async () => {
		const proj = project({
			hostingProvider: 'manual',
			workerName: 'w1',
			kvNamespaceId: 'kv1',
			inboxEmail: 'hi@acme.com',
			pendingSecrets: { apiKey: 'nyk_secret', appPassword: 'Sup3rSecret!!x' },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')

		await runDeleteProject({ name: 'acme' })

		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('local OwnMail project "acme"')
		expect(warning).toContain('Cancel and re-run with --hosted')
		expect(warning).toContain('Manual hosting content is outside OwnMail state')
		expect(warning).toContain('Your inbox (hi@acme.com), domain, mail, and Nylas resources are NOT touched')
		expect(runWrangler).not.toHaveBeenCalled()
		expect(proj.pendingSecrets).toEqual({})
		expect(deleteProject).toHaveBeenCalledWith('acme')
		expect(p.outro).toHaveBeenCalledWith(
			'Project deleted locally. Remote hosted content and Nylas resources were left untouched.',
		)
	})

	it('deletes recorded Cloudflare hosted content when --hosted is passed', async () => {
		const proj = project({ workerName: 'w1', kvNamespaceId: 'kv1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue(ok())

		await runDeleteProject({ hosted: true })

		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('Because --hosted was passed')
		expect(warning).toContain('Cloudflare worker w1')
		expect(warning).toContain('Cloudflare KV namespace')
		expect(runWrangler).toHaveBeenCalledWith(['delete', '--name', 'w1', '--force'])
		expect(runWrangler).toHaveBeenCalledWith(['kv', 'namespace', 'delete', '--namespace-id', 'kv1'])
		expect(p.log.step).toHaveBeenCalledWith('Worker w1 deleted.')
		expect(p.log.step).toHaveBeenCalledWith('Session storage deleted.')
		expect(deleteProject).toHaveBeenCalledWith('acme')
		expect(saveProject).not.toHaveBeenCalled()
		expect(p.outro).toHaveBeenCalledWith(
			'Project deleted locally. Recorded Cloudflare hosted resources were deleted first.',
		)
	})

	it('handles --hosted when no Cloudflare resources are recorded', async () => {
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')

		await runDeleteProject({ hosted: true })

		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('no Cloudflare worker or KV namespace is recorded')
		expect(p.log.info).toHaveBeenCalledWith('No Cloudflare hosted resources are recorded for this project.')
		expect(runWrangler).not.toHaveBeenCalled()
		expect(deleteProject).toHaveBeenCalledWith('acme')
	})

	it('keeps local state when delete confirmation is cancelled', async () => {
		const proj = project({ pendingSecrets: { apiKey: 'nyk_secret' } })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(p.isCancel).mockReturnValueOnce(true)

		await runDeleteProject({})

		expect(p.cancel).toHaveBeenCalledWith('Delete cancelled — project state was kept.')
		expect(proj.pendingSecrets).toEqual({ apiKey: 'nyk_secret' })
		expect(deleteProject).not.toHaveBeenCalled()
		expect(runWrangler).not.toHaveBeenCalled()
	})

	it('keeps local state when the typed project name does not match', async () => {
		const proj = project({ pendingSecrets: { apiKey: 'nyk_secret' } })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('wrong')

		await runDeleteProject({})

		expect(p.cancel).toHaveBeenCalledWith('Delete cancelled — project state was kept.')
		expect(proj.pendingSecrets).toEqual({ apiKey: 'nyk_secret' })
		expect(deleteProject).not.toHaveBeenCalled()
	})

	it('keeps local state when hosted worker deletion fails', async () => {
		const proj = project({ workerName: 'w1', pendingSecrets: { apiKey: 'nyk_secret' } })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue({ code: 1, stdout: '', stderr: 'auth error' })

		await expect(runDeleteProject({ hosted: true })).rejects.toThrow(/Safe Cloudflare recovery/)
		expect(cloudflareFailure).toHaveBeenCalledWith(
			'delete the mailbox app',
			{ code: 1, stdout: '', stderr: 'auth error' },
			{ mayHaveChanged: true },
		)

		expect(proj.pendingSecrets).toEqual({ apiKey: 'nyk_secret' })
		expect(deleteProject).not.toHaveBeenCalled()
	})

	it('keeps local state when hosted KV deletion fails for a real reason', async () => {
		const proj = project({ kvNamespaceId: 'kv1', pendingSecrets: { apiKey: 'nyk_secret' } })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue({ code: 1, stdout: 'denied', stderr: '' })

		await expect(runDeleteProject({ hosted: true })).rejects.toThrow(/Safe Cloudflare recovery/)

		expect(proj.pendingSecrets).toEqual({ apiKey: 'nyk_secret' })
		expect(deleteProject).not.toHaveBeenCalled()
	})

	it('warns when the local project file is already gone', async () => {
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(deleteProject).mockReturnValueOnce(false)

		await runDeleteProject({})

		expect(p.log.warn).toHaveBeenCalledWith('Local project state for "acme" was already gone.')
		expect(p.outro).toHaveBeenCalled()
	})
})

describe('runDestroy', () => {
	it('directs non-Cloudflare cleanup to the owning runtime', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ hostingProvider: 'local' }))
		await expect(runDestroy({})).rejects.toThrow(/cannot delete this local deployment/)
		expect(saveProject).not.toHaveBeenCalled()
	})
	function ok() {
		return { code: 0, stdout: '', stderr: '' }
	}

	it('tears down worker + KV and resets deploy state on confirmation', async () => {
		const proj = project({
			workerName: 'w1',
			kvNamespaceId: 'kv1',
			inboxEmail: 'hi@acme.com',
			workersDevUrl: 'https://w.dev',
			completedSteps: ['app', 'deploy', 'verify', 'grant'],
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue(ok())
		await runDestroy({})
		const [[warn]] = vi.mocked(p.log.warn).mock.calls
		expect(warn).toContain('Cloudflare worker w1')
		expect(warn).toContain('KV namespace')
		expect(warn).toContain('hi@acme.com')
		expect(p.log.step).toHaveBeenCalledWith('Worker w1 deleted.')
		expect(p.log.step).toHaveBeenCalledWith('Session storage deleted.')
		// Deploy state cleared; Nylas ids (grant) retained.
		expect(proj.workersDevUrl).toBeUndefined()
		expect(proj.workerName).toBeUndefined()
		expect(proj.kvNamespaceId).toBeUndefined()
		expect(proj.completedSteps).toEqual(['app', 'grant'])
		expect(saveProject).toHaveBeenCalledWith(proj)
		expect(p.outro).toHaveBeenCalled()
	})

	it('renders placeholder lines when no worker/KV/inbox exist', async () => {
		const proj = project({ completedSteps: ['app'] })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		await runDestroy({})
		const [[warn]] = vi.mocked(p.log.warn).mock.calls
		expect(warn).not.toContain('Cloudflare worker')
		expect(warn).not.toContain('KV namespace')
		expect(warn).toContain('(—)')
		expect(runWrangler).not.toHaveBeenCalled()
		expect(saveProject).toHaveBeenCalledWith(proj)
	})

	it('aborts when the confirmation prompt is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1' }))
		vi.mocked(p.text).mockResolvedValue('anything')
		vi.mocked(p.isCancel).mockReturnValue(true)
		await runDestroy({})
		expect(p.cancel).toHaveBeenCalledWith('Destroy cancelled — nothing was deleted.')
		expect(runWrangler).not.toHaveBeenCalled()
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('aborts when the typed name does not match', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ slug: 'acme', workerName: 'w1' }))
		vi.mocked(p.text).mockResolvedValue('wrong')
		await runDestroy({})
		expect(p.cancel).toHaveBeenCalledWith('Destroy cancelled — nothing was deleted.')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('tolerates an already-absent worker and KV namespace', async () => {
		const proj = project({ workerName: 'w1', kvNamespaceId: 'kv1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockImplementation(async (args) =>
			args[0] === 'delete'
				? { code: 1, stdout: 'worker not found', stderr: '' }
				: { code: 1, stdout: '', stderr: 'namespace not found' },
		)
		await runDestroy({})
		expect(p.log.step).toHaveBeenCalledWith('Worker w1 deleted.')
		expect(p.log.step).toHaveBeenCalledWith('Session storage deleted.')
		expect(saveProject).toHaveBeenCalledWith(proj)
	})

	it('throws when worker deletion fails for a real reason', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1' }))
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue({ code: 1, stdout: '', stderr: 'auth error' })
		await expect(runDestroy({})).rejects.toThrow(/Safe Cloudflare recovery/)
	})

	it('uses safe recovery guidance for worker deletion errors', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1' }))
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue({ code: 1, stdout: 'stdout error', stderr: '' })
		await expect(runDestroy({})).rejects.toThrow(/Safe Cloudflare recovery/)
	})

	it('uses safe recovery guidance in the KV failure warning', async () => {
		const proj = project({ workerName: 'w1', kvNamespaceId: 'kv1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockImplementation(async (args) =>
			args[0] === 'delete'
				? { code: 0, stdout: '', stderr: '' }
				: { code: 1, stdout: 'stdout denied', stderr: '' },
		)
		await runDestroy({})
		expect(p.log.warn).toHaveBeenCalledWith('Safe Cloudflare recovery')
	})

	it('warns but continues when KV deletion fails for a real reason', async () => {
		const proj = project({ workerName: 'w1', kvNamespaceId: 'kv1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockImplementation(async (args) =>
			args[0] === 'delete'
				? { code: 0, stdout: '', stderr: '' }
				: { code: 1, stdout: '', stderr: 'permission denied' },
		)
		await runDestroy({})
		expect(p.log.warn).toHaveBeenCalledWith('Safe Cloudflare recovery')
		expect(saveProject).toHaveBeenCalledWith(proj)
	})
})
