import type { Grant } from '@nylas-labs/cli-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runInboxAdd, runInboxResetPassword } from './inbox.js'

const CANCEL = Symbol('cancel')

const hoisted = vi.hoisted(() => ({
	v3: {
		listGrants: vi.fn(),
		createAgentAccount: vi.fn(),
		updateGrant: vi.fn(),
	},
}))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	cancel: vi.fn(),
	log: { info: vi.fn(), warn: vi.fn() },
	text: vi.fn(),
	password: vi.fn(),
	confirm: vi.fn(),
	select: vi.fn(),
	isCancel: vi.fn((v: unknown) => v === CANCEL),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))

vi.mock('@nylas-labs/cli-kit', () => ({
	NylasV3Client: vi.fn(() => hoisted.v3),
}))

vi.mock('../nylas-env.js', () => ({
	apiBaseUrl: vi.fn(() => 'https://api.us.nylas.com'),
}))

vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(),
	requireGateway: vi.fn(),
	tokens: vi.fn(() => ({ userToken: 't' })),
}))

vi.mock('../steps/provision.js', () => {
	class CancelledError extends Error {
		constructor() {
			super('Cancelled')
			this.name = 'CancelledError'
		}
	}
	return { CancelledError }
})

vi.mock('../util/password.js', () => ({
	generateAppPassword: vi.fn(() => 'Generated42!Passw0rd'),
	validateAppPassword: vi.fn(() => undefined),
}))

vi.mock('./shared.js', () => ({
	pickExistingProject: vi.fn(),
}))

import * as p from '@clack/prompts'
import { createContext, requireGateway } from '../steps/context.js'
import { CancelledError } from '../steps/provision.js'
import { generateAppPassword } from '../util/password.js'
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
		domainAddress: 'acme.com',
		inboxEmail: 'contact@acme.com',
		workersDevUrl: 'https://acme.workers.dev',
		...overrides,
	} as ProjectState
}

function grant(overrides: Partial<Grant> = {}): Grant {
	return { id: 'g1', provider: 'nylas', email: 'contact@acme.com', ...overrides } as Grant
}

const createApiKey = vi.fn()

beforeEach(() => {
	vi.clearAllMocks()
	createApiKey.mockResolvedValue({ apiKey: 'nyk_1' })
	vi.mocked(requireGateway).mockReturnValue({ createApiKey } as never)
	vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
	vi.mocked(generateAppPassword).mockReturnValue('Generated42!Passw0rd')
	hoisted.v3.listGrants.mockResolvedValue({ data: [] })
	hoisted.v3.createAgentAccount.mockResolvedValue(undefined)
	hoisted.v3.updateGrant.mockResolvedValue(undefined)
	vi.mocked(p.confirm).mockResolvedValue(true as never)
})

let savedExitCode: typeof process.exitCode
beforeEach(() => {
	savedExitCode = process.exitCode
	process.exitCode = undefined
})
afterEach(() => {
	process.exitCode = savedExitCode
})

