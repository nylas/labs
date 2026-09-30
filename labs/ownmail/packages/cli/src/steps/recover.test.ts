import * as p from '@clack/prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import type { StepContext } from './context.js'
import { inferAppDomains, isDeploymentKeyName, parseSiteName, stepRecover } from './recover.js'

const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', () => ({
	log: { info: vi.fn(), warn: vi.fn() },
	select: vi.fn(),
	isCancel: vi.fn((value: unknown) => value === CANCEL),
}))

vi.mock('../state/store.js', () => ({ saveProject: vi.fn() }))

vi.mock('./provision.js', () => {
	class CancelledError extends Error {}
	return {
		CancelledError,
		isFullyVerified: vi.fn(
			(domain: { verifiedOwnership: boolean; verifiedMx: boolean }) =>
				domain.verifiedOwnership && domain.verifiedMx,
		),
		planDomain: vi.fn(),
		stepApiKey: vi.fn(),
	}
})

import { CancelledError, planDomain, stepApiKey } from './provision.js'

function project(over: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		region: 'us',
		createdAt: 0,
		updatedAt: 0,
		orgPublicId: 'org1',
		applicationId: 'app-1',
		adoptedFromAccount: true,
		// Adopted from the live deployment the user picked on their hosting account.
		hostingProvider: 'cloudflare',
		workerName: 'acme-ownmail',
		workersDevUrl: 'https://acme-ownmail.me.workers.dev',
		recoveredAppUrl: 'https://acme-ownmail.me.workers.dev',
		appDomains: [],
		ejected: false,
		completedSteps: ['dashboard-auth', 'org', 'app'],
		pendingSecrets: {},
		...over,
	} as ProjectState
}

type AccountFixture = {
	keys?: { id: string; name: string; status: string }[]
	grants?: { id: string; provider: string; email?: string }[] | null
	domains?: Record<string, unknown>[]
	redirects?: string[]
	webhooks?: { description?: string; webhook_url?: string; status?: string }[]
}

function accountCtx(proj: ProjectState, fixture: AccountFixture = {}) {
	const v3 = {
		listGrants: vi.fn(async () => ({
			data:
				fixture.grants === undefined
					? [{ id: 'grant-1', provider: 'nylas', email: 'hello@acme.nylas.email' }]
					: fixture.grants,
		})),
		listRedirectUris: vi.fn(async () => ({
			data: (fixture.redirects ?? []).map((url) => ({ url })),
		})),
		listWebhooks: vi.fn(async () => ({ data: fixture.webhooks ?? [] })),
	}
	const gateway = {
		listApiKeys: vi.fn(async () => fixture.keys ?? []),
	}
	const dashboard = {
		listInboxDomains: vi.fn(async () =>
			fixture.domains === undefined
				? [
						{
							id: 'dom-1',
							domainAddress: 'acme.nylas.email',
							region: 'us',
							branded: true,
							verifiedOwnership: true,
							verifiedMx: true,
						},
					]
				: fixture.domains,
		),
	}
	const ctx = {
		project: proj,
		auth: { userToken: 'u', dpopPrivateJwk: {}, updatedAt: 0 },
		dpop: null,
		dashboard,
		gateway,
		v3: null,
	} as unknown as StepContext
	vi.mocked(stepApiKey).mockImplementation(async (c) => {
		c.v3 = v3 as never
		c.project.apiKeyId ??= 'key-new'
	})
	return { ctx, v3, gateway, dashboard }
}

