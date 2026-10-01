import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkOwnmailSpacing, findImprovisedSpacing } from './check-ownmail-spacing.mjs'

const sourceRoot = resolve('/workspace/ownmail/src')

function matches(file, sourceText) {
	return findImprovisedSpacing({ filePath: resolve(sourceRoot, file), sourceText, sourceRoot }).map(
		(finding) => finding.match,
	)
}

test('counts half steps on padding, margin and gap, including variants and negatives', () => {
	assert.deepEqual(
		matches('routes/mail.tsx', '<div className="px-2.5 py-1.5 md:pb-2.5 gap-0.5 -mt-1.5 space-y-0.5" />'),
		['px-2.5', 'py-1.5', 'pb-2.5', 'gap-0.5', '-mt-1.5', 'space-y-0.5'],
	)
})

test('counts arbitrary spacing values', () => {
	assert.deepEqual(matches('routes/mail.tsx', '<div className="mt-[7px] gap-x-[0.3rem]" />'), [
		'mt-[7px]',
		'gap-x-[0.3rem]',
	])
})

test('allows the scale, the named role tokens and non-spacing utilities', () => {
	assert.deepEqual(
		matches(
			'routes/mail.tsx',
			'<div className="p-4 gap-2 mt-section px-hairline h-3.5 w-[calc(100vw-5.5rem)] top-0.5 text-[10px] grid-cols-[14rem_1fr] stop-1.5" />',
		),
		[],
	)
})

test('allows safe-area sums', () => {
	assert.deepEqual(
		matches(
			'routes/mail.compose.tsx',
			'<div className="pb-[calc(0.75rem+var(--safe-area-bottom))] pl-[env(safe-area-inset-left)]" />',
		),
		[],
	)
})

test('allows improvised values inside shared primitives only', () => {
	assert.deepEqual(matches('shared/components/ui/button.tsx', 'const sm = "gap-1.5 px-2.5"'), [])
	assert.deepEqual(matches('shared/components/Sheet.tsx', 'const sheet = "gap-1.5"'), ['gap-1.5'])
})

test('skips tests and email fixtures when scanning', () => {
	const root = mkdtempSync(join(tmpdir(), 'ownmail-spacing-'))
	try {
		const improvised = 'export const a = "py-1.5"\n'
		mkdirSync(join(root, 'features/mail/components/reader-fixtures'), { recursive: true })
		mkdirSync(join(root, 'shared/components/ui'), { recursive: true })
		writeFileSync(join(root, 'features/mail/components/Row.tsx'), improvised)
		writeFileSync(join(root, 'features/mail/components/Row.test.tsx'), improvised)
		writeFileSync(join(root, 'features/mail/components/reader-fixtures/sender.ts'), improvised)
		writeFileSync(join(root, 'shared/components/ui/chip.tsx'), improvised)
		const result = checkOwnmailSpacing(root)
		assert.equal(result.checkedFiles, 2)
		assert.equal(result.findings.length, 1)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('is warn-only: the command exits 0 and prints the count', () => {
	const output = execFileSync(
		process.execPath,
		[fileURLToPath(new URL('./check-ownmail-spacing.mjs', import.meta.url))],
		{ encoding: 'utf8' },
	)
	assert.match(output, /warning: \d+ half-step or arbitrary spacing value\(s\)/)
})
