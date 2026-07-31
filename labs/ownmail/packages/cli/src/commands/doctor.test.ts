import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBHOOK_TRIGGER_TYPES } from '../deploy/webhook.js'
import type { ProjectState } from '../state/schema.js'
import { runDoctor } from './doctor.js'

const hoisted = vi.hoisted(() => ({
	v3: {
		listGrants: vi.fn(),
		listRedirectUris: vi.fn(),
		ensureRedirectUris: vi.fn(),
		ensureWebhook: vi.fn(),
		rotateWebhookSecret: vi.fn(),
	},
}))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	log: { message: vi.fn() },
}))

vi.mock('@nylas-labs/cli-kit', () => ({
	NylasV3Client: vi.fn(function NylasV3ClientMock() {
		return hoisted.v3
	}),
}))

vi.mock('../deploy/wrangler.js', () => ({
	wranglerLoggedIn: vi.fn(),
	putSecret: vi.fn(),
}))

vi.mock('node:fs', () => ({ rmSync: vi.fn() }))
vi.mock('../deploy/materialize.js', () => ({ materializeVercel: vi.fn(() => ({ dir: '/tmp/vercel' })) }))
vi.mock('../deploy/provider-cli.js', () => ({
	deployVercel: vi.fn(async () => 'https://acme.vercel.app'),
	ensureVercelProject: vi.fn(),
	ensureVercelRealtimeStore: vi.fn(),
	setVercelEnvironment: vi.fn(),
}))

vi.mock('../nylas-env.js', () => ({
	apiBaseUrl: vi.fn(() => 'https://api.us.nylas.com'),
}))

vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(),
	requireDashboard: vi.fn(),
	requireGateway: vi.fn(),
	tokens: vi.fn(() => ({ userToken: 't' })),
}))

vi.mock('./shared.js', () => ({
	pickExistingProject: vi.fn(),
	formatCommandError: vi.fn((err: unknown) =>
		err instanceof Error ? `Safe failure: ${err.message}` : 'Safe failure',
	),
	supportReference: vi.fn((err: { requestId?: string }) =>
		err?.requestId
			? `Request ID: ${err.requestId}. Include this ID if you contact Nylas Support.`
			: undefined,
	),
}))

vi.mock('../state/store.js', () => ({
	listProjectStateIssues: vi.fn(() => []),
	saveProject: vi.fn(),
}))

vi.mock('../state/pending-secrets.js', () => ({
	clearPendingSecret: vi.fn((project: ProjectState) => {
		delete project.pendingSecrets.apiKey
	}),
	storePendingSecret: vi.fn(),
}))

import * as p from '@clack/prompts'
import { putSecret, wranglerLoggedIn } from '../deploy/wrangler.js'
import { clearPendingSecret, storePendingSecret } from '../state/pending-secrets.js'
import { listProjectStateIssues, saveProject } from '../state/store.js'
import { createContext, requireDashboard, requireGateway } from '../steps/context.js'
import { pickExistingProject } from './shared.js'

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		apiKeyId: 'key_1',
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	} as ProjectState
}

const currentSession = vi.fn()
const getInboxDomain = vi.fn()
const listApiKeys = vi.fn()
const createApiKey = vi.fn()
const revokeApiKey = vi.fn()

/** Collects the icon+message lines emitted for the report. */
function messages(): string[] {
	return vi.mocked(p.log.message).mock.calls.map((c) => String(c[0]))
}

let savedExitCode: typeof process.exitCode

beforeEach(() => {
	vi.clearAllMocks()
	savedExitCode = process.exitCode
	process.exitCode = undefined
	vi.mocked(requireDashboard).mockReturnValue({ currentSession, getInboxDomain } as never)
	vi.mocked(requireGateway).mockReturnValue({ listApiKeys, createApiKey, revokeApiKey } as never)
	vi.mocked(listProjectStateIssues).mockReturnValue([])
	listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'active' }])
	createApiKey.mockResolvedValue({ id: 'probe-key', apiKey: 'nyk_probe' })
	revokeApiKey.mockResolvedValue(undefined)
	vi.mocked(putSecret).mockResolvedValue(undefined)
	vi.mocked(wranglerLoggedIn).mockResolvedValue(true)
	hoisted.v3.listGrants.mockResolvedValue({ data: [] })
	hoisted.v3.listRedirectUris.mockResolvedValue({ data: [] })
	hoisted.v3.ensureRedirectUris.mockResolvedValue(undefined)
	hoisted.v3.ensureWebhook.mockResolvedValue({ id: 'webhook-1', webhook_secret: 'wh-secret' })
	hoisted.v3.rotateWebhookSecret.mockResolvedValue({ data: {} })
})

