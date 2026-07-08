import { describe, expect, it } from 'vitest'
import { APP_DESCRIPTION, APP_TITLE, DARK_THEME_COLOR, LIGHT_THEME_COLOR } from './app-meta.js'

describe('app metadata', () => {
	it('matches the reference document identity', () => {
		expect(APP_TITLE).toBe('ownmail — Mail & Calendar')
		expect(APP_DESCRIPTION).toBe(
			'ownmail is a calm, powerful mail and calendar client. Your inbox and your schedule, in one focused workspace.',
		)
		expect(LIGHT_THEME_COLOR).toBe('#ffffff')
		expect(DARK_THEME_COLOR).toBe('#0d1210')
	})
})
