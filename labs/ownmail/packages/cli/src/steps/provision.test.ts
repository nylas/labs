import { EventEmitter } from 'node:events'
import * as p from '@clack/prompts'
import { DashboardAccountClient, DpopKey, GatewayClient, NylasV3Client } from '@nylas-labs/cli-kit'
import open from 'open'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiBaseUrl, dashboardAccountUrl, gatewayUrls } from '../nylas-env.js'
import type { ProjectState } from '../state/schema.js'
import { markStep, saveAuth, saveProject } from '../state/store.js'
import { OWNMAIL_USER_AGENT } from '../usage-attribution.js'
import { generateAppPassword, validateAppPassword } from '../util/password.js'
import type { StepContext } from './context.js'
import {
	CancelledError,
	stepApiKey,
	stepApp,
	stepConnector,
	stepDashboardAuth,
	stepDomain,
	stepDomainPlan,
	stepGrant,
	stepOrg,
	watchVerificationControls,
} from './provision.js'

// A sentinel that our mocked p.isCancel treats as "the user cancelled". Making a
// specific prompt resolve to CANCEL is how we exercise every CancelledError branch
// exactly the way @clack signals cancellation (a symbol) in production.
const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', () => ({
	log: {
		warn: vi.fn(),
		info: vi.fn(),
		step: vi.fn(),
		message: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
	},
	note: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
	password: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(),
	spinner: vi.fn(),
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	tasks: vi.fn(),
	group: vi.fn(),
}))

vi.mock('open', () => ({ default: vi.fn() }))

vi.mock('@nylas-labs/cli-kit', () => ({
	DpopKey: { generate: vi.fn(), fromStored: vi.fn() },
	DashboardAccountClient: vi.fn(),
	GatewayClient: vi.fn(),
	NylasV3Client: vi.fn(),
}))

vi.mock('../nylas-env.js', () => ({
	apiBaseUrl: vi.fn(),
	dashboardAccountUrl: vi.fn(),
	gatewayUrls: vi.fn(),
}))

vi.mock('../util/password.js', () => ({
	generateAppPassword: vi.fn(),
	validateAppPassword: vi.fn(),
}))

vi.mock('../state/store.js', () => ({
	markStep: vi.fn(),
	saveProject: vi.fn(),
	saveAuth: vi.fn(),
	loadAuth: vi.fn(),
	hasStep: vi.fn(),
}))

vi.mock('../state/pending-secrets.js', () => ({
	clearPendingSecret: vi.fn((project: ProjectState, name: keyof ProjectState['pendingSecrets']) => {
		delete project.pendingSecrets[name]
	}),
	hasPendingSecret: vi.fn((project: ProjectState, name: keyof ProjectState['pendingSecrets']) =>
		Boolean(project.pendingSecrets[name]),
	),
	readPendingSecret: vi.fn((project: ProjectState, name: keyof ProjectState['pendingSecrets']) => {
		const secret = project.pendingSecrets[name]
		return typeof secret === 'string' ? secret : null
	}),
	storePendingSecret: vi.fn(
		(project: ProjectState, name: keyof ProjectState['pendingSecrets'], value: string) => {
			project.pendingSecrets[name] = {
				storage: 'keyring',
				service: 'ownmail',
				account: `${project.slug}:${project.createdAt}:${name}`,
			}
			return value ? { storage: 'keyring' } : { storage: 'local' }
		},
	),
}))

import { clearPendingSecret, storePendingSecret } from '../state/pending-secrets.js'

const fakeDpop = { toStored: () => ({ privateJwk: { crv: 'Ed25519' } }) }

function setDefaults(): void {
	vi.mocked(p.isCancel).mockImplementation((v: unknown) => v === CANCEL)
	vi.mocked(p.spinner).mockImplementation(
		() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }) as unknown as ReturnType<typeof p.spinner>,
	)
	vi.mocked(p.confirm).mockResolvedValue(true)
	vi.mocked(p.select).mockResolvedValue('unset')
	vi.mocked(p.text).mockResolvedValue('unset')
	vi.mocked(p.password).mockResolvedValue('unset')
	vi.mocked(open).mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof open>>)
	vi.mocked(DpopKey.generate).mockResolvedValue(fakeDpop as unknown as DpopKey)
	vi.mocked(DpopKey.fromStored).mockResolvedValue(fakeDpop as unknown as DpopKey)
	vi.mocked(DashboardAccountClient).mockImplementation(function DashboardAccountClientMock() {
		return {} as unknown as DashboardAccountClient
	})
	vi.mocked(GatewayClient).mockImplementation(function GatewayClientMock() {
		return {} as unknown as GatewayClient
	})
	vi.mocked(NylasV3Client).mockImplementation(function NylasV3ClientMock() {
		return {} as unknown as NylasV3Client
	})
	vi.mocked(apiBaseUrl).mockReturnValue('https://api.test.nylas.com')
	vi.mocked(dashboardAccountUrl).mockReturnValue(undefined)
	vi.mocked(gatewayUrls).mockReturnValue({ us: 'https://gw.us', eu: 'https://gw.eu' })
	vi.mocked(generateAppPassword).mockReturnValue('GeneratedPassw0rd!!x')
	vi.mocked(validateAppPassword).mockReturnValue(undefined)
}

beforeEach(() => {
	vi.resetAllMocks()
	setDefaults()
})

type ClackOpts = { validate?: (v: string | undefined) => unknown }

/** Pulls the `validate` callback the step handed to a mocked @clack prompt so we
 * can assert the input rules independently of the (mocked) prompt UI. */
function validatorFrom(
	mock: { mock: { calls: unknown[][] } },
	callIndex = 0,
): (v: string | undefined) => unknown {
	const opts = mock.mock.calls[callIndex]?.[0] as ClackOpts | undefined
	if (!opts?.validate) throw new Error('prompt was called without a validate callback')
	return opts.validate
}

function baseProject(over: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...over,
	} as ProjectState
}

type Ctx = StepContext & {
	dashboard: Record<string, ReturnType<typeof vi.fn>> | null
	gateway: Record<string, ReturnType<typeof vi.fn>> | null
	v3: Record<string, ReturnType<typeof vi.fn>> | null
}

function baseCtx(over: Partial<StepContext> = {}): Ctx {
	return {
		project: baseProject(),
		auth: {
			userToken: 'user-tok',
			orgToken: 'org-tok',
			orgPublicId: 'org1',
			dpopPrivateJwk: {},
			updatedAt: 0,
		},
		dpop: null,
		dashboard: null,
		gateway: null,
		v3: null,
		...over,
	} as Ctx
}