describe('runInboxAdd', () => {
	it('throws when the project has no domain', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ domainAddress: undefined }))

		await expect(runInboxAdd({})).rejects.toThrow(/no domain yet/)
	})

	it('throws when not logged in', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)

		await expect(runInboxAdd({})).rejects.toThrow(/Not logged in/)
	})

	it('throws when the sandbox inbox cap is reached', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		hoisted.v3.listGrants.mockResolvedValue({
			data: Array.from({ length: 5 }, (_, i) => grant({ id: `g${i}`, email: `a${i}@acme.com` })),
		})

		await expect(runInboxAdd({})).rejects.toThrow(/5\/5 inboxes/)
	})

	it('creates a new inbox with a generated password (existing inboxes listed)', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		hoisted.v3.listGrants.mockResolvedValue({ data: [grant({ email: 'contact@acme.com' })] })
		let validate: ((v: string | undefined) => string | undefined) | undefined
		vi.mocked(p.text).mockImplementation(async (opts: never) => {
			validate = (opts as { validate: typeof validate }).validate
			return 'hello' as never
		})

		await runInboxAdd({})

		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('contact@acme.com'))
		expect(validate?.('hello')).toBeUndefined()
		expect(validate?.('!!bad')).toMatch(/Letters/)
		expect(validate?.(undefined)).toMatch(/Letters/)
		expect(hoisted.v3.createAgentAccount).toHaveBeenCalledWith({
			email: 'hello@acme.com',
			appPassword: 'Generated42!Passw0rd',
			name: 'hello',
		})
		expect(p.note).toHaveBeenCalledWith(expect.stringContaining('https://acme.workers.dev'), 'New inbox')
		expect(p.outro).toHaveBeenCalled()
	})

	it('lists "none" and uses the fallback URL when no inboxes or app URL exist', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ workersDevUrl: undefined }))
		hoisted.v3.listGrants.mockResolvedValue({ data: [] })
		vi.mocked(p.text).mockResolvedValue('hello' as never)
		// Decline generation → typed password path.
		vi.mocked(p.confirm).mockResolvedValue(false as never)
		let pwValidate: ((v: string | undefined) => string | undefined) | undefined
		vi.mocked(p.password).mockImplementation(async (opts: never) => {
			pwValidate = (opts as { validate: typeof pwValidate }).validate
			return 'Typed42!Passw0rd' as never
		})

		await runInboxAdd({})

		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('none'))
		expect(pwValidate?.('anything')).toBeUndefined()
		expect(pwValidate?.(undefined)).toBeUndefined()
		expect(generateAppPassword).not.toHaveBeenCalled()
		expect(hoisted.v3.createAgentAccount).toHaveBeenCalledWith(
			expect.objectContaining({ appPassword: 'Typed42!Passw0rd' }),
		)
		expect(p.note).toHaveBeenCalledWith(expect.stringContaining('your app URL'), 'New inbox')
	})

	it('cancels when the address prompt is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(p.text).mockResolvedValue(CANCEL as never)

		await expect(runInboxAdd({})).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws when the requested address already exists', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		hoisted.v3.listGrants.mockResolvedValue({ data: [grant({ email: 'hello@acme.com' })] })
		vi.mocked(p.text).mockResolvedValue('hello' as never)

		await expect(runInboxAdd({})).rejects.toThrow(/hello@acme.com already exists/)
	})

	it('cancels when the generate-password confirm is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(p.text).mockResolvedValue('hello' as never)
		vi.mocked(p.confirm).mockResolvedValue(CANCEL as never)

		await expect(runInboxAdd({})).rejects.toBeInstanceOf(CancelledError)
	})

	it('cancels when the typed-password prompt is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(p.text).mockResolvedValue('hello' as never)
		vi.mocked(p.confirm).mockResolvedValue(false as never)
		vi.mocked(p.password).mockResolvedValue(CANCEL as never)

		await expect(runInboxAdd({})).rejects.toBeInstanceOf(CancelledError)
	})
})

