import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
	checkOwnmailAccentRails,
	findAccentRailViolations,
	lengthInPx,
} from './check-ownmail-accent-rails.mjs'

const sourceRoot = resolve('/workspace/ownmail/src')

function violations(file, sourceText) {
	return findAccentRailViolations({ filePath: resolve(sourceRoot, file), sourceText })
}

function kinds(file, sourceText) {
	return violations(file, sourceText).map((violation) => violation.kind)
}

const declaration = (text) => `.a {\n\t${text};\n}`
const utility = (text) => `<div className="${text}" />`

function rejects(file, wrap, kind, cases) {
	for (const text of cases) assert.deepEqual(kinds(file, wrap(text)), [kind], text)
}

function allows(file, wrap, cases) {
	for (const text of cases) assert.deepEqual(violations(file, wrap(text)), [], text)
}

test('parses px, rem and em lengths to pixels and nothing else', () => {
	const cases = [
		['0', 0],
		['0.0', 0],
		['2px', 2],
		['2.5px', 2.5],
		['.5px', 0.5],
		['-2px', -2],
		['0.125rem', 2],
		['0.2rem', 3.2],
		['.25em', 4],
		['1rem', 16],
		['2', null],
		['50%', null],
		['1vw', null],
		['var(--w)', null],
		['calc(1px + 1px)', null],
		['solid', null],
	]
	for (const [token, px] of cases) assert.equal(lengthInPx(token), px, token)
})

// The audited instances, as they were written before they were removed.
test('rejects every audited instance', () => {
	const audited = [
		['a.tsx', '<div className="border-l-4 border-l-primary px-4 py-4 sm:px-5">', ['tailwind', 'tailwind']],
		['styles.css', declaration('border-left: 3px solid var(--destructive)'), ['css']],
		['styles.css', declaration('border-left: 3px solid var(--color-border)'), ['css']],
		[
			'styles.css',
			declaration('box-shadow: inset 1px 0 0 color-mix(in oklch, var(--foreground), transparent 80%)'),
			['inset-shadow'],
		],
		['styles.css', declaration('box-shadow: inset 2px 0 0 var(--ring)'), ['inset-shadow']],
		['styles.css', declaration('box-shadow: inset 0 -2px 0 var(--destructive)'), ['inset-shadow']],
		[
			'styles.css',
			'.app-rail-item-indicator {\n\tposition: absolute;\n\twidth: 2px;\n\theight: 0.875rem;\n}',
			['edge-bar'],
		],
		['styles.css', '.mobile-tab::before {\n\twidth: 1.75rem;\n\theight: 2px;\n}', ['edge-bar']],
		['a.tsx', "<div className={cn('h-1.5 w-full', eventBarClass(tone))} />", ['edge-strip']],
		['a.tsx', "<div className={cn('h-1 w-full shrink-0', eventBarClass(tone))} />", ['edge-strip']],
	]
	for (const [file, text, expected] of audited) assert.deepEqual(kinds(file, text), expected, text)
})

test('rejects one-sided CSS borders 2px or wider on any physical or logical side, in any unit', () => {
	rejects('styles.css', declaration, 'css', [
		'border-left: 2px solid red',
		'border-right: 3px solid red',
		'border-top: 10px solid red',
		'border-bottom: 2.5px dashed red',
		'border-left: 0.125rem solid red',
		'border-left: .25em solid red',
		'border-inline-start: 0.2rem solid red',
		'border-inline-end: 4px solid red',
		'border-block-start: 2px solid red',
		'border-block-end: 2px solid red',
		'border-left: solid 3px red',
		'border-left: red 3px solid',
		'border-left: thick solid red',
		'border-left: medium solid red',
		// No width means `medium`, which is 3px.
		'border-left: solid red',
		'border-left-width: 2px',
		'border-inline-start-width: 0.25rem',
		'border-block-end-width: 0.125rem',
		'border-top-width: thick',
		// One axis is the CSS form of `border-x-*` / `border-y-*`.
		'border-inline: 3px solid red',
		'border-block: 0.25rem solid red',
		'border-inline-width: 4px',
		'border-inline-width: 0 4px',
		'border-block-width: 2px 0',
		// The four-side shorthand when the sides differ.
		'border-width: 0 0 0 4px',
		'border-width: 1px 1px 1px 3px',
		'border-width: 0 0.125rem',
		'border-width: 1px thick',
		'border-left: 3px solid red !important',
	])
	// Inline styles and CSS strings in components.
	assert.deepEqual(kinds('a.tsx', "<div style={{ borderLeft: '3px solid red' }} />"), ['css'])
	assert.deepEqual(kinds('a.tsx', "<div style={{ borderInlineStartWidth: '0.25rem' }} />"), ['css'])
	assert.deepEqual(kinds('a.ts', "const css = 'border-left: 0.2rem solid red'"), ['css'])
})

