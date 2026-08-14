// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	type EmailLayoutStatusDetail,
	LINK_PREVIEW_EVENT,
} from '../lib/email-render.js'
import { anchorHref, ensureEmailElementDefined, rewriteAnchors } from './email-content-element.js'

const resizeCallbacks: ResizeObserverCallback[] = []

// A ResizeObserver stub that invokes its callback on observe(), so the element's
// measure() path runs during connection (jsdom has no real ResizeObserver).
beforeAll(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			cb: ResizeObserverCallback
			constructor(cb: ResizeObserverCallback) {
				this.cb = cb
				resizeCallbacks.push(cb)
			}
			observe() {
				this.cb([], this as unknown as ResizeObserver)
			}
			unobserve() {}
			disconnect() {}
		},
	)
})

type EmailEl = HTMLElement & { emailHtml: string; measure: () => void }

function mount(html?: string): EmailEl {
	ensureEmailElementDefined()
	const el = document.createElement(EMAIL_ELEMENT_TAG) as EmailEl
	if (html !== undefined) el.emailHtml = html
	document.body.appendChild(el)
	return el
}

/** Force layout measurements jsdom otherwise reports as 0. */
function stubSize(el: HTMLElement, prop: 'scrollWidth' | 'scrollHeight' | 'clientWidth', value: number) {
	Object.defineProperty(el, prop, { configurable: true, get: () => value })
}

async function nextFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

afterEach(() => {
	document.body.innerHTML = ''
	resizeCallbacks.length = 0
})

describe('anchorHref', () => {
	it('returns null for a non-element target', () => {
		expect(anchorHref(null)).toBeNull()
		expect(anchorHref(new EventTarget())).toBeNull()
	})

	it('returns null when the target is not inside a link', () => {
		const div = document.createElement('div')
		expect(anchorHref(div)).toBeNull()
	})

	it('returns the nearest ancestor link href', () => {
		const anchor = document.createElement('a')
		anchor.href = 'https://example.com/x'
		const span = document.createElement('span')
		anchor.appendChild(span)
		expect(anchorHref(span)).toBe('https://example.com/x')
	})
})

describe('rewriteAnchors', () => {
	it('forces every link to open safely in a new tab', () => {
		const root = document.createElement('div')
		root.innerHTML = '<a href="https://a.com">a</a><a href="https://b.com">b</a>'
		rewriteAnchors(root)
		for (const anchor of root.querySelectorAll('a')) {
			expect(anchor.getAttribute('target')).toBe('_blank')
			expect(anchor.getAttribute('rel')).toBe('noopener noreferrer nofollow')
		}
	})
})

describe('ensureEmailElementDefined', () => {
	it('registers the custom element and is idempotent', () => {
		ensureEmailElementDefined()
		ensureEmailElementDefined() // second call hits the already-registered guard
		expect(customElements.get(EMAIL_ELEMENT_TAG)).toBeTypeOf('function')
	})

	it('is a no-op when customElements is unavailable (server-like)', () => {
		const real = globalThis.customElements
		vi.stubGlobal('customElements', undefined)
		try {
			expect(() => ensureEmailElementDefined()).not.toThrow()
		} finally {
			vi.stubGlobal('customElements', real)
		}
	})

	it('accepts a layout mode before the element is connected', () => {
		ensureEmailElementDefined()
		const el = document.createElement(EMAIL_ELEMENT_TAG)
		expect(() => el.setAttribute('data-layout-mode', 'original')).not.toThrow()
		expect(el.shadowRoot).toBeNull()
	})

	it('ignores a layout attribute notification when the value did not change', async () => {
		const el = mount('<p>Stable</p>')
		el.setAttribute('data-layout-mode', 'readable')
		await nextFrame()
		const measure = vi.spyOn(el, 'measure')

		el.setAttribute('data-layout-mode', 'readable')
		await nextFrame()

		expect(measure).not.toHaveBeenCalled()
	})
})

