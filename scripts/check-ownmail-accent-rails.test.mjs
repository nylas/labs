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

// Review finding: the search field marked an invalid query with a 2px bottom shadow.
test('rejects vertical one-sided inset shadows with and without the spread length', () => {
	for (const shadow of [
		'inset 0 -2px 0 var(--destructive)',
		'inset 0 -1px 0 color-mix(in oklch, var(--primary), transparent 35%)',
		'inset 0 2px 0 0 red',
		'inset 0 -0.125rem 0 red',
	]) {
		const [violation] = violations('styles.css', `.a {\n\tbox-shadow: ${shadow};\n}`)
		assert.equal(violation?.kind, 'inset-shadow', shadow)
		assert.equal(violation?.line, 2)
	}
})

test('rejects horizontal one-sided inset shadows with and without the spread length', () => {
	for (const shadow of ['inset 2px 0 0 red', 'inset -3px 0 0 0 red', 'inset 0.25rem 0 0 red']) {
		assert.equal(violations('styles.css', `.a {\n\tbox-shadow: ${shadow};\n}`).length, 1, shadow)
	}
})

test('allows uniform inset rings and soft inset shadows', () => {
	for (const shadow of [
		'inset 0 0 0 1px var(--destructive)',
		'inset 0 0 0 2px var(--ring)',
		'inset 0 1px 2px rgb(0 0 0 / 10%)',
		'inset 0 2px 0.5rem red',
		'0 1px 2px red',
	]) {
		assert.deepEqual(violations('styles.css', `.a {\n\tbox-shadow: ${shadow};\n}`), [], shadow)
	}
})

// Review finding: the desktop rail drew a 2px bar beside the active destination.
test('rejects absolutely positioned and pseudo-element bars 2 to 4px thick', () => {
	const indicator = [
		'.app-rail-item-indicator {',
		'\tposition: absolute;',
		'\tleft: -0.5rem;',
		'\twidth: 2px;',
		'\theight: 0.875rem;',
		'\tbackground: var(--foreground);',
		'}',
	].join('\n')
	const [bar] = violations('styles.css', indicator)
	assert.equal(bar?.kind, 'edge-bar')
	assert.equal(bar?.line, 4)
	assert.equal(bar?.match, 'width: 2px')

	// The former mobile tab indicator: its colour was set by a second rule.
	const tab = ['.mobile-tab::before {', '\twidth: 1.75rem;', '\theight: 2px;', '\tcontent: "";', '}'].join(
		'\n',
	)
	assert.equal(violations('styles.css', tab)[0]?.match, 'height: 2px')
	assert.equal(violations('styles.css', '.a::after { height: 0.25rem; width: 100%; }').length, 1)
	assert.equal(violations('styles.css', '.a { position: absolute; width: 4px; }').length, 1)
	// Only CSS is parsed for bars; a border rail inside the pseudo-element is still a border rail.
	assert.equal(violations('styles.css', '.a::before {\n\tborder-top: 2px solid red;\n}')[0]?.kind, 'css')
})

test('allows hairlines, dots, thumbs and thin boxes that are in normal flow', () => {
	const css = [
		'.mail-header::after {',
		'\tposition: absolute;',
		'\tright: 0;',
		'\tbottom: 0;',
		'\tleft: 0;',
		'\theight: 1px;',
		'\tbackground: var(--border);',
		'\tcontent: "";',
		'}',
		'.thread-row::before {',
		'\tposition: absolute;',
		'\twidth: 5px;',
		'\theight: 5px;',
		'}',
		'.dot::before {',
		'\twidth: 4px;',
		'\theight: 4px;',
		'}',
		'.toggle-thumb {',
		'\tposition: absolute;',
		'\ttop: 2px;',
		'\twidth: 1rem;',
		'\theight: 1rem;',
		'\tbackground: var(--card);',
		'}',
		'.progress {',
		'\theight: 2px;',
		'\tmin-height: 2px;',
		'\tbackground: var(--primary);',
		'}',
		'.panel {',
		'\tposition: absolute;',
		'\tmax-width: 4px;',
		'\tline-height: 2px;',
		'}',
	].join('\n')
	assert.deepEqual(violations('styles.css', css), [])
	// Bars are a CSS-only check: the same text in a component is not parsed as rules.
	assert.deepEqual(violations('a.tsx', 'const css = ".a { position: absolute; width: 2px; }"'), [])
})

// Review finding: the event dialogs drew the calendar colour as a strip across their top edge.
test('rejects full-width thin colour strips built from Tailwind utilities', () => {
	for (const line of [
		"<div className={cn('h-1.5 w-full', eventBarClass(tone))} />",
		"<div className={cn('h-1 w-full shrink-0', eventBarClass(selectedCalendarTone))} />",
		'<div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />',
		'<span className="h-1 w-full bg-event-teal" />',
	]) {
		const [violation] = violations('features/calendar/components/EventModal.tsx', line)
		assert.equal(violation?.kind, 'edge-strip', line)
	}
})

test('allows swatches, dots, skeleton lines and unfilled spacers', () => {
	for (const line of [
		"<span className={cn('h-[11px] w-[11px] shrink-0 rounded-[3px]', eventDotClass(tone))} />",
		"<span className={cn('h-2 w-2 rounded-full', eventDotClass(tone))} />",
		'<div className="h-4 w-full animate-pulse rounded bg-muted" />',
		'<div className="h-1 w-full" />',
		'<div className="h-1 w-full bg-transparent" />',
		'<div className="h-11 w-full bg-card md:h-1" />',
		'<div className="min-h-1 w-full bg-card" />',
	]) {
		assert.deepEqual(violations('routes/calendar.tsx', line), [], line)
	}
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
