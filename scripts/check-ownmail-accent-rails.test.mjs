import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { checkOwnmailAccentRails, findAccentRailViolations } from './check-ownmail-accent-rails.mjs'

const sourceRoot = resolve('/workspace/ownmail/src')

function violations(file, sourceText) {
	return findAccentRailViolations({ filePath: resolve(sourceRoot, file), sourceText })
}

// The six audited instances, as they were written before they were removed.
test('rejects the audited Tailwind rail on the invitation card', () => {
	const [violation] = violations(
		'features/mail/components/CalendarInvitationCard.tsx',
		'<div className="border-l-4 border-l-primary px-4 py-4 sm:px-5">',
	)
	assert.equal(violation?.kind, 'tailwind')
	assert.equal(violation?.line, 1)
})

test('rejects the audited thick CSS side borders (search error, composer quote)', () => {
	const results = violations(
		'styles.css',
		[
			'.mail-search-error {',
			'\tborder-left: 3px solid var(--destructive);',
			'}',
			'.markdown-editor blockquote {',
			'\tborder-left: 3px solid var(--color-border);',
			'}',
		].join('\n'),
	)
	assert.deepEqual(
		results.map((result) => [result.kind, result.line]),
		[
			['css', 2],
			['css', 5],
		],
	)
})

test('rejects the audited one-sided inset shadows (folder, open row, keyboard cursor)', () => {
	const results = violations(
		'styles.css',
		[
			'.nav-item-active {',
			'\tbox-shadow: inset 1px 0 0 color-mix(in oklch, var(--foreground), transparent 80%);',
			'}',
			'.thread-row[data-nav-cursor="true"] {',
			'\tbox-shadow: inset 2px 0 0 var(--ring);',
			'}',
		].join('\n'),
	)
	assert.deepEqual(
		results.map((result) => result.kind),
		['inset-shadow', 'inset-shadow'],
	)
})

test('rejects rails on any side and in arbitrary-value or shadow utilities', () => {
	assert.equal(violations('a.tsx', 'className="border-t-2"').length, 1)
	assert.equal(violations('a.tsx', 'className="border-s-[3px]"').length, 1)
	assert.equal(violations('a.tsx', 'className="shadow-[inset_2px_0_0_red]"').length, 1)
	assert.equal(violations('a.css', 'border-inline-start-width: 4px;').length, 1)
	assert.equal(violations('a.css', 'box-shadow: inset 0 -2px 0 0 red;').length, 1)
})

test('allows uniform borders, 1px separators, and uniform outlines', () => {
	assert.deepEqual(
		violations(
			'features/mail/components/Row.tsx',
			'<div className="rounded-xl border border-border border-b border-t border-l-0 border-b-border" />',
		),
		[],
	)
	assert.deepEqual(
		violations(
			'styles.css',
			[
				'.row {',
				'\tborder: 1px solid var(--border);',
				'\tborder-bottom: 1px solid var(--border);',
				'\toutline: 2px solid var(--ring);',
				'\tbox-shadow: inset 0 0 0 1px var(--ring);',
				'}',
			].join('\n'),
		),
		[],
	)
})

test('has no exceptions: a rail inside the mobile tab indicator is rejected too', () => {
	const css = ['.mobile-tab::before {', '\tborder-top: 2px solid var(--primary);', '}'].join('\n')
	assert.equal(violations('styles.css', css).length, 1)
})

test('scans source and CSS but skips tests and email fixtures', () => {
	const root = mkdtempSync(join(tmpdir(), 'ownmail-accent-rails-'))
	try {
		const rail = 'export const rail = "border-l-4"\n'
		mkdirSync(join(root, 'features/mail/components/reader-fixtures'), { recursive: true })
		writeFileSync(join(root, 'styles.css'), '.a {\n\tborder-left: 3px solid red;\n}\n')
		writeFileSync(join(root, 'features/mail/components/Card.tsx'), rail)
		writeFileSync(join(root, 'features/mail/components/Card.test.tsx'), rail)
		writeFileSync(join(root, 'features/mail/components/reader-fixtures/sender.ts'), rail)
		writeFileSync(join(root, 'features/mail/components/email.browser.fixture.html'), rail)
		const result = checkOwnmailAccentRails(root)
		assert.equal(result.checkedFiles, 2)
		assert.deepEqual(
			result.violations.map((violation) => violation.kind),
			['tailwind', 'css'],
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