afterEach(() => {
	process.exitCode = savedExitCode
	vi.unstubAllGlobals()
})

describe('runDoctor — healthy project', () => {
	it('reports a revoked API key and repairs it with --fix', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				workerName: 'worker-1',
				hostingProvider: 'cloudflare',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'revoked' }])
		createApiKey.mockResolvedValue({
			id: 'key_2',
			apiKey: 'nyk_replacement',
			status: 'active',
			name: 'repair',
		})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(messages().some((m) => m.includes('Nylas API key') && m.includes('revoked'))).toBe(true)
		expect(messages().some((m) => m.includes('doctor --fix'))).toBe(true)
		expect(process.exitCode).toBe(1)

		process.exitCode = undefined
		vi.mocked(p.log.message).mockClear()
		vi.mocked(p.outro).mockClear()
		await runDoctor({ fix: true })

		expect(putSecret).toHaveBeenCalledWith('worker-1', 'NYLAS_API_KEY', 'nyk_replacement')
		expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: 'key_2' }))
		expect(storePendingSecret).toHaveBeenCalledWith(expect.anything(), 'apiKey', 'nyk_replacement', {
			allowLocalFallback: false,
		})
		expect(revokeApiKey).toHaveBeenCalledWith({ userToken: 't' }, 'us', 'app_1', 'key_1')
		expect(messages().some((m) => m.startsWith('🔧') && m.includes('rotated and stored in Cloudflare'))).toBe(
			true,
		)
	})

	it('repairs the deployed key even when the OS credential store is unavailable', async () => {
		const project = makeProject({
			applicationId: 'app_1',
			workerName: 'worker-1',
			hostingProvider: 'cloudflare',
			pendingSecrets: { apiKey: 'obsolete' },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'revoked' }])
		createApiKey.mockResolvedValue({
			id: 'key_2',
			apiKey: 'nyk_replacement',
			status: 'active',
			name: 'repair',
		})
		vi.mocked(storePendingSecret).mockImplementationOnce(() => {
			throw new Error('keyring unavailable')
		})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })

		expect(clearPendingSecret).toHaveBeenCalledWith(project, 'apiKey')
		expect(messages().some((message) => message.includes('credential store was unavailable'))).toBe(true)
	})

	it('reports an expired API key without exposing key material', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ applicationId: 'app_1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'active', expiresAt: 1 }])
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(messages().some((m) => m.includes('Nylas API key') && m.includes('expired'))).toBe(true)
		expect(messages().join('\n')).not.toContain('nyk_')
	})

	it('distinguishes missing, inactive, and still-valid millisecond-expiry API keys', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ applicationId: 'app_1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn())

		listApiKeys.mockResolvedValue([{ id: 'another-key', status: 'active' }])
		await runDoctor({})
		expect(messages().some((m) => m.includes('not found in Nylas'))).toBe(true)

		vi.mocked(p.log.message).mockClear()
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: '' }])
		await runDoctor({})
		expect(messages().some((m) => m.includes('inactive'))).toBe(true)

		vi.mocked(p.log.message).mockClear()
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'active', expiresAt: Date.now() + 3_600_000 }])
		await runDoctor({})
		expect(messages().some((m) => m.includes('Nylas API key: active'))).toBe(true)
	})

	it('does not mint an API-key replacement until Cloudflare is authenticated', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				workerName: 'worker-1',
				hostingProvider: 'cloudflare',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'revoked' }])
		vi.mocked(wranglerLoggedIn).mockResolvedValue(false)
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })

		expect(createApiKey).not.toHaveBeenCalled()
		expect(putSecret).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('authenticate Cloudflare'))).toBe(true)
	})

	it('reports missing local API-key tracking and repairs it without revoking another key', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				apiKeyId: undefined,
				workerName: 'worker-1',
				hostingProvider: 'cloudflare',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		createApiKey.mockResolvedValue({
			id: 'key_2',
			apiKey: 'nyk_replacement',
			status: 'active',
			name: 'repair',
		})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })

		expect(putSecret).toHaveBeenCalledWith('worker-1', 'NYLAS_API_KEY', 'nyk_replacement')
		expect(revokeApiKey).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('rotated and stored in Cloudflare'))).toBe(true)
	})

	it('reports API-key lookup failures without provider details', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ applicationId: 'app_1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockRejectedValue(
			Object.assign(new Error('sensitive provider error'), { requestId: 'req-key-status-123' }),
		)
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		const message = messages().find((m) => m.includes('could not check key status'))
		expect(message).toBeDefined()
		expect(message).toContain('Request ID: req-key-status-123')
		expect(message).not.toContain('sensitive provider error')
	})

	it('explains when a manual or incomplete deployment cannot install an API-key replacement', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', hostingProvider: 'manual' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'revoked' }])
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })

		expect(messages().some((m) => m.includes('update NYLAS_API_KEY in your hosting provider'))).toBe(true)

		vi.mocked(p.log.message).mockClear()
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ applicationId: 'app_1' }))
		await runDoctor({ fix: true })
		expect(messages().some((m) => m.includes('missing Cloudflare Worker name'))).toBe(true)
	})

	it('leaves the previous key in place when a replacement cannot be created or stored', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', workerName: 'worker-1', hostingProvider: 'cloudflare' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'revoked' }])
		createApiKey.mockRejectedValue(new Error('forbidden'))
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })
		expect(messages().some((m) => m.includes('could not create a replacement key'))).toBe(true)

		vi.mocked(p.log.message).mockClear()
		createApiKey.mockResolvedValue({
			id: 'key_2',
			apiKey: 'nyk_replacement',
			status: 'active',
			name: 'repair',
		})
		vi.mocked(putSecret).mockRejectedValue(new Error('Cloudflare failure'))
		await runDoctor({ fix: true })

		expect(revokeApiKey).toHaveBeenCalledWith({ userToken: 't' }, 'us', 'app_1', 'key_2')
		expect(messages().some((m) => m.includes('could not store a replacement in Cloudflare'))).toBe(true)
		expect(saveProject).not.toHaveBeenCalled()

		vi.mocked(p.log.message).mockClear()
		revokeApiKey.mockRejectedValue(
			Object.assign(new Error('cleanup failed'), { requestId: 'req-cleanup-123' }),
		)
		await runDoctor({ fix: true })
		expect(messages().some((m) => m.includes('could not store a replacement in Cloudflare'))).toBe(true)
		expect(messages().some((m) => m.includes('Request ID: req-cleanup-123'))).toBe(true)

		vi.mocked(p.log.message).mockClear()
		revokeApiKey.mockRejectedValue(new Error('cleanup failed'))
		await runDoctor({ fix: true })
		expect(messages().some((m) => m.includes('could not store a replacement in Cloudflare'))).toBe(true)
		expect(messages().some((m) => m.includes('Request ID:'))).toBe(false)
	})

	it('flags a replacement whose previous API key cannot be revoked', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', workerName: 'worker-1', hostingProvider: 'cloudflare' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		listApiKeys.mockResolvedValue([{ id: 'key_1', status: 'revoked' }])
		createApiKey.mockResolvedValue({
			id: 'key_2',
			apiKey: 'nyk_replacement',
			status: 'active',
			name: 'repair',
		})
		revokeApiKey.mockRejectedValue(new Error('cleanup failed'))
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })

		expect(messages().some((m) => m.includes('previous key still needs to be revoked'))).toBe(true)
	})

	it('repairs missing redirect URIs with --fix and revokes the temporary API key', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				domainId: 'dom_1',
				grantId: 'grant_1',
				inboxEmail: 'contact@acme.com',
				workerName: 'acme-ownmail',
				workersDevUrl: 'https://acme.workers.dev',
				appDomain: 'mail.acme.com',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		getInboxDomain.mockResolvedValue({
			domainAddress: 'acme.com',
			verifiedOwnership: true,
			verifiedMx: true,
		})
		hoisted.v3.listGrants.mockResolvedValue({ data: [{ id: 'grant_1', grant_status: 'valid' }] })
		hoisted.v3.listRedirectUris.mockResolvedValue({ data: [] })
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '1.2.0' }) })),
		)

		await runDoctor({ fix: true })

		expect(createApiKey).toHaveBeenCalled()
		expect(hoisted.v3.ensureRedirectUris).toHaveBeenCalledWith([
			'http://localhost:3000/auth/callback',
			'https://acme.workers.dev/auth/callback',
			'https://mail.acme.com/auth/callback',
		])
		expect(hoisted.v3.ensureWebhook).toHaveBeenCalledWith(
			'https://mail.acme.com/api/webhooks/nylas',
			WEBHOOK_TRIGGER_TYPES,
		)
		expect(fetch).toHaveBeenCalledWith('https://mail.acme.com/healthz')
		expect(revokeApiKey).toHaveBeenCalledWith({ userToken: 't' }, 'us', 'app_1', 'probe-key')
		const msgs = messages()
		expect(msgs.some((m) => m.startsWith('✅') && m.includes('valid'))).toBe(true)
		expect(msgs.some((m) => m.startsWith('🔧') && m.includes('registered missing callbacks'))).toBe(true)
		expect(msgs.some((m) => m.startsWith('🔧') && m.includes('registered realtime webhook'))).toBe(true)
		expect(msgs.some((m) => m.includes('Temporary API key') && m.includes('revoked'))).toBe(true)
		expect(msgs.some((m) => m.includes('live (template 1.2.0)'))).toBe(true)
		expect(p.outro).toHaveBeenCalledWith('All checks passed.')
		expect(process.exitCode).toBeUndefined()
	})

	it('does not create temporary credentials or repair redirects by default', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				grantId: 'grant_1',
				inboxEmail: 'contact@acme.com',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '1.2.0' }) })),
		)

		await runDoctor({})

		expect(createApiKey).not.toHaveBeenCalled()
		expect(revokeApiKey).not.toHaveBeenCalled()
		expect(hoisted.v3.ensureRedirectUris).not.toHaveBeenCalled()
		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('read-only mode cannot create'))).toBe(true)
		expect(p.outro).toHaveBeenCalledWith('All completed checks passed. 3 check(s) skipped.')
	})

	it('repairs instant updates with --fix and stores a returned webhook secret', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				workerName: 'worker-1',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		hoisted.v3.ensureWebhook.mockResolvedValue({ webhook_secret: 'wh-secret' })
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '1.2.0' }) })),
		)

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).toHaveBeenCalledWith(
			'https://acme.workers.dev/api/webhooks/nylas',
			WEBHOOK_TRIGGER_TYPES,
		)
		expect(putSecret).toHaveBeenCalledWith('worker-1', 'NYLAS_WEBHOOK_SECRET', 'wh-secret')
		expect(messages().some((m) => m.startsWith('🔧') && m.includes('registered realtime webhook'))).toBe(true)
	})

	it('does not repair instant updates until Cloudflare authentication succeeds', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				hostingProvider: 'cloudflare',
				applicationId: 'app_1',
				workerName: 'worker-1',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		vi.mocked(wranglerLoggedIn).mockResolvedValue(false)
		hoisted.v3.ensureWebhook.mockResolvedValue({ webhook_secret: 'wh-secret' })
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '1.2.0' }) })),
		)

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(putSecret).not.toHaveBeenCalled()
		expect(
			messages().some((m) => m.includes('Cloudflare authentication before the webhook secret can be stored')),
		).toBe(true)
	})

	it('reports that manual hosting uses polling under --fix', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'manual', manualAppUrl: 'https://manual.acme.com' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '1.2.0' }) })),
		)

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('manual hosting uses polling'))).toBe(true)
	})

	it('reports that local hosting uses polling under --fix', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'local', localAppUrl: 'http://localhost:3000' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('this hosting mode uses polling'))).toBe(true)
	})

	it('requires Nylas API access to repair Netlify instant updates', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'netlify', providerAppUrl: 'https://acme.netlify.app' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(messages().some((message) => message.includes('requires Nylas API access'))).toBe(true)
	})

	it('repairs instant updates on Vercel under --fix', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				hostingProvider: 'vercel',
				providerAppUrl: 'https://acme.vercel.app',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		hoisted.v3.ensureWebhook.mockResolvedValue({ id: 'webhook-1', webhook_secret: 'wh-secret' })
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).toHaveBeenCalledWith(
			'https://acme.vercel.app/api/webhooks/nylas',
			expect.any(Array),
		)
		expect(messages().some((message) => message.includes('registered realtime webhook'))).toBe(true)
	})

	it('reports missing app URL when instant updates cannot be repaired', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'cloudflare', applicationId: 'app_1', completedSteps: ['deploy'] }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('missing public HTTPS app URL'))).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('skips instant updates repair until the app URL is healthy', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				hostingProvider: 'cloudflare',
				applicationId: 'app_1',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 503 })),
		)

		await runDoctor({ fix: true })

		expect(hoisted.v3.ensureWebhook).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('skipped until the app URL is healthy'))).toBe(true)
	})

	it('reports instant updates repair failures without provider details', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				hostingProvider: 'cloudflare',
				applicationId: 'app_1',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		hoisted.v3.ensureWebhook.mockRejectedValue(
			Object.assign(new Error('unable.verify.webhook_url'), { requestId: 'req-doctor-webhook-123' }),
		)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '1.2.0' }) })),
		)

		await runDoctor({ fix: true })

		const instant = messages().find((m) => m.includes('Instant updates'))
		expect(instant).toContain('could not register realtime webhook')
		expect(instant).toContain('Request ID: req-doctor-webhook-123')
		expect(instant).not.toContain('unable.verify.webhook_url')
		expect(process.exitCode).toBe(1)
	})
})