describe('stepDashboardAuth', () => {
	it('resumes silently when the existing session is still valid', async () => {
		// A live session must not re-prompt the user — that is the whole point of resume.
		const currentSession = vi.fn().mockResolvedValue({})
		const ctx = baseCtx({ dashboard: { currentSession } as never })

		await stepDashboardAuth(ctx)

		expect(currentSession).toHaveBeenCalledTimes(1)
		expect(p.select).not.toHaveBeenCalled()
		expect(markStep).not.toHaveBeenCalled()
	})

	it('refreshes and persists a new org token when the session probe fails', async () => {
		const currentSession = vi.fn().mockRejectedValue(new Error('401'))
		const refresh = vi.fn().mockResolvedValue({ userToken: 'new-user', orgToken: 'new-org' })
		const ctx = baseCtx({ dashboard: { currentSession, refresh } as never })

		await stepDashboardAuth(ctx)

		expect(refresh).toHaveBeenCalledTimes(1)
		expect(ctx.auth?.userToken).toBe('new-user')
		expect(ctx.auth?.orgToken).toBe('new-org')
		expect(saveAuth).toHaveBeenCalled()
		expect(p.select).not.toHaveBeenCalled()
	})

	it('refreshes while keeping the previous org token when refresh omits one', async () => {
		const currentSession = vi.fn().mockRejectedValue(new Error('401'))
		const refresh = vi.fn().mockResolvedValue({ userToken: 'new-user' })
		const ctx = baseCtx({ dashboard: { currentSession, refresh } as never })

		await stepDashboardAuth(ctx)

		expect(ctx.auth?.userToken).toBe('new-user')
		expect(ctx.auth?.orgToken).toBe('org-tok')
	})

	it('warns and falls back to interactive login when refresh also fails', async () => {
		const currentSession = vi.fn().mockRejectedValue(new Error('401'))
		const refresh = vi.fn().mockRejectedValue(new Error('refresh dead'))
		const ctx = baseCtx({ dashboard: { currentSession, refresh } as never })
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never) // cancel the mode picker

		await expect(stepDashboardAuth(ctx)).rejects.toBeInstanceOf(CancelledError)
		expect(p.log.warn).toHaveBeenCalled()
		expect(ctx.auth).toBeNull()
	})

	it('throws CancelledError when the login-type picker is cancelled', async () => {
		const ctx = baseCtx({ auth: null })
		vi.mocked(p.select).mockResolvedValueOnce('register' as never)
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(stepDashboardAuth(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('logs in with a Nylas email and password without exposing the password', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce(' User@Example.com ')
		vi.mocked(p.password).mockResolvedValueOnce('secret-password')
		const loginWithPassword = vi.fn().mockResolvedValue({
			status: 'complete',
			userToken: 'ut',
			orgToken: 'ot',
			user: { publicId: 'user-pub' },
			organizations: [{ publicId: 'org-pub' }],
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { loginWithPassword } as unknown as DashboardAccountClient
		})

		await stepDashboardAuth(ctx)

		expect(loginWithPassword).toHaveBeenCalledWith({
			email: 'user@example.com',
			password: 'secret-password',
		})
		expect(p.password).toHaveBeenCalledWith(expect.objectContaining({ message: 'Nylas account password' }))
		expect(ctx.auth?.userToken).toBe('ut')
		const emailPrompt = vi.mocked(p.text).mock.calls[0]?.[0]
		expect(emailPrompt?.validate?.('invalid')).toBe('Enter a valid email address.')
		expect(emailPrompt?.validate?.('valid@example.com')).toBeUndefined()
		const passwordPrompt = vi.mocked(p.password).mock.calls[0]?.[0]
		expect(passwordPrompt?.validate?.('')).toMatch(/between 1 and 1024/)
		expect(passwordPrompt?.validate?.('valid')).toBeUndefined()
	})

	it('keeps invalid email/password failures generic', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce('user@example.com')
		vi.mocked(p.password).mockResolvedValueOnce('wrong-password')
		const loginWithPassword = vi.fn().mockRejectedValue(new Error('internal auth detail'))
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { loginWithPassword } as unknown as DashboardAccountClient
		})

		const failure = stepDashboardAuth(ctx)
		await expect(failure).rejects.toThrow(/Email\/password sign-in failed/)
		await expect(failure).rejects.not.toThrow(/internal auth detail/)
	})

	it('completes password login MFA and validates the hidden code prompt', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce('user@example.com')
		vi.mocked(p.password).mockResolvedValueOnce('password').mockResolvedValueOnce('123456')
		const loginWithPassword = vi.fn().mockResolvedValue({
			status: 'mfa_required',
			user: { publicId: 'user-pub' },
			organizations: [{ publicId: 'org-pub' }],
		})
		const completeMfaLogin = vi.fn().mockResolvedValue({
			userToken: 'ut',
			orgToken: 'ot',
			user: { publicId: 'user-pub' },
			organizations: [],
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { loginWithPassword, completeMfaLogin } as unknown as DashboardAccountClient
		})

		await stepDashboardAuth(ctx)

		expect(completeMfaLogin).toHaveBeenCalledWith({
			userPublicId: 'user-pub',
			code: '123456',
			orgPublicId: 'org-pub',
		})
		const mfaPrompt = vi.mocked(p.password).mock.calls[1]?.[0]
		expect(mfaPrompt?.validate?.('12345')).toBe('Enter a six-digit code.')
		expect(mfaPrompt?.validate?.('123456')).toBeUndefined()
		expect(ctx.auth?.userToken).toBe('ut')
	})

	it('keeps MFA failures generic', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce('user@example.com')
		vi.mocked(p.password).mockResolvedValueOnce('password').mockResolvedValueOnce('123456')
		const loginWithPassword = vi.fn().mockResolvedValue({
			status: 'mfa_required',
			user: { publicId: 'user-pub' },
			organizations: [],
		})
		const completeMfaLogin = vi.fn().mockRejectedValue(new Error('sensitive factor detail'))
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { loginWithPassword, completeMfaLogin } as unknown as DashboardAccountClient
		})

		const failure = stepDashboardAuth(ctx)
		await expect(failure).rejects.toThrow('MFA verification failed')
		await expect(failure).rejects.not.toThrow(/sensitive factor detail/)
	})

	it('allows cancellation at each email/password secret prompt', async () => {
		const emailCtx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce(CANCEL as never)
		await expect(stepDashboardAuth(emailCtx)).rejects.toBeInstanceOf(CancelledError)

		vi.clearAllMocks()
		setDefaults()
		const passwordCtx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce('user@example.com')
		vi.mocked(p.password).mockResolvedValueOnce(CANCEL as never)
		await expect(stepDashboardAuth(passwordCtx)).rejects.toBeInstanceOf(CancelledError)

		vi.clearAllMocks()
		setDefaults()
		const mfaCtx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('email_password' as never)
		vi.mocked(p.text).mockResolvedValueOnce('user@example.com')
		vi.mocked(p.password)
			.mockResolvedValueOnce('password')
			.mockResolvedValueOnce(CANCEL as never)
		const loginWithPassword = vi.fn().mockResolvedValue({
			status: 'mfa_required',
			user: { publicId: 'user-pub' },
			organizations: [],
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { loginWithPassword } as unknown as DashboardAccountClient
		})
		await expect(stepDashboardAuth(mfaCtx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('completes a fresh login, reusing an existing DPoP key and opening the browser', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('google_SSO' as never)
		const started = {
			verificationUri: 'https://v',
			verificationUriComplete: 'https://vc',
			userCode: 'CODE',
		}
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted(started)
			return {
				status: 'complete',
				userToken: 'ut',
				orgToken: 'ot',
				user: { publicId: 'user-pub' },
				organizations: [{ publicId: 'org-pub' }],
			}
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize } as unknown as DashboardAccountClient
		})

		await stepDashboardAuth(ctx)

		expect(DpopKey.generate).not.toHaveBeenCalled()
		expect(open).toHaveBeenCalledWith('https://vc')
		expect(ctx.auth?.userToken).toBe('ut')
		expect(ctx.auth?.orgPublicId).toBe('org-pub')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'dashboard-auth')
	})

	it('generates a DPoP key, warns on browser-open failure, and handles an org-less result', async () => {
		const ctx = baseCtx({ auth: null, dpop: null })
		vi.mocked(p.select).mockResolvedValueOnce('register' as never)
		vi.mocked(p.select).mockResolvedValueOnce('microsoft_SSO' as never)
		vi.mocked(open).mockRejectedValueOnce(new Error('no browser'))
		const started = { verificationUri: 'https://only-plain', userCode: 'CODE' }
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted(started)
			return {
				status: 'complete',
				userToken: 'ut',
				orgToken: 'ot',
				user: { publicId: 'user-pub' },
				organizations: [],
			}
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize } as unknown as DashboardAccountClient
		})

		await stepDashboardAuth(ctx)

		expect(DpopKey.generate).toHaveBeenCalledTimes(1)
		expect(open).toHaveBeenCalledWith('https://only-plain')
		expect(p.log.warn).toHaveBeenCalled()
		expect(ctx.auth?.orgPublicId).toBeUndefined()
	})

	it('does not open the browser when the user declines', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('github_SSO' as never)
		vi.mocked(p.confirm).mockResolvedValueOnce(false)
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted({ verificationUri: 'https://v', userCode: 'CODE' })
			return {
				status: 'complete',
				userToken: 'ut',
				orgToken: 'ot',
				user: { publicId: 'u' },
				organizations: [{ publicId: 'o' }],
			}
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize } as unknown as DashboardAccountClient
		})

		await stepDashboardAuth(ctx)

		expect(open).not.toHaveBeenCalled()
	})

	it('throws CancelledError when the open-browser confirm is cancelled', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('google_SSO' as never)
		vi.mocked(p.confirm).mockResolvedValueOnce(CANCEL as never)
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted({ verificationUri: 'https://v', userCode: 'CODE' })
			return { status: 'complete' }
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize } as unknown as DashboardAccountClient
		})

		await expect(stepDashboardAuth(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('completes MFA when the browser flow reports mfa_required', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('google_SSO' as never)
		vi.mocked(p.password).mockResolvedValueOnce('123456')
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted({ verificationUri: 'https://v', userCode: 'CODE' })
			return {
				status: 'mfa_required',
				user: { publicId: 'u' },
				organizations: [{ publicId: 'o' }],
			}
		})
		const completeMfaLogin = vi.fn().mockResolvedValue({
			userToken: 'ut',
			orgToken: 'ot',
			user: { publicId: 'u' },
			organizations: [{ publicId: 'o' }],
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize, completeMfaLogin } as unknown as DashboardAccountClient
		})

		await stepDashboardAuth(ctx)

		expect(completeMfaLogin).toHaveBeenCalledWith({
			userPublicId: 'u',
			code: '123456',
			orgPublicId: 'o',
		})
		expect(ctx.auth?.userToken).toBe('ut')
	})

	it('explains how to create an account when the selected SSO identity is denied', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('google_SSO' as never)
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted({ verificationUri: 'https://v', userCode: 'CODE' })
			return { status: 'access_denied' }
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize } as unknown as DashboardAccountClient
		})

		await expect(stepDashboardAuth(ctx)).rejects.toThrow(/choose “No — create one \(free\)”/)
	})

	it('explains when the device sign-in link expires', async () => {
		const ctx = baseCtx({ auth: null, dpop: fakeDpop as unknown as DpopKey })
		vi.mocked(p.select).mockResolvedValueOnce('login' as never)
		vi.mocked(p.select).mockResolvedValueOnce('google_SSO' as never)
		const ssoAuthorize = vi.fn(async (_input, onStarted: (s: unknown) => Promise<void>) => {
			await onStarted({ verificationUri: 'https://v', userCode: 'CODE' })
			return { status: 'expired_token' }
		})
		vi.mocked(DashboardAccountClient).mockImplementationOnce(function DashboardAccountClientMock() {
			return { ssoAuthorize } as unknown as DashboardAccountClient
		})

		await expect(stepDashboardAuth(ctx)).rejects.toThrow(/sign-in link expired/)
	})
})

