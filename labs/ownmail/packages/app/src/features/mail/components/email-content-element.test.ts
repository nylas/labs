// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
	EMAIL_CANVAS_EVENT,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	EMAIL_REMOTE_IMAGES_EVENT,
	type EmailCanvasDetail,
	type EmailLayoutStatusDetail,
	type EmailRemoteImagesDetail,
	LINK_PREVIEW_EVENT,
} from '../lib/email-render.js'
import {
	anchorHref,
	applyControlledImageTreatment,
	applyEmailColorRemap,
	applyInheritedSurfaceContrast,
	applyPictureSourceMedia,
	ColorOverrides,
	detectEmailCanvas,
	ensureEmailElementDefined,
	hasLightMatteArtwork,
	isCallToActionAnchor,
	rewriteAnchors,
} from './email-content-element.js'

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

type EmailEl = HTMLElement & { emailHtml: string; measure: () => void; retryFailedImages: () => void }

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

describe('controlled image treatment', () => {
	it('updates only signed same-origin proxy references across attributes and CSS', () => {
		const token = `${'a'.repeat(20)}.${'b'.repeat(20)}`
		const root = document.createElement('div')
		root.innerHTML = `<style>.hero{background:url('/email-images/${token}?mode=automatic&theme=light')}</style>
			<img src="/email-images/${token}?mode=automatic&amp;theme=light" srcset="/email-images/${token}?mode=automatic&amp;theme=light 1x">
			<img class="remote" src="https://images.example/a.png">`
		applyControlledImageTreatment(root, 'original', 'dark')
		const image = root.querySelector('img')
		expect(image?.getAttribute('src')).toBe(`/email-images/${token}?mode=original&theme=dark`)
		expect(image?.getAttribute('srcset')).toContain('mode=original&theme=dark')
		expect(root.querySelector('style')?.textContent).toContain('mode=original&theme=dark')
		expect(root.querySelector('.remote')?.getAttribute('src')).toBe('https://images.example/a.png')
	})

	it('ignores malformed image URLs without disrupting valid content', () => {
		const root = document.createElement('div')
		root.innerHTML = '<img src="http://["><p>Still readable</p>'
		expect(() => applyControlledImageTreatment(root, 'automatic', 'dark')).not.toThrow()
		expect(root.textContent).toContain('Still readable')
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
			expect(anchor.style.getPropertyValue('color')).toBe('')
			expect(anchor.style.getPropertyValue('text-decoration')).toBe('underline')
			expect(anchor.style.getPropertyPriority('text-decoration')).toBe('important')
		}
	})

	it('enforces and restores trusted focus styles over sender inline important styles', () => {
		const el = mount(
			'<a class="focus" href="https://example.com" style="outline:none!important;box-shadow:none!important">Link</a><a class="unfocused" href="https://example.com/other">Other</a><p>Plain</p>',
		)
		const anchor = el.shadowRoot?.querySelector<HTMLAnchorElement>('.focus')
		anchor?.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
		anchor?.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
		expect(anchor?.style.getPropertyValue('outline')).toBe('2px solid CanvasText')
		expect(anchor?.style.getPropertyPriority('outline')).toBe('important')
		expect(anchor?.style.getPropertyValue('outline-offset')).toBe('2px')

		anchor?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }))
		expect(anchor?.style.getPropertyValue('outline')).toBe('none')
		expect(anchor?.style.getPropertyPriority('outline')).toBe('important')
		expect(anchor?.style.getPropertyValue('outline-offset')).toBe('')

		el.shadowRoot
			?.querySelector<HTMLAnchorElement>('.unfocused')
			?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }))
		el.shadowRoot
			?.querySelector('p')
			?.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
		el.shadowRoot?.dispatchEvent(new FocusEvent('focusin'))
	})
})

