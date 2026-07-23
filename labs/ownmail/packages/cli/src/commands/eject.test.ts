import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runEject } from './eject.js'

const CANCEL = Symbol('cancel')
const ROOT = '/fake/template/root'

vi.mock('node:fs', () => ({
	cpSync: vi.fn(),
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	writeFileSync: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	confirm: vi.fn(),
	log: { warn: vi.fn() },
	isCancel: vi.fn((v: unknown) => v === CANCEL),
}))

vi.mock('../deploy/materialize.js', () => ({
	loadManifest: vi.fn(),
	templateRoot: vi.fn(() => ROOT),
}))

vi.mock('../nylas-env.js', () => ({
	deployedApiBaseUrl: vi.fn(() => undefined),
}))

vi.mock('../state/store.js', () => ({
	saveProject: vi.fn(),
}))

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

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import { loadManifest } from '../deploy/materialize.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway } from '../steps/context.js'
import { OWNMAIL_VERSION } from '../usage-attribution.js'
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
		applicationId: 'app_1',
		orgPublicId: 'org_1',
		workerName: 'acme-ownmail',
		kvNamespaceId: 'kv_1',
		inboxEmail: 'hi@acme.com',
		...overrides,
	} as ProjectState
}

const createApiKey = vi.fn()

function writtenFile(name: string): string | undefined {
	const call = vi.mocked(writeFileSync).mock.calls.find((c) => String(c[0]).endsWith(name))
	return call ? String(call[1]) : undefined
}

let savedExitCode: typeof process.exitCode

beforeEach(() => {
	vi.clearAllMocks()
	savedExitCode = process.exitCode
	process.exitCode = undefined
	// Template files exist; the eject target does not.
	vi.mocked(existsSync).mockImplementation((path) => String(path).startsWith(ROOT))
	vi.mocked(readdirSync).mockReturnValue([])
	vi.mocked(loadManifest).mockReturnValue({
		templateVersion: '1.2.0',
		minCliVersion: '0.1.0',
		requiredSecrets: [],
		requiredVars: [],
		kvBindings: [],
		migrations: [],
	})
	vi.mocked(deployedApiBaseUrl).mockReturnValue(undefined)
	vi.mocked(p.confirm).mockResolvedValue(true as never)
	createApiKey.mockResolvedValue({ apiKey: 'nyk_minted' })
	vi.mocked(requireGateway).mockReturnValue({ createApiKey } as never)
	vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
})

afterEach(() => {
	process.exitCode = savedExitCode
})

describe('runEject — guard clauses', () => {
	it('rejects an already-ejected project', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ ejected: true }))

		await expect(runEject({})).rejects.toThrow(/already ejected/)
	})

	it('rejects a project without an application client ID', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ applicationId: '  ' }))

		await expect(runEject({})).rejects.toThrow(/client ID is missing/)
	})

	it('rejects when the target directory exists and is not empty', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(existsSync).mockReturnValue(true)
		vi.mocked(readdirSync).mockReturnValue(['file.txt'] as never)

		await expect(runEject({ dir: './out' })).rejects.toThrow(/exists and is not empty/)
	})
})

describe('runEject — confirmation', () => {
	it('aborts when the confirm prompt is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(p.confirm).mockResolvedValue(CANCEL as never)

		await runEject({})

		expect(p.cancel).toHaveBeenCalledWith('Eject cancelled.')
		expect(writeFileSync).not.toHaveBeenCalled()
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('aborts when the user declines the confirm prompt', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(p.confirm).mockResolvedValue(false as never)

		await runEject({})

		expect(p.cancel).toHaveBeenCalledWith('Eject cancelled.')
		expect(writeFileSync).not.toHaveBeenCalled()
	})
})

