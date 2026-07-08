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

	it('logs an Error message and sets a failing exit code', async () => {
		await runTopLevel(async () => {
			throw new Error('boom')
		})
		expect(p.log.error).toHaveBeenCalledWith('boom')
		expect(process.exitCode).toBe(1)
	})

	it('stringifies non-Error throws', async () => {
		await runTopLevel(async () => {
			throw 'plain string'
		})
		expect(p.log.error).toHaveBeenCalledWith('plain string')
		expect(process.exitCode).toBe(1)
	})
})