describe('applyInheritedSurfaceContrast', () => {
	it('repairs contrast against local painted surfaces while preserving readable authored colors', () => {
		const root = document.createElement('div')
		root.style.color = 'rgb(229, 231, 235)'
		root.innerHTML = `<style>
			.white{background-color:rgb(255,255,255)}
			.dark{background-color:rgb(10,20,30)}
			.card{background-color:rgba(255,255,255,.96)}
			.explicit-rule{background-color:white;color:rgb(255,0,0)}
			.explicit-same{background-color:white;color:rgb(229,231,235)}
			.transparent{background-color:transparent}
			.wide-gamut{background-color:color(display-p3 1 1 1)}
			.unsupported-color{background-color:white;color:color(display-p3 1 1 1)}
			.near-transparent{background-color:rgba(255,255,255,.96)}
			.too-transparent{background-color:rgba(255,255,255,.5)}
		</style>
		<div class="white">Inherited on white</div>
		<div class="dark">Inherited on dark <div class="card">Nested light card</div></div>
		<div class="explicit-rule">Stylesheet color</div>
		<div class="explicit-same">Stylesheet color matching its parent</div>
		<div class="white explicit-inline" style="color:rgb(0,0,255)">Inline color</div>
		<div class="white explicit-legacy" color="#008000">Legacy color</div>
		<div class="transparent">Transparent</div>
		<div class="wide-gamut">Unsupported computed color syntax</div>
		<div class="unsupported-color">Unsupported computed text color syntax</div>
		<div class="near-transparent">Nearly opaque direct surface</div>
		<div class="too-transparent">Translucent direct surface</div>`
		document.body.appendChild(root)

		applyInheritedSurfaceContrast(root, true)

		expect(root.querySelector('.white')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.dark')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.card')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.explicit-rule')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.explicit-same')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.explicit-inline')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.explicit-legacy')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.transparent')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.wide-gamut')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.unsupported-color')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.near-transparent')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.too-transparent')).not.toHaveAttribute('data-ownmail-inherited-color')

		applyInheritedSurfaceContrast(root, false)
		expect(root.querySelector('.white')).not.toHaveAttribute('style')
		expect(root.querySelector('.white')).not.toHaveAttribute('data-ownmail-inherited-color')
	})

	it('repairs explicit text inside a transparent wrapper on a light card', () => {
		const root = document.createElement('div')
		root.innerHTML = `<div class="card" style="background-color:rgb(220,220,220);color:rgb(26,26,26)">
			<p class="copy" style="color:rgb(255,255,255)!important">Card copy</p>
			<p class="translucent" style="color:rgba(0,0,0,.1)">Translucent copy</p>
			<p class="readable" style="color:rgb(26,26,26)">Readable copy</p>
		</div>`
		document.body.appendChild(root)

		applyInheritedSurfaceContrast(root, true)

		const copy = root.querySelector<HTMLElement>('.copy')
		expect(copy).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(copy?.style.color).toBe('rgb(26, 26, 26)')
		expect(copy?.style.getPropertyPriority('color')).toBe('important')
		expect(root.querySelector('.translucent')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
		expect(root.querySelector('.readable')).not.toHaveAttribute('data-ownmail-inherited-color')

		applyInheritedSurfaceContrast(root, false)
		expect(copy).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(copy?.style.color).toBe('rgb(255, 255, 255)')
		expect(copy?.style.getPropertyPriority('color')).toBe('important')
	})

	it('ignores backgrounds on wrappers that do not generate boxes', () => {
		const root = document.createElement('div')
		root.style.backgroundColor = 'rgb(0,0,0)'
		root.innerHTML = `<div style="display:contents;background-color:rgb(255,255,255)">
			<span class="contents-copy" style="color:rgb(255,255,255)">Visible on black</span>
		</div>
		<div style="display:none;background-color:rgb(255,255,255)">
			<span class="hidden-copy" style="color:rgb(255,255,255)">Hidden</span>
		</div>`
		document.body.appendChild(root)

		applyInheritedSurfaceContrast(root, true)

		expect(root.querySelector('.contents-copy')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.hidden-copy')).not.toHaveAttribute('data-ownmail-inherited-color')
	})

	it('does not infer a solid surface through a painted background image', () => {
		const root = document.createElement('div')
		root.style.backgroundColor = 'rgb(255,255,255)'
		root.innerHTML = `<div style="background-image:linear-gradient(rgb(0,0,0),rgb(0,0,0))">
			<span class="image-copy" style="color:rgb(255,255,255)">Readable on the image</span>
			<span class="opaque-copy" style="background:rgb(255,255,255);color:rgb(255,255,255)">Opaque child</span>
		</div>`
		document.body.appendChild(root)

		applyInheritedSurfaceContrast(root, true)

		expect(root.querySelector('.image-copy')).not.toHaveAttribute('data-ownmail-inherited-color')
		expect(root.querySelector('.opaque-copy')).toHaveAttribute('data-ownmail-inherited-color', 'dark')
	})

	it('chooses light inherited text for a dark nested surface and clears stale markers', () => {
		const root = document.createElement('div')
		root.style.color = 'rgb(26, 26, 26)'
		root.innerHTML =
			'<div class="dark" style="background-color:rgb(0,0,0)">Dark</div><div class="stale" data-ownmail-inherited-color="light">Stale</div>'
		document.body.appendChild(root)

		applyInheritedSurfaceContrast(root, true)
		expect(root.querySelector('.dark')).toHaveAttribute('data-ownmail-inherited-color', 'light')
		expect(root.querySelector('.stale')).not.toHaveAttribute('data-ownmail-inherited-color')

		applyInheritedSurfaceContrast(root, false)
		expect(root.querySelector('.dark')).not.toHaveAttribute('data-ownmail-inherited-color')
	})
})

