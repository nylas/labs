// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	PICTURE_MEDIA_ATTRIBUTE,
	providerCssSupportsDarkMode,
	rewriteEmailMediaQueries,
	rewritePaneMediaQueries,
	sanitizedDocumentHasRemoteImages,
	sanitizedEmailSupportsDarkMode,
	sanitizeEmailDocument,
	sanitizeEmailHtml,
	sanitizeProviderCss,
} from './sanitize-email.js'

describe('rewritePaneMediaQueries', () => {
	it('converts common width breakpoints to the named reading-pane container', () => {
		expect(
			rewritePaneMediaQueries(
				'@media only screen and (min-width: 20rem) and (max-width:600px){.mobile{display:block}}',
			),
		).toBe('@container ownmail-email (min-width: 20rem) and (max-width:600px){.mobile{display:block}}')
	})

	it('converts comma-separated width lists into pane queries', () => {
		expect(
			rewritePaneMediaQueries(
				'@media screen and (max-width:600px), screen and (max-width:40rem){.x{display:block}}',
			),
		).toBe(
			'@container ownmail-email (max-width:600px){.x{display:block}}@container ownmail-email (max-width:40rem){.x{display:block}}',
		)
	})

	it('maps archaic device-width branches to the reading pane', () => {
		expect(
			rewritePaneMediaQueries(
				'@media only screen and (max-width:600px), only screen and (max-device-width:40rem){.x{display:block}}',
			),
		).toBe(
			'@container ownmail-email (max-width:600px){.x{display:block}}@container ownmail-email (max-width:40rem){.x{display:block}}',
		)
	})

	it('deduplicates equivalent width and device-width branches', () => {
		expect(
			rewritePaneMediaQueries(
				'@media only screen and (max-width:600px), only screen and (max-device-width:600px){.x{display:block}}',
			),
		).toBe('@container ownmail-email (max-width:600px){.x{display:block}}')
	})

	it('preserves unsupported viewport branches while converting width-only branches', () => {
		expect(rewritePaneMediaQueries('@media print, (max-width:600px){.x{display:block}}')).toBe(
			'@media print{.x{display:block}}@container ownmail-email (max-width:600px){.x{display:block}}',
		)
	})

	it('leaves non-width, mixed, and malformed media rules unchanged', () => {
		const css = [
			'@media (prefers-color-scheme:dark){body{background:#000}}',
			'@media (max-width:600px) and (orientation:portrait){.x{display:block}}',
		].join('')
		expect(rewritePaneMediaQueries(css)).toBe(css)
		const malformed = '@media (max-width:600px){.x{color:red}'
		expect(rewritePaneMediaQueries(malformed)).toBe(malformed)
	})

	it('does not split media-list commas inside quoted or escaped content', () => {
		const css = String.raw`@media "a\"b,c", 'd\'e,f', \screen and (max-width:600px){.x{display:block}}`
		expect(rewritePaneMediaQueries(css)).toBe(
			String.raw`@media "a\"b,c", 'd\'e,f'{.x{display:block}}@container ownmail-email (max-width:600px){.x{display:block}}`,
		)
	})

	it('preserves viewport media semantics when Original layout requests them', () => {
		const documentElement = sanitizeEmailDocument(
			'<style>@media (max-width:600px){.mobile{display:block}}</style><p>Body</p>',
			{ rewriteViewportMedia: false },
		)
		expect(documentElement?.querySelector('style')?.textContent).toContain('@media (max-width:600px)')
	})

	it('reports no adaptive dark support for empty content', () => {
		expect(sanitizedEmailSupportsDarkMode('')).toBe(false)
	})
})

