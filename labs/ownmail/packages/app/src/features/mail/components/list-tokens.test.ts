import { describe, expect, it } from 'vitest'
import { contrast, type Lab, parseOklch, token } from '../../../../test/oklch'

/**
 * The thread list's own tints: the open row, a row asking you, a send that
 * failed, and the "Asks you" pill. Row text (foreground and muted snippets)
 * and each tint's own text stay at 4.5:1 or better on them, in both themes.
 */
describe.each(['light', 'dark'] as const)('thread list colours in the %s theme', (theme) => {
	const colour = (name: string): Lab => parseOklch(token(name, theme))

	it.each(['--list-selected', '--list-asks', '--list-failed'])('keeps row text readable on %s', (ground) => {
		expect(contrast(colour(ground), colour('--foreground'))).toBeGreaterThanOrEqual(4.5)
		expect(contrast(colour(ground), colour('--muted-foreground'))).toBeGreaterThanOrEqual(4.5)
	})

	it('says a send failed in a red that reads on its own ground', () => {
		expect(contrast(colour('--list-failed'), colour('--list-failed-fg'))).toBeGreaterThanOrEqual(4.5)
	})

	it('sets "Asks you" in an amber pill that reads', () => {
		expect(contrast(colour('--signal-ask'), colour('--signal-ask-fg'))).toBeGreaterThanOrEqual(4.5)
	})

	it("draws the open row's ring apart from its tint", () => {
		expect(colour('--list-selected-line').l).not.toBe(colour('--list-selected').l)
	})
})
