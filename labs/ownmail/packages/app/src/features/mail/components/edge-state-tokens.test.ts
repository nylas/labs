import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrast, parseOklch } from '../../../../test/oklch'

const css = readFileSync(fileURLToPath(new URL('../../../tokens.css', import.meta.url)), 'utf8')

/** The last value a theme gives a custom property, across every `:root` or `.dark` block. */
function themeToken(name: string, theme: 'light' | 'dark'): string {
	const selector = theme === 'light' ? ':root' : '\\.dark'
	let value: string | undefined
	for (const block of css.matchAll(new RegExp(`(?:^|\\n)${selector} \\{([^}]*)\\}`, 'g'))) {
		value = new RegExp(`\\s${name}: ([^;]+);`).exec(block[1] as string)?.[1] ?? value
	}
	if (!value) throw new Error(`Token ${name} is missing from the ${theme} theme`)
	return value
}

const PAIRS: Array<[foreground: string, ground: string]> = [
	['--notice-warning-fg', '--notice-warning'],
	['--danger-soft-fg', '--danger-soft'],
	['--danger-soft-fg', '--card'],
	['--quiet-fg', '--card'],
	['--quiet-fg', '--background'],
	['--file-pdf-fg', '--file-pdf'],
	['--file-sheet-fg', '--file-sheet'],
	['--file-doc-fg', '--file-doc'],
	['--file-doc-fg', '--file-image'],
]

describe('edge-state tokens', () => {
	for (const theme of ['light', 'dark'] as const) {
		it(`keep text at 4.5:1 on their grounds in the ${theme} theme`, () => {
			for (const [foreground, ground] of PAIRS) {
				const ratio = contrast(
					parseOklch(themeToken(foreground, theme)),
					parseOklch(themeToken(ground, theme)),
				)
				expect(ratio, `${foreground} on ${ground}`).toBeGreaterThanOrEqual(4.5)
			}
		})
	}

	it('map every token into the Tailwind theme', () => {
		for (const name of [
			'notice-warning',
			'danger-soft',
			'quiet-foreground',
			'file-pdf',
			'file-sheet',
			'file-doc',
			'file-image',
		]) {
			expect(css).toContain(`--color-${name}:`)
		}
	})
})
