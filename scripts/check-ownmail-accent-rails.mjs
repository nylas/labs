import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_SOURCE_ROOT = resolve(REPO_ROOT, 'labs/ownmail/packages/app/src')
const SOURCE_FILE = /\.(?:ts|tsx|css)$/
// Tests assert on class names, and reader fixtures are sender-authored email.
const EXCLUDED_FILE = /\.test\.|\.fixture\.|^routeTree\.gen\.ts$/
const EXCLUDED_DIRECTORY = /fixtures$/

// design.md "Borders and accents": no one-sided accent borders or simulated rails.
// There is no allowlist: the rule has no exceptions.
const PATTERNS = [
	{ kind: 'tailwind', regex: /\bborder-[lrtbse]-(?!0\b|border\b)(\d|\[|\(|[a-z])/ },
	{ kind: 'css', regex: /border-(left|right|top|bottom|inline-(start|end))(-width)?\s*:\s*([2-9]|\d{2})/ },
	{
		kind: 'inset-shadow',
		regex: /inset\s+-?[1-9]\d*px\s+0\s+0|inset\s+0\s+-?[1-9]\d*px\s+0\s+0|shadow-\[inset/,
	},
]

export function findAccentRailViolations({ filePath, sourceText }) {
	const violations = []
	sourceText.split('\n').forEach((text, index) => {
		for (const { kind, regex } of PATTERNS) {
			const match = regex.exec(text)
			if (match)
				violations.push({ filePath, line: index + 1, column: match.index + 1, kind, match: match[0] })
		}
	})
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