describe('stepOrg', () => {
	it('keeps a single org and skips re-saving auth when it already matches', async () => {
		const currentSession = vi.fn().mockResolvedValue({
			organizations: [{ publicId: 'org1', name: 'Acme' }],
			organization: { publicId: 'org1', name: 'Acme' },
		})
		const ctx = baseCtx({ dashboard: { currentSession } as never })

		await stepOrg(ctx)

		expect(p.select).not.toHaveBeenCalled()
		expect(saveAuth).not.toHaveBeenCalled()
		expect(ctx.project.orgPublicId).toBe('org1')
		expect(saveProject).toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'org')
	})

	it('derives the org from session.organization and re-saves auth when it changed', async () => {
		// organizations absent → the [session.organization] fallback is exercised.
		const currentSession = vi.fn().mockResolvedValue({
			organization: { publicId: 'org2', name: 'Other' },
		})
		const ctx = baseCtx({ dashboard: { currentSession } as never })

		await stepOrg(ctx)

		expect(ctx.project.orgPublicId).toBe('org2')
		expect(saveAuth).toHaveBeenCalled()
		expect(ctx.auth?.orgPublicId).toBe('org2')
	})

	it('switches org when the user picks a different one from the multi-org picker', async () => {
		// orgB has no name → the picker label falls back to its publicId.
		const currentSession = vi.fn().mockResolvedValue({
			organizations: [{ publicId: 'orgA', name: 'A' }, { publicId: 'orgB' }],
			organization: { publicId: 'orgA', name: 'A' },
		})
		const switchOrg = vi.fn().mockResolvedValue({ orgToken: 'switched-tok' })
		const ctx = baseCtx({ dashboard: { currentSession, switchOrg } as never })
		vi.mocked(p.select).mockResolvedValueOnce('orgB' as never)

		await stepOrg(ctx)

		expect(switchOrg).toHaveBeenCalledWith(expect.anything(), 'orgB')
		expect(ctx.auth?.orgToken).toBe('switched-tok')
		expect(ctx.project.orgPublicId).toBe('orgB')
	})

	it('does not switch when the picker returns the currently active org', async () => {
		const currentSession = vi.fn().mockResolvedValue({
			organizations: [
				{ publicId: 'orgA', name: 'A' },
				{ publicId: 'orgB', name: 'B' },
			],
			organization: { publicId: 'orgA', name: 'A' },
		})
		const switchOrg = vi.fn()
		const ctx = baseCtx({ dashboard: { currentSession, switchOrg } as never })
		vi.mocked(p.select).mockResolvedValueOnce('orgA' as never)

		await stepOrg(ctx)

		expect(switchOrg).not.toHaveBeenCalled()
		expect(ctx.project.orgPublicId).toBe('orgA')
	})

	it('throws CancelledError when the org picker is cancelled', async () => {
		// First org has an empty publicId so no initialValue is supplied to the picker.
		const currentSession = vi.fn().mockResolvedValue({
			organizations: [
				{ publicId: '', name: 'A' },
				{ publicId: 'orgB', name: 'B' },
			],
		})
		const ctx = baseCtx({ dashboard: { currentSession } as never })
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(stepOrg(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws a helpful error when no organization can be resolved', async () => {
		const currentSession = vi.fn().mockResolvedValue({})
		const ctx = baseCtx({ dashboard: { currentSession } as never })

		await expect(stepOrg(ctx)).rejects.toThrow(/Could not resolve your organization/)
	})
})

describe('stepApp', () => {
	it('marks the step done and returns when an application id already exists', async () => {
		const ctx = baseCtx({ project: baseProject({ applicationId: 'app-existing' }) })

		await stepApp(ctx)

		expect(markStep).toHaveBeenCalledWith(ctx.project, 'app')
	})

	it('fails safely when the prior organization step did not persist an organization', async () => {
		const ctx = baseCtx({ gateway: {} as never })

		await expect(stepApp(ctx)).rejects.toThrow(/Organization unavailable/)
	})

	it('reuses a sandbox app matched by branding name', async () => {
		const app = {
			applicationId: 'app-1',
			region: 'us',
			environment: 'Sandbox',
			branding: { name: 'ownmail:acme' },
		}
		const listApplications = vi
			.fn()
			.mockResolvedValueOnce([app]) // us (project region, prioritized first)
			.mockResolvedValueOnce([]) // eu
		const ctx = baseCtx({
			project: baseProject({ orgPublicId: 'org1' }),
			gateway: { listApplications } as never,
		})

		await stepApp(ctx)

		expect(ctx.project.applicationId).toBe('app-1')
		expect(ctx.project.region).toBe('us')
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('ownmail:acme'))
	})

	it('falls back to the first sandbox app, skipping non-sandbox and using region/name fallbacks', async () => {
		const sandboxNoBranding = { applicationId: 'app-eu', region: 'zz', environment: 'sandbox' }
		const notSandbox = { applicationId: 'app-prod', region: 'us', environment: 'production' }
		const listApplications = vi
			.fn()
			.mockResolvedValueOnce([sandboxNoBranding]) // eu (project region first)
			.mockResolvedValueOnce([notSandbox]) // us
		const ctx = baseCtx({
			project: baseProject({ orgPublicId: 'org1', region: 'eu' }),
			gateway: { listApplications } as never,
		})

		await stepApp(ctx)

		expect(ctx.project.applicationId).toBe('app-eu')
		expect(ctx.project.region).toBe('eu') // region 'zz' is invalid → falls back to listed region
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('app-eu')) // name falls back to id
	})

	it('creates a new sandbox app without retaining the unused client secret', async () => {
		const listApplications = vi.fn().mockResolvedValue([])
		const createApplication = vi
			.fn()
			.mockResolvedValue({ applicationId: 'app-new', clientSecret: 'secret-xyz' })
		const ctx = baseCtx({
			project: baseProject({ orgPublicId: 'org1' }),
			gateway: { listApplications, createApplication } as never,
		})

		await stepApp(ctx)

		expect(createApplication).toHaveBeenCalled()
		expect(ctx.project.applicationId).toBe('app-new')
		expect(ctx.project.pendingSecrets.clientSecret).toBeUndefined()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'app')
	})
})

