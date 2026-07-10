import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runDoctor } from './doctor.js'

const hoisted = vi.hoisted(() => ({
	v3: {
		listGrants: vi.fn(),
		listRedirectUris: vi.fn(),
		ensureRedirectUris: vi.fn(),
	},
}))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	log: { message: vi.fn() },
}))

vi.mock('@nylas-labs/cli-kit', () => ({
	NylasV3Client: vi.fn(() => hoisted.v3),
}))

vi.mock('../deploy/wrangler.js', () => ({
	wranglerLoggedIn: vi.fn(),
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
}))

vi.mock('../state/store.js', () => ({
	listProjectStateIssues: vi.fn(() => []),
}))

import * as p from '@clack/prompts'
import { wranglerLoggedIn } from '../deploy/wrangler.js'
import { listProjectStateIssues } from '../state/store.js'
import { createContext, requireDashboard, requireGateway } from '../steps/context.js'
import { pickExistingProject } from './shared.js'

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
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

const currentSession = vi.fn()
const getInboxDomain = vi.fn()
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
	vi.mocked(requireGateway).mockReturnValue({ createApiKey, revokeApiKey } as never)
	vi.mocked(listProjectStateIssues).mockReturnValue([])
	createApiKey.mockResolvedValue({ id: 'probe-key', apiKey: 'nyk_probe' })
	revokeApiKey.mockResolvedValue(undefined)
	vi.mocked(wranglerLoggedIn).mockResolvedValue(true)
	hoisted.v3.listGrants.mockResolvedValue({ data: [] })
	hoisted.v3.listRedirectUris.mockResolvedValue({ data: [] })
	hoisted.v3.ensureRedirectUris.mockResolvedValue(undefined)
})

afterEach(() => {
	process.exitCode = savedExitCode
})

describe('runDoctor — healthy project', () => {
	it('repairs missing redirect URIs with --fix and revokes the temporary API key', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				applicationId: 'app_1',
				domainId: 'dom_1',
				grantId: 'grant_1',
				inboxEmail: 'contact@acme.com',
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
		expect(fetch).toHaveBeenCalledWith('https://mail.acme.com/healthz')
		expect(revokeApiKey).toHaveBeenCalledWith({ userToken: 't' }, 'us', 'app_1', 'probe-key')
		const msgs = messages()
		expect(msgs.some((m) => m.startsWith('✅') && m.includes('valid'))).toBe(true)
		expect(msgs.some((m) => m.startsWith('🔧') && m.includes('registered missing callbacks'))).toBe(true)
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
		expect(messages().some((m) => m.includes('read-only mode cannot create'))).toBe(true)
		expect(p.outro).toHaveBeenCalledWith('All completed checks passed. 3 check(s) skipped.')
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
		expect(msgs.some((m) => m.includes('API error: grants down'))).toBe(true)
		expect(msgs.some((m) => m.includes('uris down'))).toBe(true)
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

		expect(messages().some((m) => m.includes('could not revoke temporary key'))).toBe(true)
		expect(messages().some((m) => m.includes('probe-key'))).toBe(false)
		expect(process.exitCode).toBe(1)
	})
})
