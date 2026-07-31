import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runAppName } from './app-name.js'

const CANCEL = Symbol('cancel')
const releaseLock = vi.fn()

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	text: vi.fn(),
	isCancel: vi.fn((value: unknown) => value === CANCEL),
	log: { warn: vi.fn() },
}))
vi.mock('../state/project-lock.js', () => ({ acquireProjectLock: vi.fn(() => releaseLock) }))
vi.mock('../state/store.js', () => ({ saveProject: vi.fn() }))
vi.mock('./shared.js', () => ({ pickExistingProject: vi.fn() }))
vi.mock('./update.js', () => ({ redeployProject: vi.fn() }))

import * as p from '@clack/prompts'
import { acquireProjectLock } from '../state/project-lock.js'
import { saveProject } from '../state/store.js'
import { pickExistingProject } from './shared.js'
import { redeployProject } from './update.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: ['deploy'],
		pendingSecrets: {},
		domainAddress: 'acme.nylas.email',
		...overrides,
	} as ProjectState
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(pickExistingProject).mockResolvedValue(project())
	Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
})

afterEach(() => {
	Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
})

describe('runAppName', () => {
	it('validates, saves, and redeploys a new name under the project lock', async () => {
		const existing = project()
		vi.mocked(pickExistingProject).mockResolvedValue(existing)

		await runAppName({ name: 'acme', siteName: '  Acme   Inbox ' })

		expect(existing.siteName).toBe('Acme Inbox')
		expect(acquireProjectLock).toHaveBeenCalledWith('acme')
		expect(saveProject).toHaveBeenCalledWith(existing)
		expect(redeployProject).toHaveBeenCalledWith(existing)
		expect(releaseLock).toHaveBeenCalled()
	})

	it('prompts with a domain-derived suggestion', async () => {
		vi.mocked(p.text).mockResolvedValue('Acme Mail' as never)

		await runAppName({})

		expect(p.text).toHaveBeenCalledWith(
			expect.objectContaining({ initialValue: 'Acme Mail', placeholder: 'Acme Mail' }),
		)
	})

	it.each([
		[{ domainAddress: undefined, plannedDomainAddress: 'planned.nylas.email' }, 'Planned Mail'],
		[{ domainAddress: undefined, plannedDomainAddress: undefined }, 'Acme Mail'],
	] as const)('falls back through available naming sources: %o', async (overrides, suggestion) => {
		vi.mocked(pickExistingProject).mockResolvedValue(project(overrides))
		vi.mocked(p.text).mockResolvedValue(suggestion as never)

		await runAppName({})

		expect(p.text).toHaveBeenCalledWith(expect.objectContaining({ initialValue: suggestion }))
	})

	it('shows current and suggested names in non-interactive mode without mutation', async () => {
		Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

		await runAppName({})

		expect(p.note).toHaveBeenCalledWith(expect.stringContaining('Suggested: Acme Mail'), 'acme')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('omits the suggestion for an explicitly configured name in non-interactive mode', async () => {
		Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
		vi.mocked(pickExistingProject).mockResolvedValue(project({ siteName: 'Acme Inbox' }))

		await runAppName({})

		const body = String(vi.mocked(p.note).mock.calls[0]?.[0])
		expect(body).toContain('Current:   Acme Inbox')
		expect(body).not.toContain('Suggested:')
	})

	it('saves without redeploying an incomplete project', async () => {
		const incomplete = project({ completedSteps: [] })
		vi.mocked(pickExistingProject).mockResolvedValue(incomplete)

		await runAppName({ siteName: 'Acme Mail' })

		expect(saveProject).toHaveBeenCalledWith(incomplete)
		expect(redeployProject).not.toHaveBeenCalled()
		expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('when this project deploys'))
	})

	it('rejects invalid input and ejected projects before mutation', async () => {
		await expect(runAppName({ siteName: '<script>' })).rejects.toThrow()
		vi.mocked(pickExistingProject).mockResolvedValue(project({ ejected: true }))
		await expect(runAppName({ siteName: 'Acme Mail' })).rejects.toThrow(/OWNMAIL_SITE_NAME/)
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('keeps the desired name for a safe retry when deployment fails', async () => {
		vi.mocked(redeployProject).mockRejectedValueOnce(new Error('provider unavailable'))

		await expect(runAppName({ siteName: 'Acme Mail' })).rejects.toThrow('provider unavailable')

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('ownmail app update --name acme'))
		expect(saveProject).toHaveBeenCalled()
		expect(releaseLock).toHaveBeenCalled()
	})

	it('treats prompt cancellation and identical configured names as no-ops', async () => {
		vi.mocked(p.text).mockResolvedValue(CANCEL as never)
		await expect(runAppName({})).rejects.toThrow()
		vi.mocked(pickExistingProject).mockResolvedValue(project({ siteName: 'Acme Mail' }))
		await runAppName({ siteName: 'Acme Mail' })
		expect(p.outro).toHaveBeenCalledWith('App name is already “Acme Mail”.')
	})
})
