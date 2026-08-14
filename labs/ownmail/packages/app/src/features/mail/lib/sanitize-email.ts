import DOMPurify from 'dompurify'

const PANE_WIDTH_FEATURE = /^\(\s*(?:min|max)-width\s*:\s*\d*\.?\d+(?:px|em|rem)\s*\)$/i
const DEVICE_WIDTH_FEATURE = /\(\s*((?:min|max))-device-width\s*:\s*(\d*\.?\d+(?:px|em|rem))\s*\)/gi
const COLOR_SCHEME_FEATURE = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i
const REMOTE_IMAGE_MARKER = 'data-ownmail-has-remote-images'
const EMAIL_THEME_PROPERTY = '--ownmail-email-theme'
const MAX_CSS_BLOCK_DEPTH = 128
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export interface SanitizeEmailOptions {
	rewriteViewportMedia?: boolean
	rewriteThemeMedia?: boolean
	allowRemoteImages?: boolean
}

interface ConvertedMediaBranch {
	container: string
	media?: string
}

interface CssContainer {
	children: CssBlock[]
	end: number
	kind: 'declarations' | 'rules'
	start: number
}

interface CssBlock {
	body: CssContainer
	close: number
	headerStart: number
	open: number
}

const DECLARATION_AT_RULES = new Set([
	'counter-style',
	'font-face',
	'font-feature-values',
	'page',
	'property',
])

/**
 * Convert common email viewport breakpoints into named container queries so
 * responsive sender CSS follows the reading pane rather than the browser window.
 * A small component-value scanner supplies the grammar-aware parse without
 * pulling a build-time CSS tool into the browser bundle. Malformed CSS is
 * preserved for the browser's own recovery instead of being rewritten.
 */
export function rewritePaneMediaQueries(css: string): string {
	return rewriteEmailMediaQueries(css, { rewriteViewportMedia: true, rewriteThemeMedia: false })
}

/** Rewrite provider color preferences to the app theme, independent of the OS. */
export function rewriteEmailMediaQueries(
	css: string,
	options: { rewriteViewportMedia?: boolean; rewriteThemeMedia?: boolean } = {},
): string {
	const root = parseCss(css)
	return root ? rewriteCssContainer(css, root, options) : css
}

function rewriteCssContainer(
	css: string,
	container: CssContainer,
	options: { rewriteViewportMedia?: boolean; rewriteThemeMedia?: boolean },
): string {
	let cursor = container.start
	let output = ''
	for (const block of container.children) {
		output += css.slice(cursor, block.headerStart)
		const header = css.slice(block.headerStart, block.open)
		const body = rewriteCssContainer(css, block.body, options)
		const media = readAtRuleHeader(header)
		if (media?.name === 'media') {
			output += rewriteMediaBlock(header, media, body, options)
		} else {
			output += `${header}{${body}}`
		}
		cursor = block.close + 1
	}
	return output + css.slice(cursor, container.end)
}

function rewriteMediaBlock(
	header: string,
	media: { params: string; prefix: string },
	body: string,
	options: { rewriteViewportMedia?: boolean; rewriteThemeMedia?: boolean },
): string {
	const queries = splitMediaList(media.params).flatMap(splitMediaDisjunction)
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
	if (branches.length === 0) return `${header}{${body}}`

	const untouched = converted.flatMap(({ branch, query }) => (branch ? [] : [query]))
	let output = media.prefix
	if (untouched.length > 0) output += `@media ${untouched.join(', ')}{${body}}`
	for (const branch of branches) {
		const convertedBody = `@container ownmail-email ${branch.container}{${body}}`
		output += branch.media ? `@media ${branch.media}{${convertedBody}}` : convertedBody
	}
	return output
}

/**
 * Parse only the CSS structure needed by the renderer. The scanner understands
 * component-value boundaries, strings, comments, and escapes; it deliberately
 * does not attempt selector or value interpretation. Any unbalanced construct
 * invalidates the tree so callers can preserve or reject the complete sheet.
 */
