import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_SOURCE_ROOT = resolve(REPO_ROOT, 'labs/ownmail/packages/app/src')
const SOURCE_FILE = /\.tsx?$/
const EXCLUDED_FILE = /\.test\.|\.fixture\.|^routeTree\.gen\.ts$/
const EXCLUDED_DIRECTORY = /fixtures$/
// design.md "Spacing", clause 6: improvised values belong in shared primitives only.
const SHARED_PRIMITIVES = 'shared/components/ui/'

// Padding, margin and gap utilities with a half step (`py-1.5`) or an arbitrary value (`mt-[7px]`).
const IMPROVISED_SPACING =
	/(?<![\w-])-?(?:[pm][trblxyse]?|gap(?:-[xy])?|space-[xy])-(?:\d+\.5|\[[^\]\s]+\])(?![\w-])/g
// Safe-area sums are the one arbitrary value screens may write.
const SAFE_AREA = /safe-area/

export function findImprovisedSpacing({ filePath, sourceText, sourceRoot = APP_SOURCE_ROOT }) {
	const file = relative(sourceRoot, filePath).split(sep).join('/')
	if (file.startsWith(SHARED_PRIMITIVES)) return []
	const findings = []
	sourceText.split('\n').forEach((text, index) => {
		for (const match of text.matchAll(IMPROVISED_SPACING)) {
			if (!SAFE_AREA.test(match[0])) {
				findings.push({ filePath, line: index + 1, column: match.index + 1, match: match[0] })
			}
		}
	})
	return findings
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

export function checkOwnmailSpacing(sourceRoot = APP_SOURCE_ROOT) {
	const files = sourceFiles(sourceRoot)
	return {
		checkedFiles: files.length,
		findings: files.flatMap((filePath) =>
			findImprovisedSpacing({ filePath, sourceText: readFileSync(filePath, 'utf8'), sourceRoot }),
		),
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = checkOwnmailSpacing()
	if (process.argv.includes('--list')) {
		for (const finding of result.findings) {
			console.log(
				`${relative(REPO_ROOT, finding.filePath)}:${finding.line}:${finding.column} ${finding.match}`,
			)
		}
	}
	// Warn-only while the existing uses are migrated: this never fails the build.
	console.log(
		`OwnMail spacing: checked ${result.checkedFiles} files; warning: ${result.findings.length} half-step or arbitrary spacing value(s) outside ${SHARED_PRIMITIVES} (run with --list to see them).`,
	)
}