describe('stepApiKey', () => {
	it('fails safely when the prior application step did not persist an application', async () => {
		const ctx = baseCtx({ gateway: {} as never })

		await expect(stepApiKey(ctx)).rejects.toThrow(/Nylas application unavailable/)
	})

	it('rebuilds the v3 client from a pending key on resume without minting a new one', async () => {
		const createApiKey = vi.fn()
		const ctx = baseCtx({
			project: baseProject({ pendingSecrets: { apiKey: 'existing-key' } }),
			gateway: { createApiKey } as never,
		})

		await stepApiKey(ctx)

		expect(createApiKey).not.toHaveBeenCalled()
		expect(NylasV3Client).toHaveBeenCalledWith(
			'existing-key',
			'us',
			fetch,
			'https://api.test.nylas.com',
			OWNMAIL_USER_AGENT,
		)
		expect(ctx.v3).not.toBeNull()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'api-key')
	})

	it('mints an API key and constructs the v3 client', async () => {
		const createApiKey = vi.fn().mockResolvedValue({ id: 'key-1', apiKey: 'nyk_secret' })
		const ctx = baseCtx({
			project: baseProject({ applicationId: 'app-1' }),
			gateway: { createApiKey } as never,
		})

		await stepApiKey(ctx)

		expect(ctx.project.apiKeyId).toBe('key-1')
		expect(storePendingSecret).toHaveBeenCalledWith(ctx.project, 'apiKey', 'nyk_secret')
		expect(ctx.project.pendingSecrets.apiKey).toEqual({
			storage: 'keyring',
			service: 'ownmail',
			account: 'acme:0:apiKey',
		})
		expect(NylasV3Client).toHaveBeenCalledWith(
			'nyk_secret',
			'us',
			fetch,
			'https://api.test.nylas.com',
			OWNMAIL_USER_AGENT,
		)
		expect(saveProject).toHaveBeenCalled()
	})

	it('clears an unreadable pending API key reference and mints a fresh key', async () => {
		const createApiKey = vi.fn().mockResolvedValue({ id: 'key-2', apiKey: 'nyk_fresh' })
		const ctx = baseCtx({
			project: baseProject({
				applicationId: 'app-1',
				pendingSecrets: {
					apiKey: { storage: 'keyring', service: 'ownmail', account: 'missing' },
				},
			}),
			gateway: { createApiKey } as never,
		})

		await stepApiKey(ctx)

		expect(clearPendingSecret).toHaveBeenCalledWith(ctx.project, 'apiKey')
		expect(p.log.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not read the pending Nylas API key'),
		)
		expect(createApiKey).toHaveBeenCalled()
		expect(storePendingSecret).toHaveBeenCalledWith(ctx.project, 'apiKey', 'nyk_fresh')
	})

	it('warns when a fresh API key falls back to local pending storage', async () => {
		vi.mocked(storePendingSecret).mockImplementationOnce((project, name, value) => {
			project.pendingSecrets[name] = value
			return { storage: 'local' }
		})
		const createApiKey = vi.fn().mockResolvedValue({ id: 'key-1', apiKey: 'nyk_secret' })
		const ctx = baseCtx({
			project: baseProject({ applicationId: 'app-1' }),
			gateway: { createApiKey } as never,
		})

		await stepApiKey(ctx)

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not use the OS keyring'))
		expect(ctx.project.pendingSecrets.apiKey).toBe('nyk_secret')
	})

	it('stops the spinner and rethrows if key creation fails', async () => {
		const createApiKey = vi.fn().mockRejectedValue(new Error('gateway 500'))
		const stop = vi.fn()
		vi.mocked(p.spinner).mockReturnValue({
			start: vi.fn(),
			stop,
			message: vi.fn(),
		} as unknown as ReturnType<typeof p.spinner>)
		const ctx = baseCtx({
			project: baseProject({ applicationId: 'app-1' }),
			gateway: { createApiKey } as never,
		})

		await expect(stepApiKey(ctx)).rejects.toThrow('gateway 500')
		expect(stop).toHaveBeenCalledWith('Could not create a Nylas API key.')
	})
})

describe('stepConnector', () => {
	it('ensures the nylas connector and marks the step', async () => {
		const ensureConnector = vi.fn().mockResolvedValue({ provider: 'nylas' })
		const ctx = baseCtx({ v3: { ensureConnector } as never })

		await stepConnector(ctx)

		expect(ensureConnector).toHaveBeenCalledWith('nylas')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'connector')
	})

	it('stops the spinner and rethrows when connector setup fails', async () => {
		const ensureConnector = vi.fn().mockRejectedValue(new Error('connector boom'))
		const stop = vi.fn()
		vi.mocked(p.spinner).mockReturnValue({
			start: vi.fn(),
			stop,
			message: vi.fn(),
		} as unknown as ReturnType<typeof p.spinner>)
		const ctx = baseCtx({ v3: { ensureConnector } as never })

		await expect(stepConnector(ctx)).rejects.toThrow('connector boom')
		expect(stop).toHaveBeenCalledWith('Could not configure the hosted-auth connector.')
		expect(markStep).not.toHaveBeenCalled()
	})
})

