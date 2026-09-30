import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runCreate, showSetupHeader } from './create.js'

const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	cancel: vi.fn(),
	log: { error: vi.fn(), info: vi.fn(), step: vi.fn() },
	select: vi.fn(),
	text: vi.fn(),
	confirm: vi.fn(async () => true),
	isCancel: vi.fn((v: unknown) => v === CANCEL),
}))

vi.mock('../nylas-env.js', () => ({
	defaultProjectRegion: vi.fn((r: 'us' | 'eu') => r),
	ownmailNylasEnvironment: vi.fn(() => 'production'),
}))

vi.mock('../state/store.js', () => ({
	listProjects: vi.fn(() => [] as ProjectState[]),
	loadProject: vi.fn(),
	newProject: vi.fn(),
	saveProject: vi.fn(),
}))

vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(async (project: ProjectState) => ({ project }) as never),
}))

vi.mock('../steps/site-name.js', () => ({
	stepSiteName: vi.fn(async (ctx: { project: ProjectState }) => {
		ctx.project.siteName ??= 'Acme Mail'
	}),
}))

vi.mock('../steps/deploy.js', () => ({
	stepHostingProvider: vi.fn(async (ctx: { project: ProjectState }) => {
		ctx.project.hostingProvider ??= 'cloudflare'
	}),
	stepCfAuth: vi.fn(),
	stepCfResources: vi.fn(),
	stepDeploy: vi.fn(),
	stepWebhook: vi.fn(),
	stepRedirectUris: vi.fn(),
	stepVerify: vi.fn(),
}))

vi.mock('../steps/provision.js', () => {
	class CancelledError extends Error {
		constructor() {
			super('Cancelled')
			this.name = 'CancelledError'
		}
	}
	return {
		CancelledError,
		stepDashboardAuth: vi.fn(),
		stepOrg: vi.fn(),
		stepApp: vi.fn(),
		stepApiKey: vi.fn(),
		stepConnector: vi.fn(),
		stepDomain: vi.fn(),
		stepDomainPlan: vi.fn(async (ctx: { project: ProjectState }) => {
			ctx.project.plannedDomainAddress ??= 'acme.nylas.email'
			ctx.project.plannedDomainBranded ??= true
		}),
		stepGrant: vi.fn(),
		listAccountProjects: vi.fn(async () => []),
	}
})

vi.mock('../steps/recover.js', () => ({ stepRecover: vi.fn() }))

vi.mock('./misc.js', () => ({ LOGIN_PROJECT_SLUG: '__login__' }))

import * as p from '@clack/prompts'
import { ownmailNylasEnvironment } from '../nylas-env.js'
import { listProjects, loadProject, newProject, saveProject } from '../state/store.js'
import {
	CancelledError,
	listAccountProjects,
	stepApp,
	stepDashboardAuth,
	stepDomainPlan,
	stepGrant,
	stepOrg,
} from '../steps/provision.js'
import { stepRecover } from '../steps/recover.js'
import { stepSiteName } from '../steps/site-name.js'

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

let savedExitCode: typeof process.exitCode

beforeEach(() => {
	vi.clearAllMocks()
	savedExitCode = process.exitCode
	process.exitCode = undefined
	vi.mocked(ownmailNylasEnvironment).mockReturnValue('production')
	vi.mocked(listProjects).mockReturnValue([])
})

afterEach(() => {
	process.exitCode = savedExitCode
})