test('rejects a one-sided border in an accent colour even at one pixel', () => {
	rejects('styles.css', declaration, 'css', [
		'border-left: 1px solid var(--destructive)',
		'border-left: 1px solid red',
		'border-top-color: var(--primary)',
		'border-inline-start-color: #f00',
		'border-bottom: 1px solid color-mix(in oklch, var(--primary), var(--border))',
	])
})

test('allows hairline separators, uniform borders and borders that are switched off', () => {
	allows('styles.css', declaration, [
		'border: 1px solid var(--border)',
		'border: 2px solid var(--ring)',
		'border: 4px solid red',
		'border-top: 1px solid var(--border)',
		'border-bottom: 1px solid var(--color-border)',
		'border-right: 1px solid var(--sidebar-border)',
		'border-left: 0.0625rem solid var(--border)',
		'border-left: thin solid var(--border)',
		'border-bottom: 1px solid color-mix(in oklch, var(--border), transparent 20%)',
		'border-left: 1px solid transparent',
		'border-left: 1px solid',
		'border-left: 0',
		'border-left: none',
		'border-left: 3px none red',
		'border-left-width: 0',
		'border-left-width: 1px',
		'border-inline-start-width: 0.0625rem',
		'border-inline-width: 1px',
		'border-block-width: 0 1px',
		'border-top-color: var(--border)',
		'border-top-color: transparent',
		'border-left-style: solid',
		'border-width: 1px',
		'border-width: 2px',
		'border-width: 2px 2px 2px 2px',
		'border-width: 0 0 1px',
		'border-width: 1px 0',
		'border-radius: 0 0 4px 4px',
		'border-top-left-radius: 4px',
		'outline: 2px solid var(--ring)',
		'--card-border-left: 3px solid red',
	])
	assert.deepEqual(violations('styles.css', '.a {\n\t/* border-left: 3px solid red; */\n}'), [])
	assert.deepEqual(violations('a.tsx', "<div style={{ borderLeft: '1px solid var(--border)' }} />"), [])
})

test('does not mistake TypeScript types and assignments for CSS declarations', () => {
	allows('a.ts', (text) => text, [
		'type Style = { borderWidth: number | string }',
		'type Style = { borderLeft?: string | undefined; boxShadow: string }',
		'const boxShadow: ShadowToken = tokens.sm',
		'function rail({ borderLeftWidth: width }: Props) {}',
		'const style = { borderWidth: size === 1 ? narrow : wide }',
	])
	// A real value in the same position is still read, in either comment style for the allow note.
	assert.deepEqual(kinds('a.ts', "const style = { borderWidth: '0 0 0 4px' }"), ['css'])
	assert.deepEqual(kinds('a.ts', "const style = { borderLeftWidth: 'var(--rail)' }"), ['unverifiable'])
	assert.deepEqual(
		violations(
			'a.ts',
			"// accent-rails-allow: resolves to the 1px hairline\nconst style = { borderLeftWidth: 'var(--rail)' }",
		),
		[],
	)
})

test('treats one-sided widths it cannot evaluate as violations unless explicitly allowed', () => {
	rejects('styles.css', declaration, 'unverifiable', [
		'border-left-width: var(--rail)',
		'border-inline-start-width: calc(1px + 1px)',
		'border-left: var(--rail-border)',
		'border-width: 0 0 0 var(--rail)',
		'border-inline-width: 0 var(--rail)',
		'box-shadow: inset var(--rail) 0 0 red',
		'box-shadow: inset 0 calc(-1 * var(--rail)) 0 0 red',
	])
	assert.deepEqual(kinds('a.tsx', utility('border-l-[var(--rail)]')), ['unverifiable'])
	assert.deepEqual(kinds('a.tsx', utility('border-l-[length:var(--rail)]')), ['unverifiable'])

	const allowedAbove =
		'.a {\n\t/* accent-rails-allow: 1px hairline token */\n\tborder-left-width: var(--hairline);\n}'
	const allowedInline =
		'.a {\n\tborder-left-width: var(--hairline); /* accent-rails-allow: 1px hairline token */\n}'
	assert.deepEqual(violations('styles.css', allowedAbove), [])
	assert.deepEqual(violations('styles.css', allowedInline), [])
	// A reason is required, the comment must be adjacent, and it never excuses a readable width.
	assert.deepEqual(
		kinds('styles.css', '.a {\n\t/* accent-rails-allow: */\n\tborder-left-width: var(--hairline);\n}'),
		['unverifiable'],
	)
	assert.deepEqual(
		kinds(
			'styles.css',
			'.a {\n\t/* accent-rails-allow: far away */\n\tcolor: red;\n\tborder-left-width: var(--hairline);\n}',
		),
		['unverifiable'],
	)
	assert.deepEqual(
		kinds('styles.css', '.a {\n\t/* accent-rails-allow: no */\n\tborder-left: 3px solid red;\n}'),
		['css'],
	)
})

