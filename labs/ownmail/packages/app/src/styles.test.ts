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

	it('exports one named spacing token per role so screens choose spacing by job', () => {
		const theme = tokens.slice(tokens.indexOf('@theme inline {'), tokens.indexOf(':root {'))
		const roles = { control: 0.25, cluster: 0.5, hairline: 0.75, region: 1, section: 1.5, page: 2 }
		for (const [role, rem] of Object.entries(roles)) {
			expect(theme).toContain(`--spacing-${role}: ${rem}rem;`)
		}
		// Six steps only: a seventh named step would reintroduce per-screen choices.
		expect(theme.match(/--spacing-[a-z]+:/g)).toHaveLength(6)
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

	it('marks search field states with a uniform ring instead of a bottom accent', () => {
		expect(rule('.mail-search-control[data-state="error"]')).toContain(
			'box-shadow: inset 0 0 0 1px var(--destructive);',
		)
		expect(rule('.mail-search-control[data-state="success"]')).toContain('box-shadow: inset 0 0 0 1px ')
		// The focus outline is separate, so the ring never replaces keyboard focus.
		expect(rule('.mail-search-control:focus-within')).toContain('outline-color: var(--event-teal);')
	})

	it('marks the active desktop destination with a fill, not a bar beside it', () => {
		expect(styles).not.toContain('app-rail-item-indicator')
		expect(rule('.app-rail-item-active')).toContain('background: color-mix(')
		expect(rule('.app-rail-item-active')).toContain('color: var(--foreground);')
	})

	it('marks the active mobile tab with a filled pill behind the icon, not an edge bar', () => {
		expect(styles).not.toMatch(/\.mobile-tab(-active)?::(before|after)/)
		expect(rule('.mobile-tab-active .mobile-tab-icon')).toContain('background: var(--muted);')
		expect(rule('.mobile-tab-active')).toContain('color: var(--foreground);')
		expect(rule('.mobile-tab')).toContain('min-height: var(--mobile-tab-bar-height);')
	})
})

describe('mail list density styles', () => {
	const densityQuery = '@media (width > 48rem) and (pointer: fine) and (not (any-pointer: coarse)) {'
	const densityStart = styles.indexOf(densityQuery)
	// The density block is the only place Compact and Condensed are defined; it ends at the next top-level rule.
	const densityBlock = styles.slice(densityStart, styles.indexOf('\n}\n', densityStart))
	const outsideDensityBlock = styles.replace(densityBlock, '')

	it('defines the Default three-line row once, with the unread dot as an in-flow leading cell', () => {
		expect(outsideDensityBlock).toMatch(
			/\.thread-row\s*\{[^}]*display: grid;[^}]*grid-template-areas:\s*"dot lead who when"\s*"\. text text text";/,
		)
		expect(styles).toMatch(/\.thread-row-dot\s*\{\s*grid-area: dot;/)
		// The dot's track has no width: it sits in the row's 16px padding, so row text keeps the title's left edge.
		expect(outsideDensityBlock).toMatch(
			/\.thread-row\s*\{[^}]*grid-template-columns: 0 auto minmax\(0, 1fr\) auto;/,
		)
		expect(outsideDensityBlock).not.toMatch(/\.thread-row\s*\{[^}]*padding/)
		// The dot used to be absolutely positioned for a three-line row; no pseudo-element may bring that back.
		expect(styles).not.toMatch(/\.thread-row[^{]*::before\s*\{[^}]*position: absolute/)
		// It still only fills on unread rows that are not the open conversation.
		expect(styles).toMatch(
			/\.thread-row\[data-unread="true"\]:not\(\[data-active="true"\]\):not\(:has\(\[data-active="true"\]\)\)\s+\.thread-row-dot,/,
		)
	})

	it('never lets touch or mobile layouts have mail rows under 48px', () => {
		expect(densityStart).toBeGreaterThan(-1)
		// Mobile layouts and any touch-capable device keep the primary-row floor...
		expect(styles).toMatch(
			/@media \(max-width: 48rem\), \(any-pointer: coarse\)\s*\{\s*\.thread-row\s*\{\s*min-height: 3rem;/,
		)
		// ...and no density rule exists outside the fine-pointer desktop query that complements it.
		expect(densityBlock).toContain('[data-density="compact"] .thread-row {')
		expect(densityBlock).toContain('[data-density="condensed"] .thread-row {')
		expect(outsideDensityBlock).not.toContain('data-density')
	})

	it('puts subject and snippet on one line for Compact, about 62px tall', () => {
		expect(densityBlock).toMatch(
			/\[data-density="compact"\] \.thread-row\s*\{\s*row-gap: 1px;\s*padding-block: 0\.625rem;/,
		)
		expect(densityBlock).toMatch(
			/\[data-density="compact"\] \.thread-row-subject,\s*\[data-density="compact"\] \.thread-row-snippet,[^{]*\{\s*display: inline;/,
		)
		expect(densityBlock).toMatch(
			/\[data-density="compact"\] \.thread-row-snippet:not\(:empty\)::before,[^{]*\{\s*content: " {2}· {2}";/,
		)
	})

	it('puts sender, subject and snippet, and date on a single 34px line for Condensed', () => {
		expect(densityBlock).toMatch(
			/\[data-density="condensed"\] \.thread-row\s*\{\s*grid-template-columns: 0 auto minmax\(4\.5rem, 9rem\) minmax\(0, 1fr\) auto;\s*grid-template-areas: "dot lead who text when";\s*min-height: 2\.125rem;\s*padding-block: 0;/,
		)
	})

	it('sizes the star target to fit inside each dense row so neighbouring targets never overlap', () => {
		// Compact rows are 62px and Condensed rows 34px; the target must be no taller than its row.
		expect(densityBlock).toMatch(
			/\[data-density="compact"\] \.thread-row-star\s*\{\s*width: 2rem;\s*height: 2rem;\s*margin: -0\.5rem;/,
		)
		expect(densityBlock).toMatch(
			/\[data-density="condensed"\] \.thread-row-star\s*\{\s*width: 1\.75rem;\s*height: 1\.75rem;\s*margin: -0\.375rem;/,
		)
	})

	it('widens the vertical-split list for Condensed only where Condensed rows apply', () => {
		// A stored or palette-chosen Condensed preference must not change layout on touch or
		// mobile, where rows stay Default: the 26rem width exists only inside the density query,
		// and only from the xl breakpoint where the list sits beside the reader.
		expect(densityBlock).toMatch(
			/@media \(min-width: 80rem\)\s*\{\s*\.mail-list-vertical\[data-density="condensed"\]\s*\{\s*width: 26rem;\s*max-width: 26rem;/,
		)
		expect(outsideDensityBlock).not.toContain('26rem')
	})

	it('shows the density control only where the choice takes effect', () => {
		expect(outsideDensityBlock).toMatch(/\.list-density-menu\s*\{\s*display: none;/)
		expect(densityBlock).toMatch(/\.list-density-menu\s*\{\s*display: block;/)
	})
})