function parseCss(css: string): CssContainer | null {
	const root: CssContainer = { children: [], end: css.length, kind: 'rules', start: 0 }
	const stack: Array<CssContainer & { statementStart: number; valueBraces: number }> = [
		{ ...root, statementStart: 0, valueBraces: 0 },
	]
	let parentheses = 0
	let brackets = 0

	for (let index = 0; index < css.length; index += 1) {
		const character = css[index]
		if (character === '/' && css[index + 1] === '*') {
			const close = css.indexOf('*/', index + 2)
			if (close < 0) return null
			index = close + 1
			continue
		}
		if (character === '"' || character === "'") {
			const close = consumeCssString(css, index, character)
			if (close < 0) return null
			index = close
			continue
		}
		if (character === '\\') {
			const close = consumeCssEscape(css, index)
			if (close < 0) return null
			index = close
			continue
		}
		if (character === '(') {
			parentheses += 1
			continue
		}
		if (character === ')') {
			if (parentheses === 0) return null
			parentheses -= 1
			continue
		}
		if (character === '[') {
			brackets += 1
			continue
		}
		if (character === ']') {
			if (brackets === 0) return null
			brackets -= 1
			continue
		}
		if (parentheses > 0 || brackets > 0) continue

		const context = stack.at(-1)
		/* v8 ignore next -- the root context remains on the stack until EOF -- @preserve */
		if (!context) return null
		if (context.valueBraces > 0) {
			if (character === '{') context.valueBraces += 1
			else if (character === '}') context.valueBraces -= 1
			continue
		}
		if (character === '{') {
			const header = css.slice(context.statementStart, index)
			if (context.kind === 'declarations' && isCustomPropertyPrelude(header)) {
				context.valueBraces = 1
				continue
			}
			// Every parsed block is later consumed recursively. Reject pathological
			// provider nesting before it can exhaust the JavaScript call stack.
			if (stack.length >= MAX_CSS_BLOCK_DEPTH) return null
			const body: CssContainer & { statementStart: number; valueBraces: number } = {
				children: [],
				end: -1,
				kind: cssBlockContentKind(header, context.kind),
				start: index + 1,
				statementStart: index + 1,
				valueBraces: 0,
			}
			context.children.push({ body, close: -1, headerStart: context.statementStart, open: index })
			stack.push(body)
			continue
		}
		if (character === '}') {
			if (stack.length === 1) return null
			const completed = stack.pop()
			/* v8 ignore next -- guarded by the stack length check above -- @preserve */
			if (!completed) return null
			completed.end = index
			const parent = stack.at(-1)
			/* v8 ignore next -- every non-root context has a parent -- @preserve */
			if (!parent) return null
			const owner = parent.children.at(-1)
			/* v8 ignore next -- a context is pushed only with its owning block -- @preserve */
			if (!owner) return null
			owner.close = index
			parent.statementStart = index + 1
			continue
		}
		if (character === ';') context.statementStart = index + 1
	}

	if (stack.length !== 1 || parentheses !== 0 || brackets !== 0 || stack[0]?.valueBraces !== 0) return null
	const parsedRoot = stack[0]
	/* v8 ignore next -- the initialized root is always retained -- @preserve */
	if (!parsedRoot) return null
	return parsedRoot
}

function consumeCssString(css: string, start: number, quote: string): number {
	for (let index = start + 1; index < css.length; index += 1) {
		const character = css[index]
		if (character === quote) return index
		if (character === '\n' || character === '\r' || character === '\f') return -1
		if (character === '\\') {
			const close = consumeCssEscape(css, index)
			if (close < 0) return -1
			index = close
		}
	}
	return -1
}

function consumeCssEscape(css: string, start: number): number {
	const first = css[start + 1]
	if (!first) return -1
	if (first === '\r' && css[start + 2] === '\n') return start + 2
	if (first === '\n' || first === '\r' || first === '\f') return start + 1
	if (!/[0-9a-f]/i.test(first)) return start + 1
	let index = start + 1
	let digits = 0
	while (index < css.length && digits < 6 && /[0-9a-f]/i.test(css.charAt(index))) {
		index += 1
		digits += 1
	}
	if (index < css.length && /[\t\n\f\r ]/.test(css.charAt(index))) index += 1
	return index - 1
}

function skipCssTrivia(css: string, start = 0): number {
	let index = start
	while (index < css.length) {
		if (/\s/.test(css.charAt(index))) {
			index += 1
			continue
		}
		if (css[index] === '/' && css[index + 1] === '*') {
			const close = css.indexOf('*/', index + 2)
			/* v8 ignore next -- parseCss rejects unterminated comments first -- @preserve */
			if (close < 0) return css.length
			index = close + 2
			continue
		}
		break
	}
	return index
}