test('rejects inset shadows with any offset and no blur, in every syntax', () => {
	rejects('styles.css', declaration, 'inset-shadow', [
		'box-shadow: inset 2px 0 0 red',
		'box-shadow: inset 2px 0 red',
		'box-shadow: inset -3px 0 0 0 red',
		'box-shadow: inset 0 -2px 0 red',
		'box-shadow: inset 0 2px 0 0 red',
		'box-shadow: inset 0 -1px 0 color-mix(in oklch, var(--primary), transparent 35%)',
		'box-shadow: inset 0.5px 0 0 red',
		'box-shadow: inset 0 -0.125rem 0 red',
		'box-shadow: inset 0.2em 0 0 red',
		'box-shadow: inset 2px 2px 0 red',
		'box-shadow: inset 2px 0 0 1px red',
		'box-shadow: red 2px 0 0 inset',
		'box-shadow: 0 1px 2px rgb(0 0 0 / 10%), inset 3px 0 0 red',
		'box-shadow:\n\t\t0 1px 2px red,\n\t\tinset 0 -2px 0 red',
	])
	rejects('a.tsx', utility, 'inset-shadow', [
		'shadow-[inset_2px_0_0_red]',
		'shadow-[inset_0_-2px_0_var(--destructive)]',
		'shadow-[inset_0.125rem_0_0_red]',
		'md:shadow-[0_1px_2px_red,inset_3px_0_0_red]',
		'inset-shadow-[2px_0_0_red]',
	])
	assert.deepEqual(kinds('a.tsx', "<div style={{ boxShadow: 'inset 2px 0 0 red' }} />"), ['inset-shadow'])
})

test('allows uniform inset rings, soft inset shadows and outer shadows', () => {
	allows('styles.css', declaration, [
		'box-shadow: inset 0 0 0 1px var(--destructive)',
		'box-shadow: inset 0 0 0 2px var(--ring)',
		'box-shadow: inset 0 0 0 0.125rem var(--ring)',
		'box-shadow: inset 0 1px 2px rgb(0 0 0 / 10%)',
		'box-shadow: inset 0 2px 0.5rem red',
		'box-shadow: 0 1px 2px red',
		'box-shadow: 2px 0 0 red',
		'box-shadow: 0 1px 2px red, 0 12px 36px red',
		'box-shadow: none',
		'box-shadow: var(--shadow)',
		'box-shadow: inset 0 0 0 1px red, 0 1px 2px red',
		'box-shadow: var(--ring-colour) 0 0 0 1px inset',
		'box-shadow: inset 0 0 0 var(--ring-width) red',
		'box-shadow: inset 0 0 var(--ring-colour)',
	])
	allows('a.tsx', utility, [
		'shadow-[inset_0_0_0_1px_red]',
		'shadow-[0_1px_2px_red]',
		'shadow-[inset_0_1px_2px_red]',
		'inset-shadow-[0_0_0_1px_red]',
		'shadow-sm shadow-xs inset-shadow-sm',
	])
})

test('rejects one-sided and one-axis Tailwind border utilities used as accents', () => {
	rejects('a.tsx', utility, 'tailwind', [
		'border-l-2',
		'border-l-4',
		'border-r-8',
		'border-t-2',
		'border-b-2',
		'border-s-4',
		'border-e-2',
		'border-x-4',
		'border-y-2',
		'border-l-[3px]',
		'border-l-[2.5px]',
		'border-s-[0.25rem]',
		'border-t-[0.125rem]',
		'border-x-[2px]',
		'border-l-[length:3px]',
		'md:border-l-4',
		'hover:border-b-2',
		'border-l-primary',
		'border-b-destructive/50',
		'border-t-transparent',
		'border-l-[#ff0000]',
		'border-x-primary',
	])
})

test('allows Tailwind hairlines, resets, separator colours and uniform borders', () => {
	allows('a.tsx', utility, [
		'rounded-xl border border-border',
		'border-2 border-ring',
		'border-b border-t border-l border-x border-y',
		'border-l-0 border-b-0 border-x-0',
		'border-l-1',
		'border-l-[1px]',
		'border-s-[0.0625rem]',
		'border-b-border border-t-border/60',
		'border-solid border-spacing-2 border-separate border-collapse',
		'rounded-l-lg rounded-t-[3px]',
		'ring-2 ring-inset ring-ring outline-2',
	])
})

