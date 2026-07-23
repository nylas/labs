import { describe, expect, it } from 'vitest'
import { AuthStateSchema, ProjectSlugSchema, ProjectStateSchema, StepIdSchema } from './schema.js'

/**
 * The schemas are the single source of truth for what persists to disk. If a
 * default drifts (region, ejected, completedSteps, pendingSecrets) a resumed
 * project would load with different behaviour than it was created with, so the
 * defaults are pinned here explicitly.
 */
describe('AuthStateSchema', () => {
	it('parses a minimal valid auth state', () => {
		const parsed = AuthStateSchema.parse({
			userToken: 'tok',
			dpopPrivateJwk: { kty: 'EC' },
			updatedAt: 123,
		})
		expect(parsed.userToken).toBe('tok')
		expect(parsed.orgToken).toBeUndefined()
	})

	it('rejects auth state missing required fields', () => {
		expect(AuthStateSchema.safeParse({ userToken: 'tok' }).success).toBe(false)
		expect(AuthStateSchema.safeParse({ dpopPrivateJwk: {}, updatedAt: 1 }).success).toBe(false)
	})
})

describe('StepIdSchema', () => {
	it('accepts known step ids and rejects unknown ones', () => {
		expect(StepIdSchema.parse('deploy')).toBe('deploy')
		expect(StepIdSchema.safeParse('not-a-step').success).toBe(false)
	})
})

describe('ProjectStateSchema', () => {
	it('applies defaults for a freshly created project', () => {
		const parsed = ProjectStateSchema.parse({
			slug: 'my-inbox',
			createdAt: 1,
			updatedAt: 1,
		})
		expect(parsed.region).toBe('us')
		expect(parsed.ejected).toBe(false)
		expect(parsed.completedSteps).toEqual([])
		expect(parsed.pendingSecrets).toEqual({})
	})

	it('preserves explicitly provided values over defaults', () => {
		const parsed = ProjectStateSchema.parse({
			slug: 'my-inbox',
			createdAt: 1,
			updatedAt: 1,
			region: 'eu',
			ejected: true,
			completedSteps: ['deploy'],
			pendingSecrets: { apiKey: 'k' },
		})
		expect(parsed.region).toBe('eu')
		expect(parsed.ejected).toBe(true)
		expect(parsed.completedSteps).toEqual(['deploy'])
		expect(parsed.pendingSecrets).toEqual({ apiKey: 'k' })
	})

	it.each(['cloudflare', 'vercel', 'netlify', 'local', 'manual'] as const)(
		'accepts the %s hosting provider',
		(hostingProvider) => {
			expect(
				ProjectStateSchema.parse({ slug: 'my-inbox', createdAt: 1, updatedAt: 1, hostingProvider })
					.hostingProvider,
			).toBe(hostingProvider)
		},
	)

	it('validates provider and local deployment metadata', () => {
		const parsed = ProjectStateSchema.parse({
			slug: 'my-inbox',
			createdAt: 1,
			updatedAt: 1,
			providerAppUrl: 'https://acme.vercel.app',
			vercelProjectId: 'prj_1',
			vercelOrgId: 'team_1',
			netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
			localAppUrl: 'http://localhost:3000',
			localPort: 3000,
			localDeployDir: '/tmp/runtime',
			pendingSecrets: { sessionSecret: 'session' },
		})
		expect(parsed.localPort).toBe(3000)
		expect(parsed.pendingSecrets.sessionSecret).toBe('session')
		expect(ProjectStateSchema.safeParse({ ...parsed, localPort: 80 }).success).toBe(false)
		expect(ProjectStateSchema.safeParse({ ...parsed, netlifySiteId: 'bad' }).success).toBe(false)
	})

	it('accepts keyring references for pending setup secrets', () => {
		const parsed = ProjectStateSchema.parse({
			slug: 'my-inbox',
			createdAt: 1,
			updatedAt: 1,
			pendingSecrets: {
				apiKey: { storage: 'keyring', service: 'ownmail', account: 'my-inbox:1:apiKey' },
			},
		})
		expect(parsed.pendingSecrets.apiKey).toEqual({
			storage: 'keyring',
			service: 'ownmail',
			account: 'my-inbox:1:apiKey',
		})
	})

	it('rejects invalid enum, url and step values', () => {
		expect(
			ProjectStateSchema.safeParse({ slug: 's', createdAt: 1, updatedAt: 1, region: 'ap' }).success,
		).toBe(false)
		expect(
			ProjectStateSchema.safeParse({
				slug: 's',
				createdAt: 1,
				updatedAt: 1,
				manualAppUrl: 'not-a-url',
			}).success,
		).toBe(false)
		expect(
			ProjectStateSchema.safeParse({
				slug: 's',
				createdAt: 1,
				updatedAt: 1,
				completedSteps: ['bogus'],
			}).success,
		).toBe(false)
	})

	it('requires slug', () => {
		expect(ProjectStateSchema.safeParse({ createdAt: 1, updatedAt: 1 }).success).toBe(false)
	})

	it('rejects slugs that could escape the project state directory', () => {
		expect(ProjectSlugSchema.safeParse('../auth').success).toBe(false)
		expect(ProjectStateSchema.safeParse({ slug: '../auth', createdAt: 1, updatedAt: 1 }).success).toBe(false)
	})
})