function readAtRuleHeader(header: string): { name: string; params: string; prefix: string } | null {
	const at = skipCssTrivia(header)
	if (header[at] !== '@') return null
	let index = at + 1
	const nameStart = index
	while (index < header.length) {
		const character = header.charAt(index)
		if (character === '/' && header[index + 1] === '*') {
			const close = header.indexOf('*/', index + 2)
			/* v8 ignore next -- parseCss rejects unterminated comments first -- @preserve */
			if (close < 0) return null
			index = close + 2
			continue
		}
		if (character === '\\') {
			const close = consumeCssEscape(header, index)
			/* v8 ignore next -- parseCss rejects incomplete escapes first -- @preserve */
			if (close < 0) return null
			index = close + 1
			continue
		}
		if (/[\w-]/.test(character) || character.charCodeAt(0) >= 0x80) {
			index += 1
			continue
		}
		break
	}
	if (index === nameStart) return null
	return {
		name: inspectableCss(header.slice(nameStart, index)),
		params: header.slice(index).trim(),
		prefix: header.slice(0, at),
	}
}

function cssBlockContentKind(header: string, parentKind: CssContainer['kind']): CssContainer['kind'] {
	const atRule = readAtRuleHeader(header)
	if (!atRule || DECLARATION_AT_RULES.has(atRule.name)) return 'declarations'
	// Conditional groups inherit whether they contain rules or nested
	// declarations. Unknown nested at-rules inherit too: legacy @page margin
	// boxes are browser-fetch-capable declaration lists and must fail closed.
	return parentKind
}

function isCustomPropertyPrelude(header: string): boolean {
	let index = 0
	while (isRegexWhitespace(header.charAt(index))) index += 1
	if (header.charAt(index) !== '-' || header.charAt(index + 1) !== '-') return false
	index += 2

	const first = header.charAt(index)
	if (isAsciiIdentifierStart(first) || first.charCodeAt(0) >= 0x80) {
		index += 1
	} else if (first === '\\' && isEscapableRegexCharacter(header.charAt(index + 1))) {
		index += 2
	} else {
		return false
	}

	while (isAsciiWordOrHyphen(header.charAt(index))) index += 1
	while (index < header.length) {
		if (isRegexWhitespace(header.charAt(index))) {
			index += 1
			continue
		}
		if (header.charAt(index) !== '/' || header.charAt(index + 1) !== '*') break
		const close = header.indexOf('*/', index + 2)
		/* v8 ignore next -- parseCss rejects unterminated comments before this helper is called -- @preserve */
		if (close < 0) return false
		index = close + 2
	}
	return header.charAt(index) === ':'
}

function isRegexWhitespace(character: string): boolean {
	return character !== '' && /\s/u.test(character)
}

function isAsciiIdentifierStart(character: string): boolean {
	const code = character.charCodeAt(0)
	return character === '_' || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAsciiWordOrHyphen(character: string): boolean {
	const code = character.charCodeAt(0)
	return (
		character === '-' ||
		character === '_' ||
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122)
	)
}

function isEscapableRegexCharacter(character: string): boolean {
	return (
		character !== '' &&
		character !== '\n' &&
		character !== '\r' &&
		character !== '\u2028' &&
		character !== '\u2029'
	)
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
		const panePart = inspectedPart.replace(
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
		if (character === '/' && query[index + 1] === '*') {
			index = query.indexOf('*/', index + 2) + 1
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
		if (character === '/' && query[index + 1] === '*') {
			index = query.indexOf('*/', index + 2) + 1
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
	const root = parseCss(css)
	return root ? cssContainerSupportsDarkMode(css, root) : false
}

function cssContainerSupportsDarkMode(css: string, container: CssContainer): boolean {
	return container.children.some((block) => {
		const atRule = readAtRuleHeader(css.slice(block.headerStart, block.open))
		return (
			(atRule?.name === 'media' &&
				splitMediaList(atRule.params)
					.flatMap(splitMediaDisjunction)
					.some(screenMediaBranchSupportsDarkMode)) ||
			cssContainerSupportsDarkMode(css, block.body)
		)
	})
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
		if (element.namespaceURI === SVG_NAMESPACE && element.tagName.toUpperCase() !== 'A')
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
				!['href', 'src', 'srcset', 'poster', 'background', 'style', 'xmlns', 'xmlns:xlink'].includes(
					attribute.name,
				) &&
				containsRemoteResource(attribute.value)
			) {
				found = true
				element.removeAttribute(attribute.name)
			}
		}
	}
	for (const style of sanitizedDocument.querySelectorAll('style')) {
		const sanitized = removeRemoteCssDeclarations(style.textContent)
		if (sanitized) {
			style.textContent = sanitized.css
			found ||= sanitized.removed
		} else if (containsRemoteResource(style.textContent)) {
			// Browser recovery differs across engines. A malformed sheet with a remote
			// resource is removed in full so no recovery path can bypass consent.
			found = true
			style.remove()
		}
	}
	return found
}

function removeRemoteCssDeclarations(css: string): { css: string; removed: boolean } | null {
	const root = parseCss(css)
	if (!root) return null
	return sanitizeCssContainerResources(css, root)
}

