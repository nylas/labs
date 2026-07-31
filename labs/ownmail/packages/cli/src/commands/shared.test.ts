import { DashboardAccountError, GatewayError, NylasApiError } from '@nylas-labs/cli-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { formatCommandError, pickExistingProject, runTopLevel, supportReference } from './shared.js'

vi.mock('@clack/prompts', () => ({
	select: vi.fn(),
	isCancel: vi.fn(() => false),
	cancel: vi.fn(),
	log: { error: vi.fn() },
}))
vi.mock('../state/store.js', () => ({
	listProjects: vi.fn(),
	loadProject: vi.fn(),
}))
vi.mock('../steps/provision.js', () => ({
	CancelledError: class CancelledError extends Error {
		constructor() {
			super('Cancelled')
			this.name = 'CancelledError'
		}
	},
}))

import * as p from '@clack/prompts'
import { listProjects, loadProject } from '../state/store.js'
import { CancelledError } from '../steps/provision.js'

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

describe('pickExistingProject', () => {
	it('loads a named project directly', async () => {
		const proj = project({ slug: 'byname' })
		vi.mocked(loadProject).mockReturnValue(proj)
		expect(await pickExistingProject('byname')).toBe(proj)
		expect(loadProject).toHaveBeenCalledWith('byname')
		expect(listProjects).not.toHaveBeenCalled()
	})

	it('throws when the named project does not exist', async () => {
		vi.mocked(loadProject).mockReturnValue(null)
		await expect(pickExistingProject('ghost')).rejects.toThrow(/No project named "ghost"/)
	})

	it('throws when there are no projects at all', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		await expect(pickExistingProject()).rejects.toThrow(/No projects yet/)
	})

	it('returns the sole project without prompting', async () => {
		const proj = project({ slug: 'only' })
		vi.mocked(listProjects).mockReturnValue([proj])
		expect(await pickExistingProject()).toBe(proj)
		expect(p.select).not.toHaveBeenCalled()
	})

	it('fails safely if project storage returns a sparse project list', async () => {
		vi.mocked(listProjects).mockReturnValue(new Array<ProjectState>(1))

		await expect(pickExistingProject()).rejects.toThrow(/Could not load the project/)
	})

	it('prompts to choose among multiple projects and loads the pick', async () => {
		const a = project({ slug: 'a', inboxEmail: 'a@x.com' })
		const b = project({ slug: 'b' })
		vi.mocked(listProjects).mockReturnValue([a, b])
		vi.mocked(p.select).mockResolvedValue('b')
		vi.mocked(loadProject).mockReturnValue(b)
		expect(await pickExistingProject()).toBe(b)
		const [[selectOpts]] = vi.mocked(p.select).mock.calls
		const options = selectOpts.options
		expect(options).toEqual([
			{ value: 'a', label: 'a (a@x.com)' },
			{ value: 'b', label: 'b' },
		])
		expect(loadProject).toHaveBeenCalledWith('b')
	})

	it('throws CancelledError when the picker is cancelled', async () => {
		vi.mocked(listProjects).mockReturnValue([project({ slug: 'a' }), project({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue('a')
		vi.mocked(p.isCancel).mockReturnValue(true)
		await expect(pickExistingProject()).rejects.toBeInstanceOf(CancelledError)
	})

	it('reports a project removed while the picker was open', async () => {
		vi.mocked(listProjects).mockReturnValue([project({ slug: 'a' }), project({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue('b')
		vi.mocked(loadProject).mockReturnValue(null)

		await expect(pickExistingProject()).rejects.toThrow(/selected project no longer exists/)
	})
})

describe('runTopLevel', () => {
	let saved: number | string | undefined
	beforeEach(() => {
		saved = process.exitCode
		process.exitCode = 0
	})
	afterEach(() => {
		process.exitCode = saved
	})

	it('does nothing extra on success', async () => {
		await runTopLevel(async () => {})
		expect(p.cancel).not.toHaveBeenCalled()
		expect(p.log.error).not.toHaveBeenCalled()
		expect(process.exitCode).toBe(0)
	})

	it('reports a cancellation and sets a failing exit code', async () => {
		await runTopLevel(async () => {
			throw new CancelledError()
		})
		expect(p.cancel).toHaveBeenCalledWith('Cancelled.')
		expect(p.log.error).not.toHaveBeenCalled()
		expect(process.exitCode).toBe(1)
	})

	it('gives a safe recovery path for an unexpected error', async () => {
		await runTopLevel(async () => {
			throw new Error('boom')
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'The command could not be completed safely.\n\nHow to fix: Run `npx ownmail project doctor` to identify the failed dependency, then retry. If the problem continues, run `npx ownmail auth login` to refresh your session.',
		)
		expect(process.exitCode).toBe(1)
	})

	it('explains how to recover from an invalid gateway session', async () => {
		await runTopLevel(async () => {
			throw new Error('gateway V3_ApiKeys errors: INVALID SESSION')
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'Your Nylas session is invalid or has expired.\n\nHow to fix: Run `npx ownmail auth login`, then retry your command.',
		)
		expect(process.exitCode).toBe(1)
	})

	it('preserves safe Cloudflare recovery guidance', async () => {
		await runTopLevel(async () => {
			throw new Error('Cloudflare could not deploy. Retry this OwnMail command.')
		})
		expect(p.log.error).toHaveBeenCalledWith('Cloudflare could not deploy. Retry this OwnMail command.')
	})

	it('preserves Cloudflare unknown-state reconciliation guidance', async () => {
		const guidance =
			'Cloudflare may have created session storage named "ownmail-acme", but OwnMail could not confirm its ID. Do not start a new project. Run `npx wrangler kv namespace list` to find it, then re-run `npx ownmail`; it will safely resume.'
		await runTopLevel(async () => {
			throw new Error(guidance)
		})
		expect(p.log.error).toHaveBeenCalledWith(guidance)
	})

	it.each([
		'Vercel could not deploy the mailbox app. Check the Vercel dashboard, then retry.',
		'Vercel deployed the mailbox app, but its health check did not pass. View Runtime Logs in the Vercel dashboard.',
		'Netlify returned an invalid deployment URL; refusing to record it.',
	])('preserves a curated provider recovery message', async (guidance) => {
		await runTopLevel(async () => {
			throw new Error(guidance)
		})
		expect(p.log.error).toHaveBeenCalledWith(guidance)
	})

	it('does not expose arbitrary text merely because it mentions a provider', async () => {
		await runTopLevel(async () => {
			throw new Error('Vercel leaked raw provider detail')
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'The command could not be completed safely.\n\nHow to fix: Run `npx ownmail project doctor` to identify the failed dependency, then retry. If the problem continues, run `npx ownmail auth login` to refresh your session.',
		)
	})

	it('preserves the deployment precondition and its remedy', async () => {
		await runTopLevel(async () => {
			throw new Error('This project hasn’t deployed yet — run `npx ownmail` first.')
		})
		expect(p.log.error).toHaveBeenCalledWith('This project hasn’t deployed yet — run `npx ownmail` first.')
	})

	it('preserves the safe custom-domain validation message', async () => {
		await runTopLevel(async () => {
			throw new Error('Enter a domain like mail.your-company.com')
		})
		expect(p.log.error).toHaveBeenCalledWith('Enter a domain like mail.your-company.com')
	})

	it('explains how to recover when no local project is available', async () => {
		await runTopLevel(async () => {
			throw new Error('No projects yet. Run `npx ownmail` first.')
		})
		expect(p.log.error).toHaveBeenCalledWith('No projects yet. Run `npx ownmail` first.')
	})

	it('explains how to recover from a connectivity failure', async () => {
		await runTopLevel(async () => {
			throw new Error('gateway V3_ApiKeys timed out after 30s')
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'OwnMail could not reach a required service.\n\nHow to fix: Check your internet connection and the provider status page, then retry the command.',
		)
	})

	it('gives a safe recovery path for non-Error throws', async () => {
		await runTopLevel(async () => {
			throw 'plain string'
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'The command could not be completed safely.\n\nHow to fix: Run `npx ownmail project doctor` to identify the failed dependency, then retry. If the problem continues, run `npx ownmail auth login` to refresh your session.',
		)
		expect(process.exitCode).toBe(1)
	})
})

describe('formatCommandError', () => {
	it('explains a Nylas authentication failure and includes its request ID', () => {
		expect(formatCommandError(new NylasApiError('secret upstream detail', 401, 'req-auth-123'))).toBe(
			'The Nylas API rejected the current credentials (HTTP 401).\n\nHow to fix: Run `npx ownmail auth login`, then retry the command.\n\nRequest ID: req-auth-123. Include this ID if you contact Nylas Support.',
		)
	})

	it.each([
		[
			new NylasApiError('hidden', 404, 'req-not-found', 'not_found'),
			'The Nylas API could not find a resource recorded by this project (HTTP 404, not_found).',
			'doctor --fix',
		],
		[
			new NylasApiError('hidden', 409, undefined, 'conflict'),
			'The Nylas API reported a resource conflict (HTTP 409, conflict).',
			'retry the same command',
		],
		[
			new NylasApiError('hidden', 429, undefined, 'rate_limited'),
			'The Nylas API is rate limiting the request (HTTP 429, rate_limited).',
			'Wait a few minutes',
		],
		[
			new NylasApiError('hidden', 503),
			'The Nylas API is temporarily unavailable (HTTP 503).',
			'Nylas status page',
		],
		[
			new NylasApiError('hidden', 422, undefined, 'invalid_request'),
			'The Nylas API rejected the request (HTTP 422, invalid_request).',
			'command inputs',
		],
	])('maps API failures to a specific recovery path', (error, summary, recovery) => {
		const formatted = formatCommandError(error)
		expect(formatted).toContain(summary)
		expect(formatted).toContain(recovery)
		expect(formatted).not.toContain('hidden')
	})

	it('uses a safe fallback for an unclassified service failure and drops unsafe codes', () => {
		const formatted = formatCommandError(
			new NylasApiError('hidden', 418, undefined, 'unsafe\ninternal-detail'),
		)
		expect(formatted).toBe(
			'The Nylas API could not complete the request (HTTP 418).\n\nHow to fix: Run `npx ownmail project doctor`, then retry. If the session check fails, run `npx ownmail auth login`.',
		)
	})

	it('explains a successful HTTP response with an invalid payload', () => {
		expect(
			formatCommandError(new NylasApiError('hidden', 200, 'req-invalid-123', 'invalid_response')),
		).toContain('The Nylas API returned an invalid response (HTTP 200, invalid_response).')
	})

	it('explains malformed successful dashboard responses with their request ID', () => {
		const formatted = formatCommandError(
			new DashboardAccountError('hidden', 200, undefined, 'req-malformed-123'),
		)
		expect(formatted).toContain('The Nylas dashboard returned an invalid response.')
		expect(formatted).toContain('Request ID: req-malformed-123.')
	})

	it('maps dashboard HTTP failures without exposing their body', () => {
		const formatted = formatCommandError(
			new DashboardAccountError('hidden', 403, { token: 'must-not-print' }, 'req-dashboard-123'),
		)
		expect(formatted).toContain('The Nylas dashboard rejected the current credentials (HTTP 403).')
		expect(formatted).not.toContain('must-not-print')
	})

	it('gives safe setup guidance when Enterprise SAML is not configured', () => {
		const formatted = formatCommandError(
			new DashboardAccountError(
				'hidden',
				400,
				{
					error: {
						code: 'SAML_NOT_CONFIGURED',
						message: 'sensitive domain-discovery detail',
					},
				},
				'req-saml-123',
			),
		)

		expect(formatted).toContain(
			'Enterprise SAML is not configured for this work email (HTTP 400, SAML_NOT_CONFIGURED).',
		)
		expect(formatted).toContain('ask your organization administrator')
		expect(formatted).toContain('Request ID: req-saml-123.')
		expect(formatted).not.toContain('sensitive domain-discovery detail')
	})

	it('drops malformed dashboard error codes and never exposes response details', () => {
		const formatted = formatCommandError(
			new DashboardAccountError('hidden', 400, {
				error: { code: 'SAML_NOT_CONFIGURED\nsecret', message: 'must-not-print' },
			}),
		)

		expect(formatted).toContain('The Nylas dashboard rejected the request (HTTP 400).')
		expect(formatted).not.toContain('secret')
		expect(formatted).not.toContain('must-not-print')
	})

	it.each([
		undefined,
		null,
		[],
		{ error: null },
		{ error: [] },
		{ error: 'not-an-object' },
		{ error: {} },
		{ error: { code: 123 } },
	])('fails closed for a malformed dashboard error envelope: %j', (body) => {
		const formatted = formatCommandError(new DashboardAccountError('hidden', 400, body))

		expect(formatted).toBe(
			'The Nylas dashboard rejected the request (HTTP 400).\n\nHow to fix: Run `npx ownmail project doctor` to check the project state and command inputs, then retry.',
		)
	})

	it('uses GraphQL codes when the gateway has no HTTP status', () => {
		const formatted = formatCommandError(
			new GatewayError(
				'hidden',
				[{ message: 'ignored' }, { extensions: { code: 'RATE_LIMITED', supportId: 'support-body' } }],
				'support-gateway-123',
			),
		)
		expect(formatted).toContain('The Nylas dashboard is rate limiting the request (RATE_LIMITED).')
		expect(formatted).toContain('Request ID: support-gateway-123.')
		expect(formatted).not.toContain('ignored')
	})

	it('omits empty service details and support references', () => {
		expect(formatCommandError(new GatewayError('hidden'))).toBe(
			'The Nylas dashboard could not complete the request.\n\nHow to fix: Run `npx ownmail project doctor`, then retry. If the session check fails, run `npx ownmail auth login`.',
		)
	})

	it('keeps only validated request IDs', () => {
		expect(supportReference({ requestId: 'req-safe-123' })).toContain('req-safe-123')
		expect(supportReference({ requestId: 'secret\ninjected' })).toBeUndefined()
		expect(supportReference(null)).toBeUndefined()
	})

	it('retains a request ID through safe wrappers and avoids cause cycles', () => {
		expect(
			supportReference(new Error('Sign-in failed', { cause: { requestId: 'req-cause-123' } })),
		).toContain('req-cause-123')
		const cyclic = new Error('cycle')
		cyclic.cause = cyclic
		expect(supportReference(cyclic)).toBeUndefined()
	})

	it('rejects control characters and non-actionable provider text from plain errors', () => {
		const fallback =
			'The command could not be completed safely.\n\nHow to fix: Run `npx ownmail project doctor` to identify the failed dependency, then retry. If the problem continues, run `npx ownmail auth login` to refresh your session.'
		expect(formatCommandError(new Error('Vercel leaked raw provider detail; check token\rsecret'))).toBe(
			fallback,
		)
		expect(formatCommandError(new Error('Vercel leaked raw provider detail; check \u202Esecret'))).toBe(
			fallback,
		)
	})

	it('preserves reviewed actionable messages that use normal Unicode punctuation', () => {
		const message = '"acme" hasn’t finished its first deploy — run `npx ownmail` to complete it.'
		expect(formatCommandError(new Error(message))).toBe(message)
	})

	it('classifies plain local authentication, project, and network failures', () => {
		expect(formatCommandError(new Error('INVALID SESSION'))).toContain('session is invalid')
		expect(formatCommandError(new Error('no Nylas application'))).toContain('local OwnMail project')
		expect(formatCommandError(new Error('ECONNREFUSED'))).toContain('internet connection')
	})
})
