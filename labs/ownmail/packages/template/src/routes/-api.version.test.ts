import { describe, expect, it } from 'vitest'
import { versionResponse } from './api.version.js'

describe('/api/version', () => {
	it('returns the inert realtime signal for local dev mocks without requiring a signed session', async () => {
		const response = await versionResponse(new Request('http://ownmail.local/api/version'), {
			devMocks: true,
		})

		expect(response.status).toBe(200)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(await response.json()).toEqual({ version: 0 })
	})
})
