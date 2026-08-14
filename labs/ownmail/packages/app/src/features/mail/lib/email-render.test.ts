// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	applyDarkInvert,
	applyEmailHtml,
	applyEmailLayoutMode,
	computeScale,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	emailSupportsDarkMode,
	LINK_PREVIEW_EVENT,
	linkPreviewText,
	meaningfulContentWidth,
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

describe('meaningfulContentWidth', () => {
	function rect(left: number, width: number, height = 20): DOMRect {
		return {
			left,
			right: left + width,
			top: 0,
			bottom: height,
			width,
			height,
			x: left,
			y: 0,
			toJSON: () => ({}),
		}
	}

	it('counts a visible fixed-width table in normal flow', () => {
		const root = document.createElement('div')
		const table = document.createElement('table')
		root.append(table)
		root.getBoundingClientRect = () => rect(100, 300)
		table.getClientRects = () => [rect(120, 600)] as unknown as DOMRectList

		expect(meaningfulContentWidth(root)).toBe(620)
	})

	it('ignores invisible and offscreen positioned preheader artifacts', () => {
		const root = document.createElement('div')
		const visible = document.createElement('table')
		const hidden = document.createElement('div')
		const offscreen = document.createElement('div')
		hidden.style.display = 'none'
		offscreen.style.position = 'absolute'
		root.append(visible, hidden, offscreen)
		root.getBoundingClientRect = () => rect(100, 300)
		visible.getClientRects = () => [rect(120, 280)] as unknown as DOMRectList
		hidden.getClientRects = () => [rect(120, 4_000)] as unknown as DOMRectList
		offscreen.getClientRects = () => [rect(10_000, 1)] as unknown as DOMRectList

		expect(meaningfulContentWidth(root)).toBe(300)
	})

	it('inherits hidden and positioned state from off-canvas ancestors', () => {
		const root = document.createElement('div')
		const preheader = document.createElement('div')
		const nested = document.createElement('span')
		preheader.style.position = 'absolute'
		preheader.append(nested)
		root.append(preheader)
		root.getBoundingClientRect = () => rect(100, 300)
		preheader.getClientRects = () => [rect(10_000, 1)] as unknown as DOMRectList
		nested.getClientRects = () => [rect(10_000, 5_000)] as unknown as DOMRectList

		expect(meaningfulContentWidth(root)).toBe(300)

		preheader.style.position = 'static'
		preheader.style.opacity = '0'
		nested.getClientRects = () => [rect(120, 5_000)] as unknown as DOMRectList
		expect(meaningfulContentWidth(root)).toBe(300)
	})

	it('ignores text ranges clipped by a zero-height preheader', () => {
		const root = document.createElement('div')
		const preheader = document.createElement('div')
		preheader.style.maxHeight = '0'
		preheader.style.overflow = 'hidden'
		preheader.style.whiteSpace = 'nowrap'
		preheader.textContent = 'A very long hidden preview line'
		root.append(preheader)
		root.getBoundingClientRect = () => rect(100, 300)
		preheader.getBoundingClientRect = () => rect(100, 4_000, 0)
		preheader.getClientRects = () => [rect(100, 4_000, 0)] as unknown as DOMRectList
		const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
		Object.defineProperty(Range.prototype, 'getClientRects', {
			configurable: true,
			value: () => [rect(100, 4_000)] as unknown as DOMRectList,
		})

		try {
			expect(meaningfulContentWidth(root)).toBe(300)
		} finally {
			if (original) Object.defineProperty(Range.prototype, 'getClientRects', original)
			else Reflect.deleteProperty(Range.prototype, 'getClientRects')
		}
	})

	it('recognizes computed height and max-height clipping, including SVG descendants', () => {
		const root = document.createElement('div')
		const byHeight = document.createElement('div')
		byHeight.style.cssText = 'height:0;overflow:hidden'
		const byMaxHeight = document.createElement('div')
		byMaxHeight.style.cssText = 'max-height:0;overflow:hidden'
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
		root.append(byHeight, byMaxHeight, svg)
		root.getBoundingClientRect = () => rect(100, 300)
		byHeight.getBoundingClientRect = () => rect(100, 4_000, 20)
		byHeight.getClientRects = () => [rect(100, 4_000, 20)] as unknown as DOMRectList
		byMaxHeight.getBoundingClientRect = () => rect(100, 4_000, 20)
		byMaxHeight.getClientRects = () => [rect(100, 4_000, 20)] as unknown as DOMRectList
		svg.getBoundingClientRect = () => rect(120, 100)
		svg.getClientRects = () => [rect(120, 100)] as unknown as DOMRectList

		expect(meaningfulContentWidth(root)).toBe(300)
	})

	it('uses the text-node walker fallback for documents without a window', () => {
		const detached = document.implementation.createHTMLDocument('email')
		const root = detached.createElement('div')
		root.getBoundingClientRect = () => rect(0, 300)
		Object.defineProperty(root, 'clientWidth', { configurable: true, value: 300 })

		expect(meaningfulContentWidth(root)).toBe(300)
	})

	it('includes overflowing visible text range geometry', () => {
		const root = document.createElement('div')
		const paragraph = document.createElement('p')
		paragraph.textContent = 'A long visible nowrap line'
		root.append(paragraph)
		root.getBoundingClientRect = () => rect(100, 300)
		const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
		Object.defineProperty(Range.prototype, 'getClientRects', {
			configurable: true,
			value: () => [rect(120, 600)] as unknown as DOMRectList,
		})

		try {
			expect(meaningfulContentWidth(root)).toBe(620)
		} finally {
			if (original) Object.defineProperty(Range.prototype, 'getClientRects', original)
			else Reflect.deleteProperty(Range.prototype, 'getClientRects')
		}
	})

	it('ignores empty text and zero-area element geometry', () => {
		const root = document.createElement('div')
		const empty = document.createTextNode('   ')
		const zero = document.createElement('span')
		root.append(empty, zero)
		root.getBoundingClientRect = () => rect(100, 300)
		zero.getClientRects = () => [rect(120, 0)] as unknown as DOMRectList

		expect(meaningfulContentWidth(root)).toBe(300)
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
		expect(css).toContain('container:ownmail-email / inline-size')
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

	it('uses zero-specificity defaults plus trusted readable-mode constraints', () => {
		const css = shadowStyleText()

		expect(css).toContain(':where(.email-root) :where(*, *::before, *::after){box-sizing:border-box;}')
		expect(css).toContain(':where(.email-root) :where(body){margin:0;}')
		expect(css).toContain(':host(:not([data-layout-mode="original"]))')
		expect(css).toContain(':where(html, body, table, img, video, svg, canvas){max-width:100%!important;}')
		expect(css).toContain(':where(table){min-width:0!important;table-layout:auto;}')
		expect(css).toContain('[style*="white-space" i][style*="nowrap" i]')
		expect(css).toContain(':where(.email-root) :where(pre){max-width:100%;white-space:pre-wrap;')
		expect(css).not.toContain('.email-root body{margin:0!important')
	})

	it('keeps the fitted transform and logical RTL origin below trusted important rules', () => {
		const css = shadowStyleText()
		expect(css).toContain('transform:scale(var(--ownmail-email-scale,1))!important')
		expect(css).toContain('width:var(--ownmail-email-natural-width,100%)!important')
		expect(css).toContain('[data-ownmail-direction="rtl"]{transform-origin:top right!important;}')
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

describe('applyEmailLayoutMode', () => {
	it('reflects either supported mode and tolerates a pre-mount ref', () => {
		expect(() => applyEmailLayoutMode(null, 'readable')).not.toThrow()
		const el = document.createElement('div')
		applyEmailLayoutMode(el, 'original')
		expect(el).toHaveAttribute('data-layout-mode', 'original')
		applyEmailLayoutMode(el, 'readable')
		expect(el).toHaveAttribute('data-layout-mode', 'readable')
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

describe('EMAIL_LAYOUT_STATUS_EVENT', () => {
	it('uses a stable public custom-event name', () => {
		expect(EMAIL_LAYOUT_STATUS_EVENT).toBe('email-layout-status')
	})
})
