import { describe, expect, it } from 'vitest'
import { contrast, type Lab, mixOklab, parseOklch, token } from '../../../../test/oklch'

/**
 * In the Conversation view the reader's own bubbles are a tinted surface and
 * everyone else's are the neutral muted fill. The tint only works if everything
 * that can sit inside an own bubble stays readable on it, in both themes.
 */
describe.each(['light', 'dark'] as const)('own bubble colours in the %s theme', (theme) => {
	const colour = (name: string): Lab => parseOklch(token(name, theme))
	const own = colour('--bubble-own')

	it('keeps message text, and links which inherit its colour, at 4.5:1 or better', () => {
		expect(contrast(own, colour('--bubble-own-fg'))).toBeGreaterThanOrEqual(4.5)
	})

	it('keeps muted text (signatures, quoted text, reply references) at 4.5:1 or better', () => {
		const muted = colour('--muted-foreground')
		expect(contrast(own, muted)).toBeGreaterThanOrEqual(4.5)
		// A reply reference sits on a 60% background fill over the bubble.
		const reference = mixOklab(colour('--background'), own, 0.6)
		expect(contrast(reference, muted)).toBeGreaterThanOrEqual(4.5)
	})

	it('is a different fill from the neutral bubble, so the tint is visible', () => {
		expect(token('--bubble-own', theme)).not.toBe(token('--muted', theme))
		// Quiet, not loud: the two fills stay close in lightness.
		expect(Math.abs(own.l - colour('--muted').l)).toBeLessThan(0.06)
	})

	it('uses the green accent surface where the theme has one', () => {
		// The light accent is neutral, so only the dark theme can borrow it.
		if (theme === 'dark') {
			expect(token('--bubble-own', theme)).toBe(token('--accent', theme))
			expect(token('--bubble-own-fg', theme)).toBe(token('--accent-foreground', theme))
		} else {
			expect(token('--accent', theme)).toBe(token('--muted', theme))
		}
	})
})
