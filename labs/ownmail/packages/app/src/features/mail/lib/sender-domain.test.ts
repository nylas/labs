import { describe, expect, it } from 'vitest'
import { organisationDomain, sameSenderDomain } from './sender-domain.js'

describe('organisationDomain', () => {
	it('keeps the registrable part of a domain', () => {
		expect(organisationDomain('alerts@mail.MeridianBank.com')).toBe('meridianbank.com')
		expect(organisationDomain('a@news.example.co.uk')).toBe('example.co.uk')
		expect(organisationDomain('a@mail.example.ne.jp')).toBe('example.ne.jp')
		expect(organisationDomain('a@www.example.gouv.fr')).toBe('example.gouv.fr')
		expect(organisationDomain('a@shop.example.de')).toBe('example.de')
		expect(organisationDomain('a@example.com.')).toBe('example.com')
		expect(organisationDomain('nobody')).toBe('')
	})
})

describe('sameSenderDomain', () => {
	it('matches the same host, whatever its case or trailing dot', () => {
		expect(sameSenderDomain('a@Example.com', 'b@example.com.')).toBe(true)
		expect(sameSenderDomain('a@example.co.uk', 'b@example.co.uk')).toBe(true)
		expect(sameSenderDomain('a@localhost', 'b@localhost')).toBe(true)
	})

	it('matches a subdomain of the other host, either way round', () => {
		expect(sameSenderDomain('a@mail.example.com', 'b@example.com')).toBe(true)
		expect(sameSenderDomain('a@example.co.uk', 'b@news.example.co.uk')).toBe(true)
		expect(sameSenderDomain('a@deep.mail.example.ne.jp', 'b@mail.example.ne.jp')).toBe(true)
	})

	it('matches sibling hosts of one registrable domain under a plain top-level domain', () => {
		expect(sameSenderDomain('a@mail.example.com', 'b@news.example.com')).toBe(true)
		expect(sameSenderDomain('a@mail.example.de', 'b@news.example.de')).toBe(true)
	})

	it('keeps siblings under a multi-label public suffix apart', () => {
		for (const suffix of ['co.uk', 'ne.jp', 'com.au', 'ac.jp', 'org.uk', 'gov.uk', 'gouv.fr']) {
			expect(sameSenderDomain(`a@mail.example.${suffix}`, `b@news.example.${suffix}`)).toBe(false)
			expect(sameSenderDomain(`a@example.${suffix}`, `b@evil.${suffix}`)).toBe(false)
		}
	})

	it('keeps other organisations, bare top-level domains and missing domains apart', () => {
		expect(sameSenderDomain('a@meridianbank.com', 'b@meridian-secure.co')).toBe(false)
		expect(sameSenderDomain('a@example.com', 'b@notexample.com')).toBe(false)
		expect(sameSenderDomain('a@com', 'b@example.com')).toBe(false)
		expect(sameSenderDomain('a@example.com', 'b@com')).toBe(false)
		expect(sameSenderDomain('a@localhost', 'b@intranet')).toBe(false)
		expect(sameSenderDomain('nodomain', 'b@example.com')).toBe(false)
		expect(sameSenderDomain('a@example.com', 'b@')).toBe(false)
		expect(sameSenderDomain('', '')).toBe(false)
	})
})
