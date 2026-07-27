import DOMPurify from 'dompurify'

const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi
const BODY_CONTENT = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i

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

function sanitizeStyleBlocks(html: string): string {
	return html.replace(STYLE_BLOCK, (_block, opening: string, css: string, closing: string) => {
		const safeCss = sanitizeProviderCss(css)
		return safeCss ? `${opening}${safeCss}${closing}` : ''
	})
}

function renderableFragment(sanitizedDocument: string): string {
	const safeDocument = sanitizeStyleBlocks(sanitizedDocument)
	const styles = safeDocument.match(STYLE_BLOCK)?.join('') ?? ''
	/* v8 ignore next -- DOMPurify WHOLE_DOCUMENT always emits a body element -- @preserve */
	const body = BODY_CONTENT.exec(safeDocument)?.[1] ?? ''
	return styles + body.replace(STYLE_BLOCK, '')
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
 */
export function sanitizeEmailHtml(html: string): string {
	const sanitized = DOMPurify.sanitize(html, {
		// Fragment sanitization discards `<head>` and its legitimate email styles
		// before our CSS boundary can inspect them. Sanitize the complete document,
		// then return only vetted styles plus the sanitized body fragment.
		WHOLE_DOCUMENT: true,
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
	return renderableFragment(sanitized)
}