describe('<ownmail-email> rendering', () => {
	it('renders sanitized html into a scoped shadow root and rewrites links', () => {
		const el = mount('<p>Hi</p><a href="https://x.com">link</a><script>alert(1)</script>')
		const root = el.shadowRoot?.querySelector('.email-root')
		expect(root?.innerHTML).toContain('<p>Hi</p>')
		expect(root?.innerHTML).not.toContain('<script')
		expect(root?.querySelector('a')?.getAttribute('target')).toBe('_blank')
	})

	it('mounts the sanitized html/head/body tree instead of flattening sender document semantics', () => {
		const el = mount(
			'<html lang="fr"><head><style>body.canvas{background:navy}</style></head><body class="canvas" dir="rtl"><p>Bonjour</p></body></html>',
		)
		const root = el.shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('html')).toHaveAttribute('lang', 'fr')
		expect(root?.querySelector('head style')?.textContent).toContain('body.canvas')
		expect(root?.querySelector('body')).toHaveAttribute('class', 'canvas')
		expect(root?.querySelector('body')).toHaveAttribute('dir', 'rtl')
	})

	it('keeps OwnMail theme rules after broad provider styles in the shadow cascade', () => {
		const el = mount('<style>div { filter: none !important; background: white !important; }</style><p>Hi</p>')
		const children = Array.from(el.shadowRoot?.children ?? [])
		expect(children.at(-1)?.tagName).toBe('STYLE')
		expect(children.at(-1)?.textContent).toContain(':host([data-dark-invert])')
	})

	it('applies html set after the element is already connected', () => {
		const el = mount()
		el.emailHtml = '<p>Later</p>'
		expect(el.shadowRoot?.querySelector('.email-root')?.innerHTML).toContain('Later')
		expect(el.emailHtml).toBe('<p>Later</p>')
	})

	it('stores html set before connection and renders it on connect', () => {
		ensureEmailElementDefined()
		const el = document.createElement(EMAIL_ELEMENT_TAG) as EmailEl
		el.emailHtml = '<p>Early</p>' // set while contentRoot is still null
		expect(el.shadowRoot).toBeNull()
		document.body.appendChild(el)
		expect(el.shadowRoot?.querySelector('.email-root')?.innerHTML).toContain('Early')
	})

	it('reuses its shadow root and observer when reconnected', () => {
		const el = mount('<p>x</p>')
		const shadow = el.shadowRoot
		el.remove()
		document.body.appendChild(el)
		expect(el.shadowRoot).toBe(shadow)
	})

	it('remeasures after media and font loading settles, then removes the font listener', async () => {
		const fontListeners = new Map<string, EventListener>()
		const fontSet = {
			ready: Promise.resolve(),
			addEventListener: vi.fn((type: string, listener: EventListener) => fontListeners.set(type, listener)),
			removeEventListener: vi.fn((type: string) => fontListeners.delete(type)),
		}
		const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
		Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet })

		try {
			const el = mount('<img alt="late"><video></video><p>text</p>')
			await nextFrame()
			const measure = vi.spyOn(el, 'measure')
			const image = el.shadowRoot?.querySelector('img') as HTMLImageElement
			const video = el.shadowRoot?.querySelector('video') as HTMLVideoElement
			const paragraph = el.shadowRoot?.querySelector('p') as HTMLParagraphElement

			image.dispatchEvent(new Event('load'))
			await nextFrame()
			video.dispatchEvent(new Event('error'))
			await nextFrame()
			paragraph.dispatchEvent(new Event('load'))
			fontListeners.get('loadingdone')?.(new Event('loadingdone'))
			await nextFrame()

			expect(measure).toHaveBeenCalledTimes(3)
			expect(fontSet.addEventListener).toHaveBeenCalledWith('loadingdone', expect.any(Function))
			el.remove()
			expect(fontSet.removeEventListener).toHaveBeenCalledWith('loadingdone', expect.any(Function))
		} finally {
			if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
			else Reflect.deleteProperty(document, 'fonts')
		}
	})

	it('falls back to a microtask when animation frames are unavailable', async () => {
		const el = mount('<p>fallback</p>')
		await nextFrame()
		const measure = vi.spyOn(el, 'measure')
		const originalRequestAnimationFrame = globalThis.requestAnimationFrame
		vi.stubGlobal('requestAnimationFrame', undefined)

		try {
			el.setAttribute('data-layout-mode', 'original')
			await Promise.resolve()
			expect(measure).toHaveBeenCalledOnce()
		} finally {
			vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame)
		}
	})

	it('remeasures relevant descendant and root attribute mutations', async () => {
		const el = mount('<p>mutation</p>')
		await nextFrame()
		const measure = vi.spyOn(el, 'measure')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const paragraph = content.querySelector('p') as HTMLParagraphElement

		paragraph.className = 'changed'
		await nextFrame()
		content.className = 'email-root changed'
		await nextFrame()

		expect(measure).toHaveBeenCalledTimes(2)
	})

	it('ignores renderer-owned root style mutations and unchanged host widths', async () => {
		const el = mount('<p>stable</p>')
		await nextFrame()
		const measure = vi.spyOn(el, 'measure')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement

		content.style.backgroundColor = 'transparent'
		resizeCallbacks.at(-1)?.([], {} as ResizeObserver)
		resizeCallbacks.at(-1)?.([], {} as ResizeObserver)
		await nextFrame()

		expect(measure).not.toHaveBeenCalled()
	})

	it('drops a queued microtask measurement after disconnection', async () => {
		const el = mount('<p>disconnect</p>')
		await nextFrame()
		const measure = vi.spyOn(el, 'measure')
		const originalRequestAnimationFrame = globalThis.requestAnimationFrame
		vi.stubGlobal('requestAnimationFrame', undefined)

		try {
			el.setAttribute('data-layout-mode', 'original')
			el.remove()
			await Promise.resolve()
			expect(measure).not.toHaveBeenCalled()
		} finally {
			vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame)
		}
	})
})

