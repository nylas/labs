import { afterEach, describe, expect, it } from 'vitest'
import {
	forgetRememberedEmails,
	rememberEmail,
	rememberedEmail,
	renderedEmailKey,
} from './email-render-memory.js'

afterEach(() => forgetRememberedEmails())

describe('rendered email memory', () => {
	it('keys presentations by message, theme, and color mode', () => {
		expect(renderedEmailKey('m1', 'dark', 'automatic')).not.toBe(renderedEmailKey('m1', 'light', 'automatic'))
		expect(renderedEmailKey('m1', 'dark', 'automatic')).not.toBe(renderedEmailKey('m1', 'dark', 'original'))
	})

	it('remembers the latest presentation and evicts the least recently stored', () => {
		const detail = { strategy: 'remap' as const, canvas: null, height: 420 }
		rememberEmail('first', detail)
		for (let index = 0; index < 300; index += 1) rememberEmail(`message-${index}`, detail)
		expect(rememberedEmail('first')).toBeUndefined()
		expect(rememberedEmail('message-299')).toEqual(detail)
		rememberEmail('message-0', { ...detail, height: 500 })
		rememberEmail('another', detail)
		expect(rememberedEmail('message-0')?.height).toBe(500)
		expect(rememberedEmail('message-1')).toBeUndefined()
	})
})