describe('stepDomainPlan', () => {
	it.each([
		{ domainAddress: 'existing.nylas.email' },
		{ plannedDomainAddress: 'planned.nylas.email' },
		{ applicationId: 'app-1' },
		{ domainId: 'domain-1' },
		{ grantId: 'grant-1' },
	])('reuses existing plan or durable state without prompting: %o', async (project) => {
		const listInboxDomains = vi.fn()
		const ctx = baseCtx({
			project: baseProject(project),
			dashboard: { listInboxDomains } as never,
		})

		await stepDomainPlan(ctx)

		expect(listInboxDomains).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain-plan')
	})

	it('plans a new domain without creating it', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const domainAvailability = vi.fn().mockResolvedValue({ available: true })
		const createInboxDomain = vi.fn()
		const ctx = baseCtx({
			dashboard: { listInboxDomains, domainAvailability, createInboxDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('free' as never)
		vi.mocked(p.text).mockResolvedValueOnce('planned' as never)

		await stepDomainPlan(ctx)

		expect(ctx.project.plannedDomainAddress).toBe('planned.nylas.email')
		expect(createInboxDomain).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain-plan')
	})
})

describe('stepDomain', () => {
	it('short-circuits when a verified domain is already recorded', async () => {
		const listInboxDomains = vi.fn()
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'me.nylas.email', domainVerified: true }),
			dashboard: { listInboxDomains } as never,
		})

		await stepDomain(ctx)

		expect(listInboxDomains).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain')
	})

	it('adopts an existing fully-verified branded domain for the region', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([
			{ id: 'd0', domainAddress: 'x.nylas.email', branded: false, region: 'us' },
			{ id: 'd1', domainAddress: 'eu.nylas.email', branded: true, region: 'eu' },
			{
				id: 'd2',
				domainAddress: 'ours.nylas.email',
				branded: true,
				region: 'us',
				verifiedOwnership: true,
				verifiedMx: true,
			},
		])
		const ctx = baseCtx({ dashboard: { listInboxDomains } as never })

		await stepDomain(ctx)

		expect(ctx.project.domainId).toBe('d2')
		expect(ctx.project.domainAddress).toBe('ours.nylas.email')
		expect(ctx.project.domainVerified).toBe(true)
		expect(p.select).not.toHaveBeenCalled()
	})

	it('adopts an existing branded domain even when not fully verified', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([
			{
				id: 'd2',
				domainAddress: 'ours.nylas.email',
				branded: true,
				region: 'us',
				verifiedOwnership: true,
				verifiedMx: false,
			},
		])
		const ctx = baseCtx({ dashboard: { listInboxDomains } as never })

		await stepDomain(ctx)

		expect(ctx.project.domainVerified).toBe(false)
	})

	it('reuses a recorded branded domain while its verification settles', async () => {
		const listInboxDomains = vi.fn()
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'branded-1',
				domainAddress: 'ours.nylas.email',
				domainBranded: true,
				domainVerified: false,
			}),
			dashboard: { listInboxDomains } as never,
		})

		await stepDomain(ctx)

		expect(listInboxDomains).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain')
	})

	it('resumes verification for an existing custom domain', async () => {
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const verifyDomain = vi.fn().mockResolvedValue({ status: 'verified' })
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('poll' as never)

		await stepDomain(ctx)

		expect(verifyDomain).toHaveBeenCalledTimes(5)
		expect(ctx.project.domainVerified).toBe(true)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain')
	})

	it('finishes from the authoritative dashboard state without starting a verification loop', async () => {
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi.fn().mockResolvedValue({
			verifiedOwnership: true,
			verifiedMx: true,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		})
		const verifyDomain = vi.fn()
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})

		await stepDomain(ctx)

		expect(getInboxDomain).toHaveBeenCalledWith(expect.anything(), 'custom-1', 'us')
		expect(verifyDomain).not.toHaveBeenCalled()
		expect(p.select).not.toHaveBeenCalled()
		expect(ctx.project.domainVerified).toBe(true)
	})

	it('offers a manual retry and completes once the required checks verify', async () => {
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi.fn().mockRejectedValue(new Error('refresh unavailable'))
		const verifyDomain = vi.fn((_tokens: unknown, _domainId: string, { type }: { type: string }) =>
			Promise.resolve({ status: type === 'ownership' || type === 'mx' ? 'verified' : 'pending' }),
		)
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('manual' as never)

		await stepDomain(ctx)

		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.arrayContaining([
					expect.objectContaining({ value: 'poll' }),
					expect.objectContaining({ value: 'manual' }),
				]),
			}),
		)
		expect(ctx.project.domainVerified).toBe(true)
	})

	it('returns to the verification choice after an unsuccessful manual retry', async () => {
		const unverified = {
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		}
		const verified = { ...unverified, verifiedOwnership: true, verifiedMx: true }
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi
			.fn()
			.mockResolvedValueOnce(unverified)
			.mockResolvedValueOnce(unverified)
			.mockResolvedValueOnce(verified)
		const verifyDomain = vi.fn().mockResolvedValue({ status: 'pending' })
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})
		vi.mocked(p.select)
			.mockResolvedValueOnce('manual' as never)
			.mockResolvedValueOnce('manual' as never)

		await stepDomain(ctx)

		expect(p.select).toHaveBeenCalledTimes(2)
		const spinners = vi.mocked(p.spinner).mock.results.map((result) => result.value)
		expect(spinners[0]?.stop).toHaveBeenCalledWith(expect.stringContaining('Still waiting on'))
		expect(ctx.project.domainVerified).toBe(true)
	})

	it('allows cancellation from the verification choice', async () => {
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi.fn().mockResolvedValue({
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		})
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(stepDomain(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('lets the user escape automatic polling and retry manually', async () => {
		const unverified = {
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		}
		const verified = { ...unverified, verifiedOwnership: true, verifiedMx: true }
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi
			.fn()
			.mockResolvedValueOnce(unverified)
			.mockResolvedValueOnce(unverified)
			.mockResolvedValue(verified)
		const verifyDomain = vi.fn().mockResolvedValue({ status: 'pending' })
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})
		vi.mocked(p.select)
			.mockResolvedValueOnce('poll' as never)
			.mockResolvedValueOnce('manual' as never)

		const promise = stepDomain(ctx)
		await vi.waitFor(() => expect(getInboxDomain).toHaveBeenCalledTimes(2))
		process.stdin.emit('data', Buffer.from('\u001b'))
		await promise

		expect(p.select).toHaveBeenCalledTimes(2)
		expect(ctx.project.domainVerified).toBe(true)
		const spinners = vi.mocked(p.spinner).mock.results.map((result) => result.value)
		expect(spinners[0]?.stop).toHaveBeenCalledWith('Automatic polling paused.')
	})

	it('honors Escape pressed while a verification request is in flight', async () => {
		const unverified = {
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		}
		const verified = { ...unverified, verifiedOwnership: true, verifiedMx: true }
		let releaseVerification!: (value: { status: string }) => void
		const blockedVerification = new Promise<{ status: string }>((resolve) => {
			releaseVerification = resolve
		})
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi
			.fn()
			.mockResolvedValueOnce(unverified)
			.mockResolvedValueOnce(unverified)
			.mockResolvedValue(verified)
		const verifyDomain = vi
			.fn()
			.mockImplementationOnce(() => blockedVerification)
			.mockResolvedValue({ status: 'pending' })
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})
		vi.mocked(p.select)
			.mockResolvedValueOnce('poll' as never)
			.mockResolvedValueOnce('manual' as never)

		const promise = stepDomain(ctx)
		await vi.waitFor(() => expect(verifyDomain).toHaveBeenCalledTimes(1))
		process.stdin.emit('data', Buffer.from('\u001b'))
		releaseVerification({ status: 'pending' })
		await promise

		expect(p.select).toHaveBeenCalledTimes(2)
		expect(ctx.project.domainVerified).toBe(true)
	})

	it('honors Ctrl+C pressed while a verification request is in flight', async () => {
		const unverified = {
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		}
		let releaseVerification!: (value: { status: string }) => void
		const blockedVerification = new Promise<{ status: string }>((resolve) => {
			releaseVerification = resolve
		})
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi.fn().mockResolvedValue(unverified)
		const verifyDomain = vi
			.fn()
			.mockImplementationOnce(() => blockedVerification)
			.mockResolvedValue({ status: 'pending' })
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('poll' as never)

		const promise = stepDomain(ctx)
		const assertion = expect(promise).rejects.toBeInstanceOf(CancelledError)
		await vi.waitFor(() => expect(verifyDomain).toHaveBeenCalledTimes(1))
		process.stdin.emit('data', Buffer.from('\u0003'))
		releaseVerification({ status: 'pending' })
		await assertion
	})

	it('honors Ctrl+C while waiting between automatic verification attempts', async () => {
		const unverified = {
			verifiedOwnership: false,
			verifiedMx: false,
			verifiedSpf: false,
			verifiedDkim: false,
			verifiedFeedback: false,
		}
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const getInboxDomain = vi.fn().mockResolvedValue(unverified)
		const verifyDomain = vi.fn().mockResolvedValue({ status: 'pending' })
		const ctx = baseCtx({
			project: baseProject({
				domainId: 'custom-1',
				domainAddress: 'mail.acme.com',
				domainBranded: false,
				domainVerified: false,
			}),
			dashboard: { domainInfo, getInboxDomain, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('poll' as never)

		const promise = stepDomain(ctx)
		const assertion = expect(promise).rejects.toBeInstanceOf(CancelledError)
		await vi.waitFor(() => expect(getInboxDomain).toHaveBeenCalledTimes(2))
		process.stdin.emit('data', Buffer.from('\u0003'))
		await assertion
	})

	it('throws CancelledError when the domain-choice picker is cancelled', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const ctx = baseCtx({ dashboard: { listInboxDomains } as never })
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(stepDomain(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('claims a free branded subdomain, retrying when the first pick is taken', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const domainAvailability = vi
			.fn()
			.mockResolvedValueOnce({ available: false })
			.mockResolvedValueOnce({ available: true })
		const createInboxDomain = vi.fn().mockResolvedValue({ id: 'dom-new', domainAddress: 'acme2.nylas.email' })
		const ctx = baseCtx({
			dashboard: { listInboxDomains, domainAvailability, createInboxDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('free' as never)
		vi.mocked(p.text).mockResolvedValueOnce('acme' as never)
		vi.mocked(p.text).mockResolvedValueOnce('acme2' as never)

		await stepDomain(ctx)

		expect(p.log.warn).toHaveBeenCalled() // "taken" warning on first attempt
		expect(createInboxDomain).toHaveBeenCalledTimes(1)
		expect(ctx.project.domainAddress).toBe('acme2.nylas.email')
		expect(ctx.project.domainBranded).toBe(true)
		expect(ctx.project.domainVerified).toBe(true)

		// The subdomain rule accepts a clean label and rejects illegal/empty input.
		const validate = validatorFrom(vi.mocked(p.text))
		expect(validate('acme')).toBeUndefined()
		expect(validate('Bad_Label!')).toBeTruthy()
		expect(validate(undefined)).toBeTruthy()
	})

	it('re-prompts when a planned branded subdomain is claimed before creation', async () => {
		const conflict = Object.assign(new Error('domain taken'), { status: 409 })
		const domainAvailability = vi.fn().mockResolvedValue({ available: true })
		const createInboxDomain = vi
			.fn()
			.mockRejectedValueOnce(conflict)
			.mockResolvedValueOnce({ id: 'dom-new', domainAddress: 'acme2.nylas.email' })
		const ctx = baseCtx({
			project: baseProject({
				plannedDomainAddress: 'acme.nylas.email',
				plannedDomainBranded: true,
				completedSteps: ['domain-plan', 'plan-confirmed', 'app', 'api-key', 'connector'],
			}),
			dashboard: { domainAvailability, createInboxDomain } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce('acme2' as never)

		await stepDomain(ctx)

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('acme.nylas.email was claimed'))
		expect(domainAvailability).toHaveBeenCalledWith(expect.anything(), 'acme2.nylas.email')
		expect(createInboxDomain).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			expect.objectContaining({ domainAddress: 'acme.nylas.email' }),
		)
		expect(createInboxDomain).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			expect.objectContaining({ domainAddress: 'acme2.nylas.email' }),
		)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain-plan')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain')
		expect(ctx.project.domainAddress).toBe('acme2.nylas.email')
		expect(ctx.project.plannedDomainAddress).toBeUndefined()
		expect(ctx.project.plannedDomainBranded).toBeUndefined()
	})

	it('keeps the planned branded subdomain when creation fails for a non-conflict error', async () => {
		const createInboxDomain = vi.fn().mockRejectedValue(new Error('gateway down'))
		const ctx = baseCtx({
			project: baseProject({
				plannedDomainAddress: 'acme.nylas.email',
				plannedDomainBranded: true,
				completedSteps: ['domain-plan'],
			}),
			dashboard: { createInboxDomain } as never,
		})

		await expect(stepDomain(ctx)).rejects.toThrow('gateway down')

		expect(p.text).not.toHaveBeenCalled()
		expect(ctx.project.plannedDomainAddress).toBe('acme.nylas.email')
		expect(ctx.project.plannedDomainBranded).toBe(true)
		expect(markStep).not.toHaveBeenCalledWith(ctx.project, 'domain')
	})

	it('throws CancelledError when the free-subdomain prompt is cancelled', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const ctx = baseCtx({ dashboard: { listInboxDomains } as never })
		vi.mocked(p.select).mockResolvedValueOnce('free' as never)
		vi.mocked(p.text).mockResolvedValueOnce(CANCEL as never)

		await expect(stepDomain(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws CancelledError when the custom-domain prompt is cancelled', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const ctx = baseCtx({ dashboard: { listInboxDomains } as never })
		vi.mocked(p.select).mockResolvedValueOnce('custom' as never)
		vi.mocked(p.text).mockResolvedValueOnce(CANCEL as never)

		await expect(stepDomain(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('fails closed when domain planning returns an empty address', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const ctx = baseCtx({ dashboard: { listInboxDomains } as never })
		vi.mocked(p.select).mockResolvedValueOnce('custom' as never)
		vi.mocked(p.text).mockResolvedValueOnce('' as never)

		await expect(stepDomain(ctx)).rejects.toThrow(/domain plan is missing/)
	})

	it('sets up a custom domain, prints DNS records, and finishes when all checks verify', async () => {
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const createInboxDomain = vi.fn().mockResolvedValue({ id: 'dom-c', domainAddress: 'mail.acme.com' })
		// One check with full DNS options → printed; one with null attempt → skipped;
		// one missing a value → skipped; one that throws → swallowed.
		const domainInfo = vi
			.fn()
			.mockResolvedValueOnce({ attempt: { options: { host: 'h', type: 'TXT', value: 'v' } } })
			.mockResolvedValueOnce({ attempt: null })
			.mockResolvedValueOnce({ attempt: { options: { host: 'h', type: 'MX' } } })
			.mockRejectedValueOnce(new Error('not ready'))
			.mockResolvedValueOnce({ attempt: { options: { host: 'h', type: 'CNAME', value: 'v' } } })
		const verifyDomain = vi.fn().mockResolvedValue({ status: 'verified' })
		const ctx = baseCtx({
			dashboard: { listInboxDomains, createInboxDomain, domainInfo, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('custom' as never)
		vi.mocked(p.select).mockResolvedValueOnce('poll' as never)
		vi.mocked(p.text).mockResolvedValueOnce('mail.acme.com' as never)

		await stepDomain(ctx)

		expect(p.log.message).toHaveBeenCalledTimes(2) // only the two complete records printed
		expect(ctx.project.domainBranded).toBe(false)
		expect(ctx.project.domainVerified).toBe(true)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'domain')

		// The custom-domain rule accepts an FQDN and rejects a bare/empty label.
		const validate = validatorFrom(vi.mocked(p.text))
		expect(validate('mail.acme.com')).toBeUndefined()
		expect(validate('nope')).toBeTruthy()
		expect(validate(undefined)).toBeTruthy()
	})

	it('polls, waits, and finishes once every DNS check eventually verifies', async () => {
		vi.useFakeTimers()
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const createInboxDomain = vi.fn().mockResolvedValue({ id: 'dom-c', domainAddress: 'mail.acme.com' })
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		// First sweep: still pending (regex miss). Second sweep: all verified.
		const verifyDomain = vi
			.fn()
			.mockResolvedValue({ status: 'verified' })
			.mockResolvedValueOnce({ status: 'pending' })
			.mockResolvedValueOnce({ status: 'pending' })
			.mockResolvedValueOnce({ status: 'pending' })
			.mockResolvedValueOnce({ status: 'pending' })
			.mockResolvedValueOnce({ status: 'pending' })
		const ctx = baseCtx({
			dashboard: { listInboxDomains, createInboxDomain, domainInfo, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('custom' as never)
		vi.mocked(p.select).mockResolvedValueOnce('poll' as never)
		vi.mocked(p.text).mockResolvedValueOnce('mail.acme.com' as never)

		const promise = stepDomain(ctx)
		await vi.advanceTimersByTimeAsync(31_000)
		await promise
		vi.useRealTimers()

		expect(ctx.project.domainVerified).toBe(true)
	})

	it('gives up with a resume-friendly error when DNS never verifies', async () => {
		vi.useFakeTimers()
		const listInboxDomains = vi.fn().mockResolvedValue([])
		const createInboxDomain = vi.fn().mockResolvedValue({ id: 'dom-c', domainAddress: 'mail.acme.com' })
		const domainInfo = vi.fn().mockResolvedValue({ attempt: null })
		const verifyDomain = vi.fn().mockRejectedValue(new Error('dns pending')) // always fails
		const ctx = baseCtx({
			dashboard: { listInboxDomains, createInboxDomain, domainInfo, verifyDomain } as never,
		})
		vi.mocked(p.select).mockResolvedValueOnce('custom' as never)
		vi.mocked(p.select).mockResolvedValueOnce('poll' as never)
		vi.mocked(p.text).mockResolvedValueOnce('mail.acme.com' as never)

		const promise = stepDomain(ctx)
		const assertion = expect(promise).rejects.toThrow(/Still waiting on/)
		await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
		await assertion
		vi.useRealTimers()
	})
})

describe('watchVerificationControls', () => {
	it('ignores unrelated keys, keeps the first control, and restores a paused raw terminal', async () => {
		const input = Object.assign(new EventEmitter(), {
			isTTY: true,
			isRaw: false,
			isPaused: vi.fn(() => true),
			resume: vi.fn(),
			pause: vi.fn(),
			setRawMode: vi.fn(),
		})
		input.setRawMode.mockImplementation((mode: boolean) => {
			input.isRaw = mode
		})

		const controls = watchVerificationControls(input as never)
		input.emit('data', Buffer.from('x'))
		expect(controls.current()).toBeNull()
		input.emit('data', Buffer.from('\u001b'))
		input.emit('data', Buffer.from('\u0003'))

		await expect(controls.wait).resolves.toBe('back')
		expect(controls.current()).toBe('back')
		controls.dispose()
		expect(input.setRawMode).toHaveBeenNthCalledWith(1, true)
		expect(input.setRawMode).toHaveBeenNthCalledWith(2, false)
		expect(input.resume).toHaveBeenCalledTimes(1)
		expect(input.pause).toHaveBeenCalledTimes(1)
	})

	it('supports TTY-like inputs without raw-mode controls', () => {
		const input = Object.assign(new EventEmitter(), {
			isTTY: true,
			isRaw: false,
			isPaused: vi.fn(() => false),
			resume: vi.fn(),
			pause: vi.fn(),
		})

		const controls = watchVerificationControls(input as never)
		controls.dispose()

		expect(input.resume).toHaveBeenCalledTimes(1)
		expect(input.pause).not.toHaveBeenCalled()
	})

	it('does not toggle raw mode again when the terminal was already raw', () => {
		const input = Object.assign(new EventEmitter(), {
			isTTY: true,
			isRaw: true,
			isPaused: vi.fn(() => false),
			resume: vi.fn(),
			pause: vi.fn(),
			setRawMode: vi.fn(),
		})

		const controls = watchVerificationControls(input as never)
		controls.dispose()

		expect(input.setRawMode).toHaveBeenCalledTimes(1)
		expect(input.setRawMode).toHaveBeenCalledWith(true)
	})
})

describe('stepGrant', () => {
	it('fails safely when the prior domain step did not persist a domain', async () => {
		const ctx = baseCtx({ v3: {} as never })

		await expect(stepGrant(ctx)).rejects.toThrow(/Domain unavailable/)
	})

	it('re-shows the saved inbox password on resume', async () => {
		const ctx = baseCtx({
			project: baseProject({
				grantId: 'grant-1',
				inboxEmail: 'contact@acme.nylas.email',
				pendingSecrets: { appPassword: 'Sup3rSecret!!x' },
			}),
			v3: {} as never,
		})

		await stepGrant(ctx)

		expect(p.note).toHaveBeenCalled()
		expect(p.confirm).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'I saved this inbox password somewhere safe.' }),
		)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'grant')
	})

	it('clears an unreadable pending inbox password reference on resume', async () => {
		const ctx = baseCtx({
			project: baseProject({
				grantId: 'grant-1',
				inboxEmail: 'contact@acme.nylas.email',
				pendingSecrets: {
					appPassword: { storage: 'keyring', service: 'ownmail', account: 'missing' },
				},
			}),
			v3: {} as never,
		})

		await stepGrant(ctx)

		expect(clearPendingSecret).toHaveBeenCalledWith(ctx.project, 'appPassword')
		expect(p.log.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not read the pending inbox password'),
		)
		expect(p.note).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'grant')
	})

	it('resumes without a note when no plaintext password is retained', async () => {
		const ctx = baseCtx({
			project: baseProject({ grantId: 'grant-1' }),
			v3: {} as never,
		})

		await stepGrant(ctx)

		expect(p.note).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'grant')
	})

	it('reuses an existing inbox on our domain when the user confirms', async () => {
		const listGrants = vi.fn().mockResolvedValue({
			data: [
				{ id: 'g-google', provider: 'google', email: 'x@acme.nylas.email' }, // not nylas
				{ id: 'g-noemail', provider: 'nylas' }, // no email
				{ id: 'g-other', provider: 'nylas', email: 'y@other.com' }, // wrong domain
				{ id: 'g-ours', provider: 'nylas', email: 'contact@acme.nylas.email' }, // match
			],
		})
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants } as never,
		})
		vi.mocked(p.confirm).mockResolvedValueOnce(true)

		await stepGrant(ctx)

		expect(ctx.project.grantId).toBe('g-ours')
		expect(ctx.project.inboxEmail).toBe('contact@acme.nylas.email')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'grant')
	})

	it('throws CancelledError when the reuse confirm is cancelled', async () => {
		const listGrants = vi.fn().mockResolvedValue({
			data: [{ id: 'g-ours', provider: 'nylas', email: 'contact@acme.nylas.email' }],
		})
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants } as never,
		})
		vi.mocked(p.confirm).mockResolvedValueOnce(CANCEL as never)

		await expect(stepGrant(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('declining reuse creates a fresh inbox with a generated password', async () => {
		const listGrants = vi.fn().mockResolvedValue({
			data: [{ id: 'g-ours', provider: 'nylas', email: 'old@acme.nylas.email' }],
		})
		const createAgentAccount = vi.fn().mockResolvedValue({ id: 'grant-new' })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants, createAgentAccount } as never,
		})
		vi.mocked(p.confirm).mockResolvedValueOnce(false) // decline reuse
		vi.mocked(p.text).mockResolvedValueOnce('contact' as never) // local part
		vi.mocked(p.confirm).mockResolvedValueOnce(true) // generate password

		await stepGrant(ctx)

		expect(generateAppPassword).toHaveBeenCalledWith('contact')
		expect(createAgentAccount).toHaveBeenCalledWith({
			email: 'contact@acme.nylas.email',
			appPassword: 'GeneratedPassw0rd!!x',
			name: 'acme',
		})
		expect(ctx.project.grantId).toBe('grant-new')
		expect(storePendingSecret).toHaveBeenCalledWith(ctx.project, 'appPassword', 'GeneratedPassw0rd!!x')
		expect(ctx.project.pendingSecrets.appPassword).toEqual({
			storage: 'keyring',
			service: 'ownmail',
			account: 'acme:0:appPassword',
		})
		expect(p.note).toHaveBeenCalled()
	})

	it('throws CancelledError when the password acknowledgement is declined', async () => {
		const listGrants = vi.fn().mockResolvedValue({ data: [] })
		const createAgentAccount = vi.fn().mockResolvedValue({ id: 'grant-new' })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants, createAgentAccount } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce('contact' as never)
		vi.mocked(p.confirm)
			.mockResolvedValueOnce(true) // generate password
			.mockResolvedValueOnce(false) // acknowledgement

		await expect(stepGrant(ctx)).rejects.toBeInstanceOf(CancelledError)

		expect(ctx.project.grantId).toBe('grant-new')
		expect(markStep).not.toHaveBeenCalledWith(ctx.project, 'grant')
	})

	it('throws CancelledError when the password acknowledgement is cancelled', async () => {
		const listGrants = vi.fn().mockResolvedValue({ data: [] })
		const createAgentAccount = vi.fn().mockResolvedValue({ id: 'grant-new' })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants, createAgentAccount } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce('contact' as never)
		vi.mocked(p.confirm)
			.mockResolvedValueOnce(true) // generate password
			.mockResolvedValueOnce(CANCEL as never) // acknowledgement

		await expect(stepGrant(ctx)).rejects.toBeInstanceOf(CancelledError)

		expect(markStep).not.toHaveBeenCalledWith(ctx.project, 'grant')
	})

	it('refuses to create when the sandbox mailbox cap is reached', async () => {
		const data = Array.from({ length: 5 }, (_, i) => ({
			id: `g${i}`,
			provider: 'nylas',
			email: `u${i}@other.com`,
		}))
		const listGrants = vi.fn().mockResolvedValue({ data })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants } as never,
		})

		await expect(stepGrant(ctx)).rejects.toThrow(/sandbox cap is 5/)
	})

	it('creates a fresh inbox with a user-typed password when generation is declined', async () => {
		const listGrants = vi.fn().mockResolvedValue({ data: [] })
		const createAgentAccount = vi.fn().mockResolvedValue({ id: 'grant-typed' })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants, createAgentAccount } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce('sales' as never)
		vi.mocked(p.confirm).mockResolvedValueOnce(false) // type your own
		vi.mocked(p.password).mockResolvedValueOnce('MyTyp3dPassword!!x' as never)

		await stepGrant(ctx)

		expect(createAgentAccount).toHaveBeenCalledWith({
			email: 'sales@acme.nylas.email',
			appPassword: 'MyTyp3dPassword!!x',
			name: 'acme',
		})
		expect(ctx.project.inboxEmail).toBe('sales@acme.nylas.email')
		expect(storePendingSecret).toHaveBeenCalledWith(ctx.project, 'appPassword', 'MyTyp3dPassword!!x')

		// Local-part rule accepts a valid handle and rejects an empty/illegal one.
		const localValidate = validatorFrom(vi.mocked(p.text))
		expect(localValidate('contact')).toBeUndefined()
		expect(localValidate('-')).toBeTruthy()
		expect(localValidate(undefined)).toBeTruthy()

		// Password rule delegates to the shared (mocked) validator for both inputs.
		const pwValidate = validatorFrom(vi.mocked(p.password))
		expect(pwValidate('whatever')).toBeUndefined()
		expect(pwValidate(undefined)).toBeUndefined()
		expect(validateAppPassword).toHaveBeenCalledWith('', 'sales')
	})

	it('throws CancelledError when the local-part prompt is cancelled', async () => {
		const listGrants = vi.fn().mockResolvedValue({ data: [] })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce(CANCEL as never)

		await expect(stepGrant(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws CancelledError when the generate-password confirm is cancelled', async () => {
		const listGrants = vi.fn().mockResolvedValue({ data: [] })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce('contact' as never)
		vi.mocked(p.confirm).mockResolvedValueOnce(CANCEL as never)

		await expect(stepGrant(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws CancelledError when the typed password prompt is cancelled', async () => {
		const listGrants = vi.fn().mockResolvedValue({ data: [] })
		const ctx = baseCtx({
			project: baseProject({ domainAddress: 'acme.nylas.email' }),
			v3: { listGrants } as never,
		})
		vi.mocked(p.text).mockResolvedValueOnce('contact' as never)
		vi.mocked(p.confirm).mockResolvedValueOnce(false)
		vi.mocked(p.password).mockResolvedValueOnce(CANCEL as never)

		await expect(stepGrant(ctx)).rejects.toBeInstanceOf(CancelledError)
	})
})
