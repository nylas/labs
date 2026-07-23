import { describe, expect, it } from 'vitest'
import { addProjectAppDomain, isAppDomain, normalizeAppDomain, projectAppDomains } from './app-domains.js'
import type { ProjectState } from './schema.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		appDomains: [],
		...overrides,
	} as ProjectState
}

describe('app domain state boundaries', () => {
	it('normalizes safe ASCII and punycode hostnames', () => {
		expect(normalizeAppDomain(' MAIL.Example.COM. ')).toBe('mail.example.com')
		expect(isAppDomain('mail.xn--bcher-kva.example')).toBe(true)
	})

	it.each([
		'',
		'abc',
		'localhost',
		'https://mail.example.com',
		'*.example.com',
		'mail.example.com/path',
		'mail.example.com:443',
		'-mail.example.com',
		'mail-.example.com',
		`${'a'.repeat(64)}.example.com`,
		`${'a'.repeat(244)}.example.com`,
		'mail.example.123',
	])('rejects invalid hostname %s', (domain) => {
		expect(isAppDomain(domain)).toBe(false)
		expect(() => normalizeAppDomain(domain)).toThrow(/Enter an app hostname/)
	})

	it('deduplicates the primary with aliases and tolerates legacy state without the array', () => {
		expect(
			projectAppDomains(
				project({
					appDomain: 'mail.example.com',
					appDomains: ['mail.example.com', 'inbox.example.com'],
				}),
			),
		).toEqual(['mail.example.com', 'inbox.example.com'])
		expect(projectAppDomains({ appDomain: 'mail.example.com' } as ProjectState)).toEqual(['mail.example.com'])
	})

	it('adds a domain and enforces the project limit', () => {
		const input = project({ appDomains: ['mail.example.com'] })
		addProjectAppDomain(input, 'inbox.example.com')
		expect(input.appDomains).toEqual(['mail.example.com', 'inbox.example.com'])

		const full = project({
			appDomains: Array.from({ length: 50 }, (_, index) => `mail${index}.example.com`),
		})
		expect(() => addProjectAppDomain(full, 'overflow.example.com')).toThrow(/at most 50/)
	})
})