describe('adaptive app-theme media', () => {
	it('rewrites light and dark provider branches to app-theme style queries', () => {
		const css =
			'@media (prefers-color-scheme:dark){.x{color:white}}@media screen and (prefers-color-scheme:light) and (max-width:600px){.x{color:black}}'
		expect(rewriteEmailMediaQueries(css)).toBe(
			'@container ownmail-email style(--ownmail-email-theme: dark){.x{color:white}}@container ownmail-email style(--ownmail-email-theme: light) and (max-width:600px){.x{color:black}}',
		)
	})

	it('rewrites Level 4 or branches without leaving OS-controlled color rules', () => {
		expect(
			rewriteEmailMediaQueries('@media (prefers-color-scheme:dark) or (min-width:900px){.x{color:white}}'),
		).toBe(
			'@container ownmail-email style(--ownmail-email-theme: dark){.x{color:white}}@container ownmail-email (min-width:900px){.x{color:white}}',
		)
	})

	it('rewrites unary negated color conditions to the opposite app theme', () => {
		const css =
			'@media not (prefers-color-scheme:light){.dark{color:white}}@media not (prefers-color-scheme:dark){.light{color:black}}'
		expect(rewriteEmailMediaQueries(css)).toBe(
			'@container ownmail-email style(--ownmail-email-theme: dark){.dark{color:white}}@container ownmail-email style(--ownmail-email-theme: light){.light{color:black}}',
		)
		expect(providerCssSupportsDarkMode(css)).toBe(true)
		expect(providerCssSupportsDarkMode('@media not (prefers-color-scheme:dark){.x{color:black}}')).toBe(false)
	})

	it('handles negated theme conditions across lists, boolean operators, comments, and escapes', () => {
		const css = String.raw`@media (n\6f t/**/(prefers-color-scheme/**/:light)) and (max-width:600px), (not (prefers-color-scheme:dark)) or (min-width:900px){.x{display:block}}`
		expect(rewriteEmailMediaQueries(css)).toBe(
			'@container ownmail-email style(--ownmail-email-theme: dark) and (max-width:600px){.x{display:block}}@container ownmail-email style(--ownmail-email-theme: light){.x{display:block}}@container ownmail-email (min-width:900px){.x{display:block}}',
		)
	})

	it('keeps negated theme width semantics tied to the viewport in Original mode', () => {
		expect(
			rewriteEmailMediaQueries(
				'@media (not (prefers-color-scheme:light)) and (max-width:600px){.x{display:block}}',
				{ rewriteViewportMedia: false },
			),
		).toBe(
			'@media (max-width:600px){@container ownmail-email style(--ownmail-email-theme: dark){.x{display:block}}}',
		)
	})

	it('does not confuse malformed or legacy media-type negation with unary theme negation', () => {
		for (const css of [
			'@media not(prefers-color-scheme:light){.x{color:white}}',
			'@media not (prefers-color-scheme:light) and (max-width:600px){.x{color:white}}',
			'@media not (prefers-color-scheme:light) or (min-width:900px){.x{color:white}}',
			'@media not dangling (prefers-color-scheme:light){.x{color:white}}',
		]) {
			expect(rewriteEmailMediaQueries(css)).toBe(css)
			expect(providerCssSupportsDarkMode(css)).toBe(false)
		}
		expect(
			rewriteEmailMediaQueries('@media not screen and (prefers-color-scheme:dark){.x{color:white}}'),
		).toBe('@media not screen and (prefers-color-scheme:dark){.x{color:white}}')
		expect(rewriteEmailMediaQueries('@media not all and (prefers-color-scheme:dark){.x{color:white}}')).toBe(
			'@media not all and (prefers-color-scheme:dark){.x{color:white}}',
		)
		for (const mediaType of ['print', 'tv']) {
			const css = `@media not ${mediaType} and (prefers-color-scheme:dark){.x{color:white}}`
			expect(rewriteEmailMediaQueries(css)).toBe(css)
			expect(providerCssSupportsDarkMode(css)).toBe(false)
		}
		expect(providerCssSupportsDarkMode('@media not(prefers-color-scheme:light){.x{color:white}}')).toBe(false)
	})

	it('leaves screen-only and contradictory theme queries under browser control', () => {
		const screenOnly = '@media screen{.x{display:block}}'
		expect(rewriteEmailMediaQueries(screenOnly)).toBe(screenOnly)
		const contradictory =
			'@media (prefers-color-scheme:dark) and (prefers-color-scheme:light){.x{display:block}}'
		expect(rewriteEmailMediaQueries(contradictory)).toBe(contradictory)
	})

	it('does not parse an operator embedded at the start of a media identifier', () => {
		const css = '@media android and (max-width:600px){.x{display:block}}'
		expect(rewriteEmailMediaQueries(css)).toBe(css)
		const dangling = '@media screen and{.x{display:block}}'
		expect(rewriteEmailMediaQueries(dangling)).toBe(dangling)
		expect(providerCssSupportsDarkMode(dangling)).toBe(false)
		for (const css of [
			'@media or (prefers-color-scheme:dark){.x{color:white}}',
			'@media (prefers-color-scheme:dark) or{.x{color:white}}',
			'@media , (prefers-color-scheme:dark){.x{color:white}}',
			'@media (prefers-color-scheme:dark),{.x{color:white}}',
		]) {
			expect(rewriteEmailMediaQueries(css)).toBe(css)
			expect(providerCssSupportsDarkMode(css)).toBe(false)
		}
	})

	it('bounds redundant grouping and ignores strings inside grouped conditions', () => {
		const stringCondition = '@media (not ("prefers-color-scheme:light")){.x{color:white}}'
		expect(rewriteEmailMediaQueries(stringCondition)).toBe(stringCondition)
		expect(providerCssSupportsDarkMode(stringCondition)).toBe(false)

		const opening = '('.repeat(129)
		const closing = ')'.repeat(129)
		const deeplyGrouped = `@media ${opening}prefers-color-scheme:dark${closing}{.x{color:white}}`
		expect(rewriteEmailMediaQueries(deeplyGrouped)).toBe(deeplyGrouped)
		expect(providerCssSupportsDarkMode(deeplyGrouped)).toBe(false)
	})

	it('rewrites nested, commented, and escaped media grammar without scanning strings', () => {
		const escaped = String.raw`@\6d edia/**/ (prefers-color-scheme/**/:dark)/**/or/**/(max-width:600px){.x{content:"}; @media (prefers-color-scheme:light){"}}`
		expect(rewriteEmailMediaQueries(escaped)).toBe(
			'@container ownmail-email style(--ownmail-email-theme: dark){.x{content:"}; @media (prefers-color-scheme:light){"}}@container ownmail-email (max-width:600px){.x{content:"}; @media (prefers-color-scheme:light){"}}',
		)
		const nested = '@supports (display:grid){@media (prefers-color-scheme:dark){.x{color:white}}}'
		expect(rewriteEmailMediaQueries(nested)).toBe(
			'@supports (display:grid){@container ownmail-email style(--ownmail-email-theme: dark){.x{color:white}}}',
		)
	})

	it('preserves CSS when strings, comments, blocks, or component values are malformed', () => {
		const malformed = [
			'@media (prefers-color-scheme:dark){.x{content:"unterminated}}',
			'@media (prefers-color-scheme:dark){.x{color:white}/* unterminated',
			'@media (prefers-color-scheme:dark]{.x{color:white}}',
			'@media (prefers-color-scheme:dark){.x{--tokens:{a:b}',
			'@media (prefers-color-scheme:dark){.x{color:white}}}',
			'@media (prefers-color-scheme:dark){.x{content:"line\nbreak"}}',
			"@media (prefers-color-scheme:dark){.x{content:'trailing\\",
			'@media (prefers-color-scheme:dark){.x{color:red}\\',
			'@media (prefers-color-scheme:dark)){.x{color:white}}',
		]
		for (const css of malformed) {
			expect(rewriteEmailMediaQueries(css)).toBe(css)
			expect(providerCssSupportsDarkMode(css)).toBe(false)
		}
	})

	it('handles leading trivia, nested custom-property blocks, and CSS line-continuation escapes', () => {
		const css = '/* lead */ @media (prefers-color-scheme:dark){.x{--tokens:{{a:b}};color:white}}'
		expect(rewriteEmailMediaQueries(css)).toBe(
			'/* lead */ @container ownmail-email style(--ownmail-email-theme: dark){.x{--tokens:{{a:b}};color:white}}',
		)
		expect(rewriteEmailMediaQueries('@{color:red}')).toBe('@{color:red}')
		expect(rewriteEmailMediaQueries('@keyframes pulse{from{color:red}}')).toBe(
			'@keyframes pulse{from{color:red}}',
		)
		for (const continuation of ['\\\r\n', '\\\n', '\\\r', '\\\f']) {
			const continued = `.x${continuation}{color:red}`
			expect(rewriteEmailMediaQueries(continued)).toBe(continued)
		}
	})

	it('bounds custom-property detection for adversarial comment repetitions', () => {
		const maliciousPrelude = `--_${'/**/'.repeat(27)}not-a-declaration`
		const legitimateControls =
			'.card{--_token-1/**/ : {@media (prefers-color-scheme:dark){tone:blue}};--éclair:{tone:white};--\\x:{tone:black};color:black}'
		const startedAt = performance.now()
		const output = sanitizeEmailHtml(
			`<style>.card{${maliciousPrelude}{color:red}--1{color:orange}}${legitimateControls}</style><p class="card">Body</p>`,
		)
		const elapsed = performance.now() - startedAt

		expect(elapsed).toBeLessThan(250)
		expect(output).toContain(`${maliciousPrelude}{color:red}`)
		expect(output).toContain('--1{color:orange}')
		expect(output).toContain(legitimateControls)
		expect(output).toContain('color:black')
	})

	it('fails closed before excessive CSS nesting can overflow recursive consumers', () => {
		const supportedOpening = '@media all{'.repeat(125)
		const supportedClosing = '}'.repeat(125)
		const supported = `${supportedOpening}@media (prefers-color-scheme:dark){.x{color:white}}${supportedClosing}`
		expect(sanitizedEmailSupportsDarkMode(`<style>${supported}</style>`)).toBe(true)
		expect(sanitizeEmailHtml(`<style>${supported}</style>`)).toContain(
			'@container ownmail-email style(--ownmail-email-theme: dark)',
		)

		const opening = '@media all{'.repeat(4_000)
		const closing = '}'.repeat(4_000)
		const deeplyNested = `${opening}@media (prefers-color-scheme:dark){.x{color:white}}${closing}`
		const startedAt = performance.now()

		expect(sanitizedEmailSupportsDarkMode(`<style>${deeplyNested}</style>`)).toBe(false)
		expect(sanitizeEmailHtml(`<style>${deeplyNested}</style><p>Body</p>`)).toContain(
			'prefers-color-scheme:dark',
		)
		expect(performance.now() - startedAt).toBeLessThan(250)

		const remote = sanitizeEmailDocument(
			`<style>${opening}.x{background:url(https://images.example/deep.png)}${closing}</style><p>Body</p>`,
		)
		expect(sanitizedDocumentHasRemoteImages(remote as HTMLElement)).toBe(true)
		expect(remote?.querySelector('style')).toBeNull()
	})

	it('preserves viewport semantics around app theme in Original mode', () => {
		expect(
			rewriteEmailMediaQueries(
				'@media (prefers-color-scheme:dark) and (max-width:600px){.x{display:block}}',
				{ rewriteViewportMedia: false },
			),
		).toBe(
			'@media (max-width:600px){@container ownmail-email style(--ownmail-email-theme: dark){.x{display:block}}}',
		)
	})

	it('detects only parseable dark rules that survive sanitization', () => {
		expect(providerCssSupportsDarkMode('@media (prefers-color-scheme:dark){.x{color:white}}')).toBe(true)
		expect(
			sanitizedEmailSupportsDarkMode('<style>@media (prefers-color-scheme:dark){.x{color:white}}</style>'),
		).toBe(true)
		expect(sanitizedEmailSupportsDarkMode('<script>"@media (prefers-color-scheme:dark)"</script>')).toBe(
			false,
		)
		expect(sanitizedEmailSupportsDarkMode('<style>:host{}@media (prefers-color-scheme:dark){}</style>')).toBe(
			false,
		)
		expect(providerCssSupportsDarkMode('@media (prefers-color-scheme:dark){')).toBe(false)
		expect(providerCssSupportsDarkMode('@media (prefers-color-scheme/**/:dark){.x{color:white}}')).toBe(true)
		expect(providerCssSupportsDarkMode('@media print and (prefers-color-scheme:dark){.x{color:white}}')).toBe(
			false,
		)
		expect(
			providerCssSupportsDarkMode('@media not screen and (prefers-color-scheme:dark){.x{color:white}}'),
		).toBe(false)
		expect(
			providerCssSupportsDarkMode('@media not all and (prefers-color-scheme:dark){.x{color:white}}'),
		).toBe(false)
		expect(
			providerCssSupportsDarkMode('@media speech and (prefers-color-scheme:dark){.x{color:white}}'),
		).toBe(false)
		expect(
			providerCssSupportsDarkMode(
				'@supports (display:grid){.x{content:"@media (prefers-color-scheme:dark)"}@media (prefers-color-scheme:dark){.y{color:white}}}',
			),
		).toBe(true)
		expect(providerCssSupportsDarkMode('.x{content:"@media (prefers-color-scheme:dark){}"}')).toBe(false)
	})

	it('carries enclosing screen, theme, and width applicability through nested dark rules', () => {
		for (const css of [
			'@media print{@media (prefers-color-scheme:dark){.x{color:white}}}',
			'@media speech{@media (prefers-color-scheme:dark){.x{color:white}}}',
			'@media (prefers-color-scheme:light){@media (prefers-color-scheme:dark){.x{color:white}}}',
			'@media (prefers-color-scheme:dark) and (prefers-color-scheme:light){.x{color:white}}',
			'@media (max-width:400px){@media (min-width:500px) and (prefers-color-scheme:dark){.x{color:white}}}',
			'@media (prefers-color-scheme:dark){@media print{.x{color:white}}}',
			'@media (prefers-color-scheme:dark){@media (prefers-color-scheme:light){@media (prefers-color-scheme:dark){.x{color:white}}}}',
			'@media (prefers-color-scheme:dark){color:white;background:black}',
			'@media (prefers-color-scheme:dark){@font-face{font-family:Mail;src:local(Arial)}}',
		]) {
			expect(providerCssSupportsDarkMode(css), css).toBe(false)
		}

		for (const css of [
			'@media screen{@media (prefers-color-scheme:dark){.x{color:white}}}',
			'@media all and (min-width:300px){@media (max-width:600px) and (prefers-color-scheme:dark){.x{color:white}}}',
			'@media print, screen and (max-width:600px){@media not/**/(prefers-color-scheme:light){.x{color:white}}}',
			String.raw`@\6d edia screen{@media (prefers-color-scheme/**/:dark){.x{color:white}}}`,
			'@media (min-device-width:900px){@media (max-width:600px){@media (prefers-color-scheme:dark){.x{color:white}}}}',
			'.x{@media (prefers-color-scheme:dark){color:white;background:black}}',
			'@media (prefers-color-scheme:dark){.x{color:white;@media print{background:black}}}',
			'.x{@media (prefers-color-scheme:dark){@supports (display:grid){color:white}}}',
			'@supports (display:grid){.x{@media (prefers-color-scheme:dark){color:white}}}',
		]) {
			expect(providerCssSupportsDarkMode(css), css).toBe(true)
		}
	})

	it('applies enclosing style media when detecting sanitized adaptive dark support', () => {
		expect(
			sanitizedEmailSupportsDarkMode(
				'<style media="print">@media (prefers-color-scheme:dark){.x{color:white}}</style>',
			),
		).toBe(false)
		expect(
			sanitizedEmailSupportsDarkMode(
				'<style media="screen and (max-width:600px)">@media (prefers-color-scheme:dark){.x{color:white}}</style>',
			),
		).toBe(true)
	})

	it('normalizes style media attributes through app-theme and pane queries', () => {
		const documentElement = sanitizeEmailDocument(`
			<style media="(prefers-color-scheme: dark)">.dark{color:white}</style>
			<style media="screen and (prefers-color-scheme: light) and (max-device-width: 40rem)">.light{color:black}</style>
			<style media="(max-width: 600px)">.mobile{display:block}</style>
		`)
		const styles = Array.from(documentElement?.querySelectorAll('style') ?? [])
		expect(styles).toHaveLength(3)
		expect(styles.every((style) => !style.hasAttribute('media'))).toBe(true)
		expect(styles[0]?.textContent).toBe(
			'@container ownmail-email style(--ownmail-email-theme: dark){.dark{color:white}}',
		)
		expect(styles[1]?.textContent).toBe(
			'@container ownmail-email style(--ownmail-email-theme: light) and (max-width:40rem){.light{color:black}}',
		)
		expect(styles[2]?.textContent).toBe('@container ownmail-email (max-width: 600px){.mobile{display:block}}')
		expect(
			sanitizedEmailSupportsDarkMode(
				'<style media="(prefers-color-scheme: dark)">.dark{color:white}</style>',
			),
		).toBe(true)
	})

	it('normalizes negated style media through app-theme and pane queries', () => {
		const documentElement = sanitizeEmailDocument(`
			<style media="not (prefers-color-scheme: light)">.dark{color:white}</style>
			<style media="(not/**/(prefers-color-scheme: dark)) and (max-width: 600px)">.light{color:black}</style>
		`)
		const styles = Array.from(documentElement?.querySelectorAll('style') ?? [])
		expect(styles.map((style) => style.textContent)).toEqual([
			'@container ownmail-email style(--ownmail-email-theme: dark){.dark{color:white}}',
			'@container ownmail-email style(--ownmail-email-theme: light) and (max-width: 600px){.light{color:black}}',
		])
		expect(styles.every((style) => !style.hasAttribute('media'))).toBe(true)
		expect(
			sanitizedEmailSupportsDarkMode(
				'<style media="not (prefers-color-scheme: light)">.dark{color:white}</style>',
			),
		).toBe(true)
	})

	it('preserves viewport style media in Original mode while keeping theme app-controlled', () => {
		const original = sanitizeEmailDocument(
			'<style media="(prefers-color-scheme: dark) and (max-width: 600px)">.card{color:white}</style>',
			{ rewriteViewportMedia: false },
		)
		const css = original?.querySelector('style')?.textContent ?? ''
		expect(original?.querySelector('style')?.hasAttribute('media')).toBe(false)
		expect(css).toBe(
			'@media (max-width: 600px){@container ownmail-email style(--ownmail-email-theme: dark){.card{color:white}}}',
		)
	})

	it('fails closed for structurally invalid style media attributes', () => {
		const injected = sanitizeEmailDocument(
			'<style media="all}{:host{display:block}">.safe{color:red}</style><p>Body</p>',
		)
		expect(injected?.querySelector('style')).toBeNull()
		const emptyComment = sanitizeEmailDocument('<style media="/**/">.safe{color:red}</style><p>Body</p>')
		expect(emptyComment?.querySelector('style')).toBeNull()
	})

	it('normalizes picture source theme media into trusted app and pane branches', () => {
		const documentElement = sanitizeEmailDocument(`<picture>
			<source class="dark" media="(prefers-color-scheme:dark)" srcset="/dark.png">
			<source class="light-pane" media="(prefers-color-scheme:light) and (max-width:40rem)" srcset="/light.png">
			<source class="dark-landscape" media="(prefers-color-scheme:dark) and (orientation:landscape)" srcset="/wide.png">
			<source class="dark-or-hover" media="(prefers-color-scheme:dark) or (hover:hover)" srcset="/hover.png">
			<source class="dark-or-pane" media="(prefers-color-scheme:dark) or (max-width:500px)" srcset="/pane.png">
			<source class="dark-pane-landscape" media="(prefers-color-scheme:dark) and (max-width:500px) and (orientation:landscape)" srcset="/all.png">
			<source class="unthemed" media="(min-width:900px)" srcset="/desktop.png">
			<img src="/fallback.png">
		</picture>`)
		const definition = (selector: string) =>
			JSON.parse(documentElement?.querySelector(selector)?.getAttribute(PICTURE_MEDIA_ATTRIBUTE) ?? 'null')

		expect(documentElement?.querySelector('.dark')?.getAttribute('media')).toBe('not all')
		expect(definition('.dark')).toEqual({ branches: [{ theme: 'dark' }] })
		expect(definition('.light-pane')).toEqual({
			branches: [{ pane: ['(max-width:40rem)'], theme: 'light' }],
		})
		expect(definition('.dark-landscape')).toEqual({
			branches: [{ media: '(orientation:landscape)', theme: 'dark' }],
		})
		expect(definition('.dark-or-hover')).toEqual({
			branches: [{ theme: 'dark' }, { media: '(hover:hover)' }],
		})
		expect(definition('.dark-or-pane')).toEqual({
			branches: [{ theme: 'dark' }, { pane: ['(max-width:500px)'] }],
		})
		expect(definition('.dark-pane-landscape')).toEqual({
			branches: [
				{
					media: '(orientation:landscape)',
					pane: ['(max-width:500px)'],
					theme: 'dark',
				},
			],
		})
		expect(documentElement?.querySelector('.unthemed')?.getAttribute('media')).toBe('(min-width:900px)')
		expect(documentElement?.querySelector('.unthemed')?.hasAttribute(PICTURE_MEDIA_ATTRIBUTE)).toBe(false)
	})

	it('preserves picture viewport conditions in Original mode and fails malformed theme media closed', () => {
		const original = sanitizeEmailDocument(
			`<picture>
				<source class="original" media="(prefers-color-scheme:dark) and (max-width:600px)" srcset="/dark.png">
				<source class="malformed" media="(prefers-color-scheme:dark" srcset="/broken.png">
				<source class="contradictory" media="(prefers-color-scheme:dark) and (prefers-color-scheme:light)" srcset="/never.png">
				<img src="/fallback.png">
			</picture>`,
			{ rewriteViewportMedia: false },
		)
		const originalDefinition = JSON.parse(
			original?.querySelector('.original')?.getAttribute(PICTURE_MEDIA_ATTRIBUTE) ?? 'null',
		)
		expect(originalDefinition).toEqual({
			branches: [{ media: '(max-width:600px)', theme: 'dark' }],
		})
		for (const selector of ['.malformed', '.contradictory']) {
			expect(original?.querySelector(selector)?.getAttribute('media')).toBe('not all')
			expect(original?.querySelector(selector)?.hasAttribute(PICTURE_MEDIA_ATTRIBUTE)).toBe(false)
		}
	})

	it('fails picture media with dangling list and boolean branches closed', () => {
		const documentElement = sanitizeEmailDocument(`<picture>
			<source class="leading-or" media="or (prefers-color-scheme:dark)" srcset="/leading.png">
			<source class="trailing-or" media="(prefers-color-scheme:dark) or" srcset="/trailing.png">
			<source class="trailing-and" media="(prefers-color-scheme:dark) and" srcset="/and.png">
			<source class="trailing-comma" media="(prefers-color-scheme:dark)," srcset="/comma.png">
			<img src="/fallback.png">
		</picture>`)

		for (const source of documentElement?.querySelectorAll('source') ?? []) {
			expect(source.getAttribute('media')).toBe('not all')
			expect(source.hasAttribute(PICTURE_MEDIA_ATTRIBUTE)).toBe(false)
		}
	})
})