describe('runEject — writes the project', () => {
	it('mints a fresh API key and scaffolds the full project', async () => {
		const project = makeProject({
			appDomain: 'mail.acme.com',
			appDomains: ['mail.acme.com', 'inbox.acme.com'],
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runEject({})

		expect(createApiKey).toHaveBeenCalled()
		expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('acme'), { recursive: true })
		// All six template entries exist → all copied.
		expect(cpSync).toHaveBeenCalledTimes(6)
		expect(writtenFile('.dev.vars')).toContain('NYLAS_API_KEY=nyk_minted')
		const packageJson = JSON.parse(writtenFile('package.json') ?? '{}')
		expect(packageJson.name).toBe('acme')
		expect(packageJson.version).toBe(OWNMAIL_VERSION)
		expect(packageJson.imports['#shared/components/*']).toBe('./src/shared/components/*.tsx')
		expect(cpSync).toHaveBeenCalledWith(
			join(ROOT, 'components.json'),
			expect.stringContaining('components.json'),
			{ recursive: true },
		)
		expect(writtenFile('wrangler.jsonc')).toContain('"name": "acme-ownmail"')
		expect(writtenFile('wrangler.jsonc')).toContain('"id": "kv_1"')
		expect(JSON.parse(writtenFile('wrangler.jsonc') ?? '{}').routes).toEqual([
			{ pattern: 'mail.acme.com', custom_domain: true },
			{ pattern: 'inbox.acme.com', custom_domain: true },
		])
		expect(writtenFile('wrangler.jsonc')).not.toContain('NYLAS_API_BASE_URL')
		expect(writtenFile('README.md')).toContain('hi@acme.com')
		expect(project.ejected).toBe(true)
		expect(saveProject).toHaveBeenCalledWith(project)
		expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('all yours'))
	})

	it('warns and uses a placeholder API key when minting fails', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		createApiKey.mockRejectedValue(Object.assign(new Error('expired'), { requestId: 'req-eject-key-123' }))

		await runEject({})

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not mint'))
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Request ID: req-eject-key-123'))
		expect(writtenFile('.dev.vars')).toContain('<create an API key in the Nylas dashboard>')
		expect(saveProject).toHaveBeenCalled()
	})

	it.each(['vercel', 'netlify'] as const)(
		'does not export Cloudflare custom-domain routes for %s projects',
		async (hostingProvider) => {
			vi.mocked(pickExistingProject).mockResolvedValue(
				makeProject({
					hostingProvider,
					appDomain: 'mail.acme.com',
					appDomains: ['mail.acme.com'],
				}),
			)

			await runEject({})

			expect(JSON.parse(writtenFile('wrangler.jsonc') ?? '{}').routes).toBeUndefined()
		},
	)

	it('omits the support reference when API-key minting has no request ID', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		createApiKey.mockRejectedValue(new Error('expired'))

		await runEject({})

		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('Could not mint')
		expect(warning).not.toContain('Request ID:')
	})

	it('skips minting when not logged in and falls back to defaults', async () => {
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)
		vi.mocked(deployedApiBaseUrl).mockReturnValue('https://api-staging.us.nylas.com')
		vi.mocked(existsSync).mockImplementation(
			(path) => String(path).startsWith(ROOT) && !String(path).endsWith('public'),
		)
		const project = makeProject({
			workerName: undefined,
			kvNamespaceId: undefined,
			inboxEmail: undefined,
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runEject({ dir: './custom-dir' })

		expect(createApiKey).not.toHaveBeenCalled()
		// 'public' entry does not exist → only 5 of 6 copied.
		expect(cpSync).toHaveBeenCalledTimes(5)
		expect(writtenFile('.dev.vars')).toContain('<create an API key in the Nylas dashboard>')
		// Worker name falls back to `${slug}-ownmail`.
		expect(writtenFile('wrangler.jsonc')).toContain('"name": "acme-ownmail"')
		// Empty KV id and inbox email.
		expect(writtenFile('wrangler.jsonc')).toContain('"id": ""')
		expect(writtenFile('wrangler.jsonc')).toContain('NYLAS_API_BASE_URL')
		expect(cpSync).not.toHaveBeenCalledWith(join(ROOT, 'public'), expect.anything(), expect.anything())
	})
})
