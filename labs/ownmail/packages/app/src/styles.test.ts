import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))
const styles = readFileSync(stylesPath, 'utf8')
const tokensPath = fileURLToPath(new URL('./tokens.css', import.meta.url))
const tokens = readFileSync(tokensPath, 'utf8')

describe('touch editing styles', () => {
	it('keeps every editable surface at 16px on touch-first devices to prevent iOS focus zoom', () => {
		expect(styles).toMatch(
			/@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*input,\s*textarea,\s*select,\s*\[contenteditable\]:not\(\[contenteditable="false"\]\),\s*\.app-input\s*\{\s*font-size: 1rem;/,
		)
	})

	it('keeps inline code inside the compose editor at 16px on touch-first devices', () => {
		const touchCodeRule =
			/@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*\.markdown-editor code\s*\{\s*font-size: 1rem;/
		expect(styles).toMatch(touchCodeRule)
		// The override must appear after the base .markdown-editor code rule so
		// it wins the cascade at equal specificity.
		expect(styles.search(touchCodeRule)).toBeGreaterThan(styles.indexOf('.markdown-editor code {'))
	})
})

describe('navigation progress styles', () => {
	it('keeps pending navigation visible without motion when reduced motion is requested', () => {
		expect(styles).toMatch(
			/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.navigation-progress-bar\s*\{\s*width: 100%;\s*animation: none;/,
		)
	})
})

describe('native mobile shell styles', () => {
	it('exports shared safe-area, touch-target, and bottom-tab tokens', () => {
		expect(styles).toContain('@import "./tokens.css";')
		expect(tokens).toContain('--safe-area-top: env(safe-area-inset-top, 0px);')
		expect(tokens).toContain('--safe-area-bottom: env(safe-area-inset-bottom, 0px);')
		expect(tokens).toContain('--touch-target-min: 2.75rem;')
		expect(tokens).toContain('--mobile-tab-bar-height: 3.75rem;')
	})

	it('keeps the compose action above the tab bar and device home indicator', () => {
		expect(styles).toMatch(
			/\.fab\s*\{[^}]*bottom: calc\(var\(--mobile-tab-bar-height\) \+ var\(--safe-area-bottom\) \+ 0\.75rem\);/,
		)
	})

	it('hides the unlayered mobile tab bar at the desktop breakpoint', () => {
		expect(styles).toMatch(/@media \(min-width: 48rem\)\s*\{\s*\.mobile-tab-bar\s*\{\s*display: none;/)
	})
})

describe('mail search divider styles', () => {
	it('draws one divider above the full header without blocking input', () => {
		expect(styles).toMatch(
			/\.mail-header::after\s*\{[^}]*position: absolute;[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*z-index: 10;[^}]*height: 1px;[^}]*pointer-events: none;[^}]*background: var\(--border\);[^}]*content: "";/,
		)
	})
})