describe('sanitizeEmailHtml', () => {
	it('returns an empty string unchanged', () => {
		expect(sanitizeEmailHtml('')).toBe('')
	})

	it('strips <script> tags', () => {
		const out = sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>')
		expect(out).toContain('<p>Hi</p>')
		expect(out).not.toContain('<script')
		expect(out).not.toContain('alert(1)')
	})

	it('strips inline event handlers', () => {
		const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)" />')
		expect(out).not.toContain('onerror')
	})

	it('neutralizes javascript: URLs on links', () => {
		const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
		expect(out).not.toContain('javascript:')
	})

	it('drops phishing-prone form controls', () => {
		const out = sanitizeEmailHtml('<form action="https://evil.com"><input name="pw" /></form>')
		expect(out).not.toContain('<form')
		expect(out).not.toContain('<input')
	})

	it('keeps presentational HTML: links, images, tables, and inline styles', () => {
		const out = sanitizeEmailHtml(
			'<table><tr><td style="color:red"><a href="https://ok.com">ok</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" /></td></tr></table>',
		)
		expect(out).toContain('<table')
		expect(out).toContain('href="https://ok.com"')
		expect(out).toContain('src="data:image/gif;base64,R0lGODlhAQABAAAAACw="')
		expect(out).toContain('style="color:red"')
	})

	it('blocks remote image sources and CSS URLs until explicitly allowed', () => {
		const html = `<style>.hero{background-image:url(https://images.example/hero.png)}</style>
			<div class="hero" style="background:url('//images.example/inline.png')" background="https://images.example/legacy.png">
				<picture><source media="(prefers-color-scheme:dark)" srcset="https://images.example/a.png 1x, /local.png 2x"><img src="https://images.example/tracker.png" width="600" height="240"></picture>
				<img class="cid" src="cid:logo"><img class="data" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
			</div>`
		const blocked = sanitizeEmailDocument(html)
		expect(blocked).not.toBeNull()
		expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
		expect(blocked?.querySelector('img:not(.cid):not(.data)')?.hasAttribute('src')).toBe(false)
		expect(blocked?.querySelector('source')?.hasAttribute('srcset')).toBe(false)
		expect(blocked?.querySelector('source')?.getAttribute('media')).toBe('not all')
		expect(blocked?.querySelector('source')?.hasAttribute(PICTURE_MEDIA_ATTRIBUTE)).toBe(true)
		expect(blocked?.querySelector('img:not(.cid):not(.data)')?.getAttribute('width')).toBe('600')
		expect(blocked?.querySelector('img:not(.cid):not(.data)')?.getAttribute('height')).toBe('240')
		expect(blocked?.querySelector('.cid')?.getAttribute('src')).toBe('cid:logo')
		expect(blocked?.querySelector('.data')?.getAttribute('src')).toContain('data:image/gif')
		expect(blocked?.querySelector('style')?.textContent).not.toContain('images.example')
		expect(blocked?.querySelector('.hero')?.getAttribute('style')).not.toContain('images.example')

		const allowed = sanitizeEmailDocument(html, { allowRemoteImages: true })
		expect(allowed?.querySelector('img:not(.cid):not(.data)')?.hasAttribute('src')).toBe(false)
		expect(allowed?.querySelector('source')?.hasAttribute('srcset')).toBe(false)
		expect(allowed?.querySelector('source')?.getAttribute('media')).toBe('not all')
		expect(allowed?.querySelector('style')?.textContent).not.toContain('images.example')
	})

	it('keeps signed image proxy paths behind the same consent boundary', () => {
		const token = `${'a'.repeat(20)}.${'b'.repeat(20)}`
		const html = `<style>.hero{background:url('/email-images/${token}?mode=automatic&theme=light')}</style><img src="/email-images/${token}?mode=automatic&theme=light">`
		const blocked = sanitizeEmailDocument(html)
		expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
		expect(blocked?.querySelector('img')?.hasAttribute('src')).toBe(false)
		expect(blocked?.querySelector('style')?.textContent).not.toContain('/email-images/')

		const allowed = sanitizeEmailDocument(html, { allowRemoteImages: true })
		expect(allowed?.querySelector('img')?.getAttribute('src')).toContain('/email-images/')
		expect(allowed?.querySelector('style')?.textContent).toContain('/email-images/')
	})

	it('blocks browser-normalized and non-url CSS remote resource forms', () => {
		const html = String.raw`<style>
			.a{background-image:image-set("https://images.example/a.png" 1x)}
			.b{background-image:-webkit-image-set("https://images.example/b.png" 1x)}
		</style>
		<img class="slashes" src="https:\\images.example.test/x">
		<img class="newline" src="https:
//images.example.test/y">
		<img class="relative" src="/authenticated/image">
		<svg><image class="remote-svg" href="https://images.example.test/svg.png"></image><rect class="filtered" filter="url(https://images.example.test/filter.svg#x)"></rect></svg>`
		const blocked = sanitizeEmailDocument(html)
		expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
		expect(blocked?.querySelector('.slashes')?.hasAttribute('src')).toBe(false)
		expect(blocked?.querySelector('.newline')?.hasAttribute('src')).toBe(false)
		expect(blocked?.querySelector('.relative')?.hasAttribute('src')).toBe(false)
		expect(blocked?.querySelector('.remote-svg')?.hasAttribute('href')).toBe(false)
		expect(blocked?.querySelector('.filtered')?.hasAttribute('filter')).toBe(false)
		expect(blocked?.querySelector('style')?.textContent).not.toContain('images.example')
		const malformed = sanitizeEmailDocument(
			'<style>.x{background-image:image-set("https://images.example.test/malformed.gif" 1x)</style><div class="x">Safe</div>',
		)
		expect(sanitizedDocumentHasRemoteImages(malformed as HTMLElement)).toBe(true)
		expect(malformed?.querySelector('style')).toBeNull()
		const relativeCss = sanitizeEmailDocument(
			'<style>.x{background:url(../authenticated/image.png)}</style><div class="x" style="background:url(/session/image.png)">Safe</div>',
			{ allowRemoteImages: true },
		)
		expect(relativeCss?.querySelector('style')?.textContent).not.toContain('authenticated')
		expect(relativeCss?.querySelector('.x')?.getAttribute('style')).not.toContain('/session/')
	})

	it('blocks remote SVG resource references while preserving local references and anchors', () => {
		const html = `<svg>
			<use class="remote-use" href="https://images.example.test/sprite.svg#icon"></use>
			<use class="remote-xlink" xlink:href="//images.example.test/sprite.svg#icon"></use>
			<use class="local-use" href="/authenticated/sprite.svg#icon"></use>
			<use class="cid-use" href="cid:sprite#icon"></use>
			<use class="data-use" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E#icon"></use>
			<linearGradient class="remote-gradient" href="https://images.example.test/sprite.svg#paint"></linearGradient>
			<radialGradient class="remote-xlink" xlink:href="//images.example.test/sprite.svg#paint"></radialGradient>
			<pattern class="local-pattern" href="/authenticated/sprite.svg#pattern"></pattern>
			<pattern class="cid-pattern" href="cid:sprite#pattern"></pattern>
			<image class="data-image" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></image>
			<text><textPath class="remote-text-path" href="https://images.example.test/sprite.svg#path">Text</textPath></text>
			<a class="svg-link" href="https://example.test/read">Read</a>
		</svg><a class="html-link" href="https://example.test/read">Read</a>`
		const blocked = sanitizeEmailDocument(html)
		expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
		expect(blocked?.querySelector('use')).toBeNull()
		expect(blocked?.querySelector('.remote-gradient')?.hasAttribute('href')).toBe(false)
		expect(blocked?.querySelector('.remote-xlink')?.hasAttribute('xlink:href')).toBe(false)
		expect(blocked?.querySelector('.remote-text-path')?.hasAttribute('href')).toBe(false)
		expect(blocked?.querySelector('.local-pattern')?.hasAttribute('href')).toBe(false)
		expect(blocked?.querySelector('.cid-pattern')?.getAttribute('href')).toBe('cid:sprite#pattern')
		expect(blocked?.querySelector('.data-image')?.getAttribute('href')).toContain('data:image/svg+xml')
		expect(blocked?.querySelector('.svg-link')?.getAttribute('href')).toBe('https://example.test/read')
		expect(blocked?.querySelector('.html-link')?.getAttribute('href')).toBe('https://example.test/read')

		const allowed = sanitizeEmailDocument(html, { allowRemoteImages: true })
		expect(allowed?.querySelector('use')).toBeNull()
		expect(allowed?.querySelector('.remote-gradient')?.hasAttribute('href')).toBe(false)
		expect(allowed?.querySelector('.remote-xlink')?.hasAttribute('xlink:href')).toBe(false)
		expect(allowed?.querySelector('.remote-text-path')?.hasAttribute('href')).toBe(false)

		const localOnly = sanitizeEmailDocument(
			'<svg xmlns="http://www.w3.org/2000/svg"><pattern class="local" href="/authenticated/sprite.svg#paint"></pattern><image class="cid" href="cid:logo"></image><image class="data" href="data:image/gif;base64,R0lGODlhAQABAAAAACw="></image></svg>',
		)
		expect(sanitizedDocumentHasRemoteImages(localOnly as HTMLElement)).toBe(false)
		expect(localOnly?.querySelector('svg')?.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
		expect(localOnly?.querySelector('.local')?.hasAttribute('href')).toBe(false)
		expect(localOnly?.querySelector('.cid')?.getAttribute('href')).toBe('cid:logo')
		expect(localOnly?.querySelector('.data')?.getAttribute('href')).toContain('data:image/gif')
	})

	it('removes remote declarations through nesting, escapes, and structured custom properties', () => {
		const html = String.raw`<style>
			@supports (display:grid) {
				.hero[data-copy="https://text.example"] {
					--remote-art: { image: u\72l(h\74 tps://images.example/custom.png) };
					background-image: image-set(url(https://images.example/hero.png) 1x);
					background-image: url("data:image/png;base64,AAAA{;}");
					color: red;
				}
			}
			/* url(https://comments.example/not-a-request.png) */
		</style><div class="hero" data-copy="https://text.example">Body</div>`
		const blocked = sanitizeEmailDocument(html)
		const css = blocked?.querySelector('style')?.textContent ?? ''
		expect(css).not.toContain('--remote-art')
		expect(css).not.toContain('images.example')
		expect(css).toContain('data:image/png')
		expect(css).toContain('color: red')
		expect(css).toContain('comments.example')
		expect(css).toContain('[data-copy="https://text.example"]')
		expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
	})

	it('removes remote values from declaration at-rules and nested declaration lists', () => {
		const html = String.raw`<style>
			@font-face { src: url(https://fonts.example/mail.woff2); font-family: Mail; }
			@page { @top-left { background-image: url(https://images.example/page.png); content: "mail"; } }
			.card {
				color/**/: blue;
				--safe-brackets: [a;b];
				--safe-escape: a\;b;
				\63 olor: url(https://images.example/escaped-property.png);
				@media (max-width:600px) { background: url(https://images.example/mobile.png); color: red; }
			}
		</style><div class="card">Body</div>`
		const blocked = sanitizeEmailDocument(html)
		const css = blocked?.querySelector('style')?.textContent ?? ''
		expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
		expect(css).not.toContain('fonts.example')
		expect(css).not.toContain('images.example')
		expect(css).toContain('font-family: Mail')
		expect(css).toContain('content: "mail"')
		expect(css).toContain('color/**/: blue')
		expect(css).toContain('[a;b]')
		expect(css).toContain('a\\;b')
		expect(css).toContain('color: red')
	})

	it('fails closed for every malformed remote stylesheet recovery path', () => {
		for (const css of [
			'.x{background:url(https://images.example/a.png)',
			'.x{background:url(https://images.example/a.png);/*',
			'.x{background:url(https://images.example/a.png];}',
			'.x{content:"https://images.example/a.png}',
			'.x{--art:{background:url(https://images.example/a.png)}',
		]) {
			const blocked = sanitizeEmailDocument(`<style>${css}</style><p>Safe</p>`)
			expect(sanitizedDocumentHasRemoteImages(blocked as HTMLElement)).toBe(true)
			expect(blocked?.querySelector('style')).toBeNull()
		}
		const allowed = sanitizeEmailDocument(
			'<style>.x{background:url(../authenticated/image.png)</style><p>Safe</p>',
			{ allowRemoteImages: true },
		)
		expect(allowed?.querySelector('style')).toBeNull()
	})

	it('keeps ordinary scoped email stylesheet rules', () => {
		const css = '@media (max-width:600px){.card{width:100%}} .title{color:#434245}'
		const output = sanitizeEmailHtml(`<style>${css}</style><p class="title">Hi</p>`)
		expect(output).toContain(
			'@container ownmail-email (max-width:600px){.card{width:100%}} .title{color:#434245}',
		)
	})

	it('keeps malformed non-network CSS for browser recovery', () => {
		const css = '@media (max-width:600px){.card{color:red}'
		const output = sanitizeEmailHtml(`<style>${css}</style><p>Body</p>`)
		expect(output).toContain(css)
	})

	it('preserves safe document, body, and directionality attributes for faithful rendering', () => {
		const documentElement = sanitizeEmailDocument(`
			<html lang="ar" dir="rtl">
				<head><style>body.sender-canvas { background: navy; color: white; }</style></head>
				<body class="sender-canvas" id="message" style="margin:12px" onload="alert(1)">
					<p>مرحبا</p>
				</body>
			</html>
		`)
		const body = documentElement?.querySelector('body')

		expect(documentElement?.getAttribute('lang')).toBe('ar')
		expect(documentElement?.getAttribute('dir')).toBe('rtl')
		expect(documentElement?.querySelector('style')?.textContent).toContain('body.sender-canvas')
		expect(body?.getAttribute('class')).toBe('sender-canvas')
		expect(body?.getAttribute('id')).toBe('message')
		expect(body?.getAttribute('style')).toBe('margin:12px')
		expect(body?.hasAttribute('onload')).toBe(false)
	})

	it('drops stylesheets that can restyle the custom-element host', () => {
		const exploit = ':host{position:fixed!important;inset:0!important;z-index:99999!important}'
		const out = sanitizeEmailHtml(`<style>${exploit}</style><p>Safe content</p>`)
		expect(out).toBe('<p>Safe content</p>')
	})

	it('handles adjacent styles independently without reconstructing provider markup', () => {
		const out = sanitizeEmailHtml(
			'<style>.first{color:red}</style>' +
				'<style>:host{position:fixed}</style>' +
				'<style>.last{color:blue}</style><p>Content</p>',
		)
		expect(out).toBe('<style>.first{color:red}</style><style>.last{color:blue}</style><p>Content</p>')
	})

	it('moves a vetted body-nested style to the detached output without duplicating it', () => {
		const out = sanitizeEmailHtml(
			'<section><style media="screen and (max-width:600px)">.card{width:100%}</style><p class="card">Hi</p></section>',
		)
		expect(out).toBe(
			'<style>@container ownmail-email (max-width:600px){.card{width:100%}}</style><section><p class="card">Hi</p></section>',
		)
	})

	it('uses DOM parsing semantics for malformed style closing markup', () => {
		const out = sanitizeEmailHtml('<style>.safe{color:red}</style junk><p>After</p>')
		expect(out).toBe('<style>.safe{color:red}</style><p>After</p>')
	})

	it('fails closed for nested style-like text containing a host selector', () => {
		const out = sanitizeEmailHtml('<style>.safe{color:red}<style>:host{position:fixed}</style><p>After</p>')
		expect(out).toBe('<p>After</p>')
	})

	it('does not reconstruct malformed split style tags', () => {
		const out = sanitizeEmailHtml('<sty<style>le>:host{position:fixed}</style><p>Safe</p>')
		expect(out).not.toContain('<style')
		expect(out).toContain('Safe')
	})

	it('fails closed for host selectors hidden with CSS escapes or comments', () => {
		expect(sanitizeProviderCss(String.raw`:h\6f st { position: fixed }`)).toBe('')
		expect(sanitizeProviderCss(':h/**/ost { position: fixed }')).toBe('')
		expect(sanitizeProviderCss(':host/**/-context(.dark) { position: fixed }')).toBe('')
	})

	it('replaces invalid CSS escape code points during security inspection', () => {
		const css = String.raw`.label-\110000 { color: red }`
		expect(sanitizeProviderCss(css)).toBe(css)
	})

	it('drops imported stylesheets before they can load uninspected rules', () => {
		expect(sanitizeProviderCss('@import url("https://evil.example/host.css"); p { color: red }')).toBe('')
		expect(sanitizeProviderCss('@im/**/port "https://evil.example/host.css";')).toBe('')
		expect(sanitizeProviderCss(String.raw`@\69 mport "https://evil.example/host.css";`)).toBe('')
	})
})
