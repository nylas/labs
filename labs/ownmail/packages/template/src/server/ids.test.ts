import { describe, expect, it } from 'vitest'
import { requireNylasProviderId, validNylasProviderId } from './ids.js'

describe('Nylas provider IDs', () => {
	it('allows documented provider id characters', () => {
		expect(validNylasProviderId('message:id+provider@example#part=1')).toBe(true)
	})

	it('rejects empty, oversized, and header-unsafe ids', () => {
		expect(validNylasProviderId('')).toBe(false)
		expect(validNylasProviderId('a'.repeat(1001))).toBe(false)
		expect(validNylasProviderId('event\nid')).toBe(false)
	})

	it('fails closed with a generic validation error', () => {
		expect(() => requireNylasProviderId('', 'event')).toThrow('Invalid event')
	})
})
