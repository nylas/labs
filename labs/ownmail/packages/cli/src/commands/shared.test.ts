import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { pickExistingProject, runTopLevel } from './shared.js'

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
			'The command could not be completed.\n\nHow to fix: Run `npx ownmail doctor`, then retry. If the problem continues, run `npx ownmail login` to refresh your session.',
		)
		expect(process.exitCode).toBe(1)
	})

	it('explains how to recover from an invalid gateway session', async () => {
		await runTopLevel(async () => {
			throw new Error('gateway V3_ApiKeys errors: INVALID SESSION')
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'Your Nylas session is invalid or has expired.\n\nHow to fix: Run `npx ownmail login`, then retry your command.',
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
		expect(p.log.error).toHaveBeenCalledWith(
			'Your local OwnMail project is incomplete or unavailable.\n\nHow to fix: Run `npx ownmail status` to find your project, or run `npx ownmail` to create or resume one.',
		)
	})

	it('explains how to recover from a connectivity failure', async () => {
		await runTopLevel(async () => {
			throw new Error('gateway V3_ApiKeys timed out after 30s')
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'OwnMail could not reach a required service.\n\nHow to fix: Check your internet connection, then retry the command.',
		)
	})

	it('gives a safe recovery path for non-Error throws', async () => {
		await runTopLevel(async () => {
			throw 'plain string'
		})
		expect(p.log.error).toHaveBeenCalledWith(
			'The command could not be completed.\n\nHow to fix: Run `npx ownmail doctor`, then retry. If the problem continues, run `npx ownmail login` to refresh your session.',
		)
		expect(process.exitCode).toBe(1)
	})
})