describe('runDoctor — failures and skips', () => {
	it('rethrows project selection errors when local state is not malformed', async () => {
		vi.mocked(pickExistingProject).mockRejectedValue(new Error('No projects yet'))

		await expect(runDoctor({})).rejects.toThrow('No projects yet')
	})

	it('reports an expired session and unreachable worker; skips gated checks', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				domainId: 'dom_1',
				grantId: 'grant_1',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockRejectedValue(new Error('401'))
		vi.mocked(wranglerLoggedIn).mockResolvedValue(false)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('ECONNREFUSED')
			}),
		)

		await runDoctor({})

		expect(createApiKey).not.toHaveBeenCalled()
		const msgs = messages()
		expect(msgs.some((m) => m.startsWith('❌') && m.includes('expired'))).toBe(true)
		expect(msgs.some((m) => m.includes('run any ownmail deploy command'))).toBe(true)
		expect(msgs.some((m) => m.includes('unreachable'))).toBe(true)
		expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('need attention'))
		expect(process.exitCode).toBe(1)
	})

	it('skips the session check entirely when not authenticated', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(createContext).mockResolvedValue({ auth: null, v3: null } as never)
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(currentSession).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('expired'))).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('reuses an existing API client, flags an unverified domain and a missing grant', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				domainId: 'dom_1',
				grantId: 'grant_1',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		getInboxDomain.mockResolvedValue({
			domainAddress: 'acme.com',
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
		})
		hoisted.v3.listGrants.mockResolvedValue({ data: [] })
		hoisted.v3.listRedirectUris.mockResolvedValue({
			data: [
				{ url: 'https://acme.workers.dev/auth/callback' },
				{ url: 'http://localhost:3000/auth/callback' },
			],
		})
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 503 })),
		)

		await runDoctor({})

		expect(createApiKey).not.toHaveBeenCalled()
		const msgs = messages()
		expect(msgs.some((m) => m.includes('ownership, mx, spf, dkim'))).toBe(true)
		expect(msgs.some((m) => m.includes('grant missing'))).toBe(true)
		expect(msgs.some((m) => m.includes('registered') && !m.includes('re-registered'))).toBe(true)
		expect(hoisted.v3.ensureRedirectUris).not.toHaveBeenCalled()
		expect(msgs.some((m) => m.includes('HTTP 503'))).toBe(true)
	})

	it('reports a partially-verified domain (only mx failing)', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ domainId: 'dom_1' }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		getInboxDomain.mockResolvedValue({
			domainAddress: 'acme.com',
			verifiedOwnership: true,
			verifiedMx: false,
			verifiedSpf: true,
			verifiedDkim: true,
		})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		const detail = messages().find((m) => m.includes('unverified checks'))
		expect(detail).toContain('mx')
		expect(detail).not.toContain('ownership')
		expect(detail).not.toContain('spf')
		expect(detail).not.toContain('dkim')
	})

	it('reports temporary API key creation failure and the domain fetch error under --fix', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', domainId: 'dom_1', workersDevUrl: 'https://acme.workers.dev' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		createApiKey.mockRejectedValue(new Error('mint failed'))
		getInboxDomain.mockRejectedValue(new Error('boom'))
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({}) })),
		)

		await runDoctor({ fix: true })

		const msgs = messages()
		expect(msgs.some((m) => m.includes('could not create a temporary API key'))).toBe(true)
		expect(msgs.some((m) => m.includes('could not fetch domain state'))).toBe(true)
		expect(hoisted.v3.listGrants).not.toHaveBeenCalled()
		expect(msgs.some((m) => m.includes('live (template ?)'))).toBe(true)
	})

	it('skips API-key minting when the session works but there is no application', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(createApiKey).not.toHaveBeenCalled()
		expect(messages().some((m) => m.startsWith('✅') && m.includes('valid'))).toBe(true)
		expect(p.outro).toHaveBeenCalledWith('All checks passed.')
	})

	it('defaults the grant status label when the grant has none', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', grantId: 'grant_1', inboxEmail: 'contact@acme.com' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		hoisted.v3.listGrants.mockResolvedValue({ data: [{ id: 'grant_1' }] })
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(messages().some((m) => m.includes('grant valid'))).toBe(true)
	})

	it('reports API errors from the grant and redirect-URI checks', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				grantId: 'grant_1',
				inboxEmail: 'contact@acme.com',
				workersDevUrl: 'https://acme.workers.dev',
			}),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		hoisted.v3.listGrants.mockRejectedValue(new Error('grants down'))
		hoisted.v3.listRedirectUris.mockRejectedValue(new Error('uris down'))
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '9' }) })),
		)

		await runDoctor({})

		const msgs = messages()
		expect(msgs.some((m) => m.includes('Safe failure: grants down'))).toBe(true)
		expect(msgs.some((m) => m.includes('Safe failure: uris down'))).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('reports malformed local state before project selection succeeds', async () => {
		vi.mocked(listProjectStateIssues).mockReturnValue([{ file: 'broken.json', reason: 'invalid-json' }])
		vi.mocked(pickExistingProject).mockRejectedValue(new Error('No projects yet'))

		await runDoctor({})

		expect(messages()[0]).toContain('malformed local state file(s): broken.json')
		expect(p.outro).toHaveBeenCalledWith('1 check(s) need attention.')
		expect(process.exitCode).toBe(1)
	})

	it('reports malformed local state alongside checks when project selection succeeds', async () => {
		vi.mocked(listProjectStateIssues).mockReturnValue([{ file: 'broken.json', reason: 'invalid-schema' }])
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(messages().some((m) => m.includes('malformed local state file(s): broken.json'))).toBe(true)
		expect(messages().some((m) => m.includes('Nylas session') && m.includes('valid'))).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('reports missing redirect callbacks without repairing them in read-only mode', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', workersDevUrl: 'https://acme.workers.dev' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: hoisted.v3 } as never)
		currentSession.mockResolvedValue({})
		hoisted.v3.listRedirectUris.mockResolvedValue({ data: [] })
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({}) })),
		)

		await runDoctor({})

		expect(hoisted.v3.ensureRedirectUris).not.toHaveBeenCalled()
		expect(messages().some((m) => m.includes('missing callbacks') && m.includes('doctor --fix'))).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('checks manual app health without requiring Cloudflare login', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'manual', manualAppUrl: 'https://manual.acme.com' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ templateVersion: '9' }) })),
		)

		await runDoctor({})

		expect(wranglerLoggedIn).not.toHaveBeenCalled()
		expect(fetch).toHaveBeenCalledWith('https://manual.acme.com/healthz')
		expect(process.exitCode).toBeUndefined()
	})

	it('reports a missing app URL when deploy is marked complete', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ completedSteps: ['deploy'] }))
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		vi.stubGlobal('fetch', vi.fn())

		await runDoctor({})

		expect(messages().some((m) => m.includes('App URL') && m.includes('missing from local state'))).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('reports failure when a temporary API key cannot be revoked', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ applicationId: 'app_1', workersDevUrl: 'https://acme.workers.dev' }),
		)
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' }, v3: null } as never)
		currentSession.mockResolvedValue({})
		revokeApiKey.mockRejectedValue(new Error('revoke down'))
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({}) })),
		)

		await runDoctor({ fix: true })

		expect(messages().some((m) => m.includes('Could not revoke the temporary key'))).toBe(true)
		expect(messages().some((m) => m.includes('Safe failure: revoke down'))).toBe(true)
		expect(messages().some((m) => m.includes('probe-key'))).toBe(false)
		expect(process.exitCode).toBe(1)
	})
})