describe('<ownmail-email> scaling', () => {
	it('shrinks content wider than the pane and sizes the box to the scaled height', () => {
		const el = mount('<p>wide</p>')
		el.setAttribute('data-layout-mode', 'original')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(content, 'scrollHeight', 1000)
		stubSize(el, 'clientWidth', 300)
		el.measure()
		expect(content.style.transform).toBe('scale(var(--ownmail-email-scale, 1))')
		expect(content.style.getPropertyValue('--ownmail-email-scale')).toBe('0.5')
		expect(content.style.getPropertyPriority('--ownmail-email-scale')).toBe('important')
		expect(content.style.width).toBe('600px')
		expect(content.style.getPropertyPriority('width')).toBe('important')
		expect(el.style.height).toBe('500px')
	})

	it('clears any scaling when content fits the pane', () => {
		const el = mount('<p>fits</p>')
		el.setAttribute('data-layout-mode', 'original')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 300)
		stubSize(el, 'clientWidth', 800)
		el.measure()
		expect(content.style.getPropertyValue('--ownmail-email-scale')).toBe('1')
		expect(el.style.height).toBe('')
	})

	it('uses the logical inline end as the transform origin for RTL email', () => {
		const el = mount('<html><body dir="rtl"><table width="600"><tr><td>x</td></tr></table></body></html>')
		el.setAttribute('data-layout-mode', 'original')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(el, 'clientWidth', 300)
		el.measure()
		expect(content).toHaveAttribute('data-ownmail-direction', 'rtl')
		expect(content.style.transformOrigin).toBe('top right')
		expect(content.style.left).toBe('-300px')
	})

	it('emits a deduplicated composed layout status for the wrapper', () => {
		const el = mount('<table width="600"><tr><td>x</td></tr></table>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(content, 'scrollHeight', 200)
		stubSize(el, 'clientWidth', 300)
		const details: EmailLayoutStatusDetail[] = []
		el.addEventListener(EMAIL_LAYOUT_STATUS_EVENT, (event) => {
			details.push((event as CustomEvent<EmailLayoutStatusDetail>).detail)
		})

		el.measure()
		el.measure()

		expect(details).toEqual([
			{
				mode: 'readable',
				naturalWidth: 300,
				containerWidth: 300,
				scale: 1,
				reflowed: true,
				needsFit: false,
			},
		])
	})

	it('detects a fixed inline width even when a nonnumeric width attribute is present', () => {
		const el = mount('<table width="auto" style="width: 600px"><tr><td>x</td></tr></table>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(el, 'clientWidth', 300)
		let detail: EmailLayoutStatusDetail | undefined
		el.addEventListener(EMAIL_LAYOUT_STATUS_EVENT, (event) => {
			detail = (event as CustomEvent<EmailLayoutStatusDetail>).detail
		})

		el.measure()

		expect(detail?.reflowed).toBe(true)
	})

	it('does not offer original layout for a small fixed-size image', () => {
		const el = mount('<img src="https://example.com/logo.png" width="100" height="40" alt="Logo">')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 300)
		stubSize(el, 'clientWidth', 320)
		let detail: EmailLayoutStatusDetail | undefined
		el.addEventListener(EMAIL_LAYOUT_STATUS_EVENT, (event) => {
			detail = (event as CustomEvent<EmailLayoutStatusDetail>).detail
		})

		el.measure()

		expect(detail?.reflowed).toBe(false)
	})

	it('keeps non-table fixed layouts and small text readable without scaling', () => {
		const el = mount('<div class="wide" style="min-width:1200px!important;font-size:8px">Readable body</div>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const wide = content.querySelector('.wide') as HTMLElement
		stubSize(content, 'scrollWidth', 1_200)
		stubSize(el, 'clientWidth', 320)
		el.measure()

		expect(content.style.getPropertyValue('--ownmail-email-scale')).toBe('1')
		expect(content.style.width).toBe('320px')
		expect(wide.style.getPropertyValue('min-width')).toBe('0px')
		expect(wide.style.getPropertyPriority('min-width')).toBe('important')
		expect(wide.style.getPropertyValue('font-size')).toBe('12px')
		expect(wide.style.getPropertyPriority('font-size')).toBe('important')
	})

	it('normalizes explicit nowrap text in readable mode', () => {
		const el = mount('<div class="nowrap" style="white-space:nowrap">Long subject</div>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const nowrap = content.querySelector('.nowrap') as HTMLElement
		stubSize(nowrap, 'scrollWidth', 800)
		stubSize(content, 'scrollWidth', 800)
		stubSize(el, 'clientWidth', 320)
		el.measure()

		expect(nowrap.style.getPropertyValue('white-space')).toBe('normal')
		expect(nowrap.style.getPropertyPriority('white-space')).toBe('important')
	})

	it('normalizes computed fixed widths and safely skips non-HTML elements', () => {
		const el = mount(
			'<style>.by-width{width:900px}.by-min{min-width:800px}</style><div class="by-width">Width</div><div class="by-min">Minimum</div><svg class="wide-svg"></svg>',
		)
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const byWidth = content.querySelector('.by-width') as HTMLElement
		const byMin = content.querySelector('.by-min') as HTMLElement
		const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math')
		const svg = content.querySelector('.wide-svg') as SVGElement
		svg.getBoundingClientRect = () => ({ width: 900 }) as DOMRect
		content.append(math)
		stubSize(content, 'scrollWidth', 900)
		stubSize(el, 'clientWidth', 320)
		const nativeGetComputedStyle = globalThis.getComputedStyle
		const computedStyle = vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element) => {
			const style = nativeGetComputedStyle(element)
			return new Proxy(style, {
				get(target, property) {
					if (element === byWidth && property === 'width') return '900px'
					if (element === byMin && property === 'minWidth') return '800px'
					return Reflect.get(target, property)
				},
			})
		})

		try {
			el.measure()

			expect(byWidth.style.getPropertyValue('width')).toBe('100%')
			expect(byMin.style.getPropertyValue('min-width')).toBe('0px')
			expect(svg).toBeInstanceOf(SVGElement)
		} finally {
			computedStyle.mockRestore()
		}
	})

	it('does nothing when measured before the content root exists', () => {
		ensureEmailElementDefined()
		const el = document.createElement(EMAIL_ELEMENT_TAG) as EmailEl
		expect(() => el.measure()).not.toThrow()
	})
})

