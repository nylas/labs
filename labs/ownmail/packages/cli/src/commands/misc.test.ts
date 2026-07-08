import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runDestroy, runGrants, runLogin } from './misc.js'

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
	NylasV3Client: vi.fn().mockImplementation(() => ({ listGrants })),
}))
vi.mock('../deploy/wrangler.js', () => ({ runWrangler: vi.fn() }))
vi.mock('../nylas-env.js', () => ({ apiBaseUrl: vi.fn(() => 'https://api.example.com') }))
vi.mock('../state/store.js', () => ({
	clearAuth: vi.fn(),
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
import { runWrangler } from '../deploy/wrangler.js'
import { clearAuth, saveProject } from '../state/store.js'
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

describe('runDestroy', () => {
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
		await expect(runDestroy({})).rejects.toThrow(/Failed to delete worker: auth error/)
	})

	it('falls back to stdout in the worker failure message', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: 'w1' }))
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockResolvedValue({ code: 1, stdout: 'stdout error', stderr: '' })
		await expect(runDestroy({})).rejects.toThrow(/Failed to delete worker: stdout error/)
	})

	it('falls back to stdout in the KV failure warning', async () => {
		const proj = project({ workerName: 'w1', kvNamespaceId: 'kv1' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('acme')
		vi.mocked(runWrangler).mockImplementation(async (args) =>
			args[0] === 'delete'
				? { code: 0, stdout: '', stderr: '' }
				: { code: 1, stdout: 'stdout denied', stderr: '' },
		)
		await runDestroy({})
		expect(p.log.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not delete KV namespace: stdout denied'),
		)
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
		expect(p.log.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not delete KV namespace: permission denied'),
		)
		expect(saveProject).toHaveBeenCalledWith(proj)
	})
})
