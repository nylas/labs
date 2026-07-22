import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appMeta, DARK_THEME_COLOR, LIGHT_THEME_COLOR } from './app-meta.js'

describe('app metadata', () => {
	it('matches the reference document identity', () => {
		expect(appMeta('ownmail').title).toBe('ownmail — Mail & Calendar')
		expect(appMeta('Acme Mail').description).toBe(
			'Acme Mail is a calm, powerful mail and calendar client. Your inbox and your schedule, in one focused workspace.',
		)
		expect(appMeta('ownmail').description).toBe(
			'ownmail is a calm, powerful mail and calendar client. Your inbox and your schedule, in one focused workspace.',
		)
		expect(LIGHT_THEME_COLOR).toBe('#ffffff')
		expect(DARK_THEME_COLOR).toBe('#0d1210')
	})

	it('keeps the install manifest aligned to the reference root app identity', () => {
		const manifestPath = fileURLToPath(new URL('../../../public/manifest.webmanifest', import.meta.url))
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
			name: string
			short_name: string
			description: string
			id: string
			start_url: string
			theme_color: string
			background_color: string
		}

		expect(manifest.name).toBe('ownmail')
		expect(manifest.short_name).toBe('ownmail')
		expect(manifest.description).toBe(appMeta('ownmail').description)
		expect(manifest.id).toBe('/')
		expect(manifest.start_url).toBe('/')
		expect(manifest.theme_color).toBe(LIGHT_THEME_COLOR)
		expect(manifest.background_color).toBe(LIGHT_THEME_COLOR)
	})
})
