import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_SOURCE_ROOT = resolve(REPO_ROOT, 'labs/ownmail/packages/app/src')
const SOURCE_FILE = /\.(?:ts|tsx|css)$/
// Tests assert on class names; reader fixtures and the dev mocks hold sender-authored email HTML.
const EXCLUDED_FILE = /\.test\.|\.fixture\.|^routeTree\.gen\.ts$|^dev-mocks\.ts$/
const EXCLUDED_DIRECTORY = /fixtures$/

// design.md "Glass layer": a blurred backdrop exists only in the two shared
// recipes, bar glass and panel glass. A selector belongs to a recipe when it is
// one compound that starts with the recipe class: `.glass-bar::before`,
// `.glass-panel`, `.glass-panel[data-glass="solid"]`.
const RECIPE_SELECTOR = /^\.glass-(?:bar|panel)(?![\w-])(?:::?[\w-]+|\[[^\]]*\])*$/
const BACKDROP_PROPERTY = /^(?:-webkit-)?backdrop-filter$/
// Only opacity and position animate on glass, never the blur.
const MOTION_PROPERTY = /^(?:transition|transition-property|animation|will-change)$/
const DECLARATION = /(?<![\w-])([a-zA-Z-]+)\s*:\s*([^;{}]+)/g
// Outside CSS: the Tailwind backdrop utilities, an arbitrary property, an inline style, or a CSS string.
const COMPONENT_BACKDROP =
	/(?<![\w-])backdrop-(?:filter|blur|saturate|brightness|contrast|grayscale|hue-rotate|invert|opacity|sepia)(?![\w])[\w./:[\]()%-]*|(?:Webkit)?[bB]ackdropFilter(?![\w])/g

function blankComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function isRecipeRule(selector) {
	return selector
		.split(',')
		.map((part) => part.trim())
		.every((part) => RECIPE_SELECTOR.test(part))
}

/** The innermost style rules of a stylesheet, with at-rule wrappers (`@media`, `@supports`) looked through. */
function styleRules(css) {
	const rules = []
	for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = rule[1].trim()
		rules.push({ selector, body: rule[2], bodyIndex: rule.index + rule[1].length + 1 })
	}
	return rules
}

function cssProblems(css) {
	const problems = []
	for (const { selector, body, bodyIndex } of styleRules(css)) {
		for (const match of body.matchAll(DECLARATION)) {
			const property = match[1].toLowerCase()
			const value = match[2].trim()
			const found = { index: bodyIndex + match.index, match: match[0].trim().replace(/\s+/g, ' ') }
			if (BACKDROP_PROPERTY.test(property)) {
				// Turning the blur off is always allowed: it is how a surface leaves the glass layer.
				if (value.replace(/\s*!important$/, '') === 'none') continue
				if (!isRecipeRule(selector)) problems.push({ ...found, kind: 'outside-recipe' })
			} else if (MOTION_PROPERTY.test(property) && /backdrop-filter/.test(value)) {
				problems.push({ ...found, kind: 'animated-blur' })
			}
		}
	}
	return problems
}

function componentProblems(text) {
	return [...text.matchAll(COMPONENT_BACKDROP)].map((match) => ({
		index: match.index,
		match: match[0],
		kind: 'outside-recipe',
	}))
}

export function findGlassViolations({ filePath, sourceText }) {
	const isCss = filePath.endsWith('.css')
	const text = isCss ? blankComments(sourceText) : sourceText
	return (isCss ? cssProblems(text) : componentProblems(text))
		.sort((a, b) => a.index - b.index)
		.map(({ kind, index, match }) => {
			const before = text.slice(0, index).split('\n')
			return { filePath, line: before.length, column: before.at(-1).length + 1, kind, match }
		})
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

export function checkOwnmailGlass(sourceRoot = APP_SOURCE_ROOT) {
	const files = sourceFiles(sourceRoot)
	return {
		checkedFiles: files.length,
		violations: files.flatMap((filePath) =>
			findGlassViolations({ filePath, sourceText: readFileSync(filePath, 'utf8') }),
		),
	}
}

const REASON = {
	'outside-recipe': 'backdrop blur outside the glass recipes',
	'animated-blur': 'the blur must not animate',
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = checkOwnmailGlass()
	if (result.violations.length === 0) {
		console.log(`OwnMail glass layer: checked ${result.checkedFiles} files.`)
	} else {
		for (const violation of result.violations) {
			const file = relative(REPO_ROOT, violation.filePath)
			console.error(
				`${file}:${violation.line}:${violation.column} ${REASON[violation.kind]}: ${violation.match}`,
			)
		}
		console.error(
			`${result.violations.length} use(s) of backdrop blur outside the glass recipes. Use the bar or panel glass recipe; see "Glass layer" in labs/ownmail/packages/app/design.md.`,
		)
		process.exitCode = 1
	}
}
