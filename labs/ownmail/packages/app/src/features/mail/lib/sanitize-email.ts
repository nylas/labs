import DOMPurify from 'dompurify'
import postcss from 'postcss'

const PANE_WIDTH_FEATURE = /\(\s*(?:min|max)-width\s*:\s*\d*\.?\d+(?:px|em|rem)\s*\)/gi
const DEVICE_WIDTH_FEATURE = /\(\s*((?:min|max))-device-width\s*:\s*(\d*\.?\d+(?:px|em|rem))\s*\)/gi

/**
 * Convert common email viewport breakpoints into named container queries so
 * responsive sender CSS follows the reading pane rather than the browser window.
 * PostCSS supplies the grammar-aware parse; malformed CSS is preserved for the
 * browser's own recovery instead of being rewritten by a fragile brace regex.
 */
export function rewritePaneMediaQueries(css: string): string {
	try {
		const root = postcss.parse(css)
		root.walkAtRules('media', (rule) => {
			const queries = splitMediaList(rule.params)
			const converted = queries.map((query) => ({ condition: paneWidthCondition(query), query }))
			const paneConditions = [
				...new Set(converted.flatMap(({ condition }) => (condition ? [condition] : []))),
			]
			if (paneConditions.length === 0) return
			for (const condition of paneConditions.slice().reverse()) {
				rule.cloneAfter({ name: 'container', params: `ownmail-email ${condition}` })
			}
			const viewportQueries = converted.flatMap(({ condition, query }) => (condition ? [] : [query]))
			if (viewportQueries.length > 0) rule.params = viewportQueries.join(', ')
			else rule.remove()
		})
		return root.toString()
	} catch {
		return css
	}
}

function paneWidthCondition(query: string): string | null {
	const condition = query
		.trim()
		.replace(/^(?:only\s+)?(?:screen|all)\s+and\s+/i, '')
		.replace(
			DEVICE_WIDTH_FEATURE,
			(_match, boundary: string, width: string) => `(${boundary}-width:${width})`,
		)
		.trim()
	const features = condition.match(PANE_WIDTH_FEATURE)
	if (!features?.length) return null
	const remainder = condition
		.replace(PANE_WIDTH_FEATURE, '')
		.replace(/\band\b/gi, '')
		.trim()
	return remainder ? null : condition
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

function prepareSanitizedDocument(
	sanitizedDocument: HTMLElement,
	options: { rewriteViewportMedia?: boolean } = {},
): HTMLElement {
	for (const style of Array.from(sanitizedDocument.querySelectorAll('style'))) {
		const safeCss = sanitizeProviderCss(style.textContent)
		if (!safeCss) {
			style.remove()
			continue
		}
		style.textContent = options.rewriteViewportMedia === false ? safeCss : rewritePaneMediaQueries(safeCss)
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
export function sanitizeEmailDocument(
	html: string,
	options?: { rewriteViewportMedia?: boolean },
): HTMLElement | null {
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

/** Serializable form used by tests and browser-only consumers that need markup. */
export function sanitizeEmailHtml(html: string): string {
	const sanitizedDocument = sanitizeEmailDocument(html)
	return sanitizedDocument ? renderableFragment(sanitizedDocument) : ''
}