describe('runCreate — resolveProject', () => {
	it('loads a named project when one exists', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(loadProject).toHaveBeenCalledWith('acme')
		expect(newProject).not.toHaveBeenCalled()
		expect(p.outro).toHaveBeenCalled()
	})

	it('creates a new named project when none exists', async () => {
		vi.mocked(loadProject).mockReturnValue(null)
		const fresh = makeProject({ slug: 'newco', region: 'eu' })
		vi.mocked(newProject).mockReturnValue(fresh)

		await runCreate({ name: 'newco', region: 'eu' })

		expect(newProject).toHaveBeenCalledWith('newco', 'eu')
		expect(p.outro).toHaveBeenCalled()
	})

	it('normalizes a setup app-name override and refuses to silently rename a deployment', async () => {
		const fresh = makeProject({ slug: 'newco' })
		vi.mocked(loadProject).mockReturnValueOnce(null)
		vi.mocked(newProject)
			.mockReturnValueOnce(makeProject({ slug: '__login__' }))
			.mockReturnValueOnce(fresh)

		await runCreate({ name: 'newco', siteName: '  Newco   Inbox ' })

		expect(fresh.siteName).toBe('Newco Inbox')
		expect(saveProject).toHaveBeenCalledWith(fresh)

		vi.mocked(loadProject).mockReturnValueOnce(
			makeProject({ slug: 'live', siteName: 'Live Mail', completedSteps: ['deploy'] }),
		)
		await expect(runCreate({ name: 'live', siteName: 'Different Mail' })).rejects.toThrow(/ownmail app name/)

		const unchanged = makeProject({
			slug: 'live',
			siteName: 'Live Mail',
			applicationId: 'app-1',
			hostingProvider: 'cloudflare',
			completedSteps: ['deploy'],
		})
		vi.mocked(loadProject).mockReturnValueOnce(unchanged)
		await runCreate({ name: 'live', siteName: 'Live Mail' })
		expect(saveProject).toHaveBeenCalledWith(unchanged)
	})

	it('requires choosing the project name in the guide when --name is omitted', async () => {
		const proj = makeProject({ slug: 'solo' })
		vi.mocked(listProjects).mockReturnValue([proj, makeProject({ slug: 'gone', ejected: true })])
		vi.mocked(p.select).mockResolvedValue('solo' as never)
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({})

		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Project name',
				options: [
					expect.objectContaining({ value: 'solo' }),
					expect.objectContaining({ value: '__account__' }),
					expect.objectContaining({ value: '__new__' }),
				],
			}),
		)
		expect(loadProject).toHaveBeenCalledWith('solo')
		expect(p.outro).toHaveBeenCalled()
	})

	it('prompts to pick an existing project when several exist', async () => {
		const a = makeProject({ slug: 'a', inboxEmail: 'a@x.com' })
		const b = makeProject({ slug: 'b' })
		vi.mocked(listProjects).mockReturnValue([a, b])
		vi.mocked(p.select).mockResolvedValue('a' as never)
		vi.mocked(loadProject).mockReturnValue(a)

		await runCreate({})

		expect(p.select).toHaveBeenCalled()
		expect(loadProject).toHaveBeenCalledWith('a')
		expect(p.outro).toHaveBeenCalled()
	})

	it('throws when the picked existing project can no longer be loaded', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'a' }), makeProject({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue('a' as never)
		vi.mocked(loadProject).mockReturnValue(null)

		await expect(runCreate({})).rejects.toThrow('No project named "a".')
	})

	it('falls through to a new-project prompt when the picker chooses __new__', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'a' }), makeProject({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue('__new__' as never)
		vi.mocked(p.text).mockResolvedValue('brandnew' as never)
		const fresh = makeProject({ slug: 'brandnew' })
		vi.mocked(newProject).mockReturnValue(fresh)

		await runCreate({})

		expect(newProject).toHaveBeenCalledWith('brandnew', 'us')
		expect(saveProject).toHaveBeenCalledWith(fresh)
		expect(p.outro).toHaveBeenCalled()
	})

	it('cancels when the project picker is cancelled', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'a' }), makeProject({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue(CANCEL as never)

		await expect(runCreate({})).rejects.toBeInstanceOf(CancelledError)
	})

	it('creates and saves a project from the text prompt when none exist', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		vi.mocked(p.text).mockResolvedValue('typedname' as never)
		const fresh = makeProject({ slug: 'typedname' })
		vi.mocked(newProject).mockReturnValue(fresh)

		await runCreate({})

		expect(p.text).toHaveBeenCalled()
		expect(saveProject).toHaveBeenCalledWith(fresh)
		expect(p.outro).toHaveBeenCalled()
	})

	it('exercises the name-prompt validate rule (accept + reject)', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		let validate: ((v: string | undefined) => string | undefined) | undefined
		vi.mocked(p.text).mockImplementation(async (opts: never) => {
			validate = (opts as { validate: typeof validate }).validate
			return 'ok' as never
		})
		vi.mocked(newProject).mockReturnValue(makeProject({ slug: 'ok' }))

		await runCreate({})

		expect(validate?.('acme')).toBeUndefined()
		expect(validate?.('BadName!')).toMatch(/Lowercase/)
		expect(validate?.(undefined)).toMatch(/Lowercase/)
	})

	it('cancels when the new-project text prompt is cancelled', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		vi.mocked(p.text).mockResolvedValue(CANCEL as never)

		await expect(runCreate({})).rejects.toBeInstanceOf(CancelledError)
	})
})

