import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import type { StepContext } from './context.js'
import { CancelledError } from './provision.js'
import { stepSiteName } from './site-name.js'

const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	isCancel: vi.fn((value: unknown) => value === CANCEL),
}))
vi.mock('../state/store.js', () => ({ markStep: vi.fn(), saveProject: vi.fn() }))

import * as p from '@clack/prompts'
import { markStep, saveProject } from '../state/store.js'

function context(overrides: Partial<ProjectState> = {}): StepContext {
	return {
		project: {
			slug: 'acme',
			createdAt: 0,
			updatedAt: 0,
			region: 'us',
			ejected: false,
			completedSteps: [],
			pendingSecrets: {},
			plannedDomainAddress: 'smart-team.nylas.email',
			...overrides,
		} as ProjectState,
	} as StepContext
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('stepSiteName', () => {
	it('offers a domain-derived name and persists the override', async () => {
		const ctx = context()
		vi.mocked(p.text).mockResolvedValue('Smart Team Inbox' as never)

		await stepSiteName(ctx)

		expect(p.text).toHaveBeenCalledWith(
			expect.objectContaining({ initialValue: 'Smart Team Mail', placeholder: 'Smart Team Mail' }),
		)
		expect(ctx.project.siteName).toBe('Smart Team Inbox')
		expect(saveProject).toHaveBeenCalledWith(ctx.project)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'site-name')
	})

	it('exposes the same validation used by persisted state', async () => {
		let validate: ((value: string | undefined) => string | undefined) | undefined
		vi.mocked(p.text).mockImplementation(async (options: never) => {
			validate = (options as { validate: typeof validate }).validate
			return 'Acme Mail' as never
		})

		await stepSiteName(context())

		expect(validate?.('Acme Mail')).toBeUndefined()
		expect(validate?.('<script>')).toBeTruthy()
		expect(validate?.('x'.repeat(81))).toBeTruthy()
	})

	it('reuses configured names and does not interrupt legacy deployed projects', async () => {
		const configured = context({ siteName: 'Acme Mail' })
		await stepSiteName(configured)
		const legacy = context({ plannedDomainAddress: undefined, completedSteps: ['deploy'] })
		await stepSiteName(legacy)

		expect(p.text).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(configured.project, 'site-name')
		expect(markStep).toHaveBeenCalledWith(legacy.project, 'site-name')
	})

	it('fails closed without a domain and handles cancellation', async () => {
		await expect(stepSiteName(context({ plannedDomainAddress: undefined }))).rejects.toThrow(
			/Choose an email domain/,
		)
		vi.mocked(p.text).mockResolvedValue(CANCEL as never)
		await expect(stepSiteName(context())).rejects.toBeInstanceOf(CancelledError)
		expect(saveProject).not.toHaveBeenCalled()
	})
})