describe('applyPictureSourceMedia', () => {
	it('materializes app theme, pane width, and residual browser media conditions', () => {
		const root = document.createElement('div')
		root.innerHTML = `<picture>
			<source class="dark" data-ownmail-picture-media='{"branches":[{"theme":"dark"}]}' media="not all">
			<source class="light-pane" data-ownmail-picture-media='{"branches":[{"theme":"light","pane":["(max-width:40rem)"]}]}' media="not all">
			<source class="residual" data-ownmail-picture-media='{"branches":[{"theme":"dark","media":"(orientation:landscape)"},{"pane":["(min-width:20em)","(max-width:50rem)"],"media":"(hover:hover)"}]}' media="not all">
			<img>
		</picture>`

		applyPictureSourceMedia(root, 'dark', 375)
		expect(root.querySelector('.dark')).toHaveAttribute('media', 'all')
		expect(root.querySelector('.light-pane')).toHaveAttribute('media', 'not all')
		expect(root.querySelector('.residual')).toHaveAttribute('media', '(orientation:landscape), (hover:hover)')

		applyPictureSourceMedia(root, 'light', 700)
		expect(root.querySelector('.dark')).toHaveAttribute('media', 'not all')
		expect(root.querySelector('.light-pane')).toHaveAttribute('media', 'not all')
		expect(root.querySelector('.residual')).toHaveAttribute('media', '(hover:hover)')
	})

	it('fails malformed trusted definitions and pane conditions closed', () => {
		const root = document.createElement('div')
		root.innerHTML = `<picture>
			<source class="invalid-json" data-ownmail-picture-media="{" media="all">
			<source class="null" data-ownmail-picture-media="null" media="all">
			<source class="array" data-ownmail-picture-media="[]" media="all">
			<source class="missing-branches" data-ownmail-picture-media="{}" media="all">
			<source class="branches-not-array" data-ownmail-picture-media='{"branches":"dark"}' media="all">
			<source class="empty" data-ownmail-picture-media='{"branches":[]}' media="all">
			<source class="invalid-pane" data-ownmail-picture-media='{"branches":[{"pane":["(orientation:portrait)"]}]}' media="all">
			<source class="pane-not-array" data-ownmail-picture-media='{"branches":[{"pane":"(max-width:600px)"}]}' media="all">
			<source class="empty-pane" data-ownmail-picture-media='{"branches":[{"pane":[]}]}' media="all">
			<source class="pane-number" data-ownmail-picture-media='{"branches":[{"pane":[42]}]}' media="all">
			<source class="invalid-theme" data-ownmail-picture-media='{"branches":[{"theme":"system"}]}' media="all">
			<source class="media-not-string" data-ownmail-picture-media='{"branches":[{"media":42}]}' media="all">
			<source class="empty-media" data-ownmail-picture-media='{"branches":[{"media":""}]}' media="all">
			<source class="unknown-key" data-ownmail-picture-media='{"branches":[{"theme":"dark","srcset":"https://example.test/tracker.png"}]}' media="all">
			<source class="empty-branch" data-ownmail-picture-media='{"branches":[{}]}' media="all">
			<source class="array-branch" data-ownmail-picture-media='{"branches":[[]]}' media="all">
			<img>
		</picture>`
		const picture = root.querySelector('picture') as HTMLPictureElement
		for (const [name, definition] of [
			['too-many-branches', { branches: Array.from({ length: 129 }, () => ({ theme: 'dark' })) }],
			['too-many-pane-parts', { branches: [{ pane: Array.from({ length: 17 }, () => '(max-width:1px)') }] }],
			['media-too-long', { branches: [{ media: 'x'.repeat(4_097) }] }],
		] as const) {
			const source = document.createElement('source')
			source.className = name
			source.setAttribute('data-ownmail-picture-media', JSON.stringify(definition))
			source.media = 'all'
			picture.prepend(source)
		}

		applyPictureSourceMedia(root, 'dark', 375)
		for (const source of root.querySelectorAll('source')) expect(source).toHaveAttribute('media', 'not all')
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

	it('remeasures after the app theme changes computed provider layout', async () => {
		const el = mount('<p>Theme layout</p>')
		await nextFrame()
		const measure = vi.spyOn(el, 'measure')

		el.setAttribute('data-email-theme', 'dark')
		await nextFrame()

		expect(measure).toHaveBeenCalledOnce()
	})

	it('defers dark image backing analysis until an image finishes loading', () => {
		const el = mount('<img alt="Still loading">')
		const image = el.shadowRoot?.querySelector('img') as HTMLImageElement
		Object.defineProperty(image, 'complete', { configurable: true, value: false })

		el.setAttribute('data-email-theme', 'dark')

		expect(image).not.toHaveAttribute('data-ownmail-image-backing')
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
		expect(children.at(-1)?.textContent).toContain(':host([data-email-strategy="remap"])')
	})

	it('leaves provider CSS backgrounds untouched instead of re-filtering them', () => {
		const el = mount('<div class="hero" style="background-image:linear-gradient(red,blue)">Hero</div>')
		const hero = el.shadowRoot?.querySelector<HTMLElement>('.hero')
		expect(hero).not.toHaveAttribute('data-ownmail-background-media')
		expect(hero?.style.getPropertyValue('background-image')).toContain('linear-gradient')
	})

	it('applies html set after the element is already connected', () => {
		const el = mount()
		el.emailHtml = '<p>Later</p>'
		el.emailHtml = '<p>Later</p>'
		expect(el.shadowRoot?.querySelector('.email-root')?.innerHTML).toContain('Later')
		expect(el.emailHtml).toBe('<p>Later</p>')
	})

	it('reports failed controlled images, renders an accessible fallback, and retries the signed URL', () => {
		const token = `${'a'.repeat(20)}.${'b'.repeat(20)}`
		const el = mount(
			`<picture><source srcset="/email-images/${token}?asset=dark"><img class="hero" alt="Campaign artwork" src="/email-images/${token}"></picture>`,
		)
		const statuses: EmailRemoteImagesDetail[] = []
		el.addEventListener(EMAIL_REMOTE_IMAGES_EVENT, (event) => {
			statuses.push((event as CustomEvent<EmailRemoteImagesDetail>).detail)
		})

		el.setAttribute('data-load-remote-images', '')
		const image = el.shadowRoot?.querySelector<HTMLImageElement>('.hero') as HTMLImageElement
		expect(statuses.at(-1)).toMatchObject({ failedImages: 0, pendingImages: 1 })
		el.retryFailedImages()
		expect(image.src).not.toContain('retry=')

		image.dispatchEvent(new Event('error'))
		expect(statuses.at(-1)).toMatchObject({ failedImages: 1, pendingImages: 0 })
		expect(image).toHaveAttribute('hidden')
		expect(el.shadowRoot?.querySelector('[role="img"]')).toHaveAccessibleName('Campaign artwork')
		image.dispatchEvent(new Event('error'))
		expect(el.shadowRoot?.querySelectorAll('[role="img"]')).toHaveLength(1)
		image.dispatchEvent(new Event('load'))
		expect(image).not.toHaveAttribute('hidden')
		expect(el.shadowRoot?.querySelector('[role="img"]')).toBeNull()

		image.alt = ''
		image.dispatchEvent(new Event('error'))
		expect(el.shadowRoot?.querySelector('[role="img"]')).toHaveAccessibleName('Image unavailable')

		el.retryFailedImages()
		expect(image).not.toHaveAttribute('hidden')
		expect(image.src).toContain('retry=1')
		expect(el.shadowRoot?.querySelector('source')?.srcset).toContain('retry=1')
		expect(statuses.at(-1)).toMatchObject({ failedImages: 0, pendingImages: 1 })

		image.dispatchEvent(new Event('load'))
		expect(statuses.at(-1)).toMatchObject({ failedImages: 0, pendingImages: 0 })
		expect(el.shadowRoot?.querySelector('[role="img"]')).toBeNull()
		image.dispatchEvent(new Event('error'))
		el.shadowRoot?.querySelector('[role="img"]')?.remove()
		el.retryFailedImages()
		expect(image.src).toContain('retry=2')
	})

	it('stores html set before connection and renders it on connect', () => {
		ensureEmailElementDefined()
		const el = document.createElement(EMAIL_ELEMENT_TAG) as EmailEl
		el.setAttribute('data-message-id', 'before-connect')
		el.retryFailedImages()
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
	it('reclassifies inherited surface colors when host dark handling changes', () => {
		const el = mount(
			'<style>@media (prefers-color-scheme: dark){p{color:white}}</style><div class="surface" style="background:rgb(255,255,255)">Text</div>',
		)
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const surface = content.querySelector('.surface') as HTMLElement
		for (let ancestor = surface.parentElement; ancestor; ancestor = ancestor.parentElement) {
			ancestor.style.color = 'rgb(229, 231, 235)'
			if (ancestor === content) break
		}
		stubSize(content, 'scrollWidth', 320)
		stubSize(el, 'clientWidth', 320)

		el.setAttribute('data-email-theme', 'dark')
		el.measure()
		expect(el).toHaveAttribute('data-email-strategy', 'native')
		expect(surface).toHaveAttribute('data-ownmail-inherited-color', 'dark')

		el.setAttribute('data-color-mode', 'original')
		el.measure()
		expect(el).toHaveAttribute('data-email-strategy', 'original')
		expect(surface).not.toHaveAttribute('data-ownmail-inherited-color')
	})

	it('shrinks content wider than the pane and sizes the box to the scaled height', () => {
		const el = mount('<p>wide</p>')
		el.setAttribute('data-layout-mode', 'original')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 360)
		stubSize(content, 'scrollHeight', 1000)
		stubSize(el, 'clientWidth', 300)
		el.measure()
		expect(content.style.transform).toBe('scale(var(--ownmail-email-scale, 1))')
		expect(content.style.getPropertyValue('--ownmail-email-scale')).toBe(`${300 / 360}`)
		expect(content.style.getPropertyPriority('--ownmail-email-scale')).toBe('important')
		expect(content.style.width).toBe('360px')
		expect(content.style.getPropertyPriority('width')).toBe('important')
		expect(el.style.height).toBe('834px')
		expect(el).not.toHaveAttribute('data-email-pan')
	})

	it('stops shrinking at the legibility floor and pans the remainder', () => {
		const el = mount('<p>very wide</p>')
		el.setAttribute('data-layout-mode', 'original')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(content, 'scrollHeight', 1000)
		stubSize(el, 'clientWidth', 300)
		el.measure()
		expect(content.style.getPropertyValue('--ownmail-email-scale')).toBe('0.8')
		expect(el.style.height).toBe('800px')
		expect(el).toHaveAttribute('data-email-pan')

		stubSize(content, 'scrollWidth', 300)
		stubSize(el, 'clientWidth', 320)
		el.measure()
		expect(el).not.toHaveAttribute('data-email-pan')
	})

	it('pans RTL overflow from the inline start', () => {
		const el = mount('<html><body dir="rtl"><p>واسع</p></body></html>')
		el.setAttribute('data-layout-mode', 'original')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 600)
		stubSize(el, 'clientWidth', 300)
		el.measure()
		expect(el).toHaveAttribute('data-email-pan', '')
		expect(el).toHaveAttribute('data-email-direction', 'rtl')
	})

	it('pans readable content that still cannot fit after reflow', () => {
		const el = mount('<pre>unbreakable</pre>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		stubSize(content, 'scrollWidth', 500)
		stubSize(el, 'clientWidth', 320)
		el.measure()
		expect(content.style.getPropertyValue('--ownmail-email-scale')).toBe('1')
		expect(el).toHaveAttribute('data-email-pan')
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
		expect(content.style.left).toBe('0px')
		expect(el).toHaveAttribute('data-email-direction', 'rtl')
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

	it('preserves bounded nowrap text in readable mode', () => {
		const el = mount('<div class="nowrap" nowrap>Short label</div>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const nowrap = content.querySelector('.nowrap') as HTMLElement
		stubSize(content, 'scrollWidth', 300)
		stubSize(el, 'clientWidth', 320)
		el.measure()

		expect(nowrap.style.getPropertyValue('white-space')).toBe('')
	})

	it('removes overflowing horizontal margins and stacks wide tables without revealing hidden rows', () => {
		const el = mount(
			'<div class="offset" style="margin-left:60px">Offset</div><table class="wide" width="600"><tbody><tr><td>Visible</td></tr><tr class="hidden" style="display:none"><td>Hidden</td></tr></tbody></table>',
		)
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const offset = content.querySelector('.offset') as HTMLElement
		const table = content.querySelector('.wide') as HTMLTableElement
		const visibleCell = table.querySelector('td') as HTMLTableCellElement
		const hiddenRow = table.querySelector('.hidden') as HTMLTableRowElement
		Object.defineProperty(table, 'scrollWidth', {
			configurable: true,
			get: () => (table.style.getPropertyValue('display') === 'block' ? 300 : 600),
		})
		content.getBoundingClientRect = () => ({ left: 0, right: 320, width: 320 }) as DOMRect
		offset.getBoundingClientRect = () => ({ left: 60, right: 380, width: 320 }) as DOMRect
		stubSize(content, 'scrollWidth', 600)
		stubSize(el, 'clientWidth', 320)

		el.measure()

		for (const property of ['margin-left', 'margin-right', 'margin-inline-start', 'margin-inline-end']) {
			expect(offset.style.getPropertyValue(property)).toBe('0px')
			expect(offset.style.getPropertyPriority(property)).toBe('important')
		}
		expect(table.style.getPropertyValue('display')).toBe('block')
		expect(visibleCell.style.getPropertyValue('display')).toBe('block')
		expect(visibleCell.style.getPropertyValue('overflow-wrap')).toBe('')
		expect(hiddenRow.style.getPropertyValue('display')).toBe('none')
	})

	it('splits words only inside a table that still overflows after stacking', () => {
		const el = mount('<table class="narrow"><tr><td>Supercalifragilistic</td></tr></table>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const table = content.querySelector('.narrow') as HTMLTableElement
		table.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200 }) as DOMRect
		content.getBoundingClientRect = () => ({ left: 0, right: 160, width: 160 }) as DOMRect
		stubSize(el, 'clientWidth', 160)
		el.measure()
		expect(table.style.getPropertyValue('display')).toBe('block')
		expect(table.querySelector('td')?.style.getPropertyValue('overflow-wrap')).toBe('anywhere')
	})

	it('stacks a table that drifts past the pane edge', () => {
		const el = mount('<table class="drift"><tr><td>a</td><td>b</td></tr></table>')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const table = content.querySelector('.drift') as HTMLTableElement
		table.getBoundingClientRect = () =>
			(table.style.getPropertyValue('display') === 'block'
				? { left: 0, right: 150, width: 150 }
				: { left: -10, right: 150, width: 160 }) as DOMRect
		content.getBoundingClientRect = () => ({ left: 0, right: 160, width: 160 }) as DOMRect
		stubSize(el, 'clientWidth', 160)
		el.measure()
		expect(table.style.getPropertyValue('display')).toBe('block')
		expect(table.querySelector('td')?.style.getPropertyValue('overflow-wrap')).toBe('')
	})

	it('keeps table rows intact whenever clamping lets the cells fit, even in a narrow pane', () => {
		const el = mount(
			'<table class="wide" width="1200"><tbody><tr><td>Status</td><td>Job</td><td>Annotations</td></tr></tbody></table><table class="gone" style="display:none"><tr><td>x</td></tr></table>',
		)
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const table = content.querySelector('.wide') as HTMLTableElement
		const hidden = content.querySelector('.gone') as HTMLTableElement
		stubSize(content, 'scrollWidth', 1_200)
		stubSize(table, 'scrollWidth', 300)
		stubSize(hidden, 'scrollWidth', 900)
		stubSize(el, 'clientWidth', 320)

		el.measure()

		expect(table.style.getPropertyValue('table-layout')).toBe('')
		expect(table.style.getPropertyValue('width')).toBe('100%')
		expect(table.style.getPropertyValue('display')).toBe('')
		expect(hidden.style.getPropertyValue('display')).toBe('none')
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

function stubBox(element: Element, width: number, height = 100) {
	Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => width })
	Object.defineProperty(element, 'offsetHeight', { configurable: true, get: () => height })
}

const REPORT_HTML = `<div class="canvas" style="background-color:rgb(238,240,243)">
	<div class="card" style="background-color:rgb(255,255,255);color:rgb(34,34,34);border:1px solid rgb(209,217,224)">
		<p class="muted" style="color:rgb(119,119,119)">Daily report</p>
		<div class="band" style="background-color:rgb(38,38,38);color:rgb(255,255,255)">NEW ERRORS</div>
		<a class="cta" href="https://report.test" style="background-color:rgb(60,91,214);color:rgb(255,255,255);padding:12px">Open</a>
	</div>
</div>`

function mountReport(head = ''): { el: EmailEl; content: HTMLElement; events: EmailCanvasDetail[] } {
	const el = mount(`${head}${REPORT_HTML}`)
	const events: EmailCanvasDetail[] = []
	el.addEventListener(EMAIL_CANVAS_EVENT, (event) =>
		events.push((event as CustomEvent<EmailCanvasDetail>).detail),
	)
	const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
	stubSize(content, 'scrollWidth', 320)
	stubSize(content, 'scrollHeight', 400)
	stubSize(el, 'clientWidth', 320)
	stubBox(content.querySelector('.canvas') as Element, 320, 400)
	stubBox(content.querySelector('.card') as Element, 300, 380)
	return { el, content, events }
}

describe('<ownmail-email> color strategy', () => {
	it('remaps a light-only message for the dark reader and reports a transparent canvas', () => {
		const { el, content, events } = mountReport()
		el.setAttribute('data-email-theme', 'dark')
		el.measure()

		const canvas = content.querySelector('.canvas') as HTMLElement
		const card = content.querySelector('.card') as HTMLElement
		const band = content.querySelector('.band') as HTMLElement
		const cta = content.querySelector('.cta') as HTMLElement
		expect(el).toHaveAttribute('data-email-strategy', 'remap')
		expect(canvas.style.getPropertyValue('background-color')).toBe('transparent')
		expect(card.style.getPropertyValue('background-color')).not.toBe('rgb(255, 255, 255)')
		expect(card.style.getPropertyPriority('color')).toBe('important')
		expect(card.style.getPropertyValue('border-top-color')).not.toBe('rgb(209, 217, 224)')
		expect(band.style.getPropertyValue('background-color')).toBe('rgb(38, 38, 38)')
		expect(cta.style.getPropertyValue('background-color')).toBe('rgb(60, 91, 214)')
		expect(cta).toHaveAttribute('data-ownmail-cta')
		expect(events.at(-1)).toEqual({ strategy: 'remap', canvas: null, height: 400 })

		const remappedCard = card.getAttribute('style')
		el.measure()
		expect(card.getAttribute('style')).toBe(remappedCard)
		expect(events).toHaveLength(1)
	})

	it('restores sender colors and extends the canvas when the reader keeps original colors', () => {
		const { el, content, events } = mountReport()
		el.setAttribute('data-email-theme', 'dark')
		el.measure()
		el.setAttribute('data-color-mode', 'original')
		el.measure()

		const card = content.querySelector('.card') as HTMLElement
		expect(el).toHaveAttribute('data-email-strategy', 'original')
		expect(card.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)')
		expect(card.style.getPropertyPriority('background-color')).toBe('')
		expect(el.style.getPropertyValue('--ownmail-email-canvas')).toBe('rgb(238, 240, 243)')
		expect(events.at(-1)).toEqual({ strategy: 'original', canvas: 'rgb(238, 240, 243)', height: 400 })
	})

	it('trusts a sender dark stylesheet and reports its canvas', () => {
		const { el, events } = mountReport('<style>@media (prefers-color-scheme: dark){p{color:white}}</style>')
		el.setAttribute('data-email-theme', 'dark')
		el.measure()
		expect(el).toHaveAttribute('data-email-strategy', 'native')
		expect(el.style.getPropertyValue('--ownmail-email-canvas')).toBe('')
		expect(events.at(-1)?.canvas).toBe('rgb(238, 240, 243)')
	})

	it('keeps light-matte artwork on paper with light image treatment', () => {
		const token = `${'a'.repeat(20)}.${'b'.repeat(20)}`
		const el = mount(
			`<table><tr><td class="cell" style="background-color:rgb(255,255,255)"><img class="logo" alt="Logo" src="/email-images/${token}?mode=automatic&amp;theme=dark"></td></tr></table><img class="spacer" hidden alt=""><img class="pending" alt="Pending">`,
		)
		el.setAttribute('data-load-remote-images', '')
		const content = el.shadowRoot?.querySelector('.email-root') as HTMLElement
		const logo = content.querySelector('.logo') as HTMLImageElement
		for (const [property, value] of Object.entries({
			complete: true,
			naturalWidth: 300,
			naturalHeight: 56,
			offsetWidth: 300,
			offsetHeight: 56,
		})) {
			Object.defineProperty(logo, property, { configurable: true, get: () => value })
		}
		Object.defineProperty(content.querySelector('.pending'), 'complete', {
			configurable: true,
			get: () => false,
		})
		const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage() {},
			getImageData: () => ({ data: new Uint8ClampedArray(32 * 16 * 4).fill(255) }),
		} as unknown as CanvasRenderingContext2D)
		stubSize(el, 'clientWidth', 320)
		el.setAttribute('data-email-theme', 'dark')
		el.measure()
		getContext.mockRestore()

		expect(el).toHaveAttribute('data-email-strategy', 'paper')
		expect(el.style.getPropertyValue('--ownmail-email-canvas')).toBe('rgb(255, 255, 255)')
		expect(logo.getAttribute('src')).toContain('theme=light')
	})

	it('does not sample artwork when the sender ships dark styles or the reader keeps originals', () => {
		const el = mount('<style>@media (prefers-color-scheme: dark){p{color:white}}</style><img alt="Art">')
		const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
		stubSize(el, 'clientWidth', 320)
		el.setAttribute('data-email-theme', 'dark')
		el.measure()
		expect(getContext).not.toHaveBeenCalled()
		getContext.mockRestore()
	})
})

describe('detectEmailCanvas', () => {
	it('finds no canvas before the pane has a width', () => {
		expect(detectEmailCanvas(document.createElement('div'), 0)).toEqual({ color: null, elements: new Set() })
	})

	it('never treats a short full-width banner as the canvas, but joins full-width default-white rows', () => {
		const root = document.createElement('div')
		root.innerHTML = `<style>p{}</style><div class="hero" style="background-color:rgb(9,105,218)">Hero</div>
			<div class="row" style="background-color:rgb(255,255,255)">Row</div>
			<div class="ghost" style="background-color:rgba(255,255,255,0.2)">Ghost</div>
			<svg class="art"></svg><div class="narrow" style="background-color:rgb(255,255,255)">Card</div>`
		document.body.append(root)
		stubSize(root, 'scrollHeight', 1000)
		stubBox(root.querySelector('.hero') as Element, 320, 80)
		stubBox(root.querySelector('.row') as Element, 320, 80)
		stubBox(root.querySelector('.ghost') as Element, 320, 900)
		stubBox(root.querySelector('.narrow') as Element, 200, 900)
		stubBox(root.querySelector('style') as Element, 320, 900)
		const canvas = detectEmailCanvas(root, 320)
		expect(canvas.color).toBeNull()
		expect([...canvas.elements].map((element) => element.className)).toEqual(['row'])
	})
})

describe('applyEmailColorRemap', () => {
	it('keeps authored colors over background images and skips media, SVG, and contents boxes', () => {
		const root = document.createElement('div')
		root.innerHTML = `<div class="art" style="background-image:linear-gradient(red,blue);color:rgb(20,20,20)"><span class="over" style="color:rgb(10,10,10)">Over art</span><span class="veil" style="background-color:rgba(255,255,255,0.4)">Veil</span><span class="chip" style="background-color:rgb(255,255,255);color:rgb(20,20,20)">Chip</span></div>
			<p class="modern" style="color:oklch(0.5 0.1 120)">Modern color</p>
			<div class="contents" style="display:contents;background-color:rgb(255,255,255);color:rgb(30,30,30)">Contents</div>
			<div class="tint" style="background-color:rgba(255,255,255,0.5);border-top:2px solid rgb(20,20,20)">Tint</div>
			<svg><text class="svg-text" fill="black">Chart</text></svg><img alt="">`
		document.body.append(root)
		const overrides = new ColorOverrides()
		applyEmailColorRemap(root, { color: null, elements: new Set() }, overrides)

		expect((root.querySelector('.over') as HTMLElement).style.getPropertyValue('color')).toBe(
			'rgb(10, 10, 10)',
		)
		expect((root.querySelector('.over') as HTMLElement).style.getPropertyPriority('color')).toBe('')
		expect((root.querySelector('.veil') as HTMLElement).style.getPropertyPriority('background-color')).toBe(
			'',
		)
		expect((root.querySelector('.chip') as HTMLElement).style.getPropertyPriority('background-color')).toBe(
			'important',
		)
		const contents = root.querySelector('.contents') as HTMLElement
		expect(contents.style.getPropertyPriority('background-color')).toBe('')
		expect(contents.style.getPropertyPriority('color')).toBe('important')
		const tint = root.querySelector('.tint') as HTMLElement
		expect(tint.style.getPropertyPriority('background-color')).toBe('important')
		expect(tint.style.getPropertyValue('border-top-color')).toBe('rgb(20, 20, 20)')
		expect(root.querySelector('.svg-text')?.getAttribute('style')).toBeNull()

		overrides.restore()
		expect(tint.style.getPropertyValue('background-color')).toBe('rgba(255, 255, 255, 0.5)')
		expect(contents.style.getPropertyPriority('color')).toBe('')
	})

	it('removes a style attribute the remap created when restoring', () => {
		const root = document.createElement('div')
		root.innerHTML = '<p class="plain">Plain text</p>'
		document.body.append(root)
		const plain = root.querySelector('.plain') as HTMLElement
		plain.style.color = 'rgb(0, 0, 0)'
		plain.removeAttribute('style')
		const overrides = new ColorOverrides()
		overrides.set(plain, 'color', 'rgb(240, 240, 240)')
		expect(plain).toHaveAttribute('style')
		overrides.restore()
		expect(plain).not.toHaveAttribute('style')
	})
})

describe('hasLightMatteArtwork', () => {
	it('ignores images that are hidden, unloaded, or unmeasured', () => {
		const root = document.createElement('div')
		root.innerHTML = '<img hidden alt=""><span><img alt="Pending"></span>'
		document.body.append(root)
		expect(hasLightMatteArtwork(root, { red: 255, green: 255, blue: 255, alpha: 1 })).toBe(false)
	})
})

describe('isCallToActionAnchor', () => {
	function anchor(style: string): HTMLAnchorElement {
		const element = document.createElement('a')
		element.href = 'https://example.test'
		element.setAttribute('style', style)
		document.body.append(element)
		return element
	}

	it('recognizes filled, padded, and bordered button links but not text links', () => {
		expect(isCallToActionAnchor(anchor('background-image:linear-gradient(red,blue)'))).toBe(true)
		expect(isCallToActionAnchor(anchor('display:inline-block;padding:10px 20px'))).toBe(true)
		expect(isCallToActionAnchor(anchor('display:block;border:1px solid rgb(0,0,0)'))).toBe(true)
		expect(isCallToActionAnchor(anchor('display:inline-block'))).toBe(false)
		expect(isCallToActionAnchor(anchor('padding:12px'))).toBe(false)
	})
})
