import DOMPurify from 'dompurify'
import postcss from 'postcss'

const PANE_WIDTH_FEATURE = /^\(\s*(?:min|max)-width\s*:\s*\d*\.?\d+(?:px|em|rem)\s*\)$/i
const DEVICE_WIDTH_FEATURE = /\(\s*((?:min|max))-device-width\s*:\s*(\d*\.?\d+(?:px|em|rem))\s*\)/gi
const COLOR_SCHEME_FEATURE = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i
const REMOTE_IMAGE_MARKER = 'data-ownmail-has-remote-images'
const EMAIL_THEME_PROPERTY = '--ownmail-email-theme'

export interface SanitizeEmailOptions {
	rewriteViewportMedia?: boolean
	rewriteThemeMedia?: boolean
	allowRemoteImages?: boolean
}

interface ConvertedMediaBranch {
	container: string
	media?: string
}

/**
 * Convert common email viewport breakpoints into named container queries so
 * responsive sender CSS follows the reading pane rather than the browser window.
 * PostCSS supplies the grammar-aware parse; malformed CSS is preserved for the
 * browser's own recovery instead of being rewritten by a fragile brace regex.
 */
export function rewritePaneMediaQueries(css: string): string {
	return rewriteEmailMediaQueries(css, { rewriteViewportMedia: true, rewriteThemeMedia: false })
}

/** Rewrite provider color preferences to the app theme, independent of the OS. */
export function rewriteEmailMediaQueries(
	css: string,
	options: { rewriteViewportMedia?: boolean; rewriteThemeMedia?: boolean } = {},
): string {
	try {
		const root = postcss.parse(css)
		root.walkAtRules('media', (rule) => {
			const queries = splitMediaList(rule.params).flatMap(splitMediaDisjunction)
			const converted = queries.map((query) => ({
				branch: convertMediaBranch(
					query,
					options.rewriteViewportMedia !== false,
					options.rewriteThemeMedia !== false,
				),
				query,
			}))
			const branches = [
				...new Map(
					converted.flatMap(({ branch }) =>
						branch ? [[`${branch.media ?? ''}\0${branch.container}`, branch] as const] : [],
					),
				).values(),
			]
			if (branches.length === 0) return
			for (const branch of branches.slice().reverse()) {
				const container = rule.clone({
					name: 'container',
					params: `ownmail-email ${branch.container}`,
				})
				if (branch.media) {
					const media = postcss.atRule({ name: 'media', params: branch.media })
					media.append(container)
					rule.after(media)
				} else {
					rule.after(container)
				}
			}
			const viewportQueries = converted.flatMap(({ branch, query }) => (branch ? [] : [query]))
			if (viewportQueries.length > 0) rule.params = viewportQueries.join(', ')
			else rule.remove()
		})
		return root.toString()
	} catch {
		return css
	}
}

function convertMediaBranch(
	query: string,
	rewriteViewportMedia: boolean,
	rewriteThemeMedia: boolean,
): ConvertedMediaBranch | null {
	const parts = splitMediaConjunction(query)
	const containerParts: string[] = []
	const mediaParts: string[] = []
	let theme: string | undefined

	for (const originalPart of parts) {
		const part = originalPart.trim()
		const inspectedPart = inspectableCss(part)
		if (/^(?:only\s+)?(?:screen|all)$/i.test(inspectedPart)) continue
		const color = inspectedPart.match(COLOR_SCHEME_FEATURE)
		if (color) {
			if (!rewriteThemeMedia) return null
			const requestedTheme = (color[1] as 'dark' | 'light').toLowerCase()
			if (theme && theme !== requestedTheme) return null
			theme = requestedTheme
			continue
		}
		const panePart = part.replace(
			DEVICE_WIDTH_FEATURE,
			(_match, boundary: string, width: string) => `(${boundary}-width:${width})`,
		)
		if (rewriteViewportMedia && PANE_WIDTH_FEATURE.test(panePart)) containerParts.push(panePart)
		else mediaParts.push(part)
	}

	if (theme) containerParts.unshift(`style(${EMAIL_THEME_PROPERTY}: ${theme})`)
	else if (mediaParts.length > 0) return null
	if (containerParts.length === 0) return null
	return {
		container: containerParts.join(' and '),
		...(mediaParts.length > 0 ? { media: mediaParts.join(' and ') } : {}),
	}
}

function splitMediaList(query: string): string[] {
	const parts: string[] = []
	let start = 0
	let depth = 0
	let quote = ''
	let escaped = false
	for (let index = 0; index < query.length; index += 1) {
		const character = query[index]
		if (escaped) {
			escaped = false
			continue
		}
		if (character === '\\') {
			escaped = true
			continue
		}
		if (quote) {
			if (character === quote) quote = ''
			continue
		}
		if (character === '"' || character === "'") {
			quote = character
			continue
		}
		if (character === '(') depth += 1
		else if (character === ')') depth = Math.max(0, depth - 1)
		else if (character === ',' && depth === 0) {
			parts.push(query.slice(start, index).trim())
			start = index + 1
		}
	}
	parts.push(query.slice(start).trim())
	return parts.filter(Boolean)
}