function sanitizeCssContainerResources(
	css: string,
	container: CssContainer,
): { css: string; removed: boolean } {
	let cursor = container.start
	let output = ''
	let removed = false
	for (const block of container.children) {
		const preceding = css.slice(cursor, block.headerStart)
		const sanitizedPreceding =
			container.kind === 'declarations' ? removeRemoteDeclarationsFromText(preceding) : null
		output += sanitizedPreceding?.css ?? preceding
		removed ||= sanitizedPreceding?.removed ?? false

		const header = css.slice(block.headerStart, block.open)
		const sanitizedBody = sanitizeCssContainerResources(css, block.body)
		output += `${header}{${sanitizedBody.css}}`
		removed ||= sanitizedBody.removed
		cursor = block.close + 1
	}
	const trailing = css.slice(cursor, container.end)
	const sanitizedTrailing =
		container.kind === 'declarations' ? removeRemoteDeclarationsFromText(trailing) : null
	output += sanitizedTrailing?.css ?? trailing
	removed ||= sanitizedTrailing?.removed ?? false
	return { css: output, removed }
}

function removeRemoteDeclarationsFromText(css: string): { css: string; removed: boolean } {
	let cursor = 0
	let segmentStart = 0
	let output = ''
	let removed = false
	let parentheses = 0
	let brackets = 0
	let braces = 0

	for (let index = 0; index <= css.length; index += 1) {
		const character = css[index]
		if (character === '/' && css[index + 1] === '*') {
			index = css.indexOf('*/', index + 2) + 1
			continue
		}
		if (character === '"' || character === "'") {
			index = consumeCssString(css, index, character)
			continue
		}
		if (character === '\\') {
			index = consumeCssEscape(css, index)
			continue
		}
		if (character === '(') parentheses += 1
		else if (character === ')') parentheses -= 1
		else if (character === '[') brackets += 1
		else if (character === ']') brackets -= 1
		else if (character === '{') braces += 1
		else if (character === '}') braces -= 1
		const isEnd = index === css.length
		if (!isEnd && (character !== ';' || parentheses > 0 || brackets > 0 || braces > 0)) continue

		const end = isEnd ? index : index + 1
		const declaration = css.slice(segmentStart, end)
		const colon = findTopLevelColon(declaration)
		if (colon >= 0 && containsRemoteResource(declaration.slice(colon + 1))) {
			output += css.slice(cursor, segmentStart)
			cursor = end
			removed = true
		}
		segmentStart = end
	}
	return { css: output + css.slice(cursor), removed }
}

function findTopLevelColon(css: string): number {
	for (let index = 0; index < css.length; index += 1) {
		const character = css[index]
		if (character === '/' && css[index + 1] === '*') {
			index = css.indexOf('*/', index + 2) + 1
			continue
		}
		if (character === '\\') {
			index = consumeCssEscape(css, index)
			continue
		}
		if (character === ':') return index
	}
	return -1
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
		const media = style.hasAttribute('media') ? style.getAttribute('media') : null
		const normalizedCss = normalizeStyleMedia(safeCss, media, options)
		if (normalizedCss === null) {
			style.remove()
			continue
		}
		style.removeAttribute('media')
		style.textContent = normalizedCss
	}
	if (!options.allowRemoteImages && blockRemoteImages(sanitizedDocument)) {
		sanitizedDocument.setAttribute(REMOTE_IMAGE_MARKER, '')
	}
	return sanitizedDocument
}

function normalizeStyleMedia(
	css: string,
	media: string | null,
	options: SanitizeEmailOptions,
): string | null {
	const shouldRewrite = options.rewriteThemeMedia !== false || options.rewriteViewportMedia !== false
	if (media === null || media.trim() === '') {
		return shouldRewrite ? rewriteEmailMediaQueries(css, options) : css
	}

	const query = media.trim()
	const validationCss = `@media ${query}{}`
	const validationRoot = parseCss(validationCss)
	const block = validationRoot?.children[0]
	const atRule = block ? readAtRuleHeader(validationCss.slice(block.headerStart, block.open)) : null
	if (
		validationRoot?.children.length !== 1 ||
		!block ||
		block.headerStart !== 0 ||
		block.close !== validationCss.length - 1 ||
		atRule?.name !== 'media' ||
		!splitMediaList(atRule.params).some((branch) => inspectableCss(branch).trim() !== '')
	) {
		return null
	}

	const wrapped = `@media ${query}{${css}}`
	return shouldRewrite ? rewriteEmailMediaQueries(wrapped, options) : wrapped
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