describe('runCreate — normalizeProjectRegion', () => {
	it('returns the project unchanged when the region already matches', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme', region: 'us' })

		expect(proj.region).toBe('us')
		expect(p.log.info).not.toHaveBeenCalledWith(expect.stringContaining('Using US'))
	})

	it('switches region when the project has no provisioned resources', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme', region: 'eu' })

		expect(proj.region).toBe('eu')
		expect(saveProject).toHaveBeenCalledWith(proj)
		expect(p.log.info).toHaveBeenCalled()
	})

	it('refuses to switch region once resources exist', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us', applicationId: 'app_1' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await expect(runCreate({ name: 'acme', region: 'eu' })).rejects.toThrow(/was started in us/)
	})

	it('repairs the legacy EU staging default back to US', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'eu', completedSteps: ['dashboard-auth', 'org'] })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('us')
		expect(saveProject).toHaveBeenCalledWith(proj)
	})

	it('does not repair region when staging progressed past org', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'eu', completedSteps: ['dashboard-auth', 'org', 'app'] })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('eu')
	})

	it('does not repair region outside staging (production, EU)', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('production')
		const proj = makeProject({ slug: 'acme', region: 'eu' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('eu')
	})

	it('does not repair a non-EU staging project', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('us')
	})

	it('does not repair a staging EU project that already has resources', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'eu', grantId: 'grant_1' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('eu')
	})
})

