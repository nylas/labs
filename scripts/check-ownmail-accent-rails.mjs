import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_SOURCE_ROOT = resolve(REPO_ROOT, 'labs/ownmail/packages/app/src')
const SOURCE_FILE = /\.(?:ts|tsx|css)$/
// Tests assert on class names, and reader fixtures are sender-authored email.
const EXCLUDED_FILE = /\.test\.|\.fixture\.|^routeTree\.gen\.ts$/
const EXCLUDED_DIRECTORY = /fixtures$/

const LENGTH = '-?(?:[1-9]\\d*|\\d*\\.\\d*[1-9]\\d*)(?:px|rem|em)'
const NOT_A_LENGTH = '(?![\\d.])'

// design.md "Borders and accents": no one-sided accent borders or simulated rails.
// There is no allowlist: the rule has no exceptions.
const PATTERNS = [
	{ kind: 'tailwind', regex: /\bborder-[lrtbse]-(?!0\b|border\b)(\d|\[|\(|[a-z])/ },
	{ kind: 'css', regex: /border-(left|right|top|bottom|inline-(start|end))(-width)?\s*:\s*([2-9]|\d{2})/ },
	{
		// One non-zero offset and no blur, with or without the optional zero spread:
		// `inset 2px 0 0`, `inset 0 -2px 0`, `inset 0 -2px 0 0`. A uniform ring
		// (`inset 0 0 0 1px`) has no offset and passes.
		kind: 'inset-shadow',
		regex: new RegExp(
			`inset\\s+${LENGTH}\\s+0\\s+0${NOT_A_LENGTH}|inset\\s+0\\s+${LENGTH}\\s+0${NOT_A_LENGTH}|shadow-\\[inset`,
		),
	},
]

// A bar 2 to 4px thick: `2px`..`4px` or `0.125rem`..`0.25rem`.
const THIN = /^(?:[2-4]px|0?\.(?:125|1875|25)rem)$/

function declaration(body, property) {
	const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`).exec(body)
	return match ? { value: match[1].trim(), index: match.index + match[0].indexOf(property) } : null
}

/**
 * Simulated rails in CSS: a pseudo-element or absolutely positioned box that is
 * 2 to 4px thick in exactly one dimension. One-pixel hairlines, dots and
 * thumbs (thin in neither or both dimensions) pass.
 */
function findEdgeBars(filePath, sourceText) {
	const violations = []
	for (const rule of sourceText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const [, selector, body] = rule
		if (!/::(?:before|after)/.test(selector) && !/position\s*:\s*absolute/.test(body)) continue
		const width = declaration(body, 'width')
		const height = declaration(body, 'height')
		const thinWidth = width !== null && THIN.test(width.value)
		const thinHeight = height !== null && THIN.test(height.value)
		if (thinWidth === thinHeight) continue
		const thin = thinWidth ? width : height
		const before = sourceText.slice(0, rule.index + selector.length + 1 + thin.index).split('\n')
		violations.push({
			filePath,
			line: before.length,
			column: before.at(-1).length + 1,
			kind: 'edge-bar',
			match: `${thinWidth ? 'width' : 'height'}: ${thin.value}`,
		})
	}
	return violations
}

export function findAccentRailViolations({ filePath, sourceText }) {
	const violations = []
	sourceText.split('\n').forEach((text, index) => {
		for (const { kind, regex } of PATTERNS) {
			const match = regex.exec(text)
			if (match)
				violations.push({ filePath, line: index + 1, column: match.index + 1, kind, match: match[0] })
		}
	})
	if (filePath.endsWith('.css')) violations.push(...findEdgeBars(filePath, sourceText))
	return violations
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
				`${file}:${violation.line}:${violation.column} one-sided accent (${violation.kind}): ${violation.match}`,
			)
		}
		console.error(
			`${result.violations.length} one-sided accent border(s) or rail(s). See "Borders and accents" in labs/ownmail/packages/app/design.md.`,
		)
		process.exitCode = 1
	}
}