/** Stubs the deployed app's public `/login` page. */
function stubLiveApp(login: Response | Error) {
	const fetchMock = vi.fn(async (input: string | URL) => {
		const path = new URL(String(input)).pathname
		if (path !== '/login' || login instanceof Error) throw login instanceof Error ? login : new Error(path)
		return login
	})
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

function loginPage(siteName: string): Response {
	return new Response(`<head><meta name="apple-mobile-web-app-title" content="${siteName}"/></head>`)
}

beforeEach(() => {
	vi.clearAllMocks()
	// Existing deployments are unreachable unless a test says otherwise.
	stubLiveApp(new Error('offline'))
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('inferAppDomains', () => {
	it.each([
		{
			name: 'nothing for an app served only from its provider URL',
			redirects: ['http://localhost:3000/auth/callback', 'https://acme-ownmail.me.workers.dev/auth/callback'],
			webhooks: ['https://acme-ownmail.me.workers.dev/api/webhooks/nylas'],
			expected: { appDomains: [] },
		},
		{
			name: 'the custom domain that receives the webhook as the primary',
			redirects: ['https://acme-ownmail.netlify.app/auth/callback', 'https://mail.acme.com/auth/callback'],
			webhooks: ['https://mail.acme.com/api/webhooks/nylas'],
			expected: { appDomain: 'mail.acme.com', appDomains: ['mail.acme.com'] },
		},
		{
			name: 'secondary custom domains without a primary when the webhook uses the provider URL',
			redirects: ['https://acme-ownmail.vercel.app/auth/callback', 'https://inbox.acme.com/auth/callback'],
			webhooks: ['https://acme-ownmail.vercel.app/api/webhooks/nylas'],
			expected: { appDomains: ['inbox.acme.com'] },
		},
		{
			name: 'no primary when several webhook destinations are active',
			redirects: ['https://mail.acme.com/auth/callback'],
			webhooks: ['https://mail.acme.com/api/webhooks/nylas', 'https://old.acme.com/api/webhooks/nylas'],
			expected: { appDomains: ['mail.acme.com', 'old.acme.com'] },
		},
		{
			name: 'nothing for local or unparseable URLs',
			redirects: ['http://localhost:3000/auth/callback', 'http://127.0.0.1:4321/auth/callback', 'not a url'],
			webhooks: [],
			expected: { appDomains: [] },
		},
	])('infers $name', ({ redirects, webhooks, expected }) => {
		expect(inferAppDomains(redirects, webhooks)).toEqual(expected)
	})
})

describe('parseSiteName', () => {
	it.each([
		{
			name: 'decodes the escaped display name',
			html: loginPage('Zo&#x27;s Acme &amp; Co (Mail)'),
			expected: "Zo's Acme & Co (Mail)",
		},
		{ name: 'decodes decimal apostrophes', html: loginPage('Zo&#39;s Mail'), expected: "Zo's Mail" },
		// The app shows the default for unset or rejected names, so it says nothing about the user's choice.
		{ name: 'ignores the default name', html: loginPage('ownmail'), expected: undefined },
		{ name: 'ignores a name setup would reject', html: loginPage(' '), expected: undefined },
		{ name: 'ignores pages without the tag', html: new Response('<head></head>'), expected: undefined },
	])('$name', async ({ html, expected }) => {
		expect(parseSiteName(await html.text())).toBe(expected)
	})
})

describe('isDeploymentKeyName', () => {
	it.each([
		['ownmail acme 2026-01-02T03-04-05-678Z', true],
		['ownmail acme (rotated 2026-01-02)', true],
		['ownmail acme (doctor repair 2026-01-02)', true],
		// The ejected app still uses its key; revoking it would break that app.
		['ownmail acme (ejected)', false],
		// One-day diagnostic keys and other projects' keys are not this deployment's key.
		['ownmail grants 1700000000000', false],
		['ownmail acme-two 2026-01-02T03-04-05-678Z', false],
	])('%s → %s', (name, expected) => {
		expect(isDeploymentKeyName(name, 'acme')).toBe(expected)
	})
})

describe('stepRecover', () => {
	it('does nothing for projects created on this computer', async () => {
		const proj = project({ adoptedFromAccount: undefined })
		const { ctx } = accountCtx(proj)

		await stepRecover(ctx)

		expect(stepApiKey).not.toHaveBeenCalled()
		expect(proj).toEqual(project({ adoptedFromAccount: undefined }))
	})

	it('rebuilds inbox and domain around the adopted deployment so setup redeploys it instead of creating new resources', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj, {
			keys: [
				{ id: 'key-deployed', name: 'ownmail acme 2026-01-02T03-04-05-678Z', status: 'active' },
				{ id: 'key-revoked', name: 'ownmail acme (rotated 2025-06-01)', status: 'revoked' },
				{ id: 'key-temp', name: 'ownmail doctor 2026-01-02T00:00:00.000Z', status: 'active' },
			],
		})

		await stepRecover(ctx)

		expect(proj).toMatchObject({
			grantId: 'grant-1',
			inboxEmail: 'hello@acme.nylas.email',
			domainId: 'dom-1',
			domainAddress: 'acme.nylas.email',
			domainBranded: true,
			domainVerified: true,
			hostingProvider: 'cloudflare',
			workerName: 'acme-ownmail',
			// The first redeploy must land here before the old key is revoked.
			recoveredAppUrl: 'https://acme-ownmail.me.workers.dev',
			// Revoked only after the verified redeploy installs the replacement.
			pendingApiKeyRotation: { previousKeyId: 'key-deployed', replacementKeyId: 'key-new' },
		})
		expect(proj.adoptedFromAccount).toBeUndefined()
	})

	it('does not guess which key to revoke when several are active', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj, {
			keys: [
				{ id: 'k1', name: 'ownmail acme 2026-01-02T03-04-05-678Z', status: 'active' },
				{ id: 'k2', name: 'ownmail acme (rotated 2026-02-02)', status: 'active' },
			],
		})

		await stepRecover(ctx)

		expect(proj.pendingApiKeyRotation).toBeUndefined()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('none will be revoked'))
	})

	it('keeps the revocation already scheduled by an interrupted recovery', async () => {
		const rotation = { previousKeyId: 'key-deployed', replacementKeyId: 'key-new' }
		const proj = project({ apiKeyId: 'key-new', pendingApiKeyRotation: rotation })
		const { ctx, gateway } = accountCtx(proj)

		await stepRecover(ctx)

		expect(gateway.listApiKeys).not.toHaveBeenCalled()
		expect(proj.pendingApiKeyRotation).toEqual(rotation)
	})

	it('still revokes the live key when a retry had to replace an interim key', async () => {
		// First attempt identified key-deployed and minted key-1; key-1 was unreadable on resume,
		// so stepApiKey minted key-2 and pointed its own rotation at the never-deployed key-1.
		const proj = project({ apiKeyId: 'key-1', recoveredDeployedKeyId: 'key-deployed' })
		const { ctx, gateway } = accountCtx(proj)
		vi.mocked(stepApiKey).mockImplementationOnce(async (c) => {
			c.v3 = {
				listGrants: vi.fn(async () => ({ data: [] })),
				listRedirectUris: vi.fn(async () => ({ data: [] })),
				listWebhooks: vi.fn(async () => ({ data: [] })),
			} as never
			c.project.pendingApiKeyRotation = { previousKeyId: 'key-1', replacementKeyId: 'key-2' }
			c.project.apiKeyId = 'key-2'
		})

		await stepRecover(ctx)

		expect(gateway.listApiKeys).not.toHaveBeenCalled()
		expect(proj.pendingApiKeyRotation).toEqual({ previousKeyId: 'key-deployed', replacementKeyId: 'key-2' })
		expect(proj.recoveredDeployedKeyId).toBeUndefined()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('key-1'))
	})

	it('leaves the previous key active when no deployment URL was confirmed', async () => {
		// E.g. a project adopted by an earlier release that could not confirm the live app.
		const proj = project({ recoveredAppUrl: undefined })
		const { ctx, gateway } = accountCtx(proj, {
			keys: [{ id: 'key-deployed', name: 'ownmail acme 2026-01-02T03-04-05-678Z', status: 'active' }],
		})

		await stepRecover(ctx)

		expect(gateway.listApiKeys).toHaveBeenCalled()
		expect(proj.pendingApiKeyRotation).toBeUndefined()
		expect(proj.recoveredDeployedKeyId).toBeUndefined()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('will not revoke'))
	})

	it('asks which inbox the app opens when the app has several', async () => {
		vi.mocked(p.select).mockResolvedValueOnce('grant-2' as never)
		const proj = project()
		const { ctx } = accountCtx(proj, {
			grants: [
				{ id: 'grant-1', provider: 'nylas', email: 'hello@acme.nylas.email' },
				{ id: 'grant-2', provider: 'nylas', email: 'team@acme.nylas.email' },
				{ id: 'grant-3', provider: 'google', email: 'me@gmail.com' },
			],
		})

		await stepRecover(ctx)

		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: [
					{ value: 'grant-1', label: 'hello@acme.nylas.email' },
					{ value: 'grant-2', label: 'team@acme.nylas.email' },
				],
			}),
		)
		expect(proj.inboxEmail).toBe('team@acme.nylas.email')
	})

	it('pauses without clearing the adoption marker when the inbox choice is cancelled', async () => {
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)
		const proj = project()
		const { ctx } = accountCtx(proj, {
			grants: [
				{ id: 'grant-1', provider: 'nylas', email: 'a@acme.nylas.email' },
				{ id: 'grant-2', provider: 'nylas', email: 'b@acme.nylas.email' },
			],
		})

		await expect(stepRecover(ctx)).rejects.toBeInstanceOf(CancelledError)
		expect(proj.adoptedFromAccount).toBe(true)
	})

	it('plans a domain when setup stopped before the inbox existed', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj, { grants: null })

		await stepRecover(ctx)

		expect(planDomain).toHaveBeenCalledWith(ctx)
		expect(proj.grantId).toBeUndefined()
		expect(proj.adoptedFromAccount).toBeUndefined()
	})

	it('fails loudly when the inbox domain belongs to a different organization', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj, { domains: [] })

		await expect(stepRecover(ctx)).rejects.toThrow(/Could not find the email domain acme.nylas.email/)
		expect(proj.adoptedFromAccount).toBe(true)
	})

	it('resumes an interrupted recovery without redoing parts already rebuilt', async () => {
		const proj = project({ grantId: 'grant-9', domainId: 'dom-9' })
		const { ctx, v3, dashboard } = accountCtx(proj)

		await stepRecover(ctx)

		expect(v3.listGrants).not.toHaveBeenCalled()
		expect(dashboard.listInboxDomains).not.toHaveBeenCalled()
		expect(proj.adoptedFromAccount).toBeUndefined()
	})

	it('requires the adopted application before looking up its keys', async () => {
		const { ctx } = accountCtx(project({ applicationId: undefined }))

		await expect(stepRecover(ctx)).rejects.toThrow(/Nylas application unavailable/)
	})

	it('records custom domains so the redeploy keeps serving them', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj, {
			redirects: ['https://acme-ownmail.me.workers.dev/auth/callback', 'https://mail.acme.com/auth/callback'],
			webhooks: [
				{ description: 'ownmail realtime', webhook_url: 'https://mail.acme.com/api/webhooks/nylas' },
				{ description: 'someone else', webhook_url: 'https://elsewhere.example.com/hook' },
			],
		})

		await stepRecover(ctx)

		expect(proj).toMatchObject({ appDomain: 'mail.acme.com', appDomains: ['mail.acme.com'] })
	})

	it('reads legacy callback_url webhooks and tolerates empty list responses', async () => {
		const proj = project()
		const { ctx, v3 } = accountCtx(proj)
		v3.listRedirectUris.mockResolvedValueOnce({ data: null } as never)
		v3.listWebhooks.mockResolvedValueOnce({
			data: [
				{ description: 'ownmail realtime', callback_url: 'https://mail.acme.com/api/webhooks/nylas' },
				{ description: 'ownmail realtime' },
			],
		} as never)

		await stepRecover(ctx)

		expect(proj).toMatchObject({ appDomain: 'mail.acme.com', appDomains: ['mail.acme.com'] })
	})

	it('treats a missing webhook list as no webhooks', async () => {
		const proj = project()
		const { ctx, v3 } = accountCtx(proj, { redirects: ['https://mail.acme.com/auth/callback'] })
		v3.listWebhooks.mockResolvedValueOnce({ data: null } as never)

		await stepRecover(ctx)

		expect(proj.appDomains).toEqual(['mail.acme.com'])
		expect(proj.appDomain).toBeUndefined()
	})

	it('does not make an inactive webhook left behind the primary domain', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj, {
			webhooks: [
				{
					description: 'ownmail realtime',
					status: 'inactive',
					webhook_url: 'https://old.acme.com/api/webhooks/nylas',
				},
				{
					description: 'ownmail realtime',
					status: 'active',
					webhook_url: 'https://mail.acme.com/api/webhooks/nylas',
				},
			],
		})

		await stepRecover(ctx)

		expect(proj).toMatchObject({ appDomain: 'mail.acme.com', appDomains: ['mail.acme.com'] })
	})

	it('reads the display name back from the live app so the user does not retype it', async () => {
		const proj = project()
		const { ctx } = accountCtx(proj)
		const fetchMock = stubLiveApp(loginPage('Zo&#x27;s Acme &amp; Co'))

		await stepRecover(ctx)

		expect(fetchMock).toHaveBeenCalledWith('https://acme-ownmail.me.workers.dev/login', expect.anything())
		expect(proj.siteName).toBe("Zo's Acme & Co")
		expect(p.log.info).not.toHaveBeenCalledWith(expect.stringContaining('could not read the display name'))
	})

	it('keeps a display name the user already chose', async () => {
		const proj = project({ siteName: 'Chosen Mail' })
		const { ctx } = accountCtx(proj)
		const fetchMock = stubLiveApp(loginPage('Other Name'))

		await stepRecover(ctx)

		expect(proj.siteName).toBe('Chosen Mail')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it.each([
		{ name: 'login page fails', login: new Response('', { status: 500 }) },
		{ name: 'login page is unreachable', login: new Error('reset') },
	])('asks for the display name when the $name', async ({ login }) => {
		const proj = project()
		const { ctx } = accountCtx(proj)
		stubLiveApp(login)

		await stepRecover(ctx)

		expect(proj.siteName).toBeUndefined()
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('could not read the display name'))
	})
})