describe('runCreate — projects set up on another computer', () => {
	beforeEach(() => {
		vi.mocked(newProject).mockImplementation((slug, region) => makeProject({ slug, region }))
		vi.mocked(stepOrg).mockImplementation(async (ctx) => {
			ctx.project.orgPublicId = 'org1'
		})
		vi.mocked(listAccountProjects).mockResolvedValue([
			{ slug: 'acme', applicationId: 'app-acme', region: 'eu' },
			{ slug: 'local', applicationId: 'app-local', region: 'us' },
		])
	})

	it('logs in first on a new computer and resumes a picked account project without a local file', async () => {
		vi.mocked(p.select).mockResolvedValueOnce('app-acme' as never)

		await runCreate({})

		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: [
					expect.objectContaining({ value: 'app-acme', label: 'acme', hint: 'EU' }),
					expect.objectContaining({ value: 'app-local' }),
					expect.objectContaining({ value: '__new__' }),
				],
			}),
		)
		const adopted = vi.mocked(stepRecover).mock.calls[0]?.[0].project as ProjectState
		expect(adopted).toMatchObject({
			slug: 'acme',
			region: 'eu',
			orgPublicId: 'org1',
			applicationId: 'app-acme',
			adoptedFromAccount: true,
		})
		expect(adopted.adoptedSharedTag).toBeUndefined()
		expect(adopted.completedSteps).toEqual(expect.arrayContaining(['dashboard-auth', 'org', 'app']))
		expect(saveProject).toHaveBeenCalledWith(adopted)
		// The login session is reused; the runner must not prompt for login or organization again.
		expect(stepDashboardAuth).toHaveBeenCalledTimes(1)
		expect(stepOrg).toHaveBeenCalledTimes(1)
		expect(p.text).not.toHaveBeenCalled()
	})

	it('adopts an account project named with --name when it is not on this computer', async () => {
		vi.mocked(loadProject).mockReturnValue(null)

		await runCreate({ name: 'acme' })

		expect(p.select).not.toHaveBeenCalled()
		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toMatchObject({
			slug: 'acme',
			applicationId: 'app-acme',
			adoptedFromAccount: true,
		})
	})

	it('starts a fresh project on the connected session when the name is not on the account', async () => {
		vi.mocked(listAccountProjects).mockResolvedValue([])
		vi.mocked(p.text).mockResolvedValueOnce('brandnew' as never)

		await runCreate({})

		expect(p.select).not.toHaveBeenCalled()
		const created = vi.mocked(stepRecover).mock.calls[0]?.[0].project as ProjectState
		expect(created).toMatchObject({ slug: 'brandnew', orgPublicId: 'org1' })
		expect(created.applicationId).toBeUndefined()
		expect(created.adoptedFromAccount).toBeUndefined()
		expect(stepDashboardAuth).toHaveBeenCalledTimes(1)
	})

	it('offers only account projects that are not already on this computer', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'local' })])
		vi.mocked(p.select)
			.mockResolvedValueOnce('__account__' as never)
			.mockResolvedValueOnce('app-acme' as never)

		await runCreate({})

		expect(vi.mocked(p.select).mock.calls[1]?.[0]).toMatchObject({
			options: [
				expect.objectContaining({ value: 'app-acme' }),
				expect.objectContaining({ value: '__new__' }),
			],
		})
		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toMatchObject({ slug: 'acme' })
	})

	it('keeps an existing local project instead of overwriting it when its name is typed', async () => {
		const local = makeProject({ slug: 'local', applicationId: 'app-local', grantId: 'grant-1' })
		vi.mocked(listProjects).mockReturnValue([local])
		vi.mocked(listAccountProjects).mockResolvedValue([])
		vi.mocked(p.select).mockResolvedValueOnce('__account__' as never)
		vi.mocked(p.text).mockResolvedValueOnce('local' as never)
		vi.mocked(loadProject).mockReturnValue(local)

		await runCreate({})

		expect(p.log.info).toHaveBeenCalledWith('No other OwnMail projects were found on this Nylas account.')
		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toBe(local)
		expect(saveProject).not.toHaveBeenCalledWith(
			expect.objectContaining({ slug: 'local', grantId: undefined }),
		)
	})

	it('resumes the account project when its old name is typed as a new project', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'local' })])
		vi.mocked(p.select).mockResolvedValueOnce('__new__' as never)
		vi.mocked(p.text).mockResolvedValueOnce('acme' as never)
		vi.mocked(loadProject).mockReturnValue(null)

		await runCreate({})

		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toMatchObject({
			slug: 'acme',
			applicationId: 'app-acme',
			adoptedFromAccount: true,
		})
	})

	it('opens the local project when a new-project name matches one on this computer', async () => {
		const local = makeProject({ slug: 'local', grantId: 'grant-1' })
		vi.mocked(listProjects).mockReturnValue([local])
		vi.mocked(p.select).mockResolvedValueOnce('__new__' as never)
		vi.mocked(p.text).mockResolvedValueOnce('local' as never)
		vi.mocked(loadProject).mockReturnValue(local)

		await runCreate({})

		expect(listAccountProjects).not.toHaveBeenCalled()
		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toBe(local)
	})

	it('starts a new project from the account picker when asked', async () => {
		vi.mocked(p.select).mockResolvedValueOnce('__new__' as never)
		vi.mocked(p.text).mockResolvedValueOnce('fresh' as never)
		vi.mocked(loadProject).mockReturnValue(null)

		await runCreate({})

		const created = vi.mocked(stepRecover).mock.calls[0]?.[0].project as ProjectState
		expect(created).toMatchObject({ slug: 'fresh', orgPublicId: 'org1' })
		expect(created.adoptedFromAccount).toBeUndefined()
	})

	it('adopts exactly the picked app when two apps share a project tag', async () => {
		vi.mocked(listAccountProjects).mockResolvedValue([
			{ slug: 'acme', applicationId: 'app-us', region: 'us' },
			{ slug: 'acme', applicationId: 'app-eu', region: 'eu' },
		])
		vi.mocked(p.select).mockResolvedValueOnce('app-eu' as never)

		await runCreate({})

		expect(vi.mocked(p.select).mock.calls[0]?.[0]).toMatchObject({
			options: [
				expect.objectContaining({ value: 'app-us', hint: 'US · app-us' }),
				expect.objectContaining({ value: 'app-eu', hint: 'EU · app-eu' }),
				expect.objectContaining({ value: '__new__' }),
			],
		})
		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toMatchObject({
			applicationId: 'app-eu',
			region: 'eu',
			// The live app's slug cannot tell these two apps apart during recovery.
			adoptedSharedTag: true,
		})
	})

	it('asks which app a --name refers to when several share its tag', async () => {
		vi.mocked(loadProject).mockReturnValue(null)
		vi.mocked(listAccountProjects).mockResolvedValue([
			{ slug: 'acme', applicationId: 'app-us', region: 'us' },
			{ slug: 'acme', applicationId: 'app-eu', region: 'eu' },
		])
		vi.mocked(p.select).mockResolvedValueOnce('app-eu' as never)

		await runCreate({ name: 'acme' })

		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('Several apps on your Nylas account') }),
		)
		expect(vi.mocked(stepRecover).mock.calls[0]?.[0].project).toMatchObject({ applicationId: 'app-eu' })
	})

	it('pauses when choosing between apps that share a tag is cancelled', async () => {
		vi.mocked(loadProject).mockReturnValue(null)
		vi.mocked(listAccountProjects).mockResolvedValue([
			{ slug: 'acme', applicationId: 'app-us', region: 'us' },
			{ slug: 'acme', applicationId: 'app-eu', region: 'eu' },
		])
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(runCreate({ name: 'acme' })).rejects.toBeInstanceOf(CancelledError)
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('pauses when the account project picker is cancelled', async () => {
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(runCreate({})).rejects.toBeInstanceOf(CancelledError)
	})
})

