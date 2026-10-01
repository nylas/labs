import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_SOURCE_ROOT = resolve(REPO_ROOT, 'labs/ownmail/packages/app/src')
const SOURCE_FILE = /\.(?:ts|tsx|css)$/
// Tests assert on class names; reader fixtures and the dev mocks hold sender-authored email HTML.
const EXCLUDED_FILE = /\.test\.|\.fixture\.|^routeTree\.gen\.ts$|^dev-mocks\.ts$/
const EXCLUDED_DIRECTORY = /fixtures$/

// design.md "Borders and accents": no one-sided accent borders or simulated rails.
// Lengths are parsed and compared in pixels (1rem = 1em = 16px).
const ROOT_FONT_PX = 16
const ACCENT_MIN_PX = 2
const BAR_MAX_PX = 4
const WIDTH_KEYWORDS = { thin: 1, medium: 3, thick: 5 }
const VISIBLE_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'])
const HIDDEN_STYLES = new Set(['none', 'hidden'])
// The colours a one-pixel separator may use on one side.
const SEPARATOR_VARIABLES = new Set(['--border', '--color-border', '--sidebar-border', '--input'])
const SEPARATOR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit'])
/**
 * The only exception: a width the check cannot evaluate (`var()`, `calc()`) may
 * be vouched for with `accent-rails-allow: <reason>` in a comment on the same
 * or the previous line. It never excuses a width the check can read.
 */
const ALLOW_COMMENT = /accent-rails-allow:\s*\w/

// One physical or logical side, or one axis (`border-inline`, the CSS form of `border-x-*`).
const SIDE = '(?:left|right|top|bottom|inline-start|inline-end|block-start|block-end|inline|block)'
const SIDE_BORDER = new RegExp(`^border-${SIDE}(-width|-color)?$`)
const DECLARATION = /(?<![\w-])([a-zA-Z-]+)\s*:\s*([^;{}]+)/g
const TAILWIND_SIDE_BORDER = /(?<![\w-])border-[lrtbsexy]-(\[[^\]\s]*\]|\([^)\s]*\)|[\w./-]+)/g
const TAILWIND_SHADOW = /(?<![\w-])(inset-)?shadow-\[([^\]\s]*)\]/g
// A full-width strip 2 to 6px tall with a fill, built from Tailwind utilities:
// `h-1 w-full bg-primary`, `cn('h-1.5 inset-x-0', toneClass(tone))`.
const STRIP_HEIGHT = /(?<![\w:.-])h-(?:0\.5|1|1\.5)(?![\w.-])/
const STRIP_WIDTH = /(?<![\w-])(?:w-full|inset-x-0)(?![\w-])/
const STRIP_FILL = /(?<![\w-])bg-(?!transparent\b)|\w+Class\(/

/** A CSS length in pixels, or null when it cannot be evaluated (%, vw, var(), calc(), keywords). */
export function lengthInPx(token) {
	if (/^[+-]?0+(?:\.0+)?$/.test(token)) return 0
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em)$/.exec(token)
	if (!match) return null
	return Number(match[1]) * (match[2] === 'px' ? 1 : ROOT_FONT_PX)
}

function borderWidthInPx(token) {
	return lengthInPx(token) ?? WIDTH_KEYWORDS[token] ?? null
}

