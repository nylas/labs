import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_NAME, siteNameFromEnv } from './site-config.js'

describe('siteNameFromEnv', () => {
	it('uses a bounded, display-safe site name from configuration', () => {
		expect(siteNameFromEnv({ OWNMAIL_SITE_NAME: '  Acme   Mail  ' })).toBe('Acme Mail')
		expect(siteNameFromEnv({ OWNMAIL_SITE_NAME: "O'Brien's Mail" })).toBe("O'Brien's Mail")
	})

	it('fails closed to the established ownmail name for missing or unsafe values', () => {
		expect(siteNameFromEnv({})).toBe(DEFAULT_SITE_NAME)
		expect(siteNameFromEnv({ OWNMAIL_SITE_NAME: '   ' })).toBe(DEFAULT_SITE_NAME)
		expect(siteNameFromEnv({ OWNMAIL_SITE_NAME: '<script>alert(1)</script>' })).toBe(DEFAULT_SITE_NAME)
		expect(siteNameFromEnv({ OWNMAIL_SITE_NAME: 'x'.repeat(81) })).toBe(DEFAULT_SITE_NAME)
	})
})
