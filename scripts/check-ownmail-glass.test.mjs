import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { checkOwnmailGlass, findGlassViolations } from './check-ownmail-glass.mjs'

const sourceRoot = resolve('/workspace/ownmail/src')

function violations(file, sourceText) {
	return findGlassViolations({ filePath: resolve(sourceRoot, file), sourceText })
}

function kinds(file, sourceText) {
	return violations(file, sourceText).map((violation) => violation.kind)
}

const BLUR = 'backdrop-filter: blur(var(--glass-blur)) saturate(1.15)'
const rule = (selector, body = BLUR) => `${selector} {\n\t${body};\n}`
const utility = (text) => `<div className="${text}" />`

test('allows a blurred backdrop in the two glass recipes and nowhere else', () => {
	for (const selector of [
		'.glass-panel',
		'.glass-bar::before',
		'.glass-bar[data-glass-edge="top"]::before',
		'.glass-bar::before,\n.glass-panel',
	]) {
		assert.deepEqual(violations('styles.css', rule(selector)), [], selector)
		assert.deepEqual(violations('styles.css', rule(selector, `-webkit-${BLUR}`)), [], selector)
	}
	for (const selector of [
		'.account-switch-overlay',
		// A recipe class is not a licence for its neighbours or descendants.
		'.glass-panel .menu-item',
		'.dialog-overlay.glass-panel-veil',
		'.glass-panelled',
		'.glass-bar::before,\n.mobile-tab-bar',
		'.sheet .glass-panel',
	]) {
		assert.deepEqual(kinds('styles.css', rule(selector)), ['outside-recipe'], selector)
		assert.deepEqual(kinds('styles.css', rule(selector, `-webkit-${BLUR}`)), ['outside-recipe'], selector)
	}
})

test('looks through media and supports wrappers to the rule that declares the blur', () => {
	const wrapped = (selector) =>
		`@media (min-width: 40rem) {\n\t@supports (backdrop-filter: blur(1px)) {\n${rule(selector)}\n\t}\n}`
	assert.deepEqual(violations('styles.css', wrapped('.glass-panel')), [])
	assert.deepEqual(kinds('styles.css', wrapped('.toolbar')), ['outside-recipe'])
})

test('always allows turning the blur off, which is how a surface leaves the glass layer', () => {
	for (const selector of [
		'.glass-panel-from-sm',
		'.event-composer-panel',
		'.glass-panel[data-glass="solid"]',
	]) {
		assert.deepEqual(violations('styles.css', rule(selector, 'backdrop-filter: none')), [], selector)
		assert.deepEqual(violations('styles.css', rule(selector, '-webkit-backdrop-filter: none !important')), [])
	}
})

test('rejects animating the blur: only opacity and position move on glass', () => {
	for (const body of [
		'transition: backdrop-filter 200ms ease',
		'transition-property: opacity, backdrop-filter',
		'will-change: backdrop-filter',
	]) {
		assert.deepEqual(kinds('styles.css', rule('.glass-panel', body)), ['animated-blur'], body)
	}
	// A keyframe is not a recipe selector, so a blur that changes over time is rejected there.
	assert.deepEqual(
		kinds(
			'styles.css',
			`@keyframes frost {\n\tfrom {\n\t\tbackdrop-filter: blur(0);\n\t}\n\tto {\n\t\t${BLUR};\n\t}\n}`,
		),
		['outside-recipe', 'outside-recipe'],
	)
	assert.deepEqual(violations('styles.css', rule('.glass-panel', 'transition: opacity 120ms ease')), [])
})

test('rejects backdrop utilities, arbitrary properties and inline styles in components', () => {
	for (const text of [
		utility('fixed inset-0 bg-background/80 backdrop-blur-sm'),
		utility('dialog-overlay backdrop-blur-[3px]'),
		utility('md:backdrop-blur'),
		utility('backdrop-saturate-150'),
		utility('backdrop-brightness-90'),
		utility('[backdrop-filter:blur(4px)]'),
		'<div style={{ backdropFilter: "blur(4px)" }} />',
		'<div style={{ WebkitBackdropFilter: "blur(4px)" }} />',
		'const veil = "backdrop-filter: blur(2px)"',
	]) {
		assert.deepEqual(kinds('app/components/Veil.tsx', text), ['outside-recipe'], text)
	}
})

test('leaves the recipe classes and unrelated backdrop names alone in components', () => {
	for (const text of [
		utility('glass-panel absolute right-0 z-50 w-52 p-1'),
		utility('glass-bar sticky top-0 z-30'),
		utility('sheet-backdrop fixed inset-0 bg-foreground/25'),
		'<DialogContent onBackdropClick={close} />',
		'const backdropPending = pending && !selected',
	]) {
		assert.deepEqual(violations('shared/components/Sheet.tsx', text), [], text)
	}
})

test('ignores CSS comments and reports the line, column and declaration', () => {
	const css = `/* was: backdrop-filter: blur(2px) */\n.veil {\n\tbackground: var(--card);\n\t${BLUR};\n}\n`
	const found = violations('styles.css', css)
	assert.deepEqual(
		found.map(({ line, column, kind }) => [line, column, kind]),
		[[4, 2, 'outside-recipe']],
	)
	assert.equal(found[0].match, BLUR)
})

test('scans source and CSS but skips tests and email fixtures', () => {
	const root = mkdtempSync(join(tmpdir(), 'ownmail-glass-'))
	try {
		const veil = 'export const veil = "backdrop-blur-sm"\n'
		mkdirSync(join(root, 'features/mail/components/reader-fixtures'), { recursive: true })
		writeFileSync(join(root, 'styles.css'), `${rule('.glass-panel')}\n${rule('.veil')}\n`)
		writeFileSync(join(root, 'features/mail/components/Veil.tsx'), veil)
		writeFileSync(join(root, 'features/mail/components/Veil.test.tsx'), veil)
		writeFileSync(join(root, 'features/mail/components/reader-fixtures/sender.ts'), veil)
		writeFileSync(join(root, 'features/mail/components/email.browser.fixture.html'), veil)
		writeFileSync(join(root, 'dev-mocks.ts'), veil)
		const result = checkOwnmailGlass(root)
		assert.equal(result.checkedFiles, 2)
		assert.deepEqual(
			result.violations.map((violation) => [violation.kind, violation.match]),
			[
				['outside-recipe', 'backdrop-blur-sm'],
				['outside-recipe', BLUR],
			],
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
