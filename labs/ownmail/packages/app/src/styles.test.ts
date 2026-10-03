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

describe('thread list rendering cost', () => {
	it('lets off-screen thread rows skip style, layout and paint while keeping their measured height', () => {
		const rowRule = /\.thread-row \{[^}]*\}/.exec(styles)?.[0] ?? ''
		expect(rowRule).toContain('content-visibility: auto;')
		expect(rowRule).toContain('contain-intrinsic-size: auto 76px;')
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

describe('thread reader message header', () => {
	it('is a 40px row with a fine pointer', () => {
		expect(styles).toMatch(/\n\.message-header-row\s*\{\s*min-height: 2\.5rem;\s*\}/)
	})

	it('keeps the 44px touch floor on narrow and touch-capable devices', () => {
		const touchRule =
			/@media \(max-width: 48rem\), \(any-pointer: coarse\)\s*\{\s*\.message-header-row\s*\{\s*min-height: var\(--touch-target-min\);/
		expect(styles).toMatch(touchRule)
		expect(tokens).toContain('--touch-target-min: 2.75rem;')
		// The touch override must follow the 40px base rule to win at equal specificity.
		expect(styles.search(touchRule)).toBeGreaterThan(styles.indexOf('\n.message-header-row {'))
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
			/\.thread-row\s*\{[^}]*display: grid;[^}]*grid-template-areas:\s*"dot lead who when"\s*"text text text text";/,
		)
		expect(styles).toMatch(/\.thread-row-dot\s*\{\s*grid-area: dot;/)
		// The dot is centred in the row's 16px left gutter: hugging the pane border reads as
		// touching the separator, and it must stay clear of the 2px keyboard-cursor outline.
		expect(styles).toMatch(
			/\.thread-row-dot\s*\{[^}]*justify-self: end;[^}]*margin-right: calc\(\(1rem - 8px\) \/ 2\);\s*width: 8px;\s*height: 8px;/,
		)
		// design.md "List density": an 8px accent dot, so unread reads at a glance in both themes.
		expect(styles).toMatch(/\.thread-row-dot \{\s*\/\*[^*]*\*\/\s*background: var\(--cta-icon\);/)
		// No density moves it: the same cell is centred on line 1, or on the single Condensed line.
		expect(densityBlock).not.toContain('.thread-row-dot')
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

	it('starts Default and Compact subject and snippet lines at the row edge the list title shares', () => {
		// Default must look as it did before density existed: only the star and sender sit on
		// line 1, and the text lines span from column 1, whose zero-width dot track begins at the
		// row's 16px padding. Starting them at the star's column would tie them to the star's width.
		const row = outsideDensityBlock.slice(outsideDensityBlock.indexOf('\n.thread-row {'))
		const rowRule = row.slice(0, row.indexOf('}'))
		expect(rowRule).toContain('grid-template-columns: 0 auto minmax(0, 1fr) auto;')
		expect(rowRule).toMatch(/grid-template-areas:\s*"dot lead who when"\s*"text text text text";/)
		expect(rowRule).not.toMatch(/"\. text/)
		// Compact reuses the Default areas; only Condensed moves the text onto line 1.
		const compactRow = densityBlock.slice(densityBlock.indexOf('[data-density="compact"] .thread-row {'))
		expect(compactRow.slice(0, compactRow.indexOf('}'))).not.toContain('grid-template')
		expect(densityBlock).toContain('grid-template-areas: "dot lead who text when";')
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

describe('glass layer', () => {
	const glassStart = styles.indexOf('.glass-bar {')
	const glass = styles.slice(glassStart)
	const block = (source: string, selector: string) => {
		const start = source.indexOf(`${selector} {`)
		expect(start).toBeGreaterThanOrEqual(0)
		return source.slice(start, source.indexOf('}', start))
	}
	const light = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('.dark {'))
	const dark = tokens.slice(tokens.indexOf('.dark {'))
	const BLUR = 'backdrop-filter: blur(var(--glass-blur)) saturate(1.15);'

	it('keeps glass mostly solid in both themes so text holds 4.5:1 over any backdrop', () => {
		// Measured in the app: 85% of white keeps muted text at 4.59:1 over black;
		// 89% of the dark card keeps it at 4.61:1 over white. Lower values fail.
		expect(light).toContain('--glass-bg: color-mix(in oklch, var(--card) 85%, transparent);')
		expect(dark).toContain('--glass-bg: color-mix(in oklch, var(--card) 89%, transparent);')
		expect(light).toContain('--glass-blur: 14px;')
		expect(light).toContain('--glass-line: color-mix(in oklch, var(--foreground) 10%, transparent);')
		expect(dark).toContain('--glass-line: oklch(1 0 0 / 12%);')
		expect(light).toContain(
			'--glass-shadow: 0 8px 24px color-mix(in oklch, var(--foreground) 12%, transparent);',
		)
		expect(dark).toContain('--glass-shadow: 0 8px 24px oklch(0 0 0 / 40%);')
		// Panels are 12px; the plane keeps 6px, so shape also tells the layers apart.
		expect(light).toContain('--glass-radius: 0.75rem;')
		expect(light).toContain('--radius: 0.375rem;')
	})

	it('draws bar glass as a blurred layer behind the bar with one hairline and no shadow', () => {
		const bar = block(glass, '.glass-bar')
		// The bar keeps a 1px edge, so it is exactly as tall as a flat bar with a separator.
		expect(bar).toContain('border-bottom: 1px solid transparent;')
		expect(bar).toContain('border-radius: 0;')
		expect(bar).toContain('box-shadow: none;')
		// The blur is on a layer behind the bar, not the bar: a menu opened from
		// the bar is then a panel over the plane, never glass stacked on glass.
		expect(bar).not.toContain('backdrop-filter')
		const layer = block(glass, '.glass-bar::before')
		expect(layer).toContain('background: var(--glass-bg);')
		expect(layer).toContain(BLUR)
		expect(layer).toContain(`-webkit-${BLUR}`)
		expect(layer).toContain('z-index: -1;')
		expect(bar).toContain('isolation: isolate;')
		// The layer covers the bar's edge and draws the one line there, on the glass.
		expect(layer).toContain('inset: 0 0 -1px;')
		expect(layer).toContain('border-bottom: 1px solid var(--glass-line);')
		expect(layer).not.toMatch(/border-(top|left|right)/)
	})

	it('moves the one hairline to the top edge of a bar pinned to the bottom', () => {
		const bottomBar = block(glass, '.glass-bar[data-glass-edge="top"]')
		expect(bottomBar).toContain('border-top: 1px solid transparent;')
		expect(bottomBar).toContain('border-bottom-width: 0;')
		const bottomLayer = block(glass, '.glass-bar[data-glass-edge="top"]::before')
		expect(bottomLayer).toContain('inset: -1px 0 0;')
		expect(bottomLayer).toContain('border-top: 1px solid var(--glass-line);')
		expect(bottomLayer).toContain('border-bottom-width: 0;')
	})

	it('draws panel glass with a uniform border, the one soft shadow and a 12px radius', () => {
		const panel = block(glass, '.glass-panel')
		expect(panel).toContain('border: 1px solid var(--glass-line);')
		expect(panel).toContain('border-radius: var(--glass-radius);')
		expect(panel).toContain('background: var(--glass-bg);')
		expect(panel).toContain('box-shadow: var(--glass-shadow);')
		expect(panel).toContain(BLUR)
		// No brighter top edge: that would be an accent rail by another name.
		expect(panel).not.toMatch(/border-(top|bottom|left|right)/)
	})

	it('keeps glass neutral: no tint, gradient, glow or noise in either recipe', () => {
		const recipes = glass.slice(0, glass.indexOf('.under-pinned-bar'))
		expect(recipes).not.toMatch(/gradient|url\(|filter: [^;]*(hue|sepia|invert)|--primary|--accent\b/)
		// One shadow, on panels only, through the one token.
		expect(recipes.match(/box-shadow: (?!none)[^;]+;/g)).toEqual(['box-shadow: var(--glass-shadow);'])
	})

	it('strengthens the destructive colour on glass so red text also holds 4.5:1 over the worst backdrop', () => {
		// Measured: the plane's red is 3.82:1 on light glass over black and 4.32:1 on dark glass over white.
		expect(glass).toMatch(/\.glass-bar,\s*\.glass-panel\s*\{\s*--destructive: oklch\(0\.5 0\.2 25\);/)
		expect(glass).toMatch(
			/\.dark \.glass-bar,\s*\.dark \.glass-panel\s*\{\s*--destructive: oklch\(0\.69 0\.19 25\);/,
		)
		// Same hue as the plane's token: a stronger step of the status colour, not a tint of the glass.
		expect(light).toContain('--destructive: oklch(0.55 0.2 25);')
		expect(dark).toContain('--destructive: oklch(0.66 0.19 25);')
	})

	it('never animates the blur: only opacity and position move on glass', () => {
		expect(styles).not.toMatch(/(transition|animation|will-change)[^;{}]*backdrop-filter/)
		expect(glass.slice(0, glass.indexOf('.under-pinned-bar'))).not.toMatch(/transition|animation/)
	})

	it('makes a panel opened from glass, or one in the flow on a phone, solid', () => {
		const solid = block(glass, '.glass-panel[data-glass="solid"]')
		expect(solid).toContain('background: var(--card);')
		expect(solid).toContain('backdrop-filter: none;')
		expect(glass).toMatch(
			/@media \(width < 40rem\)\s*\{\s*\.glass-panel-from-sm\s*\{[^}]*background: var\(--card\);[^}]*box-shadow: none;[^}]*backdrop-filter: none;/,
		)
	})

	it('falls back to solid card when the blur is unavailable or unwanted', () => {
		const solidFallback =
			/\{\s*\.glass-bar::before,\s*\.glass-panel\s*\{\s*background: var\(--card\);\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;\s*\}/
		for (const query of [
			'@media (prefers-reduced-transparency: reduce)',
			'@media (prefers-contrast: more)',
			'@media (forced-colors: active)',
		]) {
			const start = glass.indexOf(query)
			expect(start, query).toBeGreaterThanOrEqual(0)
			expect(glass.slice(start + query.length, glass.indexOf('\n}\n', start) + 2), query).toMatch(
				solidFallback,
			)
		}
		expect(glass).toMatch(
			/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{\s*\.glass-bar::before,\s*\.glass-panel\s*\{\s*background: var\(--card\);/,
		)
	})

	it('keeps the first line and keyboard focus clear of a pinned toolbar', () => {
		// One source for the toolbar height: the token the toolbar's own height class reads.
		expect(light).toContain('--toolbar-height: 3.5rem;')
		expect(tokens).toMatch(/@media \(min-width: 48rem\)\s*\{\s*:root\s*\{\s*--toolbar-height: 2\.75rem;/)
		expect(tokens.match(/--toolbar-height:/g)).toHaveLength(2)
		expect(styles).not.toMatch(/--toolbar-height:/)
		const under = block(glass, '.under-pinned-bar')
		expect(under).toContain('padding-top: var(--toolbar-height);')
		expect(under).toContain('scroll-padding-top: var(--toolbar-height);')
	})

	it('pins the mobile tab bar over the page and keeps the last line reachable above it', () => {
		const tabBar = block(styles, '.mobile-tab-bar')
		expect(tabBar).toContain('position: fixed;')
		expect(tabBar).toContain('bottom: 0;')
		// Its surface is the bar recipe, not a colour of its own.
		expect(tabBar).not.toMatch(/background|border-top/)
		const under = block(glass, '.under-mobile-bar')
		// The bar's own height: its row, its 1px hairline and the home indicator.
		expect(under).toContain(
			'--mobile-bar-inset: calc(var(--mobile-tab-bar-height) + 1px + var(--safe-area-bottom));',
		)
		expect(under).toContain(
			'padding-bottom: calc(var(--mobile-bar-inset) + var(--under-mobile-bar-gap, 0px));',
		)
		expect(under).toContain('scroll-padding-bottom: var(--mobile-bar-inset);')
		// Only where the bar exists: desktop bottoms keep their own padding.
		expect(glass).toMatch(/@media \(width < 48rem\)\s*\{\s*\.under-mobile-bar\s*\{/)
	})

	it('hides the pull-to-refresh indicator beneath a pinned bar until it is pulled', () => {
		expect(block(glass, '.pull-to-refresh-under-pinned-bar')).toContain(
			'--pull-to-refresh-top: var(--toolbar-height);',
		)
		expect(glass).toMatch(
			/\.pull-to-refresh-under-pinned-bar:not\(\[aria-busy="true"\]\) \.pull-to-refresh-indicator:not\(\[data-pulling\]\)\s*\{\s*visibility: hidden;/,
		)
		expect(block(styles, '.pull-to-refresh-indicator')).toContain('top: var(--pull-to-refresh-top, 0px);')
	})
})

describe('dragged calendar event', () => {
	it('floats as full-strength panel glass, with no dimming or shadow of its own', () => {
		const start = styles.indexOf('.event-chip[data-dragging] {')
		const dragging = styles.slice(start, styles.indexOf('}', start))
		// The glass-panel class supplies the surface; a dimmed or struck-through chip would not stay legible.
		expect(dragging).toContain('opacity: 1;')
		expect(dragging).toContain('text-decoration: none;')
		expect(dragging).not.toMatch(/box-shadow|backdrop-filter|transition/)
	})
})
