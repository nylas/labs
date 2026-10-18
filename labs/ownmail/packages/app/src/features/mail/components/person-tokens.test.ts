import { describe, expect, it } from 'vitest'
import { contrast, parseOklch, token } from '../../../../test/oklch.js'

describe('person and notice tokens', () => {
	const pairs = [
		...[75, 250, 32, 158, 300, 200].map((hue) => [`--avatar-${hue}-fg`, `--avatar-${hue}`] as const),
		['--notice-warning-fg', '--notice-warning'] as const,
		['--notice-danger-fg', '--notice-danger'] as const,
	]

	it.each(['light', 'dark'] as const)('keeps text on every tint at 4.5:1 or better (%s)', (theme) => {
		for (const [text, ground] of pairs) {
			expect(
				contrast(parseOklch(token(text, theme)), parseOklch(token(ground, theme))),
			).toBeGreaterThanOrEqual(4.5)
		}
	})
})
