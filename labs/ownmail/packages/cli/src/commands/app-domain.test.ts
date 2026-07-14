import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runAppDomain } from './app-domain.js'

const { ensureRedirectUris } = vi.hoisted(() => ({ ensureRedirectUris: vi.fn() }))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	text: vi.fn(),
	isCancel: vi.fn(() => false),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
	log: { step: vi.fn(), warn: vi.fn() },
}))
vi.mock('@nylas-labs/cli-kit', () => ({
	NylasV3Client: vi.fn().mockImplementation(() => ({ ensureRedirectUris })),
}))
vi.mock('../deploy/materialize.js', () => ({
	loadManifest: vi.fn(() => ({ templateVersion: '3.0.0' })),
	materialize: vi.fn(() => ({ configPath: '/tmp/wrangler.json' })),
}))
vi.mock('../deploy/wrangler.js', () => ({ deploy: vi.fn() }))
vi.mock('../nylas-env.js', () => ({
	apiBaseUrl: vi.fn(() => 'https://api.example.com'),
	deployedApiBaseUrl: vi.fn(() => undefined),
}))
vi.mock('../state/store.js', () => ({ saveProject: vi.fn() }))
vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(),
	requireGateway: vi.fn(),
	tokens: vi.fn(() => ({ userToken: 't' })),
}))
vi.mock('../steps/deploy.js', () => ({ ensureCloudflareAuth: vi.fn() }))
vi.mock('../steps/provision.js', () => ({
	CancelledError: class CancelledError extends Error {
		constructor() {
			super('Cancelled')
			this.name = 'CancelledError'
		}
	},
}))
vi.mock('./shared.js', () => ({ pickExistingProject: vi.fn() }))

import * as p from '@clack/prompts'
import { materialize } from '../deploy/materialize.js'
import { deploy } from '../deploy/wrangler.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway } from '../steps/context.js'
import { ensureCloudflareAuth } from '../steps/deploy.js'
import { CancelledError } from '../steps/provision.js'
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
		workerName: 'w1',
		kvNamespaceId: 'kv1',
		applicationId: 'app-1',
		...overrides,
	} as ProjectState
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(p.isCancel).mockReturnValue(false)
	vi.mocked(deployedApiBaseUrl).mockReturnValue(undefined)
})

describe('runAppDomain', () => {
	it('refuses ejected projects', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ ejected: true }))
		await expect(runAppDomain({})).rejects.toThrow(/Ejected projects/)
	})

	it('throws when the worker is not deployed', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ workerName: undefined }))
		await expect(runAppDomain({})).rejects.toThrow(/hasn.t deployed yet/)
	})

	it('throws when the KV namespace is missing', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ kvNamespaceId: undefined }))
		await expect(runAppDomain({})).rejects.toThrow(/hasn.t deployed yet/)
	})

	it('throws when the application id is missing', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project({ applicationId: undefined }))
		await expect(runAppDomain({})).rejects.toThrow(/hasn.t deployed yet/)
	})

	it('stops the spinner and preserves the project when Cloudflare rejects domain setup', async () => {
		const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() }
		vi.mocked(p.spinner).mockReturnValueOnce(spinner as unknown as ReturnType<typeof p.spinner>)
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(deploy).mockRejectedValueOnce(new Error('Cloudflare could not deploy the mailbox app.'))

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(/could not deploy/)

		expect(spinner.stop).toHaveBeenCalledWith(
			'Cloudflare domain setup needs attention; retry `npx ownmail app-domain` when ready.',
		)
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('attaches a supplied domain, includes runtime base url + inbox, and registers redirect', async () => {
		const proj = project({ inboxEmail: 'hi@acme.com' })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(deployedApiBaseUrl).mockReturnValue('https://api-runtime.example.com')
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		vi.mocked(requireGateway).mockReturnValue({
			createApiKey: vi.fn().mockResolvedValue({ apiKey: 'k' }),
		} as never)
		await runAppDomain({ domain: 'mail.acme.com' })

		expect(p.text).not.toHaveBeenCalled()
		expect(ensureCloudflareAuth).toHaveBeenCalled()
		const [[matInput]] = vi.mocked(materialize).mock.calls
		expect(matInput.appDomain).toBe('mail.acme.com')
		expect(matInput.vars.NYLAS_API_BASE_URL).toBe('https://api-runtime.example.com')
		expect(matInput.vars.INBOX_EMAIL).toBe('hi@acme.com')
		expect(matInput.vars.TEMPLATE_VERSION).toBe('3.0.0')
		expect(deploy).toHaveBeenCalledWith('/tmp/wrangler.json')
		expect(proj.appDomain).toBe('mail.acme.com')
		expect(proj.templateVersion).toBe('3.0.0')
		expect(saveProject).toHaveBeenCalledWith(proj)
		expect(ensureRedirectUris).toHaveBeenCalledWith(['https://mail.acme.com/auth/callback'])
		expect(p.log.step).toHaveBeenCalledWith('Login redirect registered for the new domain.')
	})

	it('prompts for a domain, omits base url + inbox when absent, and warns if redirect fails', async () => {
		const proj = project({ inboxEmail: undefined })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(p.text).mockResolvedValue('mail.typed.com')
		vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
		vi.mocked(requireGateway).mockReturnValue({
			createApiKey: vi.fn().mockRejectedValue(new Error('gateway down')),
		} as never)
		await runAppDomain({})

		// Exercise the domain validator passed to p.text.
		const [[textOpts]] = vi.mocked(p.text).mock.calls
		const validate = textOpts.validate as (v: string | undefined) => string | undefined
		expect(validate('mail.example.com')).toBeUndefined()
		expect(validate('nope')).toMatch(/Enter a domain/)
		expect(validate(undefined)).toMatch(/Enter a domain/)

		const [[matInput]] = vi.mocked(materialize).mock.calls
		expect(matInput.appDomain).toBe('mail.typed.com')
		expect(matInput.vars.NYLAS_API_BASE_URL).toBeUndefined()
		expect(matInput.vars.INBOX_EMAIL).toBe('')
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not register'))
	})

	it('throws CancelledError when the domain prompt is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		vi.mocked(p.text).mockResolvedValue('x')
		vi.mocked(p.isCancel).mockReturnValue(true)
		await expect(runAppDomain({})).rejects.toBeInstanceOf(CancelledError)
	})

	it('warns to run doctor when not logged into Nylas', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)
		await runAppDomain({ domain: 'mail.acme.com' })
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Not logged into Nylas'))
		expect(requireGateway).not.toHaveBeenCalled()
	})
})