test('rejects absolutely positioned and pseudo-element bars 2 to 4px thick in one dimension', () => {
	const bar = (selector, body) => `${selector} {\n\t${body.join(';\n\t')};\n}`
	const cases = [
		['.a', ['position: absolute', 'width: 2px', 'height: 0.875rem']],
		['.a', ['position: absolute', 'width: 4px']],
		['.a', ['position: absolute', 'width: 2.5px', 'height: 100%']],
		['.a', ['position: absolute', 'height: 0.2rem', 'width: 100%']],
		['.a', ['position: absolute', 'height: 0.125rem']],
		['.a', ['position: absolute', 'height: .25em', 'width: 2rem']],
		['.a', ['position: absolute', 'inline-size: 3px', 'block-size: 1rem']],
		['.a::before', ['content: ""', 'height: 2px', 'width: 1.75rem']],
		['.a::after', ['height: 0.25rem', 'width: 100%']],
		['.a', ['position: absolute', 'width: 3px', 'height: 1px']],
		['.a', ['position: absolute', 'width: 3px', 'height: var(--h)']],
	]
	for (const [selector, body] of cases) {
		assert.deepEqual(kinds('styles.css', bar(selector, body)), ['edge-bar'], body.join('; '))
	}
	const [located] = violations('styles.css', bar('.a', ['position: absolute', 'left: 0', 'width: 2px']))
	assert.equal(located.line, 4)
	assert.equal(located.match, 'width: 2px')
})

test('allows hairlines, dots, thumbs, thicker blocks and thin boxes in normal flow', () => {
	const rule = (selector, body) => `${selector} {\n\t${body.join(';\n\t')};\n}`
	const cases = [
		['.mail-header::after', ['position: absolute', 'right: 0', 'left: 0', 'height: 1px', 'content: ""']],
		['.a::after', ['height: 0.0625rem', 'width: 100%']],
		['.a', ['position: absolute', 'height: 1.9px']],
		['.a', ['position: absolute', 'height: 4.1px']],
		['.a', ['position: absolute', 'height: 0.3rem']],
		['.thread-row::before', ['position: absolute', 'width: 5px', 'height: 5px']],
		['.dot::before', ['width: 4px', 'height: 4px']],
		['.dot::before', ['width: 0.2rem', 'height: 3px']],
		['.toggle-thumb', ['position: absolute', 'top: 2px', 'width: 1rem', 'height: 1rem']],
		['.progress', ['height: 2px', 'min-height: 2px', 'background: var(--primary)']],
		['.panel', ['position: absolute', 'max-width: 4px', 'min-height: 3px', 'line-height: 2px']],
		['.panel', ['position: absolute', 'width: var(--w)', 'height: calc(100% - 2px)']],
		['.panel', ['position: absolute', 'width: 50%', 'height: 2vw']],
	]
	for (const [selector, body] of cases) {
		assert.deepEqual(violations('styles.css', rule(selector, body)), [], `${selector} ${body.join('; ')}`)
	}
	// Bars are a CSS-only check: the same text in a component is not parsed as rules.
	assert.deepEqual(violations('a.tsx', 'const css = ".a { position: absolute; width: 2px; }"'), [])
})

test('rejects full-width thin colour strips built from Tailwind utilities', () => {
	rejects('a.tsx', (text) => text, 'edge-strip', [
		"<div className={cn('h-1.5 w-full', eventBarClass(tone))} />",
		'<div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />',
		'<span className="h-1 w-full bg-event-teal" />',
	])
})

test('allows swatches, dots, skeleton lines and unfilled spacers', () => {
	allows('a.tsx', (text) => text, [
		"<span className={cn('h-[11px] w-[11px] shrink-0 rounded-[3px]', eventDotClass(tone))} />",
		"<span className={cn('h-2 w-2 rounded-full', eventDotClass(tone))} />",
		'<div className="h-4 w-full animate-pulse rounded bg-muted" />',
		'<div className="h-1 w-full" />',
		'<div className="h-1 w-full bg-transparent" />',
		'<div className="h-11 w-full bg-card md:h-1" />',
		'<div className="min-h-1 w-full bg-card" />',
	])
})

test('reports the line and column of each violation in source order', () => {
	const css = [
		'.a {',
		'\tcolor: red;',
		'\tborder-left: 3px solid red;',
		'\tbox-shadow: inset 2px 0 0 red;',
		'}',
	]
	const found = violations('styles.css', css.join('\n'))
	assert.deepEqual(
		found.map(({ line, column, kind }) => [line, column, kind]),
		[
			[3, 2, 'css'],
			[4, 2, 'inset-shadow'],
		],
	)
	assert.equal(found[0].match, 'border-left: 3px solid red')
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
		writeFileSync(join(root, 'dev-mocks.ts'), rail)
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