describe('runCreate — step machine', () => {
	it('renders a concise setup note in a full-size terminal', () => {
		showSetupHeader({ columns: 80, rows: 24 })

		expect(p.intro).toHaveBeenCalledWith('ownmail')
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Create an email address'),
			'Launch an inbox on your domain—with one guided command.',
		)
		expect(p.log.info).not.toHaveBeenCalled()
	})

	it.each([
		{ columns: 71, rows: 24, constraint: 'narrow' },
		{ columns: 80, rows: 23, constraint: 'short' },
	])('renders a compact setup header in a $constraint terminal', ({ columns, rows }) => {
		showSetupHeader({ columns, rows })

		expect(p.intro).toHaveBeenCalledWith('ownmail')
		expect(p.log.info).toHaveBeenCalledWith(
			'Create your email address and launch your mail app. We’ll guide each step.',
		)
		expect(p.note).not.toHaveBeenCalled()
	})

	it.each([{ columns: 0, rows: Number.NaN }, {}])(
		'renders the full setup note when terminal dimensions are unavailable or invalid',
		(dimensions) => {
			showSetupHeader(dimensions)

			expect(p.note).toHaveBeenCalledWith(
				expect.any(String),
				'Launch an inbox on your domain—with one guided command.',
			)
		},
	)

	it('runs every step and shows the success outro', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))

		await runCreate({ name: 'acme' })

		expect(p.intro).toHaveBeenCalledWith('ownmail')
		expect(p.outro).toHaveBeenCalledWith('Enjoy your inbox — powered by Nylas.')
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Create an email address'),
			'Launch an inbox on your domain—with one guided command.',
		)
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('Starting “acme” at [1/5]'))
		expect(p.log.step).toHaveBeenCalledTimes(5)
		expect(p.log.step).toHaveBeenNthCalledWith(1, '[1/5] Connect your Nylas account')
		expect(p.log.step).toHaveBeenNthCalledWith(5, '[5/5] Verify your app')
		expect(process.exitCode).toBeUndefined()
	})

	it('identifies the next user-facing phase when resuming', async () => {
		vi.mocked(loadProject).mockReturnValue(
			makeProject({
				slug: 'acme',
				completedSteps: ['dashboard-auth', 'org', 'app', 'api-key', 'connector', 'domain', 'grant'],
			}),
		)

		await runCreate({ name: 'acme' })

		expect(p.log.info).toHaveBeenCalledWith(
			expect.stringContaining('Resuming “acme” at [2/5] Review your setup plan'),
		)
	})

	it('does not create durable resources when the setup plan is declined', async () => {
		vi.mocked(loadProject).mockReturnValue(
			makeProject({
				slug: 'acme',
				hostingProvider: 'cloudflare',
				plannedDomainAddress: 'acme.nylas.email',
				plannedDomainBranded: true,
			}),
		)
		vi.mocked(p.confirm).mockResolvedValueOnce(false)

		await runCreate({ name: 'acme' })

		expect(stepApp).not.toHaveBeenCalled()
		expect(p.cancel).toHaveBeenCalledWith(expect.stringContaining('Paused'))
	})

	it('treats cancelling the confirmation as a clean pause', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(p.confirm).mockResolvedValueOnce(CANCEL as never)

		await runCreate({ name: 'acme' })

		expect(stepApp).not.toHaveBeenCalled()
		expect(p.cancel).toHaveBeenCalledWith(expect.stringContaining('Paused'))
	})

	it('fails closed when a setup plan is incomplete', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepDomainPlan).mockImplementationOnce(async () => undefined)

		await expect(runCreate({ name: 'acme' })).rejects.toThrow('Setup plan is incomplete')

		expect(stepApp).not.toHaveBeenCalled()
	})

	it('fails closed when the hosting step does not record a supported provider', async () => {
		const { stepHostingProvider } = await import('../steps/deploy.js')
		vi.mocked(stepHostingProvider).mockImplementationOnce(async () => undefined)
		vi.mocked(loadProject).mockReturnValue(
			makeProject({ slug: 'acme', domainAddress: 'existing.example.com' }),
		)
		await expect(runCreate({ name: 'acme' })).rejects.toThrow(/Setup plan is incomplete/)
	})

	it('fails closed when the app-name step does not record a validated name', async () => {
		vi.mocked(stepSiteName).mockImplementationOnce(async () => undefined)
		vi.mocked(loadProject).mockReturnValue(
			makeProject({
				slug: 'acme',
				hostingProvider: 'cloudflare',
				domainAddress: 'existing.example.com',
			}),
		)

		await expect(runCreate({ name: 'acme' })).rejects.toThrow(/Setup plan is incomplete/)
	})

	it('describes manual hosting in the creation summary', async () => {
		vi.mocked(loadProject).mockReturnValue(
			makeProject({
				slug: 'acme',
				hostingProvider: 'manual',
				domainAddress: 'existing.example.com',
			}),
		)

		await runCreate({ name: 'acme' })

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Hosting:      Manual upload'),
			'Ready to create',
		)
	})

	it.each([
		['vercel', 'Vercel'],
		['netlify', 'Netlify'],
		['local', 'Local web server'],
	] as const)('describes %s hosting in the creation summary', async (hostingProvider, label) => {
		vi.mocked(loadProject).mockReturnValue(
			makeProject({ slug: 'acme', hostingProvider, domainAddress: 'existing.example.com' }),
		)

		await runCreate({ name: 'acme' })

		expect(p.note).toHaveBeenCalledWith(expect.stringContaining(`Hosting:      ${label}`), 'Ready to create')
	})

	it('does not re-confirm legacy projects that already have durable resources', async () => {
		const project = makeProject({
			slug: 'acme',
			applicationId: 'app-1',
			hostingProvider: 'cloudflare',
		})
		vi.mocked(loadProject).mockReturnValue(project)

		await runCreate({ name: 'acme' })

		expect(p.confirm).not.toHaveBeenCalled()
		expect(project.completedSteps).toContain('plan-confirmed')
	})

	it('reuses a previously confirmed plan without prompting or saving it again', async () => {
		const project = makeProject({
			slug: 'acme',
			hostingProvider: 'cloudflare',
			plannedDomainAddress: 'acme.nylas.email',
			plannedDomainBranded: true,
			completedSteps: ['plan-confirmed'],
		})
		vi.mocked(loadProject).mockReturnValue(project)

		await runCreate({ name: 'acme' })

		expect(p.confirm).not.toHaveBeenCalled()
		expect(saveProject).not.toHaveBeenCalledWith(project)
	})

	it('still confirms when only a reusable email domain exists', async () => {
		vi.mocked(loadProject).mockReturnValue(
			makeProject({
				slug: 'acme',
				domainId: 'existing-domain',
				domainAddress: 'acme.nylas.email',
				domainBranded: true,
				hostingProvider: 'cloudflare',
			}),
		)

		await runCreate({ name: 'acme' })

		expect(p.confirm).toHaveBeenCalledWith({
			message: 'Create these OwnMail resources?',
			initialValue: true,
		})
	})

	it('reports a completed project without exposing internal step IDs', async () => {
		const completedSteps = [
			'dashboard-auth',
			'org',
			'domain-plan',
			'site-name',
			'plan-confirmed',
			'app',
			'api-key',
			'connector',
			'domain',
			'grant',
			'hosting',
			'cf-auth',
			'cf-resources',
			'deploy',
			'webhook',
			'redirect-uris',
			'verify',
		] as ProjectState['completedSteps']
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme', completedSteps }))

		await runCreate({ name: 'acme' })

		expect(p.log.info).toHaveBeenCalledWith('Checking completed project “acme” across 5 setup phases.')
	})

	it('pauses and sets exit code when a step cancels', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepDashboardAuth).mockRejectedValueOnce(new CancelledError())

		await runCreate({ name: 'acme' })

		expect(p.cancel).toHaveBeenCalledWith(expect.stringContaining('Paused'))
		expect(p.outro).not.toHaveBeenCalled()
		expect(process.exitCode).toBe(1)
	})

	it('reports an error and sets exit code when a step throws', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepGrant).mockRejectedValueOnce(new Error('boom'))

		await expect(runCreate({ name: 'acme' })).rejects.toThrow('boom')
	})

	it('stringifies a non-Error thrown by a step', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepGrant).mockRejectedValueOnce('plain string failure')

		await expect(runCreate({ name: 'acme' })).rejects.toBe('plain string failure')
	})
})
