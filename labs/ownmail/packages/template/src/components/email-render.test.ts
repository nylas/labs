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
	scaledHeight,
	shadowStyleText,
	subscribeLinkPreview,
} from './email-render.js'

describe('emailSupportsDarkMode', () => {
	it('detects a prefers-color-scheme media query', () => {
		expect(emailSupportsDarkMode('<style>@media (prefers-color-scheme: dark){}</style>')).toBe(true)
	})

	it('detects a declared color-scheme', () => {
		expect(emailSupportsDarkMode('<div style="color-scheme:dark">x</div>')).toBe(true)
	})

	it('returns false for an email with no dark-mode signals', () => {
		expect(emailSupportsDarkMode('<p>Just some plain text</p>')).toBe(false)
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

	it('forwards preview hrefs and stops after unsubscribing', () => {
		const el = document.createElement('div')
		const onChange = vi.fn()
		const unsubscribe = subscribeLinkPreview(el, onChange)

		el.dispatchEvent(new CustomEvent(LINK_PREVIEW_EVENT, { detail: { href: 'https://a.com' } }))
		expect(onChange).toHaveBeenCalledWith('https://a.com')

		unsubscribe()
		el.dispatchEvent(new CustomEvent(LINK_PREVIEW_EVENT, { detail: { href: 'https://b.com' } }))
		expect(onChange).toHaveBeenCalledTimes(1)
	})
})

describe('EMAIL_ELEMENT_TAG', () => {
	it('is a valid custom-element name (contains a hyphen)', () => {
		expect(EMAIL_ELEMENT_TAG).toContain('-')
	})
})