function splitMediaConjunction(query: string): string[] {
	return splitMediaOperator(query, 'and')
}

function splitMediaDisjunction(query: string): string[] {
	return splitMediaOperator(query, 'or')
}

function splitMediaOperator(query: string, operator: 'and' | 'or'): string[] {
	const parts: string[] = []
	let start = 0
	let depth = 0
	let quote = ''
	let escaped = false
	for (let index = 0; index < query.length; index += 1) {
		const character = query[index]
		if (escaped) {
			escaped = false
			continue
		}
		if (character === '\\') {
			escaped = true
			continue
		}
		if (quote) {
			if (character === quote) quote = ''
			continue
		}
		if (character === '"' || character === "'") {
			quote = character
			continue
		}
		if (character === '(') depth += 1
		else if (character === ')') depth = Math.max(0, depth - 1)
		else if (
			depth === 0 &&
			query.slice(index, index + operator.length).toLowerCase() === operator &&
			!/[\w-]/.test(query[index - 1] ?? '') &&
			!/[\w-]/.test(query[index + operator.length] ?? '')
		) {
			parts.push(query.slice(start, index).trim())
			start = index + operator.length
			index += operator.length - 1
		}
	}
	parts.push(query.slice(start).trim())
	return parts.filter(Boolean)
}

/**
 * Decode CSS escapes only for security inspection. CSS identifiers permit
 * `:h\6f st` and `@\69 mport`, so scanning the source text alone would leave a
 * trivial bypass. Returning the original CSS preserves legitimate formatting.
 */
function inspectableCss(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\\(?:\r\n|[\n\r\f])/g, '')
		.replace(/\\([0-9a-f]{1,6})(?:[\t\n\f\r ]?)/gi, (_escape, hex: string) => {
			const codePoint = Number.parseInt(hex, 16)
			return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd'
		})
		.replace(/\\(.)/gs, '$1')
		.toLowerCase()
}

/**
 * Retain normal email presentation rules, but fail closed for CSS that can
 * address the shadow host or load a second, uninspected stylesheet. Provider
 * CSS is untrusted and shares the shadow tree with OwnMail's renderer.
 */
export function sanitizeProviderCss(css: string): string {
	const inspected = inspectableCss(css)
	if (/:host(?:-context)?\b/.test(inspected) || /@import\b/.test(inspected)) return ''
	return css
}

/** True only for a real, parseable provider dark-color media rule. */
export function providerCssSupportsDarkMode(css: string): boolean {
	try {
		let supportsDark = false
		postcss.parse(css).walkAtRules('media', (rule) => {
			if (
				splitMediaList(rule.params).flatMap(splitMediaDisjunction).some(screenMediaBranchSupportsDarkMode)
			) {
				supportsDark = true
			}
		})
		return supportsDark
	} catch {
		return false
	}
}

function screenMediaBranchSupportsDarkMode(query: string): boolean {
	const parts = splitMediaConjunction(query).map((part) => inspectableCss(part).trim())
	if (
		parts.some((part) => /^(?:only\s+)?(?:print|speech)$/i.test(part) || /^not\s+(?:screen|all)$/i.test(part))
	)
		return false
	return parts.some((part) => part.match(COLOR_SCHEME_FEATURE)?.[1]?.toLowerCase() === 'dark')
}

