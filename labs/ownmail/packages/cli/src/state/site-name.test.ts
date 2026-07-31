import { describe, expect, it } from 'vitest'
import { configuredSiteName, inferSiteName, normalizeSiteName, siteNameValidationError } from './site-name.js'

describe('site names', () => {
	it.each([
		['acme.nylas.email', 'Acme Mail'],
		['smart-team.nylas.email', 'Smart Team Mail'],
		['example.com', 'Example Mail'],
		['mail.your-company.com', 'Your Company Mail'],
		['inbox.example.co.uk', 'Example Mail'],
		['letters.custom.example.com', 'Letters Mail'],
		['mail.nylas.email', 'Mail'],
		['123.nylas.email', '123 Mail'],
		['example.xyz.uk', 'Example Mail'],
		['acme.nylas.email.', 'Acme Mail'],
		['---.nylas.email', 'My Mail'],
		['', 'My Mail'],
	])('infers %s as %s', (domain, expected) => {
		expect(inferSiteName(domain)).toBe(expected)
	})

	it('normalizes safe display names and preserves Unicode letters', () => {
		expect(normalizeSiteName('  Équipe   Mail  ')).toBe('Équipe Mail')
		expect(siteNameValidationError("O'Brien's Mail")).toBeUndefined()
	})

	it('rejects an omitted prompt value', () => {
		expect(siteNameValidationError(undefined)).toBeTruthy()
	})

	it.each(['', '   ', '<script>alert(1)</script>', 'x'.repeat(81), 'mail\nname'])(
		'rejects an unsafe app name: %j',
		(value) => {
			expect(siteNameValidationError(value)).toBeTruthy()
		},
	)

	it('keeps legacy projects on the existing default until configured', () => {
		expect(configuredSiteName({})).toBe('ownmail')
		expect(configuredSiteName({ siteName: 'Acme Mail' })).toBe('Acme Mail')
	})
})