function isDynamic(token) {
	return /(?:^|[^\w-])(?:var|calc|min|max|clamp|env)\(/.test(token)
}

/** Split a value on a separator, ignoring separators inside parentheses. */
function splitTopLevel(value, separator) {
	const parts = []
	let depth = 0
	let current = ''
	for (const character of value) {
		if (character === '(') depth += 1
		if (character === ')') depth -= 1
		if (depth === 0 && separator.test(character)) {
			if (current) parts.push(current)
			current = ''
		} else current += character
	}
	if (current) parts.push(current)
	return parts
}

function tokens(value) {
	return splitTopLevel(value.replace(/!important/g, ''), /\s/).map((token) => token.toLowerCase())
}

function isSeparatorColour(token) {
	if (SEPARATOR_KEYWORDS.has(token)) return true
	const variables = token.match(/--[\w-]+/g) ?? []
	return variables.length > 0 && variables.every((name) => SEPARATOR_VARIABLES.has(name))
}

const UNVERIFIABLE = 'unverifiable'

function widthProblem(px) {
	return px >= ACCENT_MIN_PX ? { kind: 'css', detail: `${px}px wide` } : null
}

/** `border-left: …`, `border-inline-start-width: …`, `border-top-color: …`. */
function sideBorderProblem(suffix, parts) {
	if (suffix === '-color') {
		return parts.every(isSeparatorColour) ? null : { kind: 'css', detail: 'accent colour' }
	}
	if (suffix === '-width') {
		// One value, or the two values of an axis shorthand (`border-inline-width: 0 4px`).
		const widths = parts.map(borderWidthInPx)
		if (widths.some((px) => px === null)) return { kind: UNVERIFIABLE, detail: 'width cannot be evaluated' }
		return widthProblem(Math.max(...widths))
	}
	if (parts.some((part) => HIDDEN_STYLES.has(part))) return null
	const widths = parts.map(borderWidthInPx).filter((px) => px !== null)
	if (widths.length === 0) {
		// A border with a style and no width is `medium`.
		if (parts.some((part) => VISIBLE_STYLES.has(part))) return widthProblem(WIDTH_KEYWORDS.medium)
		return parts.some(isDynamic) ? { kind: UNVERIFIABLE, detail: 'width cannot be evaluated' } : null
	}
	const px = Math.max(...widths)
	if (px === 0) return null
	const colours = parts.filter((part) => borderWidthInPx(part) === null && !VISIBLE_STYLES.has(part))
	return (
		widthProblem(px) ?? (colours.every(isSeparatorColour) ? null : { kind: 'css', detail: 'accent colour' })
	)
}

/** `border-width: 0 0 0 4px`: banned when the sides differ; the same width on all four is uniform. */
function widthShorthandProblem(parts) {
	if (new Set(parts).size === 1) return null
	const widths = parts.map(borderWidthInPx)
	if (widths.some((px) => px === null)) return { kind: UNVERIFIABLE, detail: 'width cannot be evaluated' }
	return widthProblem(Math.max(...widths))
}

/** An inset shadow with an offset and no blur draws a hard line along one or two edges. */
function insetShadowProblem(value) {
	for (const shadow of splitTopLevel(value, /,/)) {
		const all = tokens(shadow)
		if (!all.includes('inset')) continue
		const parts = all.filter((part) => part !== 'inset')
		const numeric = parts.map((part) => lengthInPx(part) !== null)
		const first = numeric.indexOf(true)
		if (first === -1) continue
		const lengths = parts.slice(first, numeric.lastIndexOf(true) + 1)
		// A `var()` or `calc()` directly before fewer than four lengths may be the x offset.
		const unknownOffset = lengths.length < 4 && first > 0 && isDynamic(parts[first - 1])
		const [x, y = 0, blur = 0] = lengths.map(lengthInPx)
		if (blur === null || blur > 0) continue
		if (x === null || y === null || unknownOffset) {
			return { kind: UNVERIFIABLE, detail: 'offset cannot be evaluated' }
		}
		if (x !== 0 || y !== 0) return { kind: 'inset-shadow', detail: 'offset with no blur' }
	}
	return null
}

function declarationProblem(property, value) {
	const name = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
	const parts = tokens(value.replace(/^['"`]|['"`],?$/g, ''))
	if (parts.length === 0) return null
	const side = SIDE_BORDER.exec(name)
	if (side) return sideBorderProblem(side[1], parts)
	if (name === 'border-width') return widthShorthandProblem(parts)
	if (name === 'box-shadow') return insetShadowProblem(parts.join(' '))
	return null
}

/** `border-l-4`, `border-s-[0.25rem]`, `border-x-2`, `border-l-primary`. */
function tailwindBorderProblem(value) {
	if (/^border(?![\w-])/.test(value)) return null
	const arbitrary = /^[[(](?:length:)?(.*)[\])]$/.exec(value)
	const px = arbitrary ? lengthInPx(arbitrary[1]) : /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null
	if (px !== null) return px >= ACCENT_MIN_PX ? { kind: 'tailwind', detail: `${px}px wide` } : null
	if (arbitrary && isDynamic(arbitrary[1])) return { kind: UNVERIFIABLE, detail: 'value cannot be evaluated' }
	return { kind: 'tailwind', detail: 'accent colour' }
}

function tailwindProblems(text) {
	const problems = []
	for (const match of text.matchAll(TAILWIND_SIDE_BORDER)) {
		const problem = tailwindBorderProblem(match[1])
		if (problem) problems.push({ ...problem, index: match.index, match: match[0] })
	}
	for (const match of text.matchAll(TAILWIND_SHADOW)) {
		const value = match[2].replaceAll('_', ' ')
		const problem = insetShadowProblem(match[1] ? `inset ${value}` : value)
		if (problem) problems.push({ ...problem, index: match.index, match: match[0] })
	}
	const strip = STRIP_HEIGHT.exec(text)
	if (strip && STRIP_WIDTH.test(text) && STRIP_FILL.test(text)) {
		problems.push({
			kind: 'edge-strip',
			detail: 'full-width colour strip',
			index: strip.index,
			match: strip[0],
		})
	}
	return problems
}

function sizeDeclaration(body, properties) {
	for (const match of body.matchAll(DECLARATION)) {
		if (properties.includes(match[1])) return { value: match[2].trim(), index: match.index }
	}
	return null
}

function isBarThickness(size) {
	const px = size ? lengthInPx(size.value.toLowerCase()) : null
	return px !== null && px >= ACCENT_MIN_PX && px <= BAR_MAX_PX
}

/**
 * Simulated rails in CSS: a pseudo-element or absolutely positioned box that is
 * 2 to 4px thick in exactly one dimension. One-pixel hairlines, dots and
 * thumbs (thin in neither or both dimensions) pass.
 */
function edgeBarProblems(css) {
	const problems = []
	for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const [, selector, body] = rule
		if (!/::(?:before|after)/.test(selector) && !/position\s*:\s*absolute/.test(body)) continue
		const width = sizeDeclaration(body, ['width', 'inline-size'])
		const height = sizeDeclaration(body, ['height', 'block-size'])
		const thinWidth = isBarThickness(width)
		if (thinWidth === isBarThickness(height)) continue
		const thin = thinWidth ? width : height
		problems.push({
			kind: 'edge-bar',
			detail: 'bar along an edge',
			index: rule.index + selector.length + 1 + thin.index,
			match: `${thinWidth ? 'width' : 'height'}: ${thin.value}`,
		})
	}
	return problems
}

function blankComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

export function findAccentRailViolations({ filePath, sourceText }) {
	const isCss = filePath.endsWith('.css')
	const text = isCss ? blankComments(sourceText) : sourceText
	const sourceLines = sourceText.split('\n')
	const problems = []
	let offset = 0
	for (const line of text.split('\n')) {
		for (const problem of tailwindProblems(line)) problems.push({ ...problem, index: offset + problem.index })
		// Outside CSS a declaration is an inline style or a CSS string, which stays on one line.
		if (!isCss) {
			for (const match of line.matchAll(DECLARATION)) {
				const problem = declarationProblem(match[1], match[2].trim())
				if (problem) problems.push({ ...problem, index: offset + match.index, match: match[0].trim() })
			}
		}
		offset += line.length + 1
	}
	if (isCss) {
		for (const match of text.matchAll(DECLARATION)) {
			const problem = declarationProblem(match[1], match[2].trim())
			if (problem)
				problems.push({ ...problem, index: match.index, match: match[0].trim().replace(/\s+/g, ' ') })
		}
		problems.push(...edgeBarProblems(text))
	}
	return problems
		.sort((a, b) => a.index - b.index)
		.map(({ kind, detail, index, match }) => {
			const before = text.slice(0, index).split('\n')
			return { filePath, line: before.length, column: before.at(-1).length + 1, kind, detail, match }
		})
		.filter(
			({ kind, line }) =>
				kind !== UNVERIFIABLE ||
				!(ALLOW_COMMENT.test(sourceLines[line - 1]) || ALLOW_COMMENT.test(sourceLines[line - 2] ?? '')),
		)
}

function sourceFiles(root) {
	const files = []
	const pending = [root]
	while (pending.length > 0) {
		const directory = pending.pop()
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name)
			if (entry.isDirectory()) {
				if (!EXCLUDED_DIRECTORY.test(entry.name)) pending.push(path)
			} else if (SOURCE_FILE.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) files.push(path)
		}
	}
	return files.sort()
}

export function checkOwnmailAccentRails(sourceRoot = APP_SOURCE_ROOT) {
	const files = sourceFiles(sourceRoot)
	return {
		checkedFiles: files.length,
		violations: files.flatMap((filePath) =>
			findAccentRailViolations({ filePath, sourceText: readFileSync(filePath, 'utf8') }),
		),
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = checkOwnmailAccentRails()
	if (result.violations.length === 0) {
		console.log(`OwnMail accent rails: checked ${result.checkedFiles} files.`)
	} else {
		for (const violation of result.violations) {
			const file = relative(REPO_ROOT, violation.filePath)
			console.error(
				`${file}:${violation.line}:${violation.column} one-sided accent (${violation.kind}, ${violation.detail}): ${violation.match}`,
			)
		}
		console.error(
			`${result.violations.length} one-sided accent border(s) or rail(s). See "Borders and accents" in labs/ownmail/packages/app/design.md.`,
		)
		process.exitCode = 1
	}
}