function isRemoteUrl(value: string): boolean {
	const normalized = stripAsciiWhitespaceAndControls(value.trim().replace(/^(['"])(.*)\1$/, '$2')).replace(
		/\\/g,
		'/',
	)
	return /^(?:https?:|\/\/)/i.test(normalized)
}

function containsRemoteResource(value: string): boolean {
	const inspected = stripAsciiWhitespaceAndControls(inspectableCss(value)).replace(/\\/g, '/')
	return /(?:https?:|\/\/)/i.test(inspected)
}

function stripAsciiWhitespaceAndControls(value: string): string {
	return Array.from(value)
		.filter((character) => character.charCodeAt(0) > 0x20)
		.join('')
}

function blockRemoteImages(sanitizedDocument: HTMLElement): boolean {
	let found = false
	for (const element of [sanitizedDocument, ...sanitizedDocument.querySelectorAll<HTMLElement>('*')]) {
		const remoteAttributes = ['src', 'poster', 'background']
		if (['IMAGE', 'FEIMAGE'].includes(element.tagName.toUpperCase()))
			remoteAttributes.push('href', 'xlink:href')
		for (const attribute of remoteAttributes) {
			const value = element.getAttribute(attribute)
			if (value && isRemoteUrl(value)) {
				found = true
				element.removeAttribute(attribute)
			}
		}
		const srcset = element.getAttribute('srcset')
		if (srcset && containsRemoteResource(srcset)) {
			found = true
			element.removeAttribute('srcset')
		}
		for (const declaration of Array.from(element.style)) {
			if (containsRemoteResource(element.style.getPropertyValue(declaration))) {
				found = true
				element.style.removeProperty(declaration)
			}
		}
		for (const attribute of Array.from(element.attributes)) {
			if (
				!['href', 'src', 'srcset', 'poster', 'background', 'style'].includes(attribute.name) &&
				containsRemoteResource(attribute.value)
			) {
				found = true
				element.removeAttribute(attribute.name)
			}
		}
	}
	for (const style of sanitizedDocument.querySelectorAll('style')) {
		try {
			const root = postcss.parse(style.textContent)
			root.walkDecls((declaration) => {
				if (containsRemoteResource(declaration.value)) {
					found = true
					declaration.remove()
				}
			})
			style.textContent = root.toString()
		} catch {
			// Malformed provider CSS is removed when it contains a network-capable url().
			if (containsRemoteResource(style.textContent)) {
				found = true
				style.remove()
			}
		}
	}
	return found
}

function prepareSanitizedDocument(
	sanitizedDocument: HTMLElement,
	options: SanitizeEmailOptions = {},
): HTMLElement {
	for (const style of Array.from(sanitizedDocument.querySelectorAll('style'))) {
		const safeCss = sanitizeProviderCss(style.textContent)
		if (!safeCss) {
			style.remove()
			continue
		}
		style.textContent =
			options.rewriteThemeMedia === false && options.rewriteViewportMedia === false
				? safeCss
				: rewriteEmailMediaQueries(safeCss, options)
	}
	if (!options.allowRemoteImages && blockRemoteImages(sanitizedDocument)) {
		sanitizedDocument.setAttribute(REMOTE_IMAGE_MARKER, '')
	}
	return sanitizedDocument
}

function renderableFragment(sanitizedDocument: HTMLElement): string {
	const serializedDocument = sanitizedDocument.cloneNode(true) as HTMLElement
	const output = serializedDocument.ownerDocument.createElement('div')

	for (const style of Array.from(serializedDocument.querySelectorAll('style'))) {
		style.remove()
		output.appendChild(style)
	}
	const body = serializedDocument.querySelector('body')
	/* v8 ignore else -- DOMPurify WHOLE_DOCUMENT always returns an HTML body -- @preserve */
	if (body) {
		for (const child of Array.from(body.childNodes)) output.appendChild(child)
	}
	return output.innerHTML
}

/**
 * Sanitize untrusted email HTML before it is inserted into the renderer's shadow
 * root. A shadow root shares the app's origin (unlike the old sandboxed iframe),
 * so this is the security boundary: it must strip anything that can execute. We
 * lean on DOMPurify's safe defaults (no `<script>`, no `on*` handlers, no
 * `javascript:` URLs) and additionally forbid tags that enable phishing or
 * navigation hijacking (`<form>`, `<iframe>`, `<meta>`, `<base>`, …). Normal
 * presentation CSS is retained, but stylesheet blocks that can target the
 * custom-element host or import uninspected CSS are removed after DOMPurify.
 * The sanitized html/head/body tree is retained so body-scoped selectors,
 * directionality, classes, and safe inline body presentation still describe the
 * same document the sender authored.
 */
export function sanitizeEmailDocument(html: string, options?: SanitizeEmailOptions): HTMLElement | null {
	if (!html.trim()) return null
	const sanitized = DOMPurify.sanitize(html, {
		// Fragment sanitization discards `<head>` and its legitimate email styles
		// before our CSS boundary can inspect them. Sanitize the complete document,
		// then return only vetted styles plus the sanitized body fragment.
		WHOLE_DOCUMENT: true,
		RETURN_DOM: true,
		FORBID_TAGS: [
			'script',
			'base',
			'form',
			'input',
			'button',
			'textarea',
			'select',
			'option',
			'iframe',
			'object',
			'embed',
			'meta',
			'link',
		],
		FORBID_ATTR: ['ping', 'formaction', 'form'],
		ALLOW_DATA_ATTR: false,
	})
	// DOMPurify's RETURN_DOM + WHOLE_DOCUMENT contract yields the sanitized
	// document element; its public type is the wider Node interface.
	return prepareSanitizedDocument(sanitized as HTMLElement, options)
}

export function sanitizedDocumentHasRemoteImages(documentElement: HTMLElement): boolean {
	const hasRemoteImages = documentElement.hasAttribute(REMOTE_IMAGE_MARKER)
	documentElement.removeAttribute(REMOTE_IMAGE_MARKER)
	return hasRemoteImages
}

/** Detect adaptive dark CSS only after the same sanitizer/security boundary used for rendering. */
export function sanitizedEmailSupportsDarkMode(html: string): boolean {
	const documentElement = sanitizeEmailDocument(html, {
		allowRemoteImages: false,
		rewriteViewportMedia: false,
		rewriteThemeMedia: false,
	})
	if (!documentElement) return false
	return Array.from(documentElement.querySelectorAll('style')).some((style) =>
		providerCssSupportsDarkMode(style.textContent),
	)
}

/** Serializable form used by tests and browser-only consumers that need markup. */
export function sanitizeEmailHtml(html: string): string {
	const sanitizedDocument = sanitizeEmailDocument(html)
	return sanitizedDocument ? renderableFragment(sanitizedDocument) : ''
}