type PreviewDetail = { href: string | null; x: number; y: number }

describe('<ownmail-email> link preview events', () => {
	it('emits the hovered link with the pointer position and clears on leave', () => {
		const el = mount('<a href="https://link.com">go</a>')
		const details: PreviewDetail[] = []
		el.addEventListener(LINK_PREVIEW_EVENT, (e) => {
			details.push((e as CustomEvent<PreviewDetail>).detail)
		})

		const anchor = el.shadowRoot?.querySelector('a') as HTMLElement
		anchor.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 240 }))
		anchor.dispatchEvent(new Event('pointerout', { bubbles: true }))

		expect(details).toEqual([
			{ href: 'https://link.com', x: 120, y: 240 },
			{ href: null, x: 0, y: 0 },
		])
	})

	it('anchors the preview to the link box for keyboard focus (no pointer position)', () => {
		const el = mount('<a href="https://link.com">go</a>')
		const anchor = el.shadowRoot?.querySelector('a') as HTMLElement
		anchor.getBoundingClientRect = () => ({ left: 30, bottom: 50 }) as DOMRect
		let detail: PreviewDetail | undefined
		el.addEventListener(LINK_PREVIEW_EVENT, (e) => {
			detail = (e as CustomEvent<PreviewDetail>).detail
		})

		anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

		expect(detail).toEqual({ href: 'https://link.com', x: 30, y: 50 })
	})

	it('does not emit when hovering a non-link region', () => {
		const el = mount('<p>plain</p>')
		const listener = vi.fn()
		el.addEventListener(LINK_PREVIEW_EVENT, listener)
		const p = el.shadowRoot?.querySelector('p') as HTMLElement
		p.dispatchEvent(new Event('pointerover', { bubbles: true }))
		expect(listener).not.toHaveBeenCalled()
	})
})

describe('<ownmail-email> disconnect', () => {
	it('tolerates disconnectedCallback before it ever connected', () => {
		ensureEmailElementDefined()
		const el = document.createElement(EMAIL_ELEMENT_TAG) as HTMLElement & {
			disconnectedCallback: () => void
		}
		expect(() => el.disconnectedCallback()).not.toThrow()
	})
})
