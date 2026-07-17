import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runStatus } from './status.js'

vi.mock('@clack/prompts', () => ({
	log: { info: vi.fn() },
	note: vi.fn(),
}))
vi.mock('../state/store.js', () => ({
	listProjects: vi.fn(),
}))

import * as p from '@clack/prompts'
import { listProjects } from '../state/store.js'

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
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('runStatus', () => {
	it('tells the user to create an inbox when there are no projects', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		await runStatus()
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('No projects yet'))
		expect(p.note).not.toHaveBeenCalled()
	})

	it('renders a fully-populated project with human state and no raw step IDs', async () => {
		vi.mocked(listProjects).mockReturnValue([
			project({
				region: 'eu',
				domainAddress: 'mail.acme.com',
				domainVerified: true,
				inboxEmail: 'hi@acme.com',
				workersDevUrl: 'https://acme.workers.dev',
				templateVersion: '1.2.3',
				ejected: true,
				completedSteps: ['app', 'deploy'],
			}),
		])
		await runStatus()
		const [[body, title]] = vi.mocked(p.note).mock.calls
		expect(title).toBe('acme')
		expect(body).toContain('region:   eu')
		expect(body).toContain('stage:    Ejected')
		expect(body).toContain('health:   Source exported')
		expect(body).toContain('hosting:  Ejected source')
		expect(body).toContain('mail.acme.com (verified)')
		expect(body).toContain('inbox:    hi@acme.com')
		expect(body).toContain('https://acme.workers.dev')
		expect(body).toContain('1.2.3 (ejected)')
		expect(body).toContain('next:     wrangler deploy')
		expect(body).not.toContain('steps:')
		expect(body).not.toContain('app → deploy')
	})

	it('falls back to placeholders when optional fields are missing', async () => {
		vi.mocked(listProjects).mockReturnValue([project()])
		await runStatus()
		const [[body]] = vi.mocked(p.note).mock.calls
		expect(body).toContain('domain:   —')
		expect(body).not.toContain('(verified)')
		expect(body).toContain('inbox:    —')
		expect(body).toContain('not deployed yet')
		expect(body).toContain('template: —')
		expect(body).not.toContain('(ejected)')
		expect(body).toContain('stage:    Not started')
		expect(body).toContain('next:     npx ownmail')
	})

	it('labels an enabled shared-storage deployment', async () => {
		vi.mocked(listProjects).mockReturnValue([project({ sharedStorage: true })])
		await runStatus()
		const [[body]] = vi.mocked(p.note).mock.calls
		expect(body).toContain('storage:  shared')
	})

	it('prints machine-readable JSON when requested', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
		vi.mocked(listProjects).mockReturnValue([
			project({
				completedSteps: ['dashboard-auth'],
				hostingProvider: 'manual',
				manualAppUrl: 'https://mail.acme.com',
			}),
		])

		await runStatus({ json: true })

		const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as {
			projects: Array<{ slug: string; stage: string; appUrl: string; hosting: string }>
		}
		expect(payload.projects[0]).toMatchObject({
			slug: 'acme',
			stage: 'Paused: Connect your Nylas account',
			appUrl: 'https://mail.acme.com',
			hosting: 'Manual upload',
		})
		expect(p.note).not.toHaveBeenCalled()
	})
})
