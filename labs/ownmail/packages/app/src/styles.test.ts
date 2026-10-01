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

	it('enforces the shared 44px touch floor on mobile and touch-capable hybrid devices', () => {
		expect(styles).toMatch(
			/@media \(max-width: 48rem\), \(any-pointer: coarse\)\s*\{\s*\.touch-target\s*\{\s*min-width: var\(--touch-target-min\);\s*min-height: var\(--touch-target-min\);\s*\}\s*\.touch-target-square\s*\{\s*min-width: var\(--touch-target-min\);\s*min-height: var\(--touch-target-min\);/,
		)
	})

	it('gives tablet rail actions the same 44px floor', () => {
		expect(styles).toMatch(
			/@media \(max-width: 48rem\), \(any-pointer: coarse\)\s*\{\s*\.app-rail-item,\s*\.app-rail-account\s*\{\s*min-width: var\(--touch-target-min\);\s*min-height: var\(--touch-target-min\);/,
		)
	})

	it('keeps the compose action above the tab bar and device home indicator', () => {
		expect(styles).toMatch(
			/\.fab\s*\{[^}]*bottom: calc\(var\(--mobile-tab-bar-height\) \+ var\(--safe-area-bottom\) \+ 0\.75rem\);/,
		)
	})

	it('keeps a minimized composer above the mobile tab bar', () => {
		expect(styles).toMatch(
			/\.compose-panel\[data-minimized="true"\]\s*\{[^}]*top: auto;[^}]*bottom: calc\(var\(--mobile-tab-bar-height\) \+ var\(--safe-area-bottom\)\);[^}]*height: 2\.75rem;/,
		)
	})

	it('hides the unlayered mobile tab bar at the desktop breakpoint', () => {
		expect(styles).toMatch(/@media \(min-width: 48rem\)\s*\{\s*\.mobile-tab-bar\s*\{\s*display: none;/)
	})

	it('uses full dynamic-viewport editors through mobile and restores floating panels at the desktop breakpoint', () => {
		expect(styles).toMatch(
			/\.compose-panel\s*\{[^}]*inset: 0;[^}]*height: 100dvh;[^}]*max-height: 100dvh;[^}]*width: 100%;/,
		)
		expect(styles).toMatch(
			/\.event-composer-panel\s*\{[^}]*inset: 0;[^}]*height: 100dvh;[^}]*max-height: 100dvh;[^}]*width: 100%;/,
		)
		expect(styles).toMatch(/@media \(min-width: 48rem\)\s*\{\s*\.compose-panel\s*\{/)
	})
})

describe('mail search divider styles', () => {
	it('draws one divider above the full header without blocking input', () => {
		expect(styles).toMatch(
			/\.mail-header::after\s*\{[^}]*position: absolute;[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*z-index: 10;[^}]*height: 1px;[^}]*pointer-events: none;[^}]*background: var\(--border\);[^}]*content: "";/,
		)
	})
})

describe('borders and accents', () => {
	const rule = (selector: string) => {
		const start = styles.indexOf(`${selector} {`)
		expect(start).toBeGreaterThanOrEqual(0)
		return styles.slice(start, styles.indexOf('}', start))
	}

	it('marks severity with a uniform tinted border instead of a side rail', () => {
		const error = rule('.mail-search-error')
		expect(error).toContain('border: 1px solid color-mix(in oklch, var(--destructive), transparent 70%);')
		expect(error).toContain('background: color-mix(in oklch, var(--destructive), transparent 92%);')
		expect(error).not.toMatch(/border-(left|right|top|bottom)/)
	})

	it('marks the open thread and current folder with a fill only', () => {
		for (const selector of ['.thread-row:has([data-active="true"])', '.nav-item-active']) {
			expect(rule(selector)).toContain('background: var(--muted);')
			expect(rule(selector)).not.toContain('box-shadow')
		}
		expect(rule('.nav-item-active')).toContain('font-weight: 500;')
		expect(styles).not.toContain('.mobile-nav-item-active')
	})

	it('draws the keyboard cursor as a uniform two-pixel outline that survives forced colours', () => {
		const cursor = rule(
			'.thread-row:has([data-nav-cursor="true"]):not([data-active="true"]):not(:has([data-active="true"]))',
		)
		expect(cursor).toContain('outline: 2px solid var(--ring);')
		expect(cursor).toContain('outline-offset: -2px;')
		expect(cursor).not.toContain('box-shadow')
		expect(styles).toMatch(
			/@media \(forced-colors: active\)\s*\{[^}]*data-nav-cursor="true"[^}]*\{\s*outline: 2px solid Highlight;/,
		)
	})

	it('quotes composer text with an indent and muted colour, not a bar', () => {
		const quote = rule('.markdown-editor blockquote')
		expect(quote).toContain('padding-left: 0.75rem;')
		expect(quote).toContain('color: var(--color-muted-foreground);')
		expect(quote).not.toContain('border')
	})

	it('marks the active mobile tab with a filled pill behind the icon, not an edge bar', () => {
		expect(styles).not.toMatch(/\.mobile-tab(-active)?::(before|after)/)
		expect(rule('.mobile-tab-active .mobile-tab-icon')).toContain(
			'background: color-mix(in oklch, var(--foreground), transparent 90%);',
		)
		expect(rule('.mobile-tab-active')).toContain('color: var(--foreground);')
		expect(rule('.mobile-tab')).toContain('min-height: var(--mobile-tab-bar-height);')
	})
})
