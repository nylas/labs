// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { anchorHref, ensureEmailElementDefined, rewriteAnchors } from './email-content-element.js'
import { EMAIL_ELEMENT_TAG, LINK_PREVIEW_EVENT } from './email-render.js'

// A ResizeObserver stub that invokes its callback on observe(), so the element's
// measure() path runs during connection (jsdom has no real ResizeObserver).
beforeAll(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			cb: ResizeObserverCallback
			constructor(cb: ResizeObserverCallback) {
				this.cb = cb
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

afterEach(() => {
	document.body.innerHTML = ''
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
})

describe('<ownmail-email> rendering', () => {
	it('renders sanitized html into a scoped shadow root and rewrites links', () => {
		const el = mount('<p>Hi</p><a href="https://x.com">link</a><script>alert(1)</script>')
		const root = el.shadowRoot?.querySelector('.email-root')
		expect(root?.innerHTML).toContain('<p>Hi</p>')
		expect(root?.innerHTML).not.toContain('<script')
		expect(root?.querySelector('a')?.getAttribute('target')).toBe('_blank')
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
})

describe('<ownmail-email> scaling', () => {
	it('shrinks content wider than the pane and sizes the box to the scaled height', () => {
		const el = mount('<p>wide</p>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(content, 'scrollHeight', 1000)
		stubSize(el, 'clientWidth', 300)
		el.measure()
		expect(content.style.transform).toBe('scale(0.5)')
		expect(el.style.height).toBe('500px')
	})

	it('clears any scaling when content fits the pane', () => {
		const el = mount('<p>fits</p>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 300)
		stubSize(el, 'clientWidth', 800)
		el.measure()
		expect(content.style.transform).toBe('')
		expect(el.style.height).toBe('')
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
