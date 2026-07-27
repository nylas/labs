// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	applyDarkInvert,
	applyEmailHtml,
	computeScale,
	EMAIL_ELEMENT_TAG,
	emailSupportsDarkMode,
	LINK_PREVIEW_EVENT,
	linkPreviewText,
	previewBoxStyle,
	scaledHeight,
	shadowStyleText,
	subscribeLinkPreview,
} from './email-render.js'

describe('emailSupportsDarkMode', () => {
	it('detects a prefers-color-scheme media query', () => {
		expect(emailSupportsDarkMode('<style>@media (prefers-color-scheme: dark){}</style>')).toBe(true)
	})

	it('does not treat a bare color-scheme declaration as adaptive dark styles', () => {
		expect(emailSupportsDarkMode('<meta name="color-scheme" content="light dark"><p>x</p>')).toBe(false)
		expect(emailSupportsDarkMode('<div style="color-scheme:dark">x</div>')).toBe(false)
	})

	it('returns false for an email with no dark-mode signals', () => {
		expect(emailSupportsDarkMode('<p>Just some plain text</p>')).toBe(false)
	})

	it('treats the supplied Slack-style hard-coded white canvas as light-only', () => {
		// Regression distilled from message-89f72564-5f08-4548-8f4b-bdb140b7acaf.eml:
		// the real message has responsive media rules but no adaptive color rule.
		const slackLightOnly = `
			<style>
				body { background: #fff; color: #434245; }
				@media only screen and (max-width: 600px) { .sm_full_width { width: 100% !important; } }
			</style>
			<table class="background_main" style="background-color:#ffffff;color:#434245"><tr><td>Trial</td></tr></table>
		`
		expect(emailSupportsDarkMode(slackLightOnly)).toBe(false)
	})
})

describe('computeScale', () => {
	it('does not scale when either dimension is unmeasured', () => {
		expect(computeScale(0, 500)).toBe(1)
		expect(computeScale(600, 0)).toBe(1)
	})

	it('never upscales content narrower than the pane', () => {
		expect(computeScale(400, 800)).toBe(1)
	})

	it('shrinks content wider than the pane to fit', () => {
		expect(computeScale(600, 300)).toBe(0.5)
		expect(computeScale(800, 400)).toBe(0.5)
	})
})

describe('scaledHeight', () => {
	it('scales the natural height and rounds up so nothing is clipped', () => {
		expect(scaledHeight(1000, 0.5)).toBe(500)
		expect(scaledHeight(1001, 0.5)).toBe(501)
	})
})

describe('linkPreviewText', () => {
	it('trims and returns short URLs unchanged', () => {
		expect(linkPreviewText('  https://example.com/path  ')).toBe('https://example.com/path')
	})

	it('truncates very long URLs with an ellipsis', () => {
		const long = `https://example.com/${'a'.repeat(200)}`
		const result = linkPreviewText(long)
		expect(result).toHaveLength(120)
		expect(result.endsWith('…')).toBe(true)
	})
})

describe('shadowStyleText', () => {
	it('scopes to the host and defines the dark inversion', () => {
		const css = shadowStyleText()
		expect(css).toContain(':host')
		expect(css).toContain('data-dark-invert')
		expect(css).toContain('invert(1)')
		expect(css).toContain(':host([data-dark-invert]){color-scheme:dark;filter:invert(1)')
		expect(css).not.toContain(':host([data-dark-invert]) .email-root{filter:')
	})

	it('contains provider layout and pins host positioning below the untrusted CSS cascade', () => {
		const css = shadowStyleText()
		expect(css).toContain('position:static!important')
		expect(css).toContain('inset:auto!important')
		expect(css).toContain('z-index:auto!important')
		expect(css).toContain('contain:layout paint')
		expect(css).toContain('overflow:hidden')
		expect(css).toContain('.email-root{')
		expect(css).toContain('contain:none!important')
		expect(css).toContain('overflow:visible!important')
	})

	it('uses zero-specificity email resets so sender rules can override the safe defaults', () => {
		const css = shadowStyleText()

		expect(css).toContain(':where(.email-root) :where(*, *::before, *::after){box-sizing:border-box;}')
		expect(css).toContain(':where(.email-root) :where(body){margin:0;}')
		expect(css).toContain(':where(.email-root) :where(img, video, svg){max-width:100%;height:auto;}')
		expect(css).toContain(':where(.email-root) :where(pre){max-width:100%;white-space:pre-wrap;')
		expect(css).not.toContain('.email-root body{margin:0!important')
	})
})

describe('applyEmailHtml', () => {
	it('is a no-op when the element is not yet mounted', () => {
		expect(() => applyEmailHtml(null, '<p>x</p>')).not.toThrow()
	})

	it('pushes html onto a mounted element', () => {
		const element = { emailHtml: '' } as { emailHtml: string } & EventTarget
		applyEmailHtml(element, '<p>hi</p>')
		expect(element.emailHtml).toBe('<p>hi</p>')
	})
})

describe('applyDarkInvert', () => {
	afterEach(() => vi.restoreAllMocks())

	it('is a no-op when the element is not yet mounted', () => {
		expect(() => applyDarkInvert(null, true)).not.toThrow()
	})

	it('sets the attribute when inverting and removes it otherwise', () => {
		const el = document.createElement('div')
		applyDarkInvert(el, true)
		expect(el.hasAttribute('data-dark-invert')).toBe(true)
		applyDarkInvert(el, false)
		expect(el.hasAttribute('data-dark-invert')).toBe(false)
	})
})

describe('subscribeLinkPreview', () => {
	it('returns a no-op unsubscribe when there is no element', () => {
		const unsubscribe = subscribeLinkPreview(null, vi.fn())
		expect(() => unsubscribe()).not.toThrow()
	})

	it('forwards the preview detail and stops after unsubscribing', () => {
		const el = document.createElement('div')
		const onChange = vi.fn()
		const unsubscribe = subscribeLinkPreview(el, onChange)

		const detail = { href: 'https://a.com', x: 40, y: 60 }
		el.dispatchEvent(new CustomEvent(LINK_PREVIEW_EVENT, { detail }))
		expect(onChange).toHaveBeenCalledWith(detail)

		unsubscribe()
		el.dispatchEvent(new CustomEvent(LINK_PREVIEW_EVENT, { detail: { href: 'https://b.com', x: 0, y: 0 } }))
		expect(onChange).toHaveBeenCalledTimes(1)
	})
})

describe('previewBoxStyle', () => {
	const viewport = { width: 1000, height: 800 }

	it('places the box below-right of a pointer in the top-left quadrant', () => {
		expect(previewBoxStyle({ x: 100, y: 100 }, viewport)).toEqual({
			left: 116,
			top: 116,
			transform: 'translate(0, 0)',
		})
	})

	it('flips the box above-left when the pointer is in the bottom-right quadrant', () => {
		expect(previewBoxStyle({ x: 900, y: 700 }, viewport)).toEqual({
			left: 884,
			top: 684,
			transform: 'translate(-100%, -100%)',
		})
	})
})

describe('EMAIL_ELEMENT_TAG', () => {
	it('is a valid custom-element name (contains a hyphen)', () => {
		expect(EMAIL_ELEMENT_TAG).toContain('-')
	})
})