describe('runInboxResetPassword', () => {
	it('throws when the project has no application', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ applicationId: undefined }))

		await expect(runInboxResetPassword({})).rejects.toThrow(/no Nylas application/)
	})

	it('throws when not logged in', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)

		await expect(runInboxResetPassword({})).rejects.toThrow(/Not logged in/)
	})

	it('throws when the app has no inboxes', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		hoisted.v3.listGrants.mockResolvedValue({ data: [] })

		await expect(runInboxResetPassword({})).rejects.toThrow(/no Nylas inboxes yet/)
	})

	it('resets by explicit email when a password already exists', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		hoisted.v3.listGrants.mockResolvedValue({
			data: [grant({ id: 'g9', email: 'Hello@Acme.com', settings: { has_app_password: true } })],
		})

		await runInboxResetPassword({ email: 'hello@acme.com' })

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('replace the password'))
		expect(hoisted.v3.updateGrant).toHaveBeenCalledWith('g9', {
			settings: { email: 'Hello@Acme.com', app_password: 'Generated42!Passw0rd' },
		})
		expect(p.note).toHaveBeenCalledWith(expect.any(String), 'New password')
		expect(p.outro).toHaveBeenCalled()
	})

	it('throws when the requested email is not an inbox', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject())
		hoisted.v3.listGrants.mockResolvedValue({ data: [grant({ email: 'other@acme.com' })] })

		await expect(runInboxResetPassword({ email: 'missing@acme.com' })).rejects.toThrow(
			/No inbox named missing@acme.com/,
		)
	})

	it('uses the project primary grant, sets a first password, and honours a declined confirm', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ grantId: 'gp' }))
		hoisted.v3.listGrants.mockResolvedValue({
			data: [
				grant({ id: 'gother', email: 'x@acme.com' }),
				grant({ id: 'gp', email: 'primary@acme.com', settings: { has_app_password: false } }),
			],
		})
		let confirmMessage = ''
		vi.mocked(p.confirm).mockImplementation(async (opts: never) => {
			confirmMessage = (opts as { message: string }).message
			return false as never
		})

		await runInboxResetPassword({})

		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('does not have an app password'))
		expect(confirmMessage).toBe('Set this inbox password?')
		expect(p.cancel).toHaveBeenCalledWith('Password reset cancelled.')
		expect(hoisted.v3.updateGrant).not.toHaveBeenCalled()
	})

	it('falls back to the single grant and cancels on confirm cancel', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ grantId: undefined }))
		hoisted.v3.listGrants.mockResolvedValue({
			data: [grant({ id: 'only', email: 'only@acme.com' })],
		})
		vi.mocked(p.confirm).mockResolvedValue(CANCEL as never)

		await expect(runInboxResetPassword({})).rejects.toBeInstanceOf(CancelledError)
		// has_app_password undefined → generic warning.
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('set a new password'))
	})

	it('prompts to pick an inbox among several and renders grant hints', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ grantId: undefined }))
		hoisted.v3.listGrants.mockResolvedValue({
			data: [
				grant({ id: 'a', email: 'a@acme.com', settings: { has_app_password: true } }),
				grant({
					id: 'b',
					email: 'b@acme.com',
					grant_status: 'invalid',
					settings: { has_app_password: false },
				}),
				grant({ id: 'c', email: undefined }),
			],
		})
		let options: { value: string; label: string; hint: string }[] = []
		vi.mocked(p.select).mockImplementation(async (opts: never) => {
			options = (opts as { options: typeof options }).options
			return 'a' as never
		})

		await runInboxResetPassword({})

		expect(options.map((o) => o.hint)).toEqual(['valid, password set', 'invalid, no password', 'valid'])
		expect(options[2]?.label).toBe('c')
		expect(hoisted.v3.updateGrant).toHaveBeenCalledWith('a', expect.anything())
	})

	it('cancels when the inbox picker is cancelled', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ grantId: undefined }))
		hoisted.v3.listGrants.mockResolvedValue({
			data: [grant({ id: 'a', email: 'a@acme.com' }), grant({ id: 'b', email: 'b@acme.com' })],
		})
		vi.mocked(p.select).mockResolvedValue(CANCEL as never)

		await expect(runInboxResetPassword({})).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws when the picked inbox no longer exists', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ grantId: undefined }))
		hoisted.v3.listGrants.mockResolvedValue({
			data: [grant({ id: 'a', email: 'a@acme.com' }), grant({ id: 'b', email: 'b@acme.com' })],
		})
		vi.mocked(p.select).mockResolvedValue('gone' as never)

		await expect(runInboxResetPassword({})).rejects.toThrow(/no longer exists/)
	})

	it('throws when the chosen grant has no email address', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ grantId: 'g1', inboxEmail: undefined }))
		hoisted.v3.listGrants.mockResolvedValue({ data: [grant({ id: 'g1', email: undefined })] })

		await expect(runInboxResetPassword({})).rejects.toThrow(/has no email address/)
	})
})
