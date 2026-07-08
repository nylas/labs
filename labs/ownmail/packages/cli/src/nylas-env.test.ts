import { GATEWAY_URLS, V3_URLS } from '@nylas-labs/cli-kit'
import { afterEach, describe, expect, it } from 'vitest'
import {
	apiBaseUrl,
	dashboardAccountUrl,
	defaultProjectRegion,
	deployedApiBaseUrl,
	gatewayUrls,
	ownmailNylasEnvironment,
	ownmailStateName,
	resourceNameSuffix,
} from './nylas-env.js'

/**
 * The whole CLI switches between the production and staging Nylas backends via
 * the OWNMAIL_NYLAS_ENV env var. A wrong mapping here would point a real deploy
 * at staging (or vice versa), so both branches of every selector are pinned.
 */
const original = process.env.OWNMAIL_NYLAS_ENV

afterEach(() => {
	if (original === undefined) delete process.env.OWNMAIL_NYLAS_ENV
	else process.env.OWNMAIL_NYLAS_ENV = original
})

describe('production environment (default)', () => {
	afterEach(() => {
		delete process.env.OWNMAIL_NYLAS_ENV
	})

	it('reports production for unset or arbitrary values', () => {
		delete process.env.OWNMAIL_NYLAS_ENV
		expect(ownmailNylasEnvironment()).toBe('production')
		process.env.OWNMAIL_NYLAS_ENV = 'anything-else'
		expect(ownmailNylasEnvironment()).toBe('production')
	})

	it('uses production state name and no suffix', () => {
		delete process.env.OWNMAIL_NYLAS_ENV
		expect(ownmailStateName()).toBe('ownmail')
		expect(resourceNameSuffix()).toBe('')
	})

	it('has no staging dashboard override and no deployed base url', () => {
		delete process.env.OWNMAIL_NYLAS_ENV
		expect(dashboardAccountUrl()).toBeUndefined()
		expect(deployedApiBaseUrl('us')).toBeUndefined()
	})

	it('uses the canonical gateway and v3 urls', () => {
		delete process.env.OWNMAIL_NYLAS_ENV
		expect(gatewayUrls()).toEqual(GATEWAY_URLS)
		expect(apiBaseUrl('us')).toBe(V3_URLS.us)
		expect(apiBaseUrl('eu')).toBe(V3_URLS.eu)
	})
})

describe('staging environment', () => {
	it('reports staging and uses staging state name and suffix', () => {
		process.env.OWNMAIL_NYLAS_ENV = 'staging'
		expect(ownmailNylasEnvironment()).toBe('staging')
		expect(ownmailStateName()).toBe('ownmail-staging')
		expect(resourceNameSuffix()).toBe('-staging')
	})

	it('points at the staging dashboard, gateway and api hosts', () => {
		process.env.OWNMAIL_NYLAS_ENV = 'staging'
		expect(dashboardAccountUrl()).toBe('https://dashboard-account-stg.eu.nylas.com')
		expect(gatewayUrls().us).toContain('staging')
		expect(gatewayUrls().eu).toContain('staging')
		expect(apiBaseUrl('us')).toBe('https://api-staging.us.nylas.com')
		expect(deployedApiBaseUrl('us')).toBe('https://api-staging.us.nylas.com')
	})
})

describe('defaultProjectRegion', () => {
	it('returns the region it is given', () => {
		expect(defaultProjectRegion('us')).toBe('us')
		expect(defaultProjectRegion('eu')).toBe('eu')
	})
})
